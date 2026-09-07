import io
import json
import os
from urllib.error import HTTPError
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.auth import CoreError
from cortex_core.confirmations import sign_confirmed_action
from cortex_core.openrouter_model import OpenRouterPassageModel
from cortex_core.settings import Settings
from fastapi.testclient import TestClient
from pydantic import SecretStr


def reply(**changes):
    return {
        "id": "synthetic-request",
        "model": "synthetic/resolved",
        "choices": [
            {"finish_reason": "stop", "message": {"content": '{"quote":"Exact passage."}'}}
        ],
        **changes,
    }


def test_transport_and_usage(monkeypatch):
    model = OpenRouterPassageModel("synthetic/model", SecretStr("synthetic-secret"))

    def open_request(request, timeout):
        assert request.full_url == "https://openrouter.ai/api/v1/chat/completions"
        assert request.get_header("Authorization") == "Bearer synthetic-secret"
        body = json.loads(request.data)
        assert "synthetic-secret" not in request.data.decode()
        assert body["provider"] == {
            "require_parameters": True,
            "data_collection": "deny",
            "zdr": True,
        }
        # The portable OpenRouter limit keeps compatible non-OpenAI routes eligible
        # when require_parameters=True; max_completion_tokens excluded them live.
        assert body["max_tokens"] == 256 and timeout == 45
        assert "max_completion_tokens" not in body
        return io.BytesIO(
            json.dumps(
                reply(usage={"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001})
            ).encode()
        )

    monkeypatch.setattr(model.opener, "open", open_request)
    result = model.select("Introduction. Exact passage.")
    assert (result["start"], result["end"]) == (14, 28)
    assert result["cost_usd"] == 0.001 and result["model_digest"] is None
    assert result["model"] == "synthetic/resolved"


@pytest.mark.parametrize(
    "payload",
    [
        reply(
            choices=[
                {"finish_reason": "length", "message": {"content": '{"quote":"Exact passage."}'}}
            ]
        ),
        reply(choices=[{"finish_reason": "stop", "message": {"content": '{"quote":"Invented"}'}}]),
        reply(choices=[None]),
        reply(usage=[1]),
        reply(usage={"cost": float("nan")}),
        reply(usage={"prompt_tokens": True}),
        reply(model=None),
    ],
)
def test_untrusted_provider_output(monkeypatch, payload):
    model = OpenRouterPassageModel("synthetic/model", SecretStr("synthetic-secret"))
    monkeypatch.setattr(model, "_request", lambda data: payload)
    with pytest.raises(CoreError, match="exact"):
        model.select("Exact passage.")


@pytest.mark.parametrize(
    "status,code",
    [
        (400, "MODEL_REQUEST_REJECTED"),
        (404, "MODEL_ROUTE_UNAVAILABLE"),
        (401, "MODEL_AUTH_FAILED"),
        (402, "MODEL_BUDGET_EXHAUSTED"),
        (429, "MODEL_RATE_LIMITED"),
        (500, "MODEL_UNAVAILABLE"),
    ],
)
def test_provider_errors_are_sanitized(monkeypatch, status, code):
    model = OpenRouterPassageModel("synthetic/model", SecretStr("synthetic-secret"))

    def fail(*args, **kwargs):
        raise HTTPError(
            model.ENDPOINT, status, "synthetic-secret", {}, io.BytesIO(b"private-source")
        )

    monkeypatch.setattr(model.opener, "open", fail)
    with pytest.raises(CoreError) as caught:
        model.select("Exact passage.")
    assert caught.value.code == code
    assert "synthetic-secret" not in str(caught.value)
    assert "private-source" not in str(caught.value)


def test_key_environment_alias_is_private(monkeypatch):
    monkeypatch.delenv("CORTEX_OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-secret")
    settings = Settings(
        database_url="postgresql+pg8000://unused",
        jwt_issuer="test",
        jwks_url="https://identity.test/keys",
    )
    assert settings.model_provider == "openrouter"
    assert settings.openrouter_api_key.get_secret_value() == "synthetic-secret"
    assert "synthetic-secret" not in repr(settings)
    assert "openrouter_api_key" not in settings.model_dump()


def test_api_destination_and_receipt(world, identity_keys, monkeypatch):
    calls = []

    def request(self, data):
        calls.append(data)
        return reply()

    monkeypatch.setattr(OpenRouterPassageModel, "_request", request)
    settings = Settings(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        openrouter_model="synthetic/model",
        openrouter_api_key=SecretStr("synthetic-secret"),
        confirmation_public_key_file=identity_keys[1],
    )
    source = world.source(content="Exact passage.")

    def confirmed(action, body):
        arguments = {"path": {"domain": world.domain, "source_id": source["id"]}, "body": body}
        return {
            **world.headers(),
            "X-Cortex-Confirmation": sign_confirmed_action(
                identity_keys[0], "alice", world.tenant, action, arguments
            ),
        }

    with TestClient(create_app(settings)) as client:
        path = world.prefix + f"/sources/{source['id']}"
        local_body = {"allow_local_processing": True, "idempotency_key": str(uuid4())}
        assert (
            client.post(
                path + "/extract-local",
                headers=confirmed("sources.extract_local", local_body),
                json=local_body,
            ).status_code
            == 422
        )
        assert calls == []
        body = {"processing_destination": "openrouter", "idempotency_key": str(uuid4())}
        assert client.post(path + "/extract", headers=world.headers(), json=body).status_code == 428
        assert calls == []
        first = client.post(
            path + "/extract", headers=confirmed("sources.extract", body), json=body
        )
        assert first.status_code == 201, first.text
        receipt = first.json()
        assert receipt["provider"] == "openrouter" and receipt["input_tokens"] is None
        assert (
            client.post(
                path + "/extract", headers=confirmed("sources.extract", body), json=body
            ).json()
            == receipt
        )
        assert len(calls) == 1
        assert (
            client.get(
                world.prefix + f"/extractions/{receipt['id']}", headers=world.headers()
            ).json()
            == receipt
        )
        assert (
            client.get("/v1/me", headers=world.headers()).json()["extraction_provider"]
            == "openrouter"
        )
        assert world.service.concepts(world.owner, world.domain) == []
