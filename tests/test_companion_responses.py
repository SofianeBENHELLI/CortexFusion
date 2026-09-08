from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, QueryInput
from cortex_core.service import digest, encoded
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def episode(w, subject=None):
    return w.service.query(subject or w.viewer, w.domain, QueryInput(question="incident"))


def response_body(answer, **changes):
    return {
        "answer_text": "Escalate to the operations team, according to the cited procedure.",
        "answer_kind": "answer",
        "citations": [
            {k: c[k] for k in ("source_id", "start", "end")} for c in answer["citations"]
        ],
        "companion": "synthetic-companion",
        "model": "synthetic/model",
        "idempotency_key": str(uuid4()),
        **changes,
    }


def call(w, method, path, body=None, subject="bob", status=200, params=None):
    r = w.client.request(
        method, w.prefix + path, json=body, headers=w.headers(subject), params=params
    )
    assert r.status_code == status, r.text
    return r.json()


def record(w, answer, body=None):
    return call(
        w,
        "POST",
        f"/episodes/{answer['episode_id']}/companion-responses",
        body or response_body(answer),
        status=201,
    )


def test_response_receipt_is_idempotent_and_never_canonical(world):
    world.approve(world.proposal())
    answer = episode(world)
    body = response_body(answer)
    first = record(world, answer, body)
    assert record(world, answer, body) == first
    assert first["served_version"] == answer["served_version"]
    assert first["citations"] == answer["citations"]
    assert first["semantic_validation"] == "not_performed"
    assert first["reference_validation"] == "episode_references_checked"
    assert call(world, "GET", f"/companion-responses/{first['id']}") == first
    assert len(call(world, "GET", "/companion-responses")["items"]) == 1
    assert world.service.brief(world.owner, world.domain)["pending_proposals"] == []
    assert world.service.version(world.owner, world.domain)["published_version"] == 1
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("DELETE FROM cf_companion_responses WHERE tenant_id=:tenant AND id=:id"),
            {"tenant": world.tenant, "id": first["id"]},
        )
    call(
        world,
        "POST",
        f"/episodes/{answer['episode_id']}/companion-responses",
        {**body, "answer_text": "Changed answer"},
        status=409,
    )


def test_references_must_come_from_selected_episode(world):
    world.approve(world.proposal())
    answer = episode(world)
    body = response_body(answer)
    foreign = world.source()
    for ref in (
        {"source_id": foreign["id"], "start": 0, "end": 3},
        {**body["citations"][0], "start": 1},
    ):
        result = call(
            world,
            "POST",
            f"/episodes/{answer['episode_id']}/companion-responses",
            {**body, "citations": [ref]},
            status=422,
        )
        assert result["error"] == "UNSUPPORTED_RESPONSE_REFERENCE"
    assert call(world, "GET", "/companion-responses")["items"] == []


@pytest.mark.parametrize(
    "changes",
    [
        {"answer_text": "  "},
        {"citations": []},
        {"answer_text": "x" * 12001},
        {"subject": "alice"},
        {"answer_kind": "trusted_knowledge"},
    ],
)
def test_response_contract_rejects_invalid_or_spoofed_fields(world, changes):
    world.approve(world.proposal())
    answer = episode(world)
    call(
        world,
        "POST",
        f"/episodes/{answer['episode_id']}/companion-responses",
        response_body(answer, **changes),
        status=422,
    )


def test_abstention_without_evidence_and_semantic_limits(world):
    answer = episode(world)
    first = record(
        world,
        answer,
        response_body(
            answer, answer_kind="abstention", answer_text="I could not find approved evidence."
        ),
    )
    assert first["reference_validation"] == "no_references" and first["citations"] == []
    world.approve(world.proposal())
    answer = episode(world)
    # Matching references do not prove that this intentionally wrong synthetic claim follows.
    wrong = record(
        world,
        answer,
        response_body(answer, answer_text="All incidents always resolve automatically."),
    )
    assert wrong["semantic_validation"] == "not_performed"


def test_response_privacy_and_revocation(world):
    source = world.source()
    world.approve(world.proposal(source))
    answer = episode(world)
    first = record(world, answer)
    call(world, "GET", f"/companion-responses/{first['id']}", subject="alice", status=404)
    call(
        world,
        "POST",
        f"/episodes/{answer['episode_id']}/companion-responses",
        response_body(answer),
        subject="alice",
        status=404,
    )
    assert call(world, "GET", "/companion-responses", subject="alice")["items"] == []
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    call(world, "GET", f"/companion-responses/{first['id']}", status=404)
    assert call(world, "GET", "/companion-responses")["items"] == []
    call(
        world,
        "POST",
        f"/episodes/{answer['episode_id']}/companion-responses",
        first["response"],
        status=404,
    )


def test_feedback_can_target_a_precise_companion_response(world):
    world.approve(world.proposal())
    answer = episode(world)
    first, second = record(world, answer), record(world, answer)
    for receipt, kind in ((first, "thumbs_up"), (second, "thumbs_down")):
        body = {
            "origin": "explicit",
            "kind": kind,
            "companion": "synthetic-feedback-host",
            "companion_response_id": receipt["id"],
            "idempotency_key": str(uuid4()),
        }
        signal = call(world, "POST", f"/episodes/{answer['episode_id']}/signals", body, status=201)
        assert signal["signal"]["companion_response_id"] == receipt["id"]
    metrics = call(world, "GET", "/feedback-summary", params={"companion_response_id": first["id"]})
    assert metrics["signal_count"] == metrics["explicit"]["thumbs_up"] == 1
    assert metrics["explicit"]["thumbs_down"] == 0
    other = episode(world)
    call(
        world,
        "POST",
        f"/episodes/{other['episode_id']}/signals",
        {
            "origin": "explicit",
            "kind": "thumbs_up",
            "companion": "synthetic",
            "companion_response_id": first["id"],
            "idempotency_key": str(uuid4()),
        },
        status=404,
    )
    call(
        world,
        "GET",
        "/feedback-summary",
        subject="alice",
        params={"companion_response_id": first["id"]},
        status=404,
    )


def test_pre_receipt_feedback_fingerprint_still_replays(world):
    answer = episode(world)
    key, ident = str(uuid4()), str(uuid4())
    legacy = {
        "origin": "explicit",
        "kind": "thumbs_up",
        "comment": "",
        "companion": "legacy",
        "confidence": None,
        "sentiment": None,
        "iteration_index": None,
        "idempotency_key": key,
    }
    with world.admin.begin() as conn:
        conn.execute(
            text("""INSERT INTO cf_feedback_signals(tenant_id,domain_id,id,subject,episode_id,origin,kind,payload,idempotency_key,request_hash)
            VALUES(:tenant,:domain,:id,'bob',:episode,'explicit','thumbs_up',CAST(:payload AS jsonb),:key,:hash)"""),
            {
                "tenant": world.tenant,
                "domain": world.domain,
                "id": ident,
                "episode": answer["episode_id"],
                "payload": encoded(legacy),
                "key": key,
                "hash": digest({"episode_id": answer["episode_id"], **legacy}),
            },
        )
    result = call(world, "POST", f"/episodes/{answer['episode_id']}/signals", legacy, status=201)
    assert result["id"] == ident and result["signal"]["companion_response_id"] is None


def test_companion_response_round_trip_over_mcp(world):
    world.approve(world.proposal())
    answer = episode(world)

    def mcp(name, arguments):
        r = world.client.post(
            "/mcp/",
            headers={**world.headers("bob"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
        )
        return r.json()["result"]["structuredContent"]

    first = mcp(
        "api_responses_create",
        {
            "path": {"domain": world.domain, "episode_id": answer["episode_id"]},
            "body": response_body(answer),
        },
    )
    assert first["http_status"] == 201
    read = mcp(
        "api_responses_read", {"path": {"domain": world.domain, "response_id": first["data"]["id"]}}
    )
    assert read == {"http_status": 200, "data": first["data"]}
