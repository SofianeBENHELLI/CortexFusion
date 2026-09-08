from datetime import datetime

import pytest
from cortex_core.auth import Principal
from cortex_core.contracts import AccessInput, TargetedPublicationInput
from cortex_core.service import one
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_governance import call, change


def audit_rows(w):
    with w.db.transaction(w.owner, w.domain) as conn:
        return one(
            conn,
            "SELECT count(*) AS n FROM cf_publications WHERE tenant_id=:t AND domain_id=:d",
            t=w.tenant,
            d=w.domain,
        )["n"]


def test_acceptance_and_publication_have_distinct_actors_and_timestamps(world):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    pending = call(world, "GET", "/commits")["items"][0]
    assert pending["author"] == "alice" and not pending["published"]
    assert pending["publication"] is None
    change(world, "bob", "owner", 0)
    world.service.publish(Principal("bob", world.tenant), world.domain)
    published = call(world, "GET", "/commits")["items"][0]
    assert published["published"] and published["author"] == "alice"
    assert published["created_at"] == pending["created_at"]
    assert published["publication"]["publisher"] == "bob"
    assert datetime.fromisoformat(
        published["publication"]["recorded_at"]
    ) >= datetime.fromisoformat(pending["created_at"])
    result = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_commits_list", "arguments": {"path": {"domain": world.domain}}},
        },
    ).json()["result"]
    assert not result.get("isError")
    assert result["structuredContent"]["data"]["items"] == [published]


def test_retries_and_projection_replay_preserve_original_publication(world):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    data = TargetedPublicationInput(expected_published_version=0)
    world.service.publish_proposal(world.owner, world.domain, proposal["id"], data)
    initial = call(world, "GET", "/commits")["items"][0]
    change(world, "bob", "owner", 0)
    assert not world.service.publish_proposal(
        Principal("bob", world.tenant), world.domain, proposal["id"], data
    )["changed"]
    assert not world.service.publish(world.owner, world.domain)["changed"]
    world.service.replay(world.owner, world.domain)
    assert call(world, "GET", "/commits")["items"] == [initial]
    assert audit_rows(world) == 1


def test_failure_after_audit_insert_rolls_back_every_publication_effect(world, monkeypatch):
    import cortex_core.service as module

    proposal = world.proposal()
    world.approve(proposal, publish=False)
    original = module.run

    def fail(conn, sql, **params):
        if sql.startswith("UPDATE cf_outbox SET status="):
            assert (
                one(
                    conn,
                    "SELECT count(*) AS n FROM cf_publications WHERE tenant_id=:t",
                    t=world.tenant,
                )["n"]
                == 1
            )
            raise RuntimeError("synthetic failure after publication audit insert")
        return original(conn, sql, **params)

    monkeypatch.setattr(module, "run", fail)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        world.service.publish(world.owner, world.domain)
    monkeypatch.setattr(module, "run", original)
    assert audit_rows(world) == 0
    assert world.service.concepts(world.owner, world.domain) == []
    pending = call(world, "GET", "/commits")["items"][0]
    assert not pending["published"] and pending["publication"] is None
    world.service.publish(world.owner, world.domain)
    assert audit_rows(world) == 1


@pytest.mark.parametrize(
    "operation", ["UPDATE cf_publications SET publisher='changed'", "DELETE FROM cf_publications"]
)
def test_publication_events_are_immutable_even_for_admin(world, operation):
    world.approve(world.proposal())
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(text(operation + " WHERE tenant_id=:t"), {"t": world.tenant})
    assert call(world, "GET", "/commits")["items"][0]["publication"]["publisher"] == "alice"


def test_publication_metadata_respects_roles_evidence_and_tenant_rls(world):
    source = world.source()
    world.approve(world.proposal(source))
    call(world, "GET", "/commits", subject="bob", expected=403)
    with world.db.transaction(Principal("alice", world.other_tenant), world.other_domain) as conn:
        assert (
            one(
                conn, "SELECT count(*) AS n FROM cf_publications WHERE tenant_id=:t", t=world.tenant
            )["n"]
            == 0
        )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert call(world, "GET", "/commits") == {"items": [], "next_after": None}


def test_historical_publication_without_audit_is_not_guessed(world):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    # Emulate pre-0018 data without changing immutable audit rows or global schema.
    with world.admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_domains SET published_version=1 WHERE tenant_id=:t AND id=:d"),
            {"t": world.tenant, "d": world.domain},
        )
        conn.execute(
            text("UPDATE cf_proposals SET status='published' WHERE tenant_id=:t AND id=:id"),
            {"t": world.tenant, "id": proposal["id"]},
        )
    historical = call(world, "GET", "/commits")["items"][0]
    assert historical["published"] and historical["publication"] is None
    assert not world.service.publish_proposal(
        world.owner,
        world.domain,
        proposal["id"],
        TargetedPublicationInput(expected_published_version=0),
    )["changed"]
    assert audit_rows(world) == 0
