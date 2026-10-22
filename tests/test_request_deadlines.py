import asyncio
import json
import time

import pytest
from cortex_core import deadlines
from cortex_core.api import create_app
from cortex_core.deadlines import DeadlineMiddleware, deadline
from cortex_core.settings import Settings
from fastapi import FastAPI
from fastapi.responses import StreamingResponse


def test_route_classes_match_the_native_deadlines():
    assert deadline("/v1/me") == 20
    assert deadline("/v1/domains/d/files/f/process") == 20
    assert deadline("/v1/domains/d/episodes/e/syntheses") == 60
    assert deadline("/v1/domains/d/sources/s/extract-local") == 60
    assert deadline("/v1/domains/d/proposals/p/publish") == 120
    assert deadline("/v1/domains/d/commits/3/compensate") == 120
    assert deadline("/v1/domains/d/proposals/p/publish/extra") == 20


def test_longer_deadlines_name_existing_routes(identity_keys):
    app = create_app(
        Settings(
            database_url="postgresql+pg8000://synthetic:synthetic@127.0.0.1:9/never_test",
            jwt_issuer="https://identity.test",
            jwt_public_key_file=identity_keys[1],
        )
    )
    # Included routers do not list their routes in app.routes; the schema does.
    paths = app.openapi()["paths"]
    for template in deadlines.MODEL_ROUTES + deadlines.PUBLICATION_ROUTES:
        assert template in paths, template


def run(app, path):
    """Drive one ASGI request; return (seconds since start, message) pairs."""

    async def scenario():
        began, messages, asked = time.monotonic(), [], False

        async def receive():
            nonlocal asked
            if not asked:
                asked = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            messages.append((time.monotonic() - began, message))

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 1),
            "server": ("127.0.0.1", 80),
        }
        await app(scope, receive, send)
        return time.monotonic() - began, messages

    return asyncio.run(scenario())


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(deadlines, "DEFAULT_SECONDS", 0.2)
    application = FastAPI()

    @application.get("/v1/slow")
    def slow():
        time.sleep(0.8)
        return {"late": True}

    @application.get("/v1/stream")
    def stream():
        def chunks():
            yield b"first "
            time.sleep(0.5)
            yield b"second"

        return StreamingResponse(chunks())

    @application.get("/v1/broken")
    def broken():
        raise RuntimeError("synthetic crash")

    @application.get("/mcp/slow")
    def transport():
        time.sleep(0.5)
        return {"transport": True}

    application.add_middleware(DeadlineMiddleware)
    return application


def test_overdue_handler_gets_503_at_the_deadline_and_its_late_reply_is_dropped(app):
    finished, messages = run(app, "/v1/slow")
    starts = [(at, m) for at, m in messages if m["type"] == "http.response.start"]
    assert len(starts) == 1 and starts[0][1]["status"] == 503
    # The client is answered at the deadline; the thread still ends its bounded work.
    assert starts[0][0] < 0.6 <= finished
    body = b"".join(m.get("body", b"") for _, m in messages)
    assert json.loads(body)["error"] == "REQUEST_TIMEOUT"


def test_started_streams_and_the_mcp_transport_are_not_cut(app):
    for path, expected in [("/v1/stream", b"first second"), ("/mcp/slow", b'{"transport":true}')]:
        _, messages = run(app, path)
        assert [m["status"] for _, m in messages if m["type"] == "http.response.start"] == [200]
        assert b"".join(m.get("body", b"") for _, m in messages) == expected


def test_handler_errors_reach_the_server_unwrapped(app):
    # Crash and lost-connection tests rely on the original exception type.
    with pytest.raises(RuntimeError, match="synthetic crash"):
        run(app, "/v1/broken")
