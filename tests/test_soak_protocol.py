"""A short, empty, failed or incomplete run cannot qualify the requested soak."""

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from soak_rust_graph import Workload, validate_completion  # noqa: E402


def completed():
    return {
        "measured_seconds": 1800,
        "cycles": 3,
        "restarts": 1,
        "acl_roundtrips": 2,
        "epochs": [{"pid": 100, "exit_code": 0}, {"pid": 101, "exit_code": 0}],
        "calls": [
            {
                "operation": operation,
                "transport": transport,
                "status": 200,
                "expected_status": 200,
                "elapsed_seconds": 10,
            }
            for operation in ("api_concepts_list", "api_knowledge_query")
            for transport in ("http", "mcp")
        ],
        "episodes_verified": 3,
        "signals_verified": 1,
    }


def test_duration_and_mandatory_events_are_not_inferred_from_a_green_process():
    validate_completion(completed(), 1800)
    for field, value in [
        ("measured_seconds", 1799),
        ("cycles", 0),
        ("restarts", 0),
        ("acl_roundtrips", 1),
        ("episodes_verified", 0),
        ("signals_verified", 0),
    ]:
        report = completed()
        report[field] = value
        with pytest.raises(AssertionError):
            validate_completion(report, 1800)


def test_failed_calls_and_missing_transport_classes_cannot_disappear():
    for change in ("unexpected", "failure", "late", "missing", "abnormal_exit", "same_pid"):
        report = copy.deepcopy(completed())
        if change == "unexpected":
            report["calls"][0]["status"] = 503
        elif change == "failure":
            report["calls"][0]["failure_type"] = "TimeoutError"
        elif change == "late":
            report["calls"][0]["elapsed_seconds"] = 1800
        elif change == "missing":
            report["calls"].pop()
        elif change == "abnormal_exit":
            report["epochs"][0]["exit_code"] = -15
        else:
            report["epochs"][1]["pid"] = 100
        with pytest.raises(AssertionError):
            validate_completion(report, 1800)


def test_slow_signing_cannot_admit_a_request_after_deadline(monkeypatch):
    instant = [9]
    monkeypatch.setattr("soak_rust_graph.time.monotonic", lambda: instant[0])

    class Fixture:
        def headers(self, subject):
            instant[0] = 11
            return {}

    class Client:
        def request(self, *args, **kwargs):
            raise RuntimeError("Network must never be reached")

    workload = Workload(Client(), Fixture(), "domain", 1, [], [], {"calls": []}, 0, 10)
    with pytest.raises(AssertionError, match="after signing"):
        workload.call("GET", "/concepts", "api_concepts_list", {})
