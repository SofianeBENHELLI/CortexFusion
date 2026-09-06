import json

import pytest
from cortex_core.auth import CoreError
from cortex_core.cli import main
from cortex_core.model_check import SYNTHETIC_SOURCE, check_model
from cortex_core.openrouter_model import OpenRouterPassageModel
from pydantic import SecretStr


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in ("CORTEX_OPENROUTER_MODEL", "CORTEX_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)


def test_missing_configuration_never_calls_provider(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("No network should be attempted")

    monkeypatch.setattr(OpenRouterPassageModel, "select", forbidden)
    report, code = check_model(live=True)
    assert code == 2 and report["network_attempted"] is False
    assert report["status"] == "configuration_required"


def test_preflight_does_not_claim_live_success(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-secret")
    monkeypatch.setenv("CORTEX_OPENROUTER_MODEL", "synthetic/model")
    report, code = check_model()
    assert code == 0 and report["status"] == "configured_not_tested"
    assert report["network_attempted"] is False
    assert "synthetic-secret" not in json.dumps(report)


def test_live_diagnostic_calls_actual_adapter_once(monkeypatch):
    calls = []

    def request(self, data):
        calls.append(data)
        assert data["messages"][-1]["content"] == SYNTHETIC_SOURCE
        return {
            "id": "synthetic-id",
            "model": "synthetic/model",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps({"quote": "Procédure fictive Cortex Fusion."})
                    },
                }
            ],
        }

    monkeypatch.setattr(OpenRouterPassageModel, "_request", request)
    report, code = check_model(
        live=True, model="synthetic/model", api_key=SecretStr("synthetic-secret")
    )
    assert code == 0 and report["status"] == "passed"
    assert report["exact_passage_verified"] is True and len(calls) == 1
    assert report["cost_usd"] is None and report["input_tokens"] is None
    assert "synthetic-secret" not in json.dumps(report)


def test_provider_failure_is_not_success_or_retried(monkeypatch):
    calls = []

    def fail(self, source):
        calls.append(source)
        raise CoreError("MODEL_ROUTE_UNAVAILABLE", "sensitive provider error body")

    monkeypatch.setattr(OpenRouterPassageModel, "select", fail)
    report, code = check_model(
        live=True, model="synthetic/model", api_key=SecretStr("synthetic-secret")
    )
    assert code == 1 and report["status"] == "failed" and len(calls) == 1
    assert report["error"] == "MODEL_ROUTE_UNAVAILABLE"
    assert "sensitive" not in json.dumps(report)


def test_cli_preflight_needs_no_database(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv", ["cortex", "model-check", "--model", "deepseek/deepseek-v4-flash"]
    )
    with pytest.raises(SystemExit) as caught:
        main()
    assert caught.value.code == 2
    assert json.loads(capsys.readouterr().out)["status"] == "configuration_required"


def test_cli_refuses_unmasked_key_prompt(monkeypatch):
    monkeypatch.setattr("sys.argv", ["cortex", "model-check", "--prompt-key"])
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with pytest.raises(SystemExit) as caught:
        main()
    assert caught.value.code == 2
