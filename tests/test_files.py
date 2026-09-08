import base64
import io
import zipfile
from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput
from cortex_core.corpus import CorpusService
from cortex_core.files import FileService, parse_bytes
from cortex_core.worker import drain
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import text


def call(w, method, path, data=None, expected=200, subject="alice"):
    r = w.client.request(method, w.prefix + path, headers=w.headers(subject), json=data)
    assert r.status_code == expected, r.text
    return r.json()


def upload(w, raw, filename, key=None):
    c = call(
        w,
        "POST",
        "/collections",
        {
            "name": "Files",
            "allowed_subjects": ["alice", "bob"],
            "idempotency_key": "test-file-collection",
        },
        expected=201,
    )
    return call(
        w,
        "POST",
        f"/collections/{c['id']}/files",
        {
            "filename": filename,
            "content_base64": base64.b64encode(raw).decode(),
            "allowed_subjects": ["alice", "bob"],
            "idempotency_key": key or str(uuid4()),
        },
        expected=202,
    )


def docx(text_value="Call operations for incidents."):
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'
            + text_value
            + "</w:t></w:r></w:p></w:body></w:document>",
        )
    return raw.getvalue()


def pdf(encrypted=False, blank=False):
    writer = PdfWriter()
    page = writer.add_blank_page(600, 800)
    if not blank:
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 20 700 Td (Call operations for incidents.) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
    if encrypted:
        writer.encrypt("synthetic-password")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize(
    "filename,factory,locator",
    [
        ("x.docx", docx, "paragraph"),
        ("x.pdf", pdf, "page"),
        ("x.txt", lambda: b"Call operations for incidents.", "section"),
    ],
)
def test_real_binary_parsing_and_exact_passages(world, filename, factory, locator):
    raw = factory()
    f = upload(world, raw, filename)
    done = call(world, "POST", f"/files/{f['id']}/process")
    assert done["status"] == "succeeded", done
    source = call(world, "GET", f"/sources/{done['source_id']}")
    span = done["spans"][0]
    assert span[locator] == 1
    assert (
        source["content"][span["start"] : span["end"]].strip() == "Call operations for incidents."
    )
    response = world.client.get(
        world.prefix + f"/files/{f['id']}/download", headers=world.headers()
    )
    assert response.content == raw and response.headers["cache-control"] == "no-store"
    assert call(world, "POST", f"/files/{f['id']}/process") == done
    assert world.service.concepts(world.owner, world.domain) == []


@pytest.mark.parametrize(
    "filename,raw,error",
    [
        ("broken.pdf", b"broken", "PARSE_FAILED"),
        ("empty.pdf", pdf(blank=True), "NO_EXTRACTABLE_TEXT"),
        ("locked.pdf", pdf(encrypted=True), "ENCRYPTED_DOCUMENT"),
        ("binary.exe", b"abc", "UNSUPPORTED_FORMAT"),
        ("long.txt", b"x" * 30001, "TEXT_REQUIRES_SPLITTING"),
    ],
)
def test_parse_failures_are_persisted(world, filename, raw, error):
    f = upload(world, raw, filename)
    done = call(world, "POST", f"/files/{f['id']}/process")
    assert done["status"] == "failed" and done["error_code"] == error
    assert call(world, "GET", "/sources")["items"] == []
    call(world, "POST", f"/files/{f['id']}/retry")
    again = call(world, "POST", f"/files/{f['id']}/process")
    assert again["attempts"] == 2


def test_cancel_during_parsing_discards_result(world, monkeypatch):
    import cortex_core.files as module

    f = upload(world, b"Incident process", "x.md")
    original = module.parse_bytes

    def cancel(raw, name):
        call(world, "POST", f"/files/{f['id']}/cancel")
        return original(raw, name)

    monkeypatch.setattr(module, "parse_bytes", cancel)
    call(world, "POST", f"/files/{f['id']}/process", expected=409)
    assert call(world, "GET", f"/files/{f['id']}")["status"] == "cancelled"
    assert call(world, "GET", "/sources")["items"] == []


def test_worker_recovers_expired_lease_and_keeps_live_one(world):
    f = upload(world, b"Incident process", "x.md")
    with world.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_files SET status='processing',lease_token='dead',lease_until=now()-interval '1 second' WHERE tenant_id=:t AND id=:id"
            ),
            {"t": world.tenant, "id": f["id"]},
        )
    service = FileService(CorpusService(world.service))
    assert drain(service, world.owner, world.domain, 20) == 1
    assert call(world, "GET", f"/files/{f['id']}")["status"] == "succeeded"
    g = upload(world, b"Different", "y.md")
    with world.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_files SET status='processing',lease_token='live',lease_until=now()+interval '1 hour' WHERE tenant_id=:t AND id=:id"
            ),
            {"t": world.tenant, "id": g["id"]},
        )
    assert drain(service, world.owner, world.domain, 20) == 0
    call(world, "POST", f"/files/{g['id']}/process", expected=409)


def test_source_revocation_protects_original_file(world):
    f = upload(world, b"Incident process", "x.md")
    done = call(world, "POST", f"/files/{f['id']}/process")
    world.service.set_access(
        world.owner, world.domain, done["source_id"], AccessInput(allowed_subjects=["alice"])
    )
    call(world, "GET", f"/files/{f['id']}", subject="bob", expected=404)
    assert (
        world.client.get(
            world.prefix + f"/files/{f['id']}/download", headers=world.headers("bob")
        ).status_code
        == 404
    )
    assert call(world, "GET", "/files", subject="bob")["items"] == []


def test_upload_idempotence_and_viewer_cannot_process(world):
    key = str(uuid4())
    first = upload(world, b"Incident process", "x.md", key)
    assert upload(world, b"Incident process", "x.md", key) == first
    call(world, "POST", f"/files/{first['id']}/process", subject="bob", expected=403)


def test_docx_entities_rejected_and_timeout_sanitized(monkeypatch):
    import cortex_core.files as module

    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr("word/document.xml", '<!DOCTYPE x [<!ENTITY test "private">]><x/>')
    assert parse_bytes(raw.getvalue(), "bad.docx")["error_code"] == "UNSAFE_XML"

    def timeout(*args, **kwargs):
        raise module.subprocess.TimeoutExpired("secret-content", 15)

    monkeypatch.setattr(module.subprocess, "run", timeout)
    assert parse_bytes(b"private", "x.pdf") == {"error_code": "PARSE_TIMEOUT"}
