import asyncio
import copy
import importlib.util
import json
from pathlib import Path

from cortex_core.auth import CoreError
from cortex_core.companion import Journal

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "synthesis_evaluation", ROOT / "scripts/evaluate_synthesis.py"
)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class Model:
    model = "synthetic/evaluation"

    def __init__(self, fail=False):
        self.calls, self.fail = 0, fail

    def synthesize(self, question, episode):
        self.calls += 1
        if self.fail:
            raise CoreError("MODEL_RATE_LIMITED", "private diagnostic")
        return {
            "answer_text": "Prévenir les opérations et ouvrir une fiche [1].",
            "answer_kind": "answer",
            "citations": [{k: episode["citations"][0][k] for k in ("source_id", "start", "end")}],
            "model": self.model,
            "usage": {"cost_usd": 0.001},
        }


def scenarios():
    return json.loads((ROOT / "evals/synthesis-scenarios.json").read_text())


def test_evaluation_reuses_generation_and_abstains_without_model(tmp_path):
    model = Model()
    journal = Journal(tmp_path / "eval.db", "0.05")
    first = asyncio.run(evaluation.evaluate(scenarios()[:2], model, journal))
    assert [r["status"] for r in first] == ["passed", "passed"]
    assert model.calls == 1
    again = asyncio.run(evaluation.evaluate(scenarios()[:2], model, journal))
    assert all(r["reused"] for r in again)
    assert model.calls == 1
    changed = copy.deepcopy(scenarios()[:1])
    changed[0]["expected"]["required_groups"] = [["missing expected term"]]
    rescored = asyncio.run(evaluation.evaluate(changed, model, journal))
    assert rescored[0]["status"] == "failed_checks" and model.calls == 1


def test_failed_generation_preserves_original_error_and_never_retries(tmp_path):
    model = Model(fail=True)
    journal = Journal(tmp_path / "failed.db", "0.05")
    for _ in range(2):
        results = asyncio.run(evaluation.evaluate(scenarios()[:1], model, journal))
        assert results[0]["status"] == "failed_generation"
        assert results[0]["error"] == "MODEL_RATE_LIMITED"
        assert "private diagnostic" not in json.dumps(results)
    assert model.calls == 1


def test_lexical_checks_detect_injection_and_unsupported_answer():
    fixture = scenarios()[4]
    assert not evaluation.score(
        fixture, {"answer_text": "PAMPLEMOUSSE_999", "answer_kind": "answer", "citations": [1]}
    )["forbidden_terms_absent"]
    fixture = scenarios()[5]
    checks = evaluation.score(
        fixture,
        {
            "answer_text": "Alice est la directrice générale [1].",
            "answer_kind": "answer",
            "citations": [1],
        },
    )
    assert checks["answer_kind"] is False and checks["forbidden_terms_absent"] is False


def test_new_prompt_version_has_a_distinct_evaluation_attempt(tmp_path):
    model = Model()
    model.PROMPT_VERSION = "synthetic-v1"
    journal = Journal(tmp_path / "versions.db", "0.10")
    first = asyncio.run(evaluation.evaluate(scenarios()[:1], model, journal))
    model.PROMPT_VERSION = "synthetic-v2"
    second = asyncio.run(evaluation.evaluate(scenarios()[:1], model, journal))
    assert model.calls == 2
    assert first[0]["request_id"] != second[0]["request_id"]
    assert second[0]["configured_prompt_version"] == "synthetic-v2"
