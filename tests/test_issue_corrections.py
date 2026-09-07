from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, IssueDecisionInput
from cortex_core.issues import IssueService
from cortex_core.service import digest, one
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_issues import call, decision, gap


def linked(action, revision, proposal):
    return {**decision(action, revision), "correction_proposal_id": proposal["id"]}


def test_correction_tracks_start_and_published_resolution_without_publishing(world):
    issue = gap(world)
    proposal = world.proposal()
    path = f"/issues/{issue['id']}"
    start = linked("start", 0, proposal)
    receipt = call(world, "POST", path + "/decisions", start, expected=201)
    assert receipt["correction_digest"] == proposal["digest"]
    assert receipt["correction_published_version"] is None
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    world.approve(proposal, publish=False)
    resolution = linked("resolve", 1, proposal)
    denied = call(world, "POST", path + "/decisions", resolution, expected=409)
    assert denied["error"] == "CORRECTION_NOT_PUBLISHED"
    assert call(world, "GET", path)["revision"] == 1
    world.service.publish(world.owner, world.domain)
    result = call(world, "POST", path + "/decisions", resolution, expected=201)
    assert result["correction_published_version"] == 1
    assert result["correction_proposal_id"] == proposal["id"]
    assert call(world, "POST", path + "/decisions", start, expected=201) == receipt
    assert call(world, "POST", path + "/decisions", resolution, expected=201) == result
    assert len(call(world, "GET", path + "/events")["items"]) == 2
    assert world.service.version(world.owner, world.domain)["published_version"] == 1


def test_legacy_null_correction_keeps_old_idempotency_fingerprint(world):
    issue = gap(world)
    data = decision("resolve", 0)
    path = f"/issues/{issue['id']}/decisions"
    receipt = call(world, "POST", path, data, expected=201)
    with world.db.transaction(world.owner, world.domain) as conn:
        row = one(conn, "SELECT request_hash FROM cf_issue_events WHERE id=:id", id=receipt["id"])
    assert row["request_hash"] == digest({"issue": issue["id"], **data})
    assert (
        call(world, "POST", path, {**data, "correction_proposal_id": None}, expected=201) == receipt
    )
    proposal = world.proposal()
    call(world, "POST", path, {**data, "correction_proposal_id": proposal["id"]}, expected=409)


@pytest.mark.parametrize("action", ["dismiss", "reopen"])
def test_correction_invalid_actions_do_not_mutate(world, action):
    issue = gap(world)
    call(
        world,
        "POST",
        f"/issues/{issue['id']}/decisions",
        linked(action, 0, {"id": str(uuid4())}),
        expected=422,
    )
    assert call(world, "GET", f"/issues/{issue['id']}")["revision"] == 0


def test_correction_viewer_and_other_personal_owner_cannot_link(world):
    issue = gap(world, world.viewer)
    proposal = world.proposal()
    path = f"/issues/{issue['id']}/decisions"
    data = linked("start", 0, proposal)
    call(world, "POST", path, data, subject="bob", expected=404)
    call(world, "POST", path, data, expected=404)
    call(world, "POST", path, decision("resolve", 0), subject="bob", expected=201)


def test_correction_evidence_revocation_filters_history_and_replay(world):
    issue = gap(world)
    source = world.source()
    proposal = world.proposal(source)
    path = f"/issues/{issue['id']}"
    start = linked("start", 0, proposal)
    call(world, "POST", path + "/decisions", start, expected=201)
    call(world, "POST", path + "/decisions", decision("resolve", 1), expected=201)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    history = call(world, "GET", path + "/events?limit=1")
    assert len(history["items"]) == 1
    assert history["items"][0]["status"] == "resolved"
    assert history["next_after"] is None
    call(world, "POST", path + "/decisions", start, expected=404)
    assert call(world, "GET", path)["status"] == "resolved"


def test_correction_failed_receipt_rolls_back_issue(world, monkeypatch):
    issue = gap(world)
    proposal = world.proposal()

    def fail(conn, sql, **params):
        if "INSERT INTO cf_issue_events" in sql:
            raise RuntimeError("synthetic persistence failure")
        return one(conn, sql, **params)

    monkeypatch.setattr("cortex_core.issues.one", fail)
    with pytest.raises(RuntimeError):
        IssueService(world.service).decide(
            world.owner,
            world.domain,
            issue["id"],
            IssueDecisionInput(**linked("start", 0, proposal)),
        )
    assert call(world, "GET", f"/issues/{issue['id']}")["revision"] == 0
    assert world.service.proposal(world.owner, world.domain, proposal["id"])["status"] == "ready"


def test_correction_tenant_fk_and_immutable_event(world):
    issue = gap(world)
    proposal = world.proposal()
    receipt = call(
        world,
        "POST",
        f"/issues/{issue['id']}/decisions",
        linked("start", 0, proposal),
        expected=201,
    )
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_issue_events SET correction_proposal_id=NULL WHERE id=:id"),
            {"id": receipt["id"]},
        )
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("""INSERT INTO cf_issue_events(tenant_id,domain_id,id,issue_id,author,previous_status,status,revision,reason,idempotency_key,request_hash,correction_proposal_id,correction_digest)
            VALUES(:tenant,:domain,:id,:issue,'alice','open','in_progress',2,'synthetic',:key,'hash',:proposal,:digest)"""),
            {
                "tenant": world.tenant,
                "domain": world.domain,
                "id": str(uuid4()),
                "issue": issue["id"],
                "key": str(uuid4()),
                "proposal": str(uuid4()),
                "digest": proposal["digest"],
            },
        )


def test_correction_generated_mcp_receipt_matches_http_replay(world):
    issue = gap(world)
    proposal = world.proposal()
    data = linked("start", 0, proposal)
    response = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_issues_decide",
                "arguments": {"path": {"domain": world.domain, "ident": issue["id"]}, "body": data},
            },
        },
    )
    result = response.json()["result"]
    assert not result.get("isError")
    assert result["structuredContent"]["data"] == call(
        world, "POST", f"/issues/{issue['id']}/decisions", data, expected=201
    )


@pytest.mark.parametrize("action", ["reject", "defer", "request_changes"])
def test_inactive_correction_cannot_be_linked(world, action):
    from test_workspace import review

    issue = gap(world)
    proposal = world.proposal()
    review(world, proposal, action)
    response = call(
        world,
        "POST",
        f"/issues/{issue['id']}/decisions",
        linked("start", 0, proposal),
        expected=409,
    )
    assert response["error"] == "CORRECTION_NOT_ACTIVE"
    assert call(world, "GET", f"/issues/{issue['id']}")["revision"] == 0


def test_role_downgrade_hides_proposal_links_but_keeps_personal_decisions(world):
    issue = gap(world)
    proposal = world.proposal()
    path = f"/issues/{issue['id']}"
    start = linked("start", 0, proposal)
    call(world, "POST", path + "/decisions", start, expected=201)
    with world.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:tenant AND domain_id=:domain AND subject='alice'"
            ),
            {"tenant": world.tenant, "domain": world.domain},
        )
    assert call(world, "GET", path + "/events")["items"] == []
    call(world, "POST", path + "/decisions", start, expected=404)
    call(world, "POST", path + "/decisions", decision("resolve", 1), expected=201)
    assert len(call(world, "GET", path + "/events")["items"]) == 1
