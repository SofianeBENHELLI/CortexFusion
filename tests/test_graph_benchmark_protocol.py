"""Measurement failures must not be counted as successful functional qualification."""

import hashlib
import sys
from pathlib import Path
from uuid import UUID

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from benchmark_rust_graph import (  # noqa: E402
    classify_import,
    fixture_data,
    mcp_result,
    measurement_summary,
    percentile,
)


def test_fixture_has_exact_unicode_proofs_and_no_future_commit_links():
    concepts, sources = fixture_data(100, str(UUID(int=1)))
    for i, (concept, source) in enumerate(zip(concepts, sources, strict=True)):
        assert concept["body"] == source["content"]
        assert concept["sources"] == [
            {"source_id": source["id"], "start": 0, "end": len(source["content"])}
        ]
        assert source["hash"] == hashlib.sha256(source["content"].encode()).hexdigest()
        assert len(source["content"].encode()) > len(source["content"]) > 100
        assert ("bob" in source["readers"]) == (i % 2 == 0)
        ids = {c["concept_id"] for c in concepts[: (i // 50 + 1) * 50]}
        assert all(link["target_id"] in ids for link in concept["links"])
    assert fixture_data(100, str(UUID(int=1))) == (concepts, sources)


def test_import_authentication_and_contract_failure_is_not_a_capacity_result():
    assert classify_import(200, {"outcome": "registered"}) == "registered"
    assert classify_import(200, {"outcome": "unresolved"}) == "unresolved"
    assert classify_import(503, {"error": "STORAGE_ERROR"}) == "service_unavailable"
    for status in [401, 403, 404, 422, 500]:
        with pytest.raises(AssertionError):
            classify_import(status, {"error": "STORAGE_ERROR"})
    with pytest.raises(AssertionError):
        classify_import(200, {"outcome": "superseded"})


@pytest.mark.parametrize("size", [100, 500, 2000])
def test_shared_long_documents_keep_exact_spans_hashes_and_separate_visibility(size):
    concepts, sources = fixture_data(size, str(UUID(int=1)), "shared_long")
    assert len(sources) == 2
    assert all(len(s["content"]) == 200_000 for s in sources)
    assert all(s["hash"] == hashlib.sha256(s["content"].encode()).hexdigest() for s in sources)
    by_id = {s["id"]: s for s in sources}
    for index, concept in enumerate(concepts):
        proof = concept["sources"][0]
        source = by_id[proof["source_id"]]
        assert source["content"][proof["start"] : proof["end"]] == concept["body"]
        assert ("bob" in source["readers"]) == (index % 2 == 0)
        assert proof["start"] > 0
    assert concepts[-2]["sources"][0]["end"] == 199_999
    assert concepts[-1]["sources"][0]["end"] == 199_999
    assert "Signal00001" not in sources[0]["content"]
    assert "Signal00000" not in sources[1]["content"]


def test_mcp_error_flag_cannot_disguise_a_success():
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"structuredContent": {"http_status": 200, "data": []}},
    }
    assert mcp_result(payload) == (200, [])
    payload["result"]["isError"] = True
    with pytest.raises(AssertionError):
        mcp_result(payload)
    payload["result"]["structuredContent"]["http_status"] = 503
    assert mcp_result(payload) == (503, [])
    payload["result"]["isError"] = False
    with pytest.raises(AssertionError):
        mcp_result(payload)


def test_empty_matrix_is_not_success_and_errors_remain_in_denominator():
    assert measurement_summary({"volumes": []}) == {
        "measured_cells": 0,
        "measured_requests": 0,
        "availability": "not_measured",
    }
    report = {"volumes": [{"measurements": [{"requests": 12, "statuses": {"200": 10, "503": 2}}]}]}
    assert measurement_summary(report)["availability"] == "degraded"
    assert measurement_summary(report)["measured_requests"] == 12
    assert percentile([3, 1, 2, 9], 0.95) == 9
