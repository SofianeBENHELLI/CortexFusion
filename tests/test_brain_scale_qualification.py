from copy import deepcopy
from uuid import uuid4

import pytest

from scripts.prepare_okf_ingestion import digest
from scripts.qualify_brain_scale import Expected, ObservationError, percentile, reconcile, summarize


@pytest.fixture
def recipe():
    domain, proposal = str(uuid4()), str(uuid4())
    records, sources = [], {}
    ids = [str(uuid4()) for _ in range(3)]
    for i, ident in enumerate(ids):
        body, key = f"Synthetic proof 🧠 {i}", str(uuid4())
        sources[key] = str(uuid4())
        records.append(
            {
                "domain_id": domain,
                "concept_id": ident,
                "title": f"Synthetic {i}",
                "body": body,
                "body_sha256": digest(body),
                "source_key": key,
                "location": f"synthetic://qualification/{i}",
                "maturity": "emerging",
                "links": [
                    {
                        "target_id": ids[(i + 1) % 3],
                        "kind": "associative",
                        "weight": 0.5,
                        "primary": False,
                    }
                ],
            }
        )
    expected = Expected(
        domain,
        records,
        sources,
        [{"proposal_id": proposal, "base_version": 0, "published_version": 1, "concepts": 3}],
    )
    return expected


class FakeReader:
    def __init__(self, expected, fault=None):
        self.e, self.fault, self.detail_count = expected, fault, 0

    def get(self, path, params=None):
        e = self.e
        route = path.removeprefix(e.root)
        if route == "/version":
            value = {"accepted_version": 1, "published_version": 1}
        elif route == "/graph/window":
            nodes = [
                {
                    "concept_id": i,
                    "title": c["title"],
                    "maturity": "emerging",
                    "source_count": 1,
                    "outgoing_relations": 1,
                    "incoming_relations": 1,
                }
                for i, c in sorted(e.concepts.items())
            ][: params["limit"]]
            selected = {n["concept_id"] for n in nodes}
            edges = [
                {"from": i, "to": link[0], "kind": link[1], "weight": link[2], "primary": link[3]}
                for i in selected
                for link in e.edges[i]
                if link[0] in selected
            ]
            value = {
                "domain_id": e.domain,
                "at_version": 1,
                "domain_totals": e.totals,
                "scope_totals": e.totals,
                "scope_ids": None,
                "nodes": nodes,
                "edges": edges,
                "internal_relations": len(edges),
                "edges_truncated": False,
                "boundary_outgoing_relations": 0 if len(nodes) == 3 else 1,
                "visibility": "v1",
                "next_after": None,
            }
            if self.fault == "duplicate_node" and params["limit"] == 50:
                value["nodes"][1] = deepcopy(nodes[0])
        elif route == "/sources":
            value = {"items": [{"id": i} for i in sorted(e.sources)], "next_after": None}
            if self.fault == "extra_source":
                value["items"].append({"id": str(uuid4())})
        elif route.startswith("/sources/"):
            ident = route.rsplit("/", 1)[-1]
            r = e.sources[ident]
            value = {
                "id": ident,
                "title": r["title"],
                "content": r["body"],
                "content_hash": r["body_sha256"],
                "location": r["location"],
                "allowed_subjects": ["alice", "reader"],
            }
            if self.fault == "changed_body":
                value["content"] += " changed"
            if self.fault == "changed_acl":
                value["allowed_subjects"].append("unexpected")
        elif route.startswith("/concepts/"):
            value = deepcopy(e.concepts[route.rsplit("/", 1)[-1]])
            self.detail_count += 1
            if self.fault == "changed_weight":
                value["links"][0]["weight"] = 0.6
        elif route == "/publications":
            value = {
                "at_version": 1,
                "items": [{"sequence": 1, "proposal_id": e.batches[0]["proposal_id"]}],
                "next_before": None,
            }
            if self.fault == "duplicate_publication":
                value["items"].append(deepcopy(value["items"][0]))
        else:
            assert route.endswith("/diff/summary")
            value = {
                "proposal_id": e.batches[0]["proposal_id"],
                "base_version": 0,
                "comparison": "accepted_before_state",
                "items": [],
            }
            for ident, c in e.concepts.items():
                summary = deepcopy(c)
                summary["body_sha256"] = digest(summary.pop("body"))
                value["items"].append({"concept_id": ident, "before": None, "after": summary})
            if self.fault == "missing_birth":
                value["items"].pop()
        return value, {"status": 200, "http_ms": 2, "decoded_bytes": 1024}


def test_complete_readback_counts_identities_content_relations_and_events(recipe):
    reader = FakeReader(recipe)
    result = reconcile(reader, recipe, lambda value: None)
    assert result["status"] == "passed" and reader.detail_count == 3
    assert {
        result[k] for k in ("concepts_exact", "sources_exact", "relations_exact", "births_exact")
    } == {3}
    assert result["publications"] == result["graph_pages"] == result["source_pages"] == 1


@pytest.mark.parametrize(
    "fault",
    [
        "duplicate_node",
        "extra_source",
        "changed_body",
        "changed_acl",
        "changed_weight",
        "duplicate_publication",
        "missing_birth",
    ],
)
def test_readback_never_accepts_incomplete_or_mutated_knowledge(recipe, fault):
    with pytest.raises(ObservationError):
        reconcile(FakeReader(recipe, fault), recipe, lambda value: None)


def test_nearest_rank_and_error_denominators_remain_explicit():
    assert percentile(list(range(1, 51)), 0.5) == 25
    assert percentile(list(range(1, 51)), 0.95) == 48
    report = summarize([{"http_ms": 1200, "decoded_bytes": 10}], [{"status": 503}])
    assert report["successes"] == report["errors"] == 1 and report["under_1000ms"] == 0
    assert summarize([], ["failed"])["p95_http_ms"] is None
    with pytest.raises(ValueError):
        percentile([], 0.95)


def test_container_memory_preserves_units_rounding_and_combined_budget():
    import json

    from scripts.qualify_brain_scale import ContainerMemory

    lines = "\n".join(
        json.dumps({"Name": name, "MemUsage": value})
        for name, value in zip(
            ContainerMemory.names, ["139.9MiB / 7.748GiB", "4.105GiB / 7.748GiB"], strict=True
        )
    )
    parsed = ContainerMemory.parse(lines)
    sampler = ContainerMemory()
    upper = sum(v["upper_rounding_bound_bytes"] for v in parsed.values())
    assert upper > 4 * 1024**3
    assert parsed["cortex-brain-postgres"]["upper_rounding_bound_bytes"] == pytest.approx(
        139.95 * 1024**2
    )
    sampler.samples.append({"sum_upper_rounding_bound_bytes": upper})
    assert sampler.report()["within_4GiB_upper_estimate"] is False
    sampler.failures = 1
    assert sampler.report()["within_4GiB_upper_estimate"] is None
    assert ContainerMemory().report()["within_4GiB_upper_estimate"] is None


@pytest.mark.parametrize(
    "rows",
    [
        [],
        [{"Name": "cortex-brain-postgres", "MemUsage": "1GiB / 8GiB"}],
        [{"Name": "cortex-brain-postgres", "MemUsage": "1GiB / 8GiB"}] * 2,
        [
            {"Name": "private-container", "MemUsage": "1GiB / 8GiB"},
            {"Name": "cortex-brain-terminus", "MemUsage": "1GiB / 8GiB"},
        ],
        [
            {"Name": "cortex-brain-postgres", "MemUsage": "--"},
            {"Name": "cortex-brain-terminus", "MemUsage": "1GiB / 8GiB"},
        ],
    ],
)
def test_container_memory_never_passes_missing_or_unexpected_readings(rows):
    import json

    from scripts.qualify_brain_scale import ContainerMemory

    with pytest.raises(ObservationError):
        ContainerMemory.parse("\n".join(json.dumps(r) for r in rows))
