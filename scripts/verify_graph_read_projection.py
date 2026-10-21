"""Read-only qualification over the retained synthetic paged snapshot fixture.

Does not remove memberships, mutate sources or publish knowledge. Optional engine
absence proves warm projections are independent of full-snapshot transport.
"""

import argparse
import hashlib
import json
import os
import signal
import time
from pathlib import Path
from uuid import UUID, uuid4

from brain_browser_fixture import fixture_for
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def run(directory, duration, offline_engine):
    directory = directory.resolve()
    assert directory.is_relative_to(ROOT / ".runtime/brain")
    state = json.loads((directory / "state.json").read_text())
    # This special recipe is tied to the 180-record synthetic workload, not the private import.
    assert state.get("concept_count") == 180
    assert all(
        c["title"].startswith("Snapshot paginé ") and c["body"].startswith("Preuve synthétique ")
        for c in state["concepts"]
    )
    urls = [make_url(os.environ[k]) for k in ("CORTEX_TEST_ADMIN_URL", "CORTEX_RUST_DATABASE_URL")]
    assert all(u.host == "127.0.0.1" and u.database.endswith("_test") for u in urls)
    assert (urls[0].host, urls[0].port, urls[0].database) == (
        urls[1].host,
        urls[1].port,
        urls[1].database,
    )
    assert os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363"
    fixture = fixture_for(directory, state)
    domain = state["domain"]
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        {
            k: os.environ[k]
            for k in (
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            )
        }
    )
    env.update(
        {
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174"]',
            "CORTEX_RUST_BIND": "127.0.0.1:8011",
        }
    )
    if offline_engine:
        env["CORTEX_TERMINUS_URL"] = "http://127.0.0.1:1"
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        root = f"/v1/domains/{domain}/graph/window"

        def get(**params):
            result = client.get(root, headers=fixture.headers(), params=params)
            assert result.status_code == 200, (result.status_code, result.text)
            return result.json()

        first = get(limit=24)
        ids = sorted(c["concept_id"] for c in state["concepts"])
        by_id = {c["concept_id"]: c for c in state["concepts"]}
        expected_hash = hashlib.sha256(
            b"cortex-graph-window-v1"
            + domain.encode()
            + state["version"].to_bytes(8, "big")
            + len(b"alice").to_bytes(8, "big")
            + b"alice"
            + b"".join(UUID(i).bytes for i in ids)
        ).hexdigest()
        assert first["visibility"] == expected_hash
        assert first["domain_totals"] == {"concepts": 180, "relations": 180}
        seen = []
        query = {"limit": 17}
        while True:
            page = get(**query)
            page_ids = [n["concept_id"] for n in page["nodes"]]
            seen += page_ids
            assert len(page_ids) <= 17
            for node in page["nodes"]:
                assert node == {
                    "concept_id": node["concept_id"],
                    "title": by_id[node["concept_id"]]["title"],
                    "maturity": "emerging",
                    "source_count": 1,
                    "outgoing_relations": 1,
                    "incoming_relations": 1,
                }
            actual_edges = {(e["from"], e["to"]) for e in page["edges"]}
            expected_edges = {
                (i, by_id[i]["links"][0]["target_id"])
                for i in page_ids
                if by_id[i]["links"][0]["target_id"] in page_ids
            }
            assert actual_edges == expected_edges
            assert page["internal_relations"] == len(expected_edges)
            assert page["boundary_outgoing_relations"] == len(page_ids) - len(expected_edges)
            if page["previous_before"]:
                prev = get(
                    limit=17, before=page["previous_before"], at_version=8, visibility=expected_hash
                )
                again = get(
                    limit=17, after=prev["next_after"], at_version=8, visibility=expected_hash
                )
                assert again["nodes"] == page["nodes"]
            if page["next_after"] is None:
                break
            query = {
                "limit": 17,
                "after": page["next_after"],
                "at_version": 8,
                "visibility": expected_hash,
            }
        assert seen == ids
        target = state["concepts"][-1]
        detail = client.get(
            f"/v1/domains/{domain}/concepts/{target['concept_id']}", headers=fixture.headers()
        )
        assert detail.status_code == 200 and detail.json() == target
        focused = get(focus=target["concept_id"], direction="outgoing", limit=2)
        assert set(focused["scope_ids"]) == {
            target["concept_id"],
            state["concepts"][0]["concept_id"],
        }
        assert focused["scope_totals"] == {"concepts": 2, "relations": 2}
        assert len(focused["edges"]) == 1
        both = get(focus=target["concept_id"], limit=2)
        assert both["scope_totals"] == {"concepts": 3, "relations": 3}
        located = get(locate=ids[-1], limit=17)
        assert ids[-1] in [n["concept_id"] for n in located["nodes"]]
        assert get(search="SNAPSHOT PAGINÉ 179")["nodes"][0]["concept_id"] == target["concept_id"]
        assert get(search="evidence-not-present")["nodes"] == []
        assert get(search="Snapshot paginé 179\nPreuve")["nodes"] == []
        assert get(search="ÉVIDENCE 🧠")["scope_totals"]["concepts"] == 180
        for params, status in [
            ({"focus": str(uuid4())}, 404),
            ({"locate": str(uuid4())}, 404),
            ({"at_version": 7}, 409),
            ({"visibility": "0" * 64}, 409),
            ({"after": ids[0]}, 422),
        ]:
            assert client.get(root, headers=fixture.headers(), params=params).status_code == status
        assert client.get(root, headers=fixture.headers("no-membership")).status_code == 404
        # Tokens name their tenant, so another tenant's header is rejected (401).
        assert (
            client.get(root, headers={**fixture.headers(), "X-Tenant-ID": str(uuid4())}).status_code
            == 401
        )
        assert client.get(root).status_code == 401
        with create_engine(os.environ["CORTEX_TEST_ADMIN_URL"]).connect() as conn:
            counts = {
                name: conn.execute(
                    text(f"SELECT count(*) FROM {name} WHERE tenant_id=:t AND domain_id=:d"),
                    {"t": fixture.tenant, "d": domain},
                ).scalar_one()
                for name in [
                    "cf_graph_read_versions",
                    "cf_graph_read_nodes",
                    "cf_graph_read_sources",
                    "cf_graph_read_edges",
                ]
            }
        assert list(counts.values()) == [1, 180, 180, 180]
        # Independent persisted-commit oracle: exact accepted before/after, not
        # another call to the same HTTP implementation.
        with create_engine(os.environ["CORTEX_TEST_ADMIN_URL"]).connect() as conn:
            commits = (
                conn.execute(
                    text(
                        "SELECT proposal_id, sequence, changes, before_state FROM cf_commits WHERE tenant_id=:t AND domain_id=:d ORDER BY sequence"
                    ),
                    {"t": fixture.tenant, "d": domain},
                )
                .mappings()
                .all()
            )
        assert len(commits) == 8
        difference_bytes = []
        for commit in commits:
            expected = {
                "proposal_id": commit["proposal_id"],
                "base_version": commit["sequence"] - 1,
                "published_version": 8,
                "comparison": "accepted_before_state",
                "stale_base": False,
                "items": [
                    {
                        "concept_id": v["concept"]["concept_id"],
                        "before": commit["before_state"].get(v["concept"]["concept_id"]),
                        "after": v["concept"],
                    }
                    for v in commit["changes"]
                ],
            }
            url = f"/v1/domains/{domain}/proposals/{commit['proposal_id']}/diff"
            full = client.get(url, headers=fixture.headers())
            assert full.status_code == 200 and full.json() == expected
            for item in expected["items"]:
                for side in ("before", "after"):
                    if item[side] is not None:
                        body = item[side].pop("body")
                        item[side]["body_sha256"] = hashlib.sha256(body.encode()).hexdigest()
            compact = client.get(url + "/summary", headers=fixture.headers())
            assert compact.status_code == 200 and compact.json() == expected
            difference_bytes.append({"full": len(full.content), "compact": len(compact.content)})
        journal = client.get(f"/v1/domains/{domain}/publications", headers=fixture.headers())
        assert journal.status_code == 200
        assert [r["sequence"] for r in journal.json()["items"]] == list(range(8, 0, -1))
        report = {
            "status": "passed",
            "engine_unavailable": offline_engine,
            "version": 8,
            "counts": counts,
            "publication_differences": difference_bytes,
            "checked": "identity completeness, summaries, all forward/backward pages, counts, pinned focus, locate, Unicode search, empty/hidden/tenant/version/token failures",
            "limits": "180 synthetic concepts; no 10k, performance or membership-removal qualification",
        }
        print(json.dumps(report), flush=True)
        (
            directory
            / ("projection-offline-report.json" if offline_engine else "projection-report.json")
        ).write_text(json.dumps(report, indent=2))
        end = time.monotonic() + duration
        while not stopped and time.monotonic() < end:
            time.sleep(0.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--duration", type=int, default=0)
    parser.add_argument("--offline-engine", action="store_true")
    args = parser.parse_args()
    assert 0 <= args.duration <= 3600
    run(args.directory, args.duration, args.offline_engine)
