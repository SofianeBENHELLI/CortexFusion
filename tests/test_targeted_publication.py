from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, TargetedPublicationInput
from cortex_core.service import one
from test_http_confirmations import signed
from test_http_confirmations import strict_client as strict_fixture


@pytest.fixture
def strict_client(world, identity_keys):
    yield from strict_fixture.__wrapped__(world, identity_keys)


def publish(w, proposal, version=0, subject="alice"):
    return w.client.post(
        w.prefix + f"/proposals/{proposal['id']}/publish",
        headers=w.headers(subject),
        json={"expected_published_version": version},
    )


def test_target_replay_never_publishes_a_later_accepted_proposal(world):
    first = world.proposal()
    world.approve(first, publish=False)
    result = publish(world, first)
    assert result.status_code == 200, result.text
    assert result.json() == {
        "proposal_id": first["id"],
        "target_version": 1,
        "published_version": 1,
        "changed": True,
    }
    second = world.proposal()
    world.approve(second, publish=False)
    replay = publish(world, first).json()
    assert replay == {**result.json(), "changed": False}
    assert world.service.proposal(world.owner, world.domain, second["id"])["status"] == "approved"
    assert world.service.version(world.owner, world.domain)["published_version"] == 1
    assert publish(world, second, version=1).json()["target_version"] == 2
    final = publish(world, first).json()
    assert final["target_version"] == 1 and final["published_version"] == 2 and not final["changed"]


def test_target_requires_acceptance_and_exact_expected_version(world):
    proposal = world.proposal()
    assert publish(world, proposal).json()["error"] == "PUBLICATION_NOT_ACCEPTED"
    world.approve(proposal, publish=False)
    assert publish(world, proposal, version=3).json()["error"] == "STALE_PUBLICATION"
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    assert publish(world, {"id": str(uuid4())}).status_code == 404
    assert publish(world, proposal, subject="bob").status_code == 403
    assert publish(world, proposal, version=-1).status_code == 422


@pytest.mark.parametrize("already_published", [False, True])
def test_target_rechecks_evidence_even_for_already_published_replay(world, already_published):
    source = world.source()
    proposal = world.proposal(source)
    world.approve(proposal, publish=already_published)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert publish(world, proposal).status_code == 404
    assert world.service.version(world.owner, world.domain)["published_version"] == int(
        already_published
    )


def test_target_failure_rolls_back_projection_and_outbox(world, monkeypatch):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    original = world.service._apply

    def broken(*args):
        original(*args)
        raise RuntimeError("synthetic failed projection")

    monkeypatch.setattr(world.service, "_apply", broken)
    with pytest.raises(RuntimeError):
        world.service.publish_proposal(
            world.owner,
            world.domain,
            proposal["id"],
            TargetedPublicationInput(expected_published_version=0),
        )
    assert world.service.concepts(world.owner, world.domain) == []
    assert world.service.proposal(world.owner, world.domain, proposal["id"])["status"] == "approved"
    monkeypatch.setattr(world.service, "_apply", original)
    assert publish(world, proposal).json()["changed"]
    with world.db.transaction(world.owner, world.domain) as conn:
        row = one(
            conn,
            "SELECT attempts,status FROM cf_outbox WHERE tenant_id=:tenant AND domain_id=:domain",
            tenant=world.tenant,
            domain=world.domain,
        )
    assert row["attempts"] == 1 and row["status"] == "done"


def test_concurrent_target_publications_apply_once(world):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    barrier = Barrier(2)

    def execute(_):
        barrier.wait(timeout=5)
        response = publish(world, proposal)
        assert response.status_code == 200, response.text
        return response.json()["changed"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(execute, range(2))) == [False, True]


def test_target_confirmation_binds_body_and_mcp_reuses_target(world, identity_keys, strict_client):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    path = world.prefix + f"/proposals/{proposal['id']}/publish"
    args = {
        "path": {"domain": world.domain, "proposal_id": proposal["id"]},
        "body": {"expected_published_version": 0},
    }
    assert strict_client.post(path, headers=world.headers(), json=args["body"]).status_code == 428
    token = signed(world, identity_keys, "proposals.publish", args)
    assert (
        strict_client.post(
            path,
            headers={**world.headers(), "X-Cortex-Confirmation": token},
            json={"expected_published_version": 1},
        ).status_code
        == 403
    )
    first = strict_client.post(
        path, headers={**world.headers(), "X-Cortex-Confirmation": token}, json=args["body"]
    )
    assert first.status_code == 200, first.text
    token = signed(world, identity_keys, "proposals.publish", args)
    result = strict_client.post(
        "/mcp/",
        headers={
            **world.headers(),
            "X-Cortex-Confirmation": token,
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_proposals_publish", "arguments": args},
        },
    ).json()["result"]
    assert not result.get("isError")
    assert result["structuredContent"]["data"] == {**first.json(), "changed": False}
