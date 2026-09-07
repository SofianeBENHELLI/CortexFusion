import asyncio
import json
import os
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cortex_core.api import create_app
from cortex_core.auth import CoreError
from cortex_core.companion import Journal
from cortex_core.companion_assessment import OpenRouterAssessment, assess_feedback
from cortex_core.settings import Settings
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pydantic import SecretStr


def reply(**changes):
    return {
        "id": "synthetic-request",
        "model": "synthetic/model",
        "usage": {"cost": 0.001, "prompt_tokens": 40, "completion_tokens": 20},
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": json.dumps(
                        {
                            "sentiment": "negative",
                            "confidence": 0.8,
                            "explanation": "The comment describes an unhelpful answer.",
                            **changes,
                        }
                    )
                },
            }
        ],
    }


def test_assessment_sends_only_comment_with_no_executable_tools(monkeypatch):
    model = OpenRouterAssessment("synthetic/model", SecretStr("synthetic-secret"))
    seen = []

    def request(payload):
        seen.append(payload)
        assert json.loads(payload["messages"][1]["content"]) == {"comment": "Still not helpful"}
        assert "untrusted data" in payload["messages"][0]["content"]
        assert "synthetic-secret" not in json.dumps(payload)
        assert "tools" not in payload and payload["max_tokens"] == 256
        assert payload["provider"]["zdr"] and payload["provider"]["data_collection"] == "deny"
        return reply()

    monkeypatch.setattr(model, "_request", request)
    result = model.assess("Still not helpful")
    assert result["sentiment"] == "negative" and len(seen) == 1
    assert result["prompt_version"] == "comment-satisfaction-v1"


@pytest.mark.parametrize(
    "changes",
    [
        {"confidence": True},
        {"confidence": "0.8"},
        {"confidence": 1.1},
        {"confidence": float("nan")},
        {"explanation": " "},
        {"sentiment": "thumbs_down"},
    ],
)
def test_invalid_inference_is_rejected(monkeypatch, changes):
    model = OpenRouterAssessment("synthetic/model", SecretStr("secret"))
    monkeypatch.setattr(model, "_request", lambda _: reply(**changes))
    with pytest.raises(CoreError) as caught:
        model.assess("Unhelpful answer")
    assert caught.value.code == "UNSUPPORTED_ASSESSMENT"
    assert model.last_usage["cost_usd"] == 0.001


class Session:
    def __init__(self, allowed=True):
        self.allowed, self.denied, self.write_error = allowed, False, False
        self.calls, self.signals = [], []

    async def call_tool(self, name, args):
        self.calls.append(name)
        status = 200
        if name == "api_feedback_preferences":
            data = {"allow_inferred": self.allowed}
        elif name == "api_identity_read":
            data = {"subject": "viewer", "tenant_id": "tenant"}
        elif name == "api_responses_read":
            data = {"episode_id": str(uuid4())}
            status = 404 if self.denied else 200
        elif name == "api_feedback_record_signal":
            if self.write_error:
                status = 503
            else:
                self.signals.append(args["body"])
            data = {"id": args["body"]["idempotency_key"], "signal": args["body"]}
        else:
            pytest.fail("Unexpected tool")
        return SimpleNamespace(
            isError=status >= 400, structuredContent={"http_status": status, "data": data}
        )


class Model:
    model = "synthetic/model"

    def __init__(self, callback=None):
        self.calls, self.callback, self.fail = [], callback, False

    def assess(self, comment):
        self.calls.append(comment)
        if self.fail:
            raise CoreError("MODEL_UNAVAILABLE", "private diagnostic")
        if self.callback:
            self.callback()
        return {
            "sentiment": "negative",
            "confidence": 0.8,
            "explanation": "User reports an unhelpful answer",
            "model": self.model,
            "prompt_version": "synthetic-v1",
            "usage": {"cost_usd": 0.001},
        }


def args(model):
    return dict(
        endpoint="http://localhost:8000/mcp/",
        domain=str(uuid4()),
        response_id=str(uuid4()),
        request_id=str(uuid4()),
        comment="Still unhelpful",
        model=model,
    )


def test_no_consent_means_no_model_call_no_response_read_and_no_journaled_comment(tmp_path):
    session, model = Session(False), Model()
    with Journal(tmp_path / "off.db", "0.05").locked() as journal:
        result = asyncio.run(assess_feedback(session, journal=journal, **args(model)))
        assert result == {"status": "not_collected", "reason": "consent_disabled"}
        assert session.calls == ["api_feedback_preferences"] and model.calls == []
        assert journal.conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_access_revocation_prevents_external_processing(tmp_path):
    session, model = Session(), Model()
    session.denied = True
    with Journal(tmp_path / "denied.db", "0.05").locked() as journal:
        with pytest.raises(CoreError):
            asyncio.run(assess_feedback(session, journal=journal, **args(model)))
    assert model.calls == []


def test_withdrawal_during_model_call_discards_inference_and_never_recollects(tmp_path):
    session = Session()
    model = Model(lambda: setattr(session, "allowed", False))
    command = args(model)
    with Journal(tmp_path / "withdrawn.db", "0.05").locked() as journal:
        result = asyncio.run(assess_feedback(session, journal=journal, **command))
        assert result["reason"] == "consent_revoked_during_assessment"
        state, payload = journal.conn.execute("SELECT state,payload FROM runs").fetchone()
        assert state == "discarded" and json.loads(payload) == {"usage": {"cost_usd": 0.001}}
        session.allowed = True
        assert (
            asyncio.run(assess_feedback(session, journal=journal, **command))["status"]
            == "not_collected"
        )
    assert len(model.calls) == 1 and not session.signals


def test_failed_signal_write_resumes_without_paying_again(tmp_path):
    session, model = Session(), Model()
    session.write_error = True
    command = args(model)
    with Journal(tmp_path / "resume.db", "0.05").locked() as journal:
        with pytest.raises(CoreError):
            asyncio.run(assess_feedback(session, journal=journal, **command))
        session.write_error = False
        result = asyncio.run(assess_feedback(session, journal=journal, **command))
        assert result["status"] == "recorded" and result["confidence_calibrated"] is False
        assert session.signals[0]["origin"] == "inferred"
        assert session.signals[0]["kind"] == "satisfaction"
        assert (
            "Still unhelpful" not in journal.conn.execute("SELECT payload FROM runs").fetchone()[0]
        )
    assert model.calls == ["Still unhelpful"]


def test_provider_failure_is_not_replayed(tmp_path):
    session, model = Session(), Model()
    model.fail = True
    command = args(model)
    with Journal(tmp_path / "failed.db", "0.05").locked() as journal:
        for _ in range(2):
            with pytest.raises(CoreError):
                asyncio.run(assess_feedback(session, journal=journal, **command))
    assert len(model.calls) == 1 and not session.signals


def test_comment_bounds_prevent_network(tmp_path):
    session, model = Session(), Model()
    command = args(model)
    command["comment"] = "a" * 2001
    with Journal(tmp_path / "bound.db", "0.05").locked() as journal:
        with pytest.raises(CoreError):
            asyncio.run(assess_feedback(session, journal=journal, **command))
    assert not session.calls and not model.calls


@pytest.mark.parametrize("lose_ack", [False, True])
def test_inferred_feedback_uses_real_mcp_and_keeps_votes_separate(
    world, identity_keys, tmp_path, lose_ack
):
    source = world.source()
    world.approve(world.proposal(source))
    episode = world.client.post(
        world.prefix + "/query", headers=world.headers("bob"), json={"question": "incident"}
    ).json()
    response = world.client.post(
        world.prefix + f"/episodes/{episode['episode_id']}/companion-responses",
        headers=world.headers("bob"),
        json={
            "answer_text": "Escalate the incident [1].",
            "answer_kind": "answer",
            "citations": [{k: episode["citations"][0][k] for k in ("source_id", "start", "end")}],
            "companion": "synthetic",
            "idempotency_key": str(uuid4()),
        },
    ).json()
    app = create_app(
        Settings(
            database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
            jwt_issuer="https://identity.test",
            jwt_public_key_file=identity_keys[1],
            model_provider="ollama",
            local_model=None,
        )
    )
    model = Model()

    async def workflow():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                headers=world.headers("bob"),
            ) as http:
                async with streamable_http_client(
                    "http://localhost:8000/mcp/", http_client=http
                ) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        command = dict(
                            endpoint="http://localhost:8000/mcp/",
                            domain=world.domain,
                            response_id=response["id"],
                            request_id=str(uuid4()),
                            comment="Still unhelpful",
                            model=model,
                        )
                        with Journal(tmp_path / "mcp.db", "0.05").locked() as journal:
                            assert (await assess_feedback(session, journal=journal, **command))[
                                "status"
                            ] == "not_collected"
                            world.client.put(
                                world.prefix + "/feedback-preferences",
                                headers=world.headers("bob"),
                                json={
                                    "allow_observed": False,
                                    "allow_inferred": True,
                                    "expected_revision": 0,
                                },
                            ).raise_for_status()
                            original_save = journal.save
                            lost = []

                            def save(ident, state, payload):
                                if lose_ack and state == "complete" and not lost:
                                    lost.append(True)
                                    raise OSError("Synthetic lost signal acknowledgement")
                                original_save(ident, state, payload)

                            journal.save = save
                            if lose_ack:
                                with pytest.raises(OSError):
                                    await assess_feedback(session, journal=journal, **command)
                            first = await assess_feedback(session, journal=journal, **command)
                            second = await assess_feedback(session, journal=journal, **command)
                            assert first["signal"]["id"] == second["signal"]["id"]
                            summary = world.client.get(
                                world.prefix + "/feedback-summary", headers=world.headers("bob")
                            ).json()
                            assert summary["inferred"]["negative"] == 1
                            assert (
                                summary["explicit"]["thumbs_down"] == 0
                                and summary["explicit"]["thumbs_up"] == 0
                            )

    asyncio.run(workflow())
    assert len(model.calls) == 1


def test_cli_checks_consent_without_sending_comment_or_key(monkeypatch, tmp_path, capsys):
    from contextlib import asynccontextmanager

    from cortex_core.cli import main

    session = Session(False)

    @asynccontextmanager
    async def connection(**kwargs):
        assert kwargs["token"] == "synthetic-private-token"
        yield session

    monkeypatch.setattr("cortex_core.companion.connected_session", connection)
    monkeypatch.setattr(OpenRouterAssessment, "_request", lambda *_: pytest.fail("Consent is off"))
    monkeypatch.setenv("CORTEX_COMPANION_TOKEN", "synthetic-private-token")
    monkeypatch.setenv("CORTEX_OPENROUTER_API_KEY", "synthetic-private-key")
    monkeypatch.setenv("CORTEX_OPENROUTER_MODEL", "synthetic/model")
    monkeypatch.setattr(
        "sys.argv",
        [
            "cortex",
            "companion-assess",
            "--endpoint",
            "http://localhost:8000/mcp/",
            "--tenant",
            str(uuid4()),
            "--domain",
            str(uuid4()),
            "--response-id",
            str(uuid4()),
            "--request-id",
            str(uuid4()),
            "--comment",
            "Private comment",
            "--journal",
            str(tmp_path / "cli.db"),
            "--budget-usd",
            "0.05",
            "--allow-openrouter",
        ],
    )
    main()
    output = capsys.readouterr().out
    assert json.loads(output) == {"status": "not_collected", "reason": "consent_disabled"}
    assert "Private comment" not in output and "synthetic-private" not in output
    assert session.calls == ["api_feedback_preferences"]
