"""Native immutable file storage, sharing, binary MCP and queue controls."""

import base64
from uuid import uuid4

from sqlalchemy import text


def verify_files(client, headers, admin, tenant, domain):
    root = f"/v1/domains/{domain}"
    col = client.post(
        root + "/collections",
        headers=headers(),
        json={
            "name": "Fichiers synthétiques",
            "allowed_subjects": ["alice", "bob"],
            "idempotency_key": str(uuid4()),
        },
    ).json()["id"]
    raw = bytes(range(256)) + "🧠".encode()
    body = {
        "filename": "preuve.bin",
        "content_base64": base64.b64encode(raw).decode(),
        "allowed_subjects": ["bob", "alice", "alice"],
        "idempotency_key": str(uuid4()),
    }
    upload = root + f"/collections/{col}/files"
    r = client.post(upload, headers=headers(), json=body)
    assert r.status_code == 202, r.text
    f = r.json()
    url = root + "/files/" + f["id"]
    assert f["size_bytes"] == len(raw) and f["status"] == "pending" and f["attempts"] == 0
    assert (
        client.post(
            upload, headers=headers(), json={**body, "allowed_subjects": ["alice", "bob"]}
        ).json()
        == f
    )
    assert (
        client.post(upload, headers=headers(), json={**body, "filename": "changed.bin"}).status_code
        == 409
    )
    assert client.post(upload, headers=headers(sub="bob"), json=body).status_code == 403
    assert client.get(url, headers=headers(sub="bob")).json() == f
    download = client.get(url + "/download", headers=headers(sub="bob"))
    assert (
        download.content == raw and download.headers["content-type"] == "application/octet-stream"
    )
    assert download.headers["content-disposition"] == 'attachment; filename="source.bin"'
    assert (
        download.headers["cache-control"] == "no-store"
        and download.headers["x-content-type-options"] == "nosniff"
    )
    rpc = client.post(
        "/mcp",
        headers={**headers(sub="bob"), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_files_download",
                "arguments": {"path": {"domain": domain, "ident": f["id"]}},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {
        "http_status": 200,
        "data": {
            "media_type": "application/octet-stream",
            "base64": base64.b64encode(raw).decode(),
        },
    }, rpc.text
    private = client.post(
        upload,
        headers=headers(),
        json={**body, "allowed_subjects": ["alice"], "idempotency_key": str(uuid4())},
    ).json()
    assert (
        client.get(root + "/files/" + private["id"], headers=headers(sub="bob")).status_code == 404
    )
    assert client.get(
        root + "/files", headers=headers(sub="bob"), params={"pending": "true"}
    ).json()["items"] == [f]
    assert client.post(url + "/retry", headers=headers()).json() == f
    cancelled = client.post(url + "/cancel", headers=headers()).json()
    assert cancelled["status"] == "cancelled" and cancelled["attempts"] == 0
    assert client.post(url + "/retry", headers=headers()).json() == cancelled
    assert (
        client.get(root + "/files", headers=headers(sub="bob"), params={"pending": "true"}).json()[
            "items"
        ]
        == []
    )
    with admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_files SET status='failed',error_code='PARSE_FAILED',attempts=2 WHERE tenant_id=:t AND domain_id=:d AND id=:i"
            ),
            {"t": tenant, "d": domain, "i": f["id"]},
        )
    retried = client.post(url + "/retry", headers=headers()).json()
    assert (
        retried["status"] == "pending"
        and retried["error_code"] is None
        and retried["attempts"] == 2
    )
    for bad in ["a", "YQ", "YQ=", "YQ===", "Y Q==", "💥", "=", "abc=def", "YWJj===="]:
        r = client.post(
            upload,
            headers=headers(),
            json={**body, "content_base64": bad, "idempotency_key": str(uuid4())},
        )
        assert r.status_code == 422, (bad, r.text)
    for good in ["YR==", "YWJ=", "YWJj"]:
        r = client.post(
            upload,
            headers=headers(),
            json={**body, "content_base64": good, "idempotency_key": str(uuid4())},
        )
        assert r.status_code == 202, (good, r.text)
    for size, status in [(500000, 202), (500001, 422)]:
        r = client.post(
            upload,
            headers=headers(),
            json={
                **body,
                "content_base64": base64.b64encode(b"x" * size).decode(),
                "idempotency_key": str(uuid4()),
            },
        )
        assert r.status_code == status, (size, r.text[:500])
    return [
        "native_file_immutable_bytes_shared_acl_http_and_binary_mcp",
        "native_file_idempotence_pending_retry_cancel_and_bounded_base64",
    ]
