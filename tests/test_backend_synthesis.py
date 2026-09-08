import os
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.auth import CoreError
from cortex_core.confirmations import sign_confirmed_action
from cortex_core.contracts import AccessInput, QueryInput, SynthesisInput
from cortex_core.model_attempts import ModelAttemptService
from cortex_core.service import one
from cortex_core.settings import Settings
from cortex_core.synthesis_model import OpenRouterSynthesis
from fastapi.testclient import TestClient
from pydantic import SecretStr
from test_companion import provider_reply


def body():
    return {"processing_destination": "openrouter", "idempotency_key": str(uuid4())}


def setup(w, monkeypatch, evidence=True):
    source = w.source()
    if evidence:
        w.approve(w.proposal(source))
    episode = w.service.query(w.viewer, w.domain, QueryInput(question="incident"))
    calls = []

    def request(self, payload):
        calls.append(payload)
        return provider_reply()

    monkeypatch.setattr(OpenRouterSynthesis, "_request", request)
    w.app.state.synthesis.factory = lambda: OpenRouterSynthesis(
        "synthetic/model", SecretStr("synthetic-secret")
    )
    return episode["episode_id"], calls, source


def post(w, episode, data, subject="bob"):
    return w.client.post(
        w.prefix + f"/episodes/{episode}/syntheses", headers=w.headers(subject), json=data
    )


def read(w, ident, subject="bob"):
    return w.client.get(w.prefix + f"/syntheses/{ident}", headers=w.headers(subject))


def test_synthesis_success_replay_and_personal_receipt(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    data = body()
    first = post(world, episode, data)
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["status"] == "succeeded" and result["budget_reserved"]
    assert post(world, episode, data).json() == result
    world.app.state.synthesis.factory = None
    assert post(world, episode, data).json() == result
    assert len(calls) == 1
    receipt = world.client.get(
        world.prefix + "/companion-responses/" + result["response_id"], headers=world.headers("bob")
    ).json()
    assert receipt["response"]["answer_kind"] == "answer"
    assert receipt["served_version"] == 1 and receipt["semantic_validation"] == "not_performed"
    assert world.service.version(world.owner, world.domain)["published_version"] == 1
    assert read(world, result["id"], "alice").status_code == 404
    assert read(world, result["id"]).json() == result
    listed = world.client.get(
        world.prefix + "/syntheses",
        headers=world.headers("bob"),
        params={"episode_id": episode, "idempotency_key": data["idempotency_key"]},
    ).json()
    assert listed["items"] == [result]
    other = world.service.query(world.viewer, world.domain, QueryInput(question="different"))
    assert post(world, other["episode_id"], data).json()["error"] == "IDEMPOTENCY_CONFLICT"


def test_disabled_and_gap_never_call_provider(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch, evidence=False)
    factory = world.app.state.synthesis.factory
    world.app.state.synthesis.factory = None
    assert post(world, episode, body()).status_code == 503
    world.app.state.synthesis.factory = factory
    world.app.state.synthesis.quota.daily_limit = 0
    result = post(world, episode, body()).json()
    assert result["status"] == "succeeded" and not result["budget_reserved"]
    assert result["provider"] == "none" and result["usage"] is None
    assert calls == []
    assert (
        world.app.state.synthesis.quota.usage(world.owner, world.domain)["reserved_attempts"] == 0
    )


def test_concurrent_same_key_observes_unresolved_without_second_call(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    entered, release = Event(), Event()
    original = OpenRouterSynthesis._request

    def paused(self, payload):
        entered.set()
        assert release.wait(5)
        return original(self, payload)

    monkeypatch.setattr(OpenRouterSynthesis, "_request", paused)
    data = body()
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(post, world, episode, data)
        try:
            assert entered.wait(5)
            second = post(world, episode, data).json()
            assert second["status"] == "unresolved"
        finally:
            release.set()
        final = first.result(timeout=5).json()
    assert final["id"] == second["id"] and final["status"] == "succeeded"
    assert len(calls) == 1


def test_interruption_after_model_never_replays_uncertain_attempt(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    service = world.app.state.synthesis

    class Interrupted(BaseException):
        pass

    def stop(*args):
        raise Interrupted()

    monkeypatch.setattr(service.responses, "_create", stop)
    data = SynthesisInput(**body())
    with pytest.raises(Interrupted):
        service.execute(world.viewer, world.domain, episode, data, lambda: world.viewer)
    retry = service.execute(world.viewer, world.domain, episode, data, lambda: world.viewer)
    assert retry["status"] == "unresolved" and retry["response_id"] is None
    assert len(calls) == 1
    assert service.responses.listing(world.viewer, world.domain, 20, None)["items"] == []


def test_revocation_during_generation_discards_response(world, monkeypatch):
    episode, calls, source = setup(world, monkeypatch)
    original = OpenRouterSynthesis._request

    def revoke(self, payload):
        result = original(self, payload)
        world.service.set_access(
            world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
        )
        return result

    monkeypatch.setattr(OpenRouterSynthesis, "_request", revoke)
    data = body()
    assert post(world, episode, data).status_code == 404
    assert post(world, episode, data).status_code == 404
    assert len(calls) == 1
    with world.db.transaction(world.owner, world.domain) as conn:
        row = one(
            conn,
            "SELECT o.status,o.error_code,o.response_id,o.usage FROM cf_synthesis_outcomes o WHERE tenant_id=:tenant AND domain_id=:domain",
            tenant=world.tenant,
            domain=world.domain,
        )
    assert row["status"] == "failed" and row["response_id"] is None
    assert row["usage"]["cost_usd"] == 0.001


def test_token_recheck_before_delivery_prevents_response(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    count = 0

    def authenticate():
        nonlocal count
        count += 1
        if count >= 3:
            raise CoreError("TOKEN_EXPIRED", "expired", 401)
        return world.viewer

    with pytest.raises(CoreError) as error:
        world.app.state.synthesis.execute(
            world.viewer, world.domain, episode, SynthesisInput(**body()), authenticate
        )
    assert error.value.status == 401 and len(calls) == 1
    rows = world.app.state.synthesis.listing(world.viewer, world.domain, 20, None)["items"]
    assert rows[0]["status"] == "failed" and rows[0]["response_id"] is None


def test_invalid_output_retains_only_safe_usage_and_error(world, monkeypatch):
    episode, _, _ = setup(world, monkeypatch)
    monkeypatch.setattr(
        OpenRouterSynthesis,
        "_request",
        lambda self, payload: provider_reply(
            answer_text="PRIVATE REJECTED TEXT [999]", citation_indices=[999]
        ),
    )
    result = post(world, episode, body()).json()
    assert result["status"] == "failed" and result["error_code"] == "UNSUPPORTED_SYNTHESIS"
    assert result["usage"]["cost_usd"] == 0.001
    assert "PRIVATE" not in str(result) and result["response_id"] is None


def test_shared_quota_blocks_synthesis_after_extraction_reservation(world, monkeypatch):
    episode, calls, source = setup(world, monkeypatch)
    quota = ModelAttemptService(world.service, daily_limit=1)
    quota.reserve(
        world.owner,
        world.domain,
        source["id"],
        str(uuid4()),
        "synthetic",
        "openrouter",
        "synthetic/model",
        0,
        1,
        "a",
    )
    world.app.state.synthesis.quota.daily_limit = 1
    result = post(world, episode, body())
    assert result.status_code == 429 and calls == []
    assert quota.usage(world.owner, world.domain)["reserved_attempts"] == 1


def test_shared_quota_blocks_extraction_after_synthesis(world, monkeypatch):
    episode, _, source = setup(world, monkeypatch)
    post(world, episode, body())
    quota = ModelAttemptService(world.service, daily_limit=1)
    with pytest.raises(CoreError) as error:
        quota.reserve(
            world.owner,
            world.domain,
            source["id"],
            str(uuid4()),
            "synthetic",
            "openrouter",
            "synthetic/model",
            0,
            1,
            "a",
        )
    assert error.value.status == 429


def test_strict_http_and_mcp_confirmations_bind_same_attempt(world, monkeypatch, identity_keys):
    episode, calls, _ = setup(world, monkeypatch)
    settings = Settings(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        confirmation_public_key_file=identity_keys[1],
    )
    app = create_app(settings)
    app.state.synthesis.factory = world.app.state.synthesis.factory
    data = body()
    args = {"path": {"domain": world.domain, "episode_id": episode}, "body": data}

    def headers():
        token = sign_confirmed_action(
            identity_keys[0], "bob", world.tenant, "syntheses.create", args
        )
        return {**world.headers("bob"), "X-Cortex-Confirmation": token}

    with TestClient(app, base_url="http://localhost:8000") as client:
        path = world.prefix + f"/episodes/{episode}/syntheses"
        assert client.post(path, headers=world.headers("bob"), json=data).status_code == 428
        assert calls == []
        first = client.post(path, headers=headers(), json=data)
        assert first.status_code == 200, first.text
        result = client.post(
            "/mcp/",
            headers={**headers(), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_syntheses_create", "arguments": args},
            },
        ).json()["result"]
        assert not result.get("isError"), result
        assert result["structuredContent"]["data"] == first.json()
    assert len(calls) == 1


def test_outcome_storage_failure_rolls_back_receipt_and_never_retries_model(world, monkeypatch):
    import cortex_core.synthesis as module

    episode, calls, _ = setup(world, monkeypatch)
    original = module.run

    def fail(conn, sql, **params):
        if "INSERT INTO cf_synthesis_outcomes" in sql and "'succeeded'" in sql:
            raise RuntimeError("private database diagnostic")
        return original(conn, sql, **params)

    monkeypatch.setattr(module, "run", fail)
    data = body()
    result = post(world, episode, data).json()
    assert result["status"] == "failed" and result["response_id"] is None
    assert result["error_code"] == "SYNTHESIS_FAILED"
    assert "private" not in str(result)
    assert post(world, episode, data).json() == result and len(calls) == 1
    assert (
        world.app.state.synthesis.responses.listing(world.viewer, world.domain, 20, None)["items"]
        == []
    )


def test_before_dispatch_revocation_prevents_provider_call(world, monkeypatch):
    episode, calls, source = setup(world, monkeypatch)
    count = 0

    def authenticate():
        nonlocal count
        count += 1
        if count == 2:
            world.service.set_access(
                world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
            )
        return world.viewer

    with pytest.raises(CoreError) as error:
        world.app.state.synthesis.execute(
            world.viewer, world.domain, episode, SynthesisInput(**body()), authenticate
        )
    assert error.value.status == 404 and calls == []


def test_concurrent_distinct_keys_share_one_remaining_reservation(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    world.app.state.synthesis.quota.daily_limit = 1
    entered, release = Event(), Event()
    original = OpenRouterSynthesis._request

    def paused(self, payload):
        entered.set()
        assert release.wait(5)
        return original(self, payload)

    monkeypatch.setattr(OpenRouterSynthesis, "_request", paused)
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(post, world, episode, body())
        try:
            assert entered.wait(5)
            assert post(world, episode, body()).status_code == 429
        finally:
            release.set()
        assert first.result(timeout=5).json()["status"] == "succeeded"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"processing_destination": "ollama"},
        {"question": "Replace the stored question"},
        {"idempotency_key": "short"},
    ],
)
def test_synthesis_rejects_unbound_destination_or_question(world, monkeypatch, changes):
    episode, calls, _ = setup(world, monkeypatch)
    assert post(world, episode, {**body(), **changes}).status_code == 422
    assert calls == []


def test_synthesis_records_are_immutable_and_tenant_isolated(world, monkeypatch):
    from cortex_core.auth import Principal
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    episode, _, _ = setup(world, monkeypatch)
    result = post(world, episode, body()).json()
    with world.db.transaction(Principal("alice", world.other_tenant), world.other_domain) as conn:
        assert (
            one(conn, "SELECT id FROM cf_synthesis_attempts WHERE id=:id", id=result["id"]) is None
        )
        assert (
            one(
                conn,
                "SELECT attempt_id FROM cf_synthesis_outcomes WHERE attempt_id=:id",
                id=result["id"],
            )
            is None
        )
    for table, column in [("cf_synthesis_attempts", "id"), ("cf_synthesis_outcomes", "attempt_id")]:
        with pytest.raises(DBAPIError), world.admin.begin() as conn:
            conn.execute(text(f"DELETE FROM {table} WHERE {column}=:id"), {"id": result["id"]})


def test_synthesis_requires_explicit_activation_with_server_key(world, identity_keys):
    values = dict(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        openrouter_model="synthetic/model",
        openrouter_api_key=SecretStr("synthetic"),
    )
    assert create_app(Settings(**values)).state.synthesis.factory is None
    app = create_app(Settings(**values, synthesis_enabled=True))
    first, second = app.state.synthesis.factory(), app.state.synthesis.factory()
    assert first is not second and first.model == "synthetic/model"
    with TestClient(app, base_url="http://localhost:8000") as client:
        me = client.get("/v1/me", headers=world.headers("bob")).json()
        assert "synthesize" in me["domains"][0]["capabilities"]
    app.state.db.dispose()


def test_token_expiry_after_commit_preserves_recoverable_success(world, monkeypatch):
    from cortex_core.synthesis import SynthesisService

    episode, calls, _ = setup(world, monkeypatch)
    data = SynthesisInput(**body())
    count = 0

    def authenticate():
        nonlocal count
        count += 1
        if count == 4:
            raise CoreError("TOKEN_EXPIRED", "Synthetic expiry after commit", 401)
        return world.viewer

    with pytest.raises(CoreError) as error:
        world.app.state.synthesis.execute(world.viewer, world.domain, episode, data, authenticate)
    assert error.value.status == 401
    # A fresh service with no configured model must recover the committed result.
    fresh = SynthesisService(world.service)
    result = fresh.execute(world.viewer, world.domain, episode, data, lambda: world.viewer)
    assert result["status"] == "succeeded" and result["response_id"]
    assert len(calls) == 1
    assert len(fresh.responses.listing(world.viewer, world.domain, 20, None)["items"]) == 1


def test_http_lost_response_body_recovers_without_second_generation(world, monkeypatch):
    import asyncio
    import json

    episode, calls, _ = setup(world, monkeypatch)
    data = body()
    path = world.prefix + f"/episodes/{episode}/syntheses"
    committed = []

    async def request():
        headers = {**world.headers("bob"), "Content-Type": "application/json"}
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
        received = False

        async def receive():
            nonlocal received
            if not received:
                received = True
                return {
                    "type": "http.request",
                    "body": json.dumps(data).encode(),
                    "more_body": False,
                }
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body":
                committed.append(json.loads(message["body"]))
                raise OSError("Synthetic lost HTTP body")

        await world.app(scope, receive, send)

    with pytest.raises(OSError, match="Synthetic lost HTTP body"):
        asyncio.run(request())
    resumed = post(world, episode, data)
    assert resumed.status_code == 200 and resumed.json() == committed[0]
    assert resumed.json()["status"] == "succeeded" and len(calls) == 1


def test_attempt_lookup_filters_keys_and_paginates_without_mutating(world, monkeypatch):
    episode, calls, _ = setup(world, monkeypatch)
    first_data, second_data = body(), body()
    first, second = (
        post(world, episode, first_data).json(),
        post(world, episode, second_data).json(),
    )
    url = world.prefix + "/syntheses"
    params = {"episode_id": episode, "limit": 1}
    page = world.client.get(url, headers=world.headers("bob"), params=params).json()
    rest = world.client.get(
        url, headers=world.headers("bob"), params={**params, "after": page["next_after"]}
    ).json()
    assert {page["items"][0]["id"], rest["items"][0]["id"]} == {first["id"], second["id"]}
    assert rest["next_after"] is None
    assert (
        world.client.get(
            url,
            headers=world.headers("alice"),
            params={"idempotency_key": first_data["idempotency_key"]},
        ).json()["items"]
        == []
    )
    assert len(calls) == 2
