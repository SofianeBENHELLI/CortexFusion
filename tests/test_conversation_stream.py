import asyncio
import json
from uuid import uuid4

import pytest
from cortex_core.auth import Authenticator, CoreError
from cortex_core.contracts import (
    AccessInput,
    QueryStreamError,
    QueryStreamResult,
    QueryStreamStarted,
)
from cortex_core.conversation_stream import wants_stream
from starlette.requests import ClientDisconnect


def conversation(world, subject="bob"):
    response = world.client.post(
        world.prefix + "/conversations",
        headers=world.headers(subject),
        json={"title": "Synthetic stream", "idempotency_key": str(uuid4())},
    )
    response.raise_for_status()
    return response.json()["id"]


def events(response):
    result = []
    models = {"started": QueryStreamStarted, "result": QueryStreamResult, "error": QueryStreamError}
    for block in response.text.strip().split("\n\n"):
        event, data = block.split("\n")
        kind = event.removeprefix("event: ")
        value = json.loads(data.removeprefix("data: "))
        models[kind].model_validate(value)
        assert value["event"] == kind
        result.append(value)
    return result


@pytest.mark.parametrize(
    ("accept", "expected"),
    [
        ("text/event-stream", True),
        ("text/event-stream; q=1,application/json;q=0.5", True),
        ("application/json,text/event-stream", False),
        ("*/*", False),
        ("text/event-stream;q=0", False),
        ("text/event-stream;q=nan", False),
        ("text/event-stream;q=bad", False),
        ("text/event-stream;q=2", False),
    ],
)
def test_stream_is_explicit_and_does_not_change_json_or_mcp_defaults(accept, expected):
    assert wants_stream(accept) is expected


@pytest.mark.parametrize("evidence", [True, False])
def test_stream_result_matches_json_and_reuses_episode(world, evidence):
    if evidence:
        world.approve(world.proposal(world.source()))
        world.service.publish(world.owner, world.domain)
    ident = conversation(world)
    path = world.prefix + "/conversations/" + ident + "/query"
    body = {"question": "incident", "idempotency_key": str(uuid4())}
    response = world.client.post(
        path, headers={**world.headers("bob"), "Accept": "text/event-stream"}, json=body
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-store"
    received = events(response)
    assert [e["event"] for e in received] == ["started", "result"]
    result = received[-1]["result"]
    assert result["status"] == ("evidence_found" if evidence else "knowledge_gap")
    assert world.client.post(path, headers=world.headers("bob"), json=body).json() == result
    assert (
        events(
            world.client.post(
                path, headers={**world.headers("bob"), "Accept": "text/event-stream"}, json=body
            )
        )[-1]["result"]
        == result
    )
    history = world.client.get(
        world.prefix + "/conversations/" + ident + "/messages", headers=world.headers("bob")
    ).json()
    assert len(history["items"]) == 1
    conflicting = world.client.post(
        path,
        headers={**world.headers("bob"), "Accept": "text/event-stream"},
        json={**body, "question": "changed"},
    )
    assert (
        conflicting.status_code == 409 and "event-stream" not in conflicting.headers["content-type"]
    )


def test_stream_refuses_invalid_cursor_and_private_conversation_before_headers(world):
    ident = conversation(world)
    path = world.prefix + "/conversations/" + ident + "/query"
    body = {"question": "incident", "idempotency_key": str(uuid4())}
    common = {"Accept": "text/event-stream"}
    assert world.client.post(path, headers=common, json=body).status_code == 401
    assert (
        world.client.post(path, headers={**world.headers(), **common}, json=body).status_code == 404
    )
    response = world.client.post(
        path, headers={**world.headers("bob"), **common, "Last-Event-ID": "previous"}, json=body
    )
    assert response.status_code == 422
    assert response.json()["error"] == "STREAM_CURSOR_UNSUPPORTED"


def test_stream_rechecks_source_access_after_query_commit(world, monkeypatch):
    source = world.source(content="Confidential synthetic incident procedure.")
    world.approve(world.proposal(source))
    world.service.publish(world.owner, world.domain)
    ident = conversation(world)
    original = world.service.query

    def revoke(*args, **kwargs):
        result = original(*args, **kwargs)
        world.service.set_access(
            world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
        )
        return result

    monkeypatch.setattr(world.service, "query", revoke)
    response = world.client.post(
        world.prefix + "/conversations/" + ident + "/query",
        headers={**world.headers("bob"), "Accept": "text/event-stream"},
        json={"question": "incident", "idempotency_key": str(uuid4())},
    )
    assert [e["event"] for e in events(response)] == ["started", "error"]
    assert events(response)[-1]["http_status"] == 404
    assert "Confidential synthetic" not in response.text


@pytest.mark.parametrize("failure", ["reauthentication", "unexpected"])
def test_stream_errors_do_not_echo_private_exceptions(world, monkeypatch, failure):
    ident = conversation(world)
    original = world.service.query

    def query(*args, **kwargs):
        if failure == "unexpected":
            raise RuntimeError("private backend exception")
        result = original(*args, **kwargs)

        def expired(*a, **k):
            raise CoreError("AUTH_REQUIRED", "private auth diagnostic", 401)

        monkeypatch.setattr(Authenticator, "authenticate", expired)
        return result

    monkeypatch.setattr(world.service, "query", query)
    response = world.client.post(
        world.prefix + "/conversations/" + ident + "/query",
        headers={**world.headers("bob"), "Accept": "text/event-stream"},
        json={"question": "incident", "idempotency_key": str(uuid4())},
    )
    last = events(response)[-1]
    assert response.status_code == 200 and last["event"] == "error"
    assert last["http_status"] == (401 if failure == "reauthentication" else 503)
    assert "private" not in response.text


def test_start_is_sent_before_work_and_lost_final_delivery_reuses_durable_episode(
    world, monkeypatch
):
    ident = conversation(world)
    path = world.prefix + "/conversations/" + ident + "/query"
    body = {"question": "incident", "idempotency_key": str(uuid4())}
    started = []
    original = world.service.query

    def query(*args, **kwargs):
        assert started, "No actual started chunk was sent before running the query"
        return original(*args, **kwargs)

    monkeypatch.setattr(world.service, "query", query)

    async def request():
        headers = {
            **world.headers("bob"),
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
        }
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": ("127.0.0.1", 1),
            "server": ("localhost", 8000),
        }
        delivered = False

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {
                    "type": "http.request",
                    "body": json.dumps(body).encode(),
                    "more_body": False,
                }
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body":
                if b"event: started" in message.get("body", b""):
                    started.append(True)
                elif b"event: result" in message.get("body", b""):
                    raise OSError("Synthetic lost connection after commit")

        await world.app(scope, receive, send)

    with pytest.raises(ClientDisconnect):
        asyncio.run(request())
    resumed = world.client.post(path, headers=world.headers("bob"), json=body)
    assert resumed.status_code == 200
    history = world.client.get(
        world.prefix + "/conversations/" + ident + "/messages", headers=world.headers("bob")
    ).json()
    assert len(history["items"]) == 1
    assert history["items"][0]["result"]["episode_id"] == resumed.json()["episode_id"]
