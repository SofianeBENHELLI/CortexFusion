from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, QueryInput
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def call(w, method, path, body=None, subject="alice", status=200):
    r = w.client.request(method, w.prefix + path, json=body, headers=w.headers(subject))
    assert r.status_code == status, r.text
    return r.json()


def episode(w, principal=None):
    return w.service.query(
        principal or w.owner, w.domain, QueryInput(question="Question synthétique")
    )["episode_id"]


def signal(origin="explicit", kind="thumbs_up", **fields):
    return {
        "origin": origin,
        "kind": kind,
        "companion": "synthetic-test",
        "idempotency_key": str(uuid4()),
        **fields,
    }


def preference(w, observed=False, inferred=False, revision=0, subject="alice", status=200):
    return call(
        w,
        "PUT",
        "/feedback-preferences",
        {"allow_observed": observed, "allow_inferred": inferred, "expected_revision": revision},
        subject,
        status,
    )


def test_explicit_negative_signal_is_idempotent_and_does_not_publish(world):
    eid = episode(world)
    body = signal(kind="thumbs_down", comment="Réponse insuffisante")
    first = call(world, "POST", f"/episodes/{eid}/signals", body, status=201)
    assert first["signal"]["origin"] == "explicit" and first["served_version"] == 0
    assert call(world, "POST", f"/episodes/{eid}/signals", body, status=201) == first
    issues = call(world, "GET", "/issues")["items"]
    assert len([i for i in issues if i["kind"] == "disputed_answer"]) == 1
    assert world.service.concepts(world.owner, world.domain) == []
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("DELETE FROM cf_feedback_signals WHERE tenant_id=:tenant AND id=:id"),
            {"tenant": world.tenant, "id": first["id"]},
        )


def test_automatic_signals_are_opt_in_and_revocable(world):
    eid = episode(world)
    assert call(world, "GET", "/feedback-preferences") == {
        "allow_observed": False,
        "allow_inferred": False,
        "revision": 0,
    }
    observed = signal("observed", "reformulation", iteration_index=3)
    inferred = signal(
        "inferred",
        "satisfaction",
        confidence=0.7,
        sentiment="negative",
        comment="Plusieurs reformulations",
    )
    call(world, "POST", f"/episodes/{eid}/signals", observed, status=403)
    call(world, "POST", f"/episodes/{eid}/signals", inferred, status=403)
    preference(world, observed=True)
    receipt = call(world, "POST", f"/episodes/{eid}/signals", observed, status=201)
    call(world, "POST", f"/episodes/{eid}/signals", inferred, status=403)
    preference(world, inferred=True, revision=1)
    call(world, "POST", f"/episodes/{eid}/signals", inferred, status=201)
    call(world, "POST", f"/episodes/{eid}/signals", signal("observed", "correction"), status=403)
    assert call(world, "POST", f"/episodes/{eid}/signals", observed, status=201) == receipt
    preference(world, revision=0, status=409)


@pytest.mark.parametrize(
    "body",
    [
        signal("inferred", "thumbs_up", confidence=0.9, sentiment="positive"),
        signal("inferred", "satisfaction"),
        signal("observed", "thumbs_down"),
        signal(confidence=0.9),
        signal(iteration_index=1),
        signal(kind="comment", comment="  "),
    ],
)
def test_provenance_constraints(world, body):
    eid = episode(world)
    call(world, "POST", f"/episodes/{eid}/signals", body, status=422)


def test_history_is_personal_and_rechecks_sources(world):
    source = world.source()
    world.approve(world.proposal(source))
    eid = world.service.query(world.viewer, world.domain, QueryInput(question="incident"))[
        "episode_id"
    ]
    first = call(world, "POST", f"/episodes/{eid}/signals", signal(), subject="bob", status=201)
    assert first["source_ids"] == [source["id"]]
    assert call(world, "GET", "/feedback-signals")["items"] == []
    call(world, "POST", f"/episodes/{eid}/signals", signal(), status=404)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert call(world, "GET", "/feedback-signals", subject="bob")["items"] == []
    call(world, "POST", f"/episodes/{eid}/signals", first["signal"], subject="bob", status=404)


def test_signal_key_conflicts_and_preferences_are_personal(world):
    eid = episode(world)
    body = signal()
    call(world, "POST", f"/episodes/{eid}/signals", body, status=201)
    call(world, "POST", f"/episodes/{eid}/signals", {**body, "kind": "thumbs_down"}, status=409)
    preference(world, observed=True)
    assert call(world, "GET", "/feedback-preferences", subject="bob")["allow_observed"] is False


def test_generated_mcp_requires_confirmation_to_enable_automatic_collection(world):
    r = world.client.post(
        "/mcp/",
        headers={**world.headers("bob"), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_feedback_configure",
                "arguments": {
                    "path": {"domain": world.domain},
                    "body": {
                        "allow_observed": True,
                        "allow_inferred": True,
                        "expected_revision": 0,
                    },
                },
            },
        },
    )
    assert r.status_code == 200, r.text
    result = r.json()["result"]["structuredContent"]
    assert result["http_status"] == 428, result
    assert call(world, "GET", "/feedback-preferences", subject="bob")["allow_observed"] is False
