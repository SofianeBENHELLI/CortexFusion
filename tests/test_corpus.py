from uuid import uuid4

import pytest
from cortex_core.auth import Principal
from cortex_core.contracts import AccessInput
from cortex_core.corpus import CorpusService
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


@pytest.fixture
def corpus(world):
    with world.admin.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_memberships VALUES(:t,:d,'manager','corpus_manager')"),
            {"t": world.tenant, "d": world.domain},
        )
    return world


def call(w, method, path, data=None, subject="manager", expected=200):
    response = w.client.request(method, w.prefix + path, json=data, headers=w.headers(subject))
    assert response.status_code == expected, response.text
    return response.json()


def collection(w, readers=None):
    return call(
        w,
        "POST",
        "/collections",
        {
            "name": "Operations",
            "description": "Synthetic corpus",
            "allowed_subjects": readers or ["manager", "alice", "bob"],
            "idempotency_key": str(uuid4()),
        },
        expected=201,
    )


def job(w, col, names=("one.md",), readers=None, key=None):
    return call(
        w,
        "POST",
        f"/collections/{col['id']}/imports",
        {
            "idempotency_key": key or str(uuid4()),
            "items": [
                {
                    "filename": n,
                    "content": "Synthetic procedure: page operations.",
                    "allowed_subjects": readers or ["manager", "alice", "bob"],
                }
                for n in names
            ],
        },
        expected=202,
    )


def test_manager_imports_and_proposes_but_cannot_approve(corpus):
    w = corpus
    c = collection(w)
    j = job(w, c)
    assert j["status"] == "pending"
    assert call(w, "GET", "/sources")["items"] == []
    done = call(w, "POST", f"/imports/{j['id']}/process")
    assert done["status"] == "succeeded"
    source = done["items"][0]["source_id"]
    listed = call(w, "GET", f"/sources?collection_id={c['id']}")
    assert [s["id"] for s in listed["items"]] == [source]
    assert "content" not in listed["items"][0]
    assert w.service.concepts(w.owner, w.domain) == []
    response = w.client.post(
        w.prefix + f"/sources/{source}/propose",
        headers={**w.headers("manager"), "Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200
    p = response.json()
    call(
        w,
        "POST",
        f"/proposals/{p['id']}/approve",
        {
            "digest": p["digest"],
            "expected_version": 0,
            "reason": "Not allowed",
            "idempotency_key": str(uuid4()),
        },
        expected=403,
    )
    w.approve(p)
    assert len(w.service.concepts(w.owner, w.domain)) == 1


def test_mixed_formats_resume_and_no_duplicate_sources(corpus):
    w = corpus
    c = collection(w)
    j = job(w, c, ("one.md", "two.pdf", "three.txt"))
    first = call(w, "POST", f"/imports/{j['id']}/process")
    assert first["status"] == "partial"
    # Fresh service instance resumes entirely from database state.
    service = CorpusService(w.service)
    p = Principal("manager", w.tenant)
    final = service.process(p, w.domain, j["id"], 20)
    assert [i["status"] for i in final["items"]] == ["succeeded", "failed", "succeeded"]
    assert final["items"][1]["error_code"] == "UNSUPPORTED_FORMAT"
    assert service.process(p, w.domain, j["id"], 20) == final
    duplicate = job(w, c, ("one.md",))
    dup = call(w, "POST", f"/imports/{duplicate['id']}/process")
    assert dup["items"][0]["source_id"] == final["items"][0]["source_id"]
    assert len(call(w, "GET", "/sources")["items"]) == 2


def test_import_key_bound_to_content_and_collection(corpus):
    w = corpus
    c = collection(w)
    key = str(uuid4())
    j = job(w, c, key=key)
    assert job(w, c, key=key) == j
    r = w.client.post(
        w.prefix + f"/collections/{c['id']}/imports",
        headers=w.headers("manager"),
        json={
            "idempotency_key": key,
            "items": [
                {"filename": "other.md", "content": "changed", "allowed_subjects": ["manager"]}
            ],
        },
    )
    assert r.status_code == 409
    c2 = collection(w)
    r = w.client.post(
        w.prefix + f"/collections/{c2['id']}/imports",
        headers=w.headers("manager"),
        json={
            "idempotency_key": key,
            "items": [
                {"filename": "one.md", "content": "changed", "allowed_subjects": ["manager"]}
            ],
        },
    )
    assert r.status_code == 409


def test_cancel_preserves_successes_and_is_idempotent(corpus):
    w = corpus
    j = job(w, collection(w), ("one.txt", "two.txt"))
    call(w, "POST", f"/imports/{j['id']}/process")
    cancelled = call(w, "POST", f"/imports/{j['id']}/cancel")
    assert [i["status"] for i in cancelled["items"]] == ["succeeded", "cancelled"]
    assert cancelled["status"] == "cancelled"
    assert call(w, "POST", f"/imports/{j['id']}/cancel") == cancelled
    call(w, "POST", f"/imports/{j['id']}/process", expected=409)
    call(w, "POST", f"/imports/{j['id']}/retry", expected=409)
    assert len(call(w, "GET", "/sources")["items"]) == 1


def test_retry_only_failed_items(corpus):
    w = corpus
    j = job(w, collection(w), ("one.md", "bad.pdf"))
    call(w, "POST", f"/imports/{j['id']}/process?limit=20")
    pending = call(w, "POST", f"/imports/{j['id']}/retry")
    assert [i["status"] for i in pending["items"]] == ["succeeded", "pending"]
    final = call(w, "POST", f"/imports/{j['id']}/process?limit=20")
    assert [i["attempts"] for i in final["items"]] == [1, 2]


def test_job_and_sources_hide_after_revocation(corpus):
    w = corpus
    j = job(w, collection(w))
    done = call(w, "POST", f"/imports/{j['id']}/process")
    source = done["items"][0]["source_id"]
    w.service.set_access(w.owner, w.domain, source, AccessInput(allowed_subjects=["alice"]))
    call(w, "GET", f"/imports/{j['id']}", expected=404)
    call(w, "POST", f"/imports/{j['id']}/process", expected=404)
    assert call(w, "GET", "/imports") == {"items": [], "next_after": None}
    assert call(w, "GET", "/sources") == {"items": [], "next_after": None}


def test_collections_private_and_import_receipts_submitter_only(corpus):
    w = corpus
    c = collection(w, ["manager"])
    call(w, "GET", f"/collections/{c['id']}", subject="alice", expected=404)
    call(w, "GET", f"/sources?collection_id={c['id']}", subject="alice", expected=404)
    assert call(w, "GET", "/collections", subject="alice")["items"] == []
    c = collection(w)
    j = job(w, c)
    call(w, "GET", f"/imports/{j['id']}", subject="alice", expected=404)
    assert call(w, "GET", "/imports", subject="alice")["items"] == []


def test_page_filters_before_limit_and_search_is_literal(corpus):
    w = corpus
    visible = [w.source(content=f"Visible {i}") for i in range(3)]
    w.source(content="Restricted", subjects=["alice"])
    ids, after = [], None
    while True:
        page = call(
            w, "GET", "/sources?limit=1" + (f"&after={after}" if after else ""), subject="bob"
        )
        ids.extend(s["id"] for s in page["items"])
        after = page["next_after"]
        if not after:
            break
    assert ids == sorted(s["id"] for s in visible)
    assert call(w, "GET", "/sources?q=%25", subject="bob")["items"] == []
    call(w, "GET", "/sources?limit=101", expected=422)
    call(w, "GET", "/sources?after=bad", expected=422)


@pytest.mark.parametrize("subject", ["bob", "agent"])
def test_non_managers_cannot_import(corpus, subject):
    w = corpus
    c = collection(w)
    call(
        w,
        "POST",
        f"/collections/{c['id']}/imports",
        {
            "idempotency_key": str(uuid4()),
            "items": [{"filename": "x.md", "content": "x", "allowed_subjects": [subject]}],
        },
        subject=subject,
        expected=403,
    )


def test_acl_bounds_and_paths_are_validated(corpus):
    w = corpus
    c = collection(w, ["manager"])
    for readers in (["alice"], ["manager", "alice"], ["manager", "unknown"]):
        call(
            w,
            "POST",
            f"/collections/{c['id']}/imports",
            {
                "idempotency_key": str(uuid4()),
                "items": [{"filename": "x.md", "content": "x", "allowed_subjects": readers}],
            },
            expected=422,
        )
    for filename, content in (("../secret.md", "x"), ("x.md", "x\x00y")):
        call(
            w,
            "POST",
            f"/collections/{c['id']}/imports",
            {
                "idempotency_key": str(uuid4()),
                "items": [
                    {"filename": filename, "content": content, "allowed_subjects": ["manager"]}
                ],
            },
            expected=422,
        )


def test_source_and_receipt_rollback_together_on_crash(corpus, monkeypatch):
    import cortex_core.corpus as module

    w = corpus
    j = job(w, collection(w))
    original = module.run

    def fail_receipt(conn, sql, **params):
        if "UPDATE cf_import_items SET status=:status" in sql:
            raise RuntimeError("synthetic crash")
        return original(conn, sql, **params)

    monkeypatch.setattr(module, "run", fail_receipt)
    with pytest.raises(RuntimeError, match="synthetic crash"):
        call(w, "POST", f"/imports/{j['id']}/process")
    monkeypatch.setattr(module, "run", original)
    assert call(w, "GET", "/sources")["items"] == []
    assert call(w, "GET", f"/imports/{j['id']}")["status"] == "pending"
    assert call(w, "POST", f"/imports/{j['id']}/process")["status"] == "succeeded"


def test_new_tables_are_tenant_isolated_and_links_domain_safe(corpus):
    w = corpus
    c = collection(w)
    j = job(w, c)
    for table in ("collections", "collection_sources", "imports", "import_items"):
        with w.db.transaction(Principal("alice", w.other_tenant), w.other_domain) as conn:
            assert (
                conn.execute(
                    text(f"SELECT count(*) FROM cf_{table} WHERE tenant_id=:t"), {"t": w.tenant}
                ).scalar_one()
                == 0
            )
    source = w.source()
    with pytest.raises(DBAPIError), w.admin.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_collection_sources VALUES(:t,:d,:c,:s)"),
            {"t": w.tenant, "d": w.other_domain, "c": c["id"], "s": source["id"]},
        )
    r = w.client.get(
        f"/v1/domains/{w.other_domain}/imports/{j['id']}", headers=w.headers("manager")
    )
    assert r.status_code == 404


def test_concurrent_process_requests_register_one_source(corpus):
    from concurrent.futures import ThreadPoolExecutor

    w = corpus
    j = job(w, collection(w))

    def process():
        return w.client.post(w.prefix + f"/imports/{j['id']}/process", headers=w.headers("manager"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: process(), range(2)))
    assert all(r.status_code in (200, 409) for r in results)
    final = call(w, "POST", f"/imports/{j['id']}/process")
    assert final["status"] == "succeeded"
    assert final["items"][0]["attempts"] == 1
    assert len(call(w, "GET", "/sources")["items"]) == 1


def test_collection_retry_and_filtered_pagination(corpus):
    w = corpus
    data = {
        "name": "Visible",
        "description": "",
        "allowed_subjects": ["manager", "bob"],
        "idempotency_key": str(uuid4()),
    }
    first = call(w, "POST", "/collections", data, expected=201)
    assert call(w, "POST", "/collections", data, expected=201) == first
    call(w, "POST", "/collections", {**data, "name": "Different"}, expected=409)
    second = collection(w)
    collection(w, ["manager"])
    page = call(w, "GET", "/collections?limit=1", subject="bob")
    rest = call(w, "GET", f"/collections?limit=1&after={page['next_after']}", subject="bob")
    assert [page["items"][0]["id"], rest["items"][0]["id"]] == sorted([first["id"], second["id"]])
    assert rest["next_after"] is None


def test_lost_manager_role_prevents_pending_import(corpus):
    w = corpus
    j = job(w, collection(w))
    with w.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:t AND domain_id=:d AND subject='manager'"
            ),
            {"t": w.tenant, "d": w.domain},
        )
    call(w, "POST", f"/imports/{j['id']}/process", expected=403)
    assert call(w, "GET", f"/imports/{j['id']}")["status"] == "pending"
    assert call(w, "GET", "/sources")["items"] == []
