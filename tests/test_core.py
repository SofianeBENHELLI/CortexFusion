from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from cortex_core.auth import CoreError, Principal
from cortex_core.contracts import (
    AccessInput,
    ApprovalInput,
    FeedbackInput,
    ProposalInput,
    QueryInput,
    RollbackInput,
    SourceInput,
)
from cortex_core.db import Database
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def query(w, principal=None, question="incident operations"):
    return w.service.query(principal or w.owner, w.domain, QueryInput(question=question))


def test_approved_knowledge_round_trip(world):
    w = world
    proposal = w.proposal()
    assert query(w)["status"] == "knowledge_gap"
    commit = w.approve(proposal, publish=False)
    assert commit["sequence"] == 1
    assert w.service.version(w.owner, w.domain) == {
        "domain_id": w.domain,
        "accepted_version": 1,
        "published_version": 0,
    }
    assert query(w)["status"] == "knowledge_gap"
    assert w.service.publish(w.owner, w.domain)["changed"]
    result = query(w)
    assert result["served_version"] == 1
    assert result["answer"] == result["citations"][0]["excerpt"]
    assert result["processing"] == "local_no_model"
    assert not w.service.publish(w.owner, w.domain)["changed"]


@pytest.mark.parametrize("subject", ["bob", "agent"])
def test_non_owner_cannot_approve(world, subject):
    p = world.proposal()
    response = world.client.post(
        f"{world.prefix}/proposals/{p['id']}/approve",
        headers=world.headers(subject),
        json={
            "digest": p["digest"],
            "expected_version": 0,
            "reason": "test",
            "idempotency_key": str(uuid4()),
        },
    )
    assert response.status_code == 403
    assert world.service.version(world.owner, world.domain)["accepted_version"] == 0


@pytest.mark.parametrize(
    "override", [{"exp": 1}, {"aud": "wrong"}, {"iss": "https://wrong.test"}, {"sub": "unknown"}]
)
def test_invalid_identity_or_membership(world, override):
    response = world.client.get(world.prefix + "/version", headers=world.headers(**override))
    assert response.status_code in (401, 404)


def test_unsigned_or_missing_identity_rejected(world):
    assert world.client.get(world.prefix + "/version").status_code == 401
    assert (
        world.client.get(
            world.prefix + "/version",
            headers={"Authorization": "Bearer garbage", "X-Tenant-ID": world.tenant},
        ).status_code
        == 401
    )
    assert (
        world.client.get(
            world.prefix + "/version", headers=world.headers(target_tenant="not-a-uuid")
        ).status_code
        == 401
    )


def test_token_owner_claim_cannot_elevate_viewer(world):
    p = world.proposal()
    r = world.client.post(
        f"{world.prefix}/proposals/{p['id']}/approve",
        headers=world.headers("bob", role="owner"),
        json={
            "digest": p["digest"],
            "expected_version": 0,
            "reason": "forged role",
            "idempotency_key": str(uuid4()),
        },
    )
    assert r.status_code == 403


def test_tenant_isolation_and_forged_source_reference(world):
    w = world
    s = w.source()
    r = w.client.get(
        f"{w.prefix}/sources/{s['id']}", headers=w.headers(target_tenant=w.other_tenant)
    )
    assert r.status_code == 404
    other = Principal("alice", w.other_tenant)
    data = ProposalInput(
        base_version=0,
        changes=[
            {
                "kind": "put_concept",
                "concept": {
                    "concept_id": str(uuid4()),
                    "title": "forged",
                    "body": "secret",
                    "sources": [{"source_id": s["id"], "start": 0, "end": 6}],
                },
            }
        ],
        reason="test",
        idempotency_key=str(uuid4()),
    )
    with pytest.raises(CoreError, match="Source not found"):
        w.service.propose(other, w.other_domain, data)


def test_row_level_security_with_actual_app_role(world):
    w = world
    with w.db.engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM cf_domains")).scalar_one() == 0
        conn.execute(text("SELECT set_config('cortex.tenant',:t,true)"), {"t": w.tenant})
        rows = conn.execute(text("SELECT tenant_id FROM cf_domains")).scalars().all()
        assert rows == [w.tenant]
    with w.db.engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM cf_domains")).scalar_one() == 0


def test_api_rejects_elevated_database_role(world):
    import os

    db = Database(os.environ["CORTEX_TEST_ADMIN_URL"])
    with pytest.raises(RuntimeError, match="superuser"):
        db.verify_role()
    db.dispose()


def test_source_deduplication_and_immutable_bytes(world):
    w = world
    data = SourceInput(
        title="Runbook",
        location="fixture://stable",
        content="Original procedure",
        allowed_subjects=["alice"],
    )
    a = w.service.create_source(w.owner, w.domain, data)
    b = w.service.create_source(w.owner, w.domain, data)
    assert a["id"] == b["id"]
    updated = data.model_copy(
        update={"content": "Replacement procedure", "supersedes": UUID(a["id"])}
    )
    c = w.service.create_source(w.owner, w.domain, updated)
    assert c["id"] != a["id"]
    assert w.service.source(w.owner, w.domain, a["id"])["content"] == "Original procedure"
    with pytest.raises(DBAPIError), w.admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_sources SET content='tamper' WHERE tenant_id=:t AND id=:id"),
            {"t": w.tenant, "id": a["id"]},
        )


def test_unsupported_summary_or_reference_maturity_stays_untrusted(world):
    with pytest.raises(CoreError, match="verbatim"):
        world.proposal(body="Invented evidence")
    with pytest.raises(CoreError, match="review policy"):
        world.proposal(maturity="reference")
    assert world.service.concepts(world.owner, world.domain) == []


def test_out_of_range_provenance(world):
    p = world.proposal()
    changes = p["payload"]
    changes[0]["concept"]["sources"][0]["end"] = 999999
    with pytest.raises(CoreError, match="source span"):
        world.service.propose(
            world.owner,
            world.domain,
            ProposalInput(
                base_version=0, changes=changes, reason="test", idempotency_key=str(uuid4())
            ),
        )


def test_duplicate_proposal_and_key_conflict(world):
    s = world.source()
    ident, key = str(uuid4()), str(uuid4())
    a = world.proposal(s, concept_id=ident, key=key)
    b = world.proposal(s, concept_id=ident, key=key)
    assert a["id"] == b["id"]
    with pytest.raises(CoreError, match="Idempotency"):
        world.proposal(s, concept_id=str(uuid4()), key=key)


def test_approval_digest_and_base_are_bound(world):
    p = world.proposal()
    with pytest.raises(CoreError, match="changed"):
        world.service.approve(
            world.owner,
            world.domain,
            p["id"],
            ApprovalInput(
                digest="0" * 64, expected_version=0, reason="test", idempotency_key=str(uuid4())
            ),
        )
    with pytest.raises(CoreError, match="base"):
        world.service.approve(
            world.owner,
            world.domain,
            p["id"],
            ApprovalInput(
                digest=p["digest"], expected_version=1, reason="test", idempotency_key=str(uuid4())
            ),
        )


def test_duplicate_approval_and_publication_backpressure(world):
    a, b = world.proposal(), world.proposal()
    key = str(uuid4())
    first = world.approve(a, publish=False, key=key)
    assert world.approve(a, publish=False, key=key) == first
    with pytest.raises(CoreError, match="Publish"):
        world.approve(b, publish=False)
    world.service.publish(world.owner, world.domain)
    with pytest.raises(CoreError, match="base"):
        world.approve(b)


def test_two_concurrent_approvals_accept_at_most_one(world):
    a, b = world.proposal(), world.proposal()

    def apply(p):
        try:
            world.approve(p, publish=False)
            return True
        except (CoreError, DBAPIError):
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(apply, [a, b])) == 1
    assert world.service.version(world.owner, world.domain)["accepted_version"] == 1


def test_failed_publication_rolls_back_and_retries(world, monkeypatch):
    p = world.proposal()
    world.approve(p, publish=False)
    original = world.service._apply

    def broken(*args):
        original(*args)
        raise RuntimeError("synthetic worker failure")

    monkeypatch.setattr(world.service, "_apply", broken)
    with pytest.raises(RuntimeError, match="failure"):
        world.service.publish(world.owner, world.domain)
    assert world.service.concepts(world.owner, world.domain) == []
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    monkeypatch.setattr(world.service, "_apply", original)
    assert world.service.publish(world.owner, world.domain)["published_version"] == 1


def test_replay_reconstructs_identical_state(world):
    world.approve(world.proposal())
    before = world.service.concepts(world.owner, world.domain)
    result = world.service.replay(world.owner, world.domain)
    assert result["concept_count"] == 1
    assert world.service.concepts(world.owner, world.domain) == before
    assert world.service.replay(world.owner, world.domain)["state_hash"] == result["state_hash"]


def test_compensation_retains_journal_and_removes_new_concept(world):
    world.approve(world.proposal())
    p = world.service.rollback_proposal(
        world.owner,
        world.domain,
        1,
        RollbackInput(
            expected_version=1, reason="Undo mistaken import", idempotency_key=str(uuid4())
        ),
    )
    assert len(world.service.concepts(world.owner, world.domain)) == 1
    world.approve(p)
    assert world.service.concepts(world.owner, world.domain) == []
    assert world.service.version(world.owner, world.domain)["published_version"] == 2
    assert world.service.replay(world.owner, world.domain)["concept_count"] == 0


def test_rollback_detects_intervening_edit(world):
    p = world.proposal()
    world.approve(p)
    ident = p["payload"][0]["concept"]["concept_id"]
    world.approve(world.proposal(concept_id=ident))
    with pytest.raises(CoreError, match="depend"):
        world.service.rollback_proposal(
            world.owner,
            world.domain,
            1,
            RollbackInput(expected_version=2, reason="test", idempotency_key=str(uuid4())),
        )


def test_source_revocation_hides_concepts_episodes_and_links(world):
    s = world.source()
    p = world.proposal(s)
    world.approve(p)
    result = query(world, world.viewer)
    assert result["citations"]
    world.service.set_access(
        world.owner, world.domain, s["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert world.service.concepts(world.viewer, world.domain) == []
    assert query(world, world.viewer)["status"] == "knowledge_gap"
    with pytest.raises(CoreError, match="Source"):
        world.service.episode(world.viewer, world.domain, result["episode_id"])


def test_owner_cannot_approve_after_support_is_revoked(world):
    s = world.source()
    p = world.proposal(s)
    world.service.set_access(
        world.owner, world.domain, s["id"], AccessInput(allowed_subjects=["bob"])
    )
    with pytest.raises(CoreError, match="Source"):
        world.approve(p)
    assert world.service.version(world.owner, world.domain)["accepted_version"] == 0


def test_graph_cycle_and_primary_parent_rules(world):
    a, b = world.proposal(), world.proposal()
    ca, cb = a["payload"][0]["concept"], b["payload"][0]["concept"]
    ca["links"] = [{"target_id": cb["concept_id"], "kind": "structural", "primary": True}]
    cb["links"] = [{"target_id": ca["concept_id"], "kind": "structural", "primary": True}]
    with pytest.raises(CoreError, match="cycle"):
        world.service.propose(
            world.owner,
            world.domain,
            ProposalInput(
                base_version=0,
                changes=[
                    {"kind": "put_concept", "concept": ca},
                    {"kind": "put_concept", "concept": cb},
                ],
                reason="cycle",
                idempotency_key=str(uuid4()),
            ),
        )


def test_graph_filters_restricted_target_names_and_edges(world):
    s = world.source(subjects=["alice"])
    private = world.proposal(s)
    private_id = private["payload"][0]["concept"]["concept_id"]
    world.approve(private)
    public = world.proposal(links=[{"target_id": private_id, "kind": "associative"}])
    world.approve(public)
    visible = world.service.concepts(world.viewer, world.domain)
    assert len(visible) == 1 and visible[0]["links"] == []
    assert private_id not in str(query(world, world.viewer))


def test_feedback_is_append_only_idempotent_and_not_shared(world):
    world.approve(world.proposal())
    episode = query(world)
    data = FeedbackInput(
        rating="unhelpful", explanation="Needs a newer procedure", idempotency_key=str(uuid4())
    )
    first = world.service.feedback(world.owner, world.domain, episode["episode_id"], data)
    assert world.service.feedback(world.owner, world.domain, episode["episode_id"], data) == first
    assert world.service.version(world.owner, world.domain)["published_version"] == 1
    with pytest.raises(CoreError, match="Episode"):
        world.service.feedback(world.viewer, world.domain, episode["episode_id"], data)
    brief = world.service.brief(world.owner, world.domain)
    assert len(brief["issues"]) == 1
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(text("DELETE FROM cf_feedback WHERE tenant_id=:t"), {"t": world.tenant})


def test_accepted_journal_is_immutable(world):
    world.approve(world.proposal())
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_commits SET reason='rewrite' WHERE tenant_id=:t"), {"t": world.tenant}
        )


def test_extract_import_requires_owner_and_preserves_entire_text(world):
    source = world.source()
    proposal = world.service.ingest_source(world.agent, world.domain, source["id"], str(uuid4()))
    assert world.service.concepts(world.owner, world.domain) == []
    world.approve(proposal)
    assert query(world)["citations"][0]["content_hash"] == source["content_hash"]


def test_query_budget_and_missing_knowledge(world):
    world.approve(world.proposal(world.source(content="incident " * 100)))
    result = world.service.query(
        world.owner, world.domain, QueryInput(question="incident", max_chars=100)
    )
    assert result["status"] == "knowledge_gap" and not result["concepts"]
    assert query(world, question="interplanetary procurement")["status"] == "knowledge_gap"


def test_errors_do_not_echo_source_content(world):
    secret = "SYNTHETIC_PRIVATE_CONTENT"
    response = world.client.post(
        world.prefix + "/sources", headers=world.headers(), json={"content": secret}
    )
    assert response.status_code == 422 and secret not in response.text


def test_request_body_limit(world):
    r = world.client.post(
        world.prefix + "/sources", headers=world.headers(), content=b"x" * 1000001
    )
    assert r.status_code == 413


def test_mcp_requires_identity_and_has_no_approval_tool(world):
    assert world.client.post("/mcp/", json={}).status_code == 401
    headers = {**world.headers("agent"), "Accept": "application/json, text/event-stream"}
    r = world.client.post(
        "/mcp/",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
    )
    assert r.status_code == 200, r.text
    tools = r.json()["result"]["tools"]
    assert {t["name"] for t in tools} == {"query", "inspect_concept", "propose", "feedback"}


def test_mcp_query_uses_authenticated_caller(world):
    world.approve(world.proposal())
    headers = {**world.headers("agent"), "Accept": "application/json, text/event-stream"}
    r = world.client.post(
        "/mcp/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "query",
                "arguments": {"domain_id": world.domain, "question": "incident"},
            },
        },
    )
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert not result.get("isError"), result
    assert "Escalate" in str(result)


def test_retired_proposal_keeps_source_access_requirements(world):
    s = world.source()
    world.approve(world.proposal(s))
    rollback = world.service.rollback_proposal(
        world.owner,
        world.domain,
        1,
        RollbackInput(expected_version=1, reason="Undo", idempotency_key=str(uuid4())),
    )
    world.approve(rollback)
    world.service.set_access(
        world.owner, world.domain, s["id"], AccessInput(allowed_subjects=["bob"])
    )
    with pytest.raises(CoreError, match="Source"):
        world.service.proposal(world.owner, world.domain, rollback["id"])


def test_reader_sees_one_snapshot_during_publication(world, monkeypatch):
    from threading import Event

    world.approve(world.proposal(), publish=False)
    snapshot, resume = Event(), Event()
    original = world.service._state

    def paused(*args):
        snapshot.set()
        assert resume.wait(5)
        return original(*args)

    monkeypatch.setattr(world.service, "_state", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(query, world)
        assert snapshot.wait(5)
        world.service.publish(world.owner, world.domain)
        resume.set()
        result = pending.result(5)
    assert result["served_version"] == 0
    assert result["status"] == "knowledge_gap"
    assert query(world)["served_version"] == 1


def test_inflight_source_revocation_withholds_answer(world, monkeypatch):
    from threading import Event

    s = world.source()
    world.approve(world.proposal(s))
    snapshot, resume = Event(), Event()
    original = world.service._state

    def paused(*args):
        snapshot.set()
        assert resume.wait(5)
        return original(*args)

    monkeypatch.setattr(world.service, "_state", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(query, world, world.viewer)
        assert snapshot.wait(5)
        world.service.set_access(
            world.owner, world.domain, s["id"], AccessInput(allowed_subjects=["alice"])
        )
        resume.set()
        with pytest.raises(CoreError, match="Source"):
            pending.result(5)


def test_import_retry_after_publication_returns_same_proposal(world):
    source = world.source()
    key = str(uuid4())
    first = world.service.ingest_source(world.agent, world.domain, source["id"], key)
    world.approve(first)
    again = world.service.ingest_source(world.agent, world.domain, source["id"], key)
    assert again["id"] == first["id"]
    assert again["status"] == "published"


def test_compensation_retry_after_publication_is_idempotent(world):
    world.approve(world.proposal())
    data = RollbackInput(expected_version=1, reason="Undo", idempotency_key=str(uuid4()))
    first = world.service.rollback_proposal(world.owner, world.domain, 1, data)
    world.approve(first)
    again = world.service.rollback_proposal(world.owner, world.domain, 1, data)
    assert again["id"] == first["id"]
    assert world.service.version(world.owner, world.domain)["accepted_version"] == 2


def test_replay_response_does_not_disclose_restricted_state(world):
    source = world.source()
    world.approve(world.proposal(source))
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    result = world.service.replay(world.owner, world.domain)
    assert result["concept_count"] == 0
    # Replay still reconstructs the entire projection internally.
    assert len(world.service.concepts(world.viewer, world.domain)) == 1


def test_proposal_endpoint_evidence_is_rechecked_after_revocation(world):
    source = world.source()
    target = world.proposal(source)
    world.approve(target)
    linked = world.proposal(
        links=[{"target_id": target["payload"][0]["concept"]["concept_id"], "kind": "associative"}]
    )
    assert source["id"] in linked["validation"]["source_ids"]
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    with pytest.raises(CoreError, match="Source"):
        world.service.proposal(world.owner, world.domain, linked["id"])
    with pytest.raises(CoreError, match="Source"):
        world.approve(linked)
    assert linked["id"] not in str(world.service.brief(world.owner, world.domain))
