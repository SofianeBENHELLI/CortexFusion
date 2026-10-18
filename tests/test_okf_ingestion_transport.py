import json
from uuid import uuid4

import httpx
import pytest

from scripts import ingest_okf
from scripts.prepare_okf_ingestion import build_manifest, digest


def manifest(count=1):
    content = "Synthetic evidence é🙂."
    return build_manifest({
        "report": {"archive_sha256": "b" * 64, "unresolved_local_links": []},
        "concepts": [{"id": f"synthetic/{letter}", "title": f"Synthetic {letter}", "text": content,
                      "source_path": f"okf/synthetic/{letter}.md", "source_sha256": digest(content),
                      "body_start": 0, "body_end": len(content), "linked_concept_ids": [],
                      "declared_status": "draft", "layer": "synthetic"} for letter in "ab"[:count]],
    }, "private")


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(ingest_okf, "headers", lambda *args, **kwargs: {"Authorization": "Bearer synthetic"})
    monkeypatch.setattr(ingest_okf, "signed", lambda *args, **kwargs: {"Authorization": "Bearer synthetic"})
    return {"tenant": str(uuid4()), "domain": str(uuid4()), "subject": "synthetic-owner"}


def test_source_registration_recovers_lost_response_without_new_identity(cfg):
    m = manifest()
    state = {"sources": {}, "batches": {}}
    source = m["sources"][0]
    source_id = str(uuid4())
    requests = []
    stored = {}

    def handler(req):
        requests.append(req.method)
        if req.method == "POST":
            body = json.loads(req.content)
            key = (body["location"], digest(body["content"]))
            receipt = stored.setdefault(key, {"id": source_id, "location": body["location"], "content_hash": key[1], "allowed_subjects": body["allowed_subjects"]})
            if len(requests) == 1:
                raise httpx.ReadError("Synthetic response lost", request=req)
            return httpx.Response(201, json=receipt)
        return httpx.Response(200, json=next(iter(stored.values())))

    saves = []
    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.ReadError):
            ingest_okf.register_sources(client, cfg, m, ["synthetic/a"], state, lambda: saves.append(1))
        assert not state["sources"]
        ingest_okf.register_sources(client, cfg, m, ["synthetic/a"], state, lambda: saves.append(1))
        ingest_okf.register_sources(client, cfg, m, ["synthetic/a"], state, lambda: saves.append(1))
    assert len(stored) == 1
    assert state["sources"][source["key"]]["id"] == source_id
    assert requests == ["POST", "POST", "GET"]


def test_source_receipt_privacy_mismatch_stops_before_checkpoint(cfg):
    m = manifest()
    state = {"sources": {}, "batches": {}}
    source = m["sources"][0]
    def handler(req):
        return httpx.Response(201, json={"id": str(uuid4()), "location": source["location"], "content_hash": source["content_sha256"], "allowed_subjects": [cfg["subject"], "unexpected-reader"]})
    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="privacy"):
            ingest_okf.register_sources(client, cfg, m, ["synthetic/a"], state, lambda: pytest.fail("Must not checkpoint"))
    assert not state["sources"]


def test_publication_retry_keeps_proposal_and_verified_batch_does_not_publish_again(cfg):
    m = manifest()
    source = m["sources"][0]
    state = {"sources": {source["key"]: {"id": str(uuid4()), "content_hash": source["content_sha256"]}}, "batches": {}}
    selection = {"manifest_sha256": m["manifest_sha256"], "record_ids": ["synthetic/a"], "decision": "publish_verbatim_emerging_without_relations", "reason": "Synthetic review"}
    concept = ingest_okf.reviewed_payloads(m, selection, state)[0]
    proposal_id = str(uuid4())
    published = False
    paths = []
    seen_publish = 0

    def handler(req):
        nonlocal published, seen_publish
        path = req.url.path
        paths.append((req.method, path))
        if path.endswith("/version"):
            return httpx.Response(200, json={"accepted_version": int(published), "published_version": int(published)})
        if path.endswith("/proposals"):
            return httpx.Response(201, json={"id": proposal_id, "digest": "d" * 64})
        if path.endswith("/approve"):
            return httpx.Response(200, json={"status": "accepted"})
        if path.endswith("/publish"):
            seen_publish += 1
            published = True
            assert json.loads(req.content) == {"expected_published_version": 0}
            if seen_publish == 1:
                raise httpx.ReadError("Synthetic response lost", request=req)
            return httpx.Response(200, json={"published_version": 1})
        if not published:
            return httpx.Response(404, json={"error": "not_found"})
        return httpx.Response(200, json=concept)

    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.ReadError):
            ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: None)
        assert next(iter(state["batches"].values()))["status"] == "approved"
        result = ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: None)
        assert result["status"] == "verified" and result["published_version"] == 1
        count = len(paths)
        ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: None)
        assert len(paths) == count
    assert sum(path.endswith("/proposals") for _, path in paths) == 1
    assert sum(path.endswith("/approve") for _, path in paths) == 1
    assert seen_publish == 2


def test_review_must_bind_manifest_and_explicit_decision(cfg):
    m = manifest()
    for decision in (None, "publish_everything"):
        with pytest.raises(ValueError, match="explicit"):
            ingest_okf.reviewed_payloads(m, {"manifest_sha256": m["manifest_sha256"], "decision": decision}, {"sources": {}})
    with pytest.raises(ValueError, match="current manifest"):
        ingest_okf.reviewed_payloads(m, {"manifest_sha256": "incorrect"}, {"sources": {}})


def test_existing_verbatim_concept_is_not_republished_with_another_review(cfg):
    m = manifest()
    source = m["sources"][0]
    state = {"sources": {source["key"]: {"id": str(uuid4()), "content_hash": source["content_sha256"]}}, "batches": {}}
    selection = {"manifest_sha256": m["manifest_sha256"], "record_ids": ["synthetic/a"], "decision": "publish_verbatim_emerging_without_relations", "reason": "Another explicit review"}
    concept = ingest_okf.reviewed_payloads(m, selection, state)[0]
    requests = []

    def handler(req):
        requests.append(req.method)
        assert req.method == "GET", "A repeated import must not mutate the published knowledge"
        return httpx.Response(200, json={"accepted_version": 7, "published_version": 7} if req.url.path.endswith("/version") else concept)

    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        result = ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: None)
    assert result["status"] == "verified"
    assert result["published_version"] == 7
    assert result["disposition"] == "already_published"
    assert requests == ["GET", "GET", "GET"]


@pytest.mark.parametrize("changed", ["maturity", "links", "body"])
def test_initial_import_never_overwrites_curated_published_concept(cfg, changed):
    m = manifest()
    source = m["sources"][0]
    state = {"sources": {source["key"]: {"id": str(uuid4()), "content_hash": source["content_sha256"]}}, "batches": {}}
    selection = {"manifest_sha256": m["manifest_sha256"], "record_ids": ["synthetic/a"], "decision": "publish_verbatim_emerging_without_relations", "reason": "Synthetic review"}
    concept = ingest_okf.reviewed_payloads(m, selection, state)[0]
    concept[changed] = {"maturity": "consolidated", "links": [{"target_id": str(uuid4())}], "body": "Curated synthetic text"}[changed]

    def handler(req):
        assert req.method == "GET"
        return httpx.Response(200, json={"accepted_version": 7, "published_version": 7} if req.url.path.endswith("/version") else concept)

    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="reconciliation"):
            ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: pytest.fail("No prepared batch on conflict"))
    assert not state["batches"]


def test_mixed_review_proposes_only_absent_concepts_and_verifies_all(cfg):
    m = manifest(2)
    state = {"sources": {s["key"]: {"id": str(uuid4()), "content_hash": s["content_sha256"]} for s in m["sources"]}, "batches": {}}
    selection = {"manifest_sha256": m["manifest_sha256"], "record_ids": ["synthetic/a", "synthetic/b"], "decision": "publish_verbatim_emerging_without_relations", "reason": "Synthetic review"}
    existing, new = ingest_okf.reviewed_payloads(m, selection, state)
    published = False
    proposed = []

    def handler(req):
        nonlocal published
        path = req.url.path
        if path.endswith("/version"):
            return httpx.Response(200, json={"accepted_version": 3 + int(published), "published_version": 3 + int(published)})
        if path.endswith("/proposals"):
            proposed.extend(json.loads(req.content)["changes"])
            return httpx.Response(201, json={"id": str(uuid4()), "digest": "d" * 64})
        if path.endswith("/approve"):
            return httpx.Response(200, json={"status": "accepted"})
        if path.endswith("/publish"):
            published = True
            return httpx.Response(200, json={"published_version": 4})
        if path.endswith(existing["concept_id"]):
            return httpx.Response(200, json=existing)
        assert path.endswith(new["concept_id"])
        return httpx.Response(200, json=new) if published else httpx.Response(404)

    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        result = ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: None)
    assert proposed == [{"kind": "put_concept", "concept": new}]
    assert result["published_version"] == 4 and result["status"] == "verified"


@pytest.mark.parametrize("failure", ["version_change", "forbidden", "server_error"])
def test_preflight_failure_cannot_prepare_a_publication(cfg, failure):
    m = manifest()
    source = m["sources"][0]
    state = {"sources": {source["key"]: {"id": str(uuid4()), "content_hash": source["content_sha256"]}}, "batches": {}}
    selection = {"manifest_sha256": m["manifest_sha256"], "record_ids": ["synthetic/a"], "decision": "publish_verbatim_emerging_without_relations", "reason": "Synthetic review"}
    concept = ingest_okf.reviewed_payloads(m, selection, state)[0]
    versions = 0

    def handler(req):
        nonlocal versions
        assert req.method == "GET"
        if req.url.path.endswith("/version"):
            versions += 1
            return httpx.Response(200, json={"accepted_version": versions, "published_version": versions})
        if failure != "version_change":
            return httpx.Response(403 if failure == "forbidden" else 500)
        return httpx.Response(200, json=concept)

    with httpx.Client(base_url="http://local.test", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises((ValueError, RuntimeError)):
            ingest_okf.publish_reviewed(client, cfg, m, selection, state, lambda: pytest.fail("No checkpoint on failed preflight"))
    assert state["batches"] == {}
