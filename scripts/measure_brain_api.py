"""Read-only, sequential qualification of a live synthetic 1,000-concept fixture.

The server and database have already been warmed by governed fixture preparation.
These local HTTP timings are not browser timings or a concurrent-load benchmark.
No database access, mutation, cache reset or resource-limit change is performed.
"""

import argparse
import hashlib
import json
import math
import platform
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import jsonschema
from brain_browser_fixture import ROOT, fixture_for


def run(directory, samples):
    state = json.loads((directory / "state.json").read_text())
    if (
        not directory.is_relative_to(ROOT / ".runtime")
        or state.get("synthetic_only") is not True
        or state.get("base_url") != "http://127.0.0.1:8011"
        or state.get("expires_at", 0) <= time.time()
        or state.get("workload", {}).get("concepts") != 1000
    ):
        raise ValueError("A live, local, synthetic 1,000-concept fixture is required")
    fixture = fixture_for(directory, state)
    expected = {c["concept_id"]: c for c in state["concepts"]}
    expected_edges = {
        (
            c["concept_id"],
            link["target_id"],
            link["kind"],
            link.get("weight", 1),
            link.get("primary", False),
        )
        for c in expected.values()
        for link in c["links"]
    }
    totals = {"concepts": 1000, "relations": 2019}
    graph_path = f"/v1/domains/{state['domain']}/graph/window"
    schemas = {
        name: jsonschema.Draft202012Validator(
            json.loads((ROOT / f"packages/contracts/schema/{name}.json").read_text()),
            format_checker=jsonschema.FormatChecker(),
        )
        for name in ["GraphWindow", "PublicationWindow", "ProposalDifferenceSummary"]
    }
    measurements = []
    with httpx.Client(base_url=state["base_url"], timeout=15, trust_env=False) as client:

        def read(path, schema, params=None):
            # Sign before the timer: report HTTP round trip including body read,
            # excluding token creation, JSON parsing and schema validation.
            headers = fixture.headers()
            started = time.perf_counter()
            response = client.get(path, headers=headers, params=params)
            elapsed = (time.perf_counter() - started) * 1000
            response.raise_for_status()
            value = response.json()
            schemas[schema].validate(value)
            return value, {
                "http_ms": round(elapsed, 3),
                "decoded_body_bytes": len(response.content),
            }

        def graph(**params):
            value, sample = read(graph_path, "GraphWindow", {"direction": "outgoing", **params})
            assert value["at_version"] == 20 and value["domain_totals"] == totals
            assert len(value["nodes"]) <= params.get("limit", 24)
            assert len(value["edges"]) <= 120
            ids = {n["concept_id"] for n in value["nodes"]}
            assert len(ids) == len(value["nodes"])
            assert all(e["from"] in ids and e["to"] in ids for e in value["edges"])
            assert all("body" not in n and "sources" not in n for n in value["nodes"])
            for node in value["nodes"]:
                assert node["outgoing_relations"] == len(expected[node["concept_id"]]["links"])
                assert node["incoming_relations"] == sum(
                    edge[1] == node["concept_id"] for edge in expected_edges
                )
            internal = {edge for edge in expected_edges if edge[0] in ids and edge[1] in ids}
            boundary = {edge for edge in expected_edges if edge[0] in ids and edge[1] not in ids}
            actual_edges = {
                (edge["from"], edge["to"], edge["kind"], edge["weight"], edge["primary"])
                for edge in value["edges"]
            }
            assert actual_edges <= internal and len(actual_edges) == min(120, len(internal))
            assert value["internal_relations"] == len(internal)
            assert value["boundary_outgoing_relations"] == len(boundary)
            return value, sample

        first, first_sample = graph()
        assert len(first["nodes"]) == 24 and first["scope_ids"] is None
        second, _ = graph(after=first["next_after"], at_version=20, visibility=first["visibility"])
        back, _ = graph(
            before=second["previous_before"], at_version=20, visibility=first["visibility"]
        )
        assert back["nodes"] == first["nodes"]
        assert not {n["concept_id"] for n in first["nodes"]} & {
            n["concept_id"] for n in second["nodes"]
        }
        pages, seen, query = [], set(), {"limit": 50}
        while True:
            value, sample = graph(**query)
            ids = {n["concept_id"] for n in value["nodes"]}
            assert not seen & ids and value["visibility"] == first["visibility"]
            assert value["scope_totals"] == totals and value["scope_ids"] is None
            for node in value["nodes"]:
                assert node["title"] == expected[node["concept_id"]]["title"]
            seen |= ids
            pages.append({**sample, "nodes": len(ids), "edges": len(value["edges"])})
            if value["next_after"] is None:
                break
            assert len(pages) < 20, "Unexpected extra page"
            query = {
                "limit": 50,
                "after": value["next_after"],
                "at_version": 20,
                "visibility": first["visibility"],
            }
        assert seen == set(expected) and len(pages) == 20

        centre = state["concepts"][0]
        last = state["concepts"][-1]
        focus_ids = {centre["concept_id"], *(link["target_id"] for link in centre["links"])}
        cases = {
            "overview_24": {},
            "search_exact_last": {"search": last["title"]},
            "locate_last": {"locate": last["concept_id"]},
            "outgoing_focus": {"focus": centre["concept_id"]},
        }
        # Interleave cases; single outstanding request, no synthetic concurrency.
        for _ in range(samples):
            for name, params in cases.items():
                value, sample = graph(**params)
                ids = {n["concept_id"] for n in value["nodes"]}
                if name == "search_exact_last":
                    assert ids == {last["concept_id"]}
                elif name == "locate_last":
                    assert last["concept_id"] in ids
                elif name == "outgoing_focus":
                    assert ids == focus_ids == set(value["scope_ids"])
                    # Scope totals include outgoing boundary relations as documented.
                    assert value["scope_totals"] == {"concepts": 3, "relations": 6}
                    assert value["internal_relations"] == 2
                    assert value["boundary_outgoing_relations"] == 4
                measurements.append({"case": name, **sample})

        journal, journal_sample = read(
            f"/v1/domains/{state['domain']}/publications", "PublicationWindow", {"limit": 20}
        )
        assert journal["at_version"] == 20
        assert journal["next_before"] is None and not journal["scan_limited"]
        assert [p["sequence"] for p in journal["items"]] == list(range(20, 0, -1))
        changes, relations, summaries = set(), 0, []
        for publication in journal["items"]:
            difference, sample = read(
                f"/v1/domains/{state['domain']}/proposals/{publication['proposal_id']}/diff/summary",
                "ProposalDifferenceSummary",
            )
            assert difference["comparison"] == "accepted_before_state"
            assert len(difference["items"]) == 50
            for item in difference["items"]:
                assert item["before"] is None and item["after"] is not None
                assert item["concept_id"] not in changes
                changes.add(item["concept_id"])
                relations += len(item["after"]["links"])
                expected_concept = expected[item["concept_id"]]
                assert item["after"]["title"] == expected_concept["title"]
                assert (
                    item["after"]["body_sha256"]
                    == hashlib.sha256(expected_concept["body"].encode()).hexdigest()
                )
                assert item["after"]["sources"] == expected_concept["sources"]
                assert item["after"]["maturity"] == expected_concept["maturity"]
                actual_links = {
                    (
                        item["concept_id"],
                        link["target_id"],
                        link["kind"],
                        link.get("weight", 1),
                        link.get("primary", False),
                    )
                    for link in item["after"]["links"]
                }
                assert actual_links == {
                    edge for edge in expected_edges if edge[0] == item["concept_id"]
                }
            summaries.append({"sequence": publication["sequence"], **sample})
        assert changes == set(expected) and relations == 2019
        final, _ = graph()
        assert final["visibility"] == first["visibility"] and final["nodes"] == first["nodes"]

    aggregates = {}
    for name in cases:
        selected = [m for m in measurements if m["case"] == name]
        timings = sorted(m["http_ms"] for m in selected)
        aggregates[name] = {
            "samples": len(selected),
            "p50_http_ms": round(statistics.median(timings), 3),
            "p95_http_ms_nearest_rank": timings[math.ceil(len(timings) * 0.95) - 1],
            "min_http_ms": timings[0],
            "max_http_ms": timings[-1],
            "max_decoded_body_bytes": max(m["decoded_body_bytes"] for m in selected),
        }
    return {
        "recorded_at": datetime.now(UTC).isoformat(),
        "environment": {
            "os": platform.system(),
            "release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        },
        "method": "Sequential local HTTP, warmed runtime/database; timer excludes signing/JSON/schema validation; decoded body excludes headers and wire overhead; p95 nearest rank; no browser/load/memory/cold-cache qualification.",
        "workload": state["workload"],
        "domain_totals": totals,
        "first_observed_graph_read": first_sample,
        "pagination": {"distinct_nodes": len(seen), "pages": pages},
        "measurements": measurements,
        "aggregates": aggregates,
        "journal": {
            "publications": 20,
            "created_concepts": len(changes),
            "created_relations": relations,
            "window": journal_sample,
            "summaries": summaries,
            "decoded_body_bytes_total": journal_sample["decoded_body_bytes"]
            + sum(s["decoded_body_bytes"] for s in summaries),
        },
        "checks": [
            "schemas",
            "pinned_forward_backward_pages",
            "all_1000_distinct_nodes",
            "exact_titles",
            "bounded_nodes_edges",
            "no_graph_bodies_sources",
            "remote_search",
            "locate",
            "outgoing_focus",
            "20_audited_publication_differences",
            "exact_degrees_and_boundary_counts",
            "1000_exact_body_hashes_and_source_ranges",
            "2019_exact_published_link_differences",
            "unchanged_final_graph",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=20)
    args = parser.parse_args()
    if not 5 <= args.samples <= 30:
        raise ValueError("Use between 5 and 30 sequential samples per case")
    print(json.dumps(run(args.directory.resolve(), args.samples), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
