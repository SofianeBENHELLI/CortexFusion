"""Static-source authorization, cold recovery and version parity on a fresh synthetic domain.

No membership removal, ACL mutation, private corpus or external provider call.
"""

import argparse
import hashlib
import json
import os
import time
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from brain_browser_fixture import prepare, publish, source_concept
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def verify_scene_cache_overlay(client, fixture, domain, index_path):
    """Same static subjects; edit only this synthetic overlay, then restore it."""
    original = index_path.read_bytes()
    stamp = index_path.stat()
    scene_root = f"/v1/domains/{domain}/graph/scene"
    headers = fixture.headers()
    baseline = client.get(scene_root, headers=headers).json()
    # Warm reads must preserve the exact content and fence.
    assert client.get(scene_root, headers=headers).json() == baseline
    replacement = json.loads(original)
    replacement["references"] = replacement["references"][1:]
    try:
        index_path.write_text(json.dumps(replacement))
        os.utime(index_path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        stale = client.get(
            scene_root, headers=headers, params={"visibility": baseline["visibility"]}
        )
        assert stale.status_code == 409
        changed = client.get(scene_root, headers=headers).json()
        assert changed["totals"]["references"] == baseline["totals"]["references"] - 1
        assert changed["totals"]["relations"] == baseline["totals"]["relations"]
        assert changed["visibility"] != baseline["visibility"]
        assert client.get(scene_root, headers=headers).json() == changed
    finally:
        index_path.write_bytes(original)
        os.utime(index_path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert client.get(scene_root, headers=headers).json() == baseline


def run(directory):
    directory = directory.resolve()
    assert directory.is_relative_to(ROOT / ".runtime/brain") and not directory.exists()
    directory.mkdir(mode=0o700)
    urls = [make_url(os.environ[k]) for k in ["CORTEX_TEST_ADMIN_URL", "CORTEX_RUST_DATABASE_URL"]]
    assert all(u.host == "127.0.0.1" and u.database.endswith("_test") for u in urls)
    assert (urls[0].port, urls[0].database) == (urls[1].port, urls[1].database)
    assert os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363"
    keys = fixture_keys(directory)
    fixture = Fixture(str(uuid4()), keys)
    domain = str(uuid4())
    for name, value in keys.items():
        path = directory / f"{name}-private.pem"
        path.write_bytes(value)
        path.chmod(0o600)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        {
            k: os.environ[k]
            for k in [
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            ]
        }
    )
    env.update(
        {
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_RUST_BIND": "127.0.0.1:0",
            "CORTEX_DOCUMENTARY_MAP_INDEX": str(directory / "map-index.json"),
        }
    )
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    with db.begin() as c:
        c.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic SQL projection')"),
            {"t": fixture.tenant},
        )
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic SQL projection')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
        c.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'reader','viewer')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    binary = ROOT / "target/debug/cortex-rust-core"
    root = f"/v1/domains/{domain}/graph/window"
    with native_client(binary, env) as client:
        empty = client.get(root, headers=fixture.headers()).json()
        assert empty["nodes"] == [] and empty["domain_totals"] == {"concepts": 0, "relations": 0}
        concepts = [
            source_concept(
                client,
                fixture,
                domain,
                "Straße" if i == 0 else f"SQL record {i}",
                ["alice", "reader"] if i < 4 else ["alice"],
            )
            for i in range(6)
        ]
        concepts[3]["sources"] += concepts[4]["sources"]  # Every cited source must be visible.
        concepts[3]["body"] += "\n\n" + concepts[4]["body"]
        for item in concepts:
            item["links"] = [
                dict(target_id=other["concept_id"], kind="associative", weight=0.5, primary=False)
                for other in concepts
                if other is not item
            ]
        index = {
            "tenant": fixture.tenant,
            "domain": domain,
            "nodes": [
                {
                    "id": item["concept_id"],
                    "body_hash": hashlib.sha256(item["body"].encode()).hexdigest(),
                    "source_hashes": sorted(
                        hashlib.sha256(part.encode()).hexdigest()
                        for part in item["body"].split("\n\n")
                    ),
                    "group": "Synthetic",
                    "territory": "Test",
                }
                for item in concepts
            ],
            "references": [
                [a["concept_id"], b["concept_id"]] for a in concepts for b in concepts if a is not b
            ],
        }
        (directory / "map-index.json").write_text(json.dumps(index))
        proposal = prepare(client, fixture, domain, 0, concepts, "sql-projection-v1")
        publish(client, fixture, domain, proposal, 0)
    with native_client(binary, {**env, "CORTEX_TERMINUS_URL": "http://127.0.0.1:1"}) as client:
        assert (
            client.get(root, headers=fixture.headers()).status_code == 503
        )  # No fabricated empty graph.
    with db.connect() as c:
        assert (
            c.execute(
                text("SELECT count(*) FROM cf_graph_read_versions WHERE tenant_id=:t"),
                {"t": fixture.tenant},
            ).scalar_one()
            == 0
        )
    with native_client(binary, env) as client:
        for subject, count in [("reader", 3), ("alice", 6)]:
            page = client.get(root, headers=fixture.headers(subject)).json()
            assert page["domain_totals"] == {"concepts": count, "relations": count * (count - 1)}
            visible = {v["concept_id"] for v in concepts[:count]}
            assert {n["concept_id"] for n in page["nodes"]} == visible
            topology_response = client.get(
                f"/v1/domains/{domain}/graph/map", headers=fixture.headers(subject)
            )
            assert topology_response.status_code == 200
            topology = topology_response.json()
            assert {n["id"] for n in topology["nodes"]} == visible
            assert (
                topology["published_relations"]
                == topology["documentary_references"]
                == count * (count - 1)
            )
            assert len(topology["edges"]) == 2 * count * (count - 1)
            assert all(0 <= e[0] < count and 0 <= e[1] < count for e in topology["edges"])
            assert all("body" not in n and "source_hashes" not in n for n in topology["nodes"])
            scene_root = f"/v1/domains/{domain}/graph/scene"
            nodes_root = f"/v1/domains/{domain}/graph/map/nodes"
            scene_response = client.get(scene_root, headers=fixture.headers(subject))
            assert scene_response.status_code == 200
            assert len(scene_response.content) <= 65536
            scene = scene_response.json()
            assert scene["totals"] == {
                "concepts": count,
                "relations": count * (count - 1),
                "references": count * (count - 1),
            }
            assert all(g["concept_id"] in visible for g in scene["glyphs"] if g["concept_id"])
            node_response = client.get(nodes_root, headers=fixture.headers(subject))
            assert node_response.status_code == 200
            node_page = node_response.json()
            assert {n["node"]["id"] for n in node_page["items"]} == visible
            assert node_page["visibility"] == scene["visibility"]
            assert (
                client.get(
                    scene_root, headers=fixture.headers(subject), params={"at_version": 99}
                ).status_code
                == 409
            )
            assert client.get(
                nodes_root,
                headers=fixture.headers(subject),
                params={"focus": concepts[-1]["concept_id"]},
            ).status_code == (404 if subject == "reader" else 200)
            if subject == "alice":
                assert (
                    client.get(
                        scene_root,
                        headers=fixture.headers("reader"),
                        params={"visibility": scene["visibility"]},
                    ).status_code
                    == 409
                )
            for ident in [c["concept_id"] for c in concepts]:
                actual = client.get(
                    f"/v1/domains/{domain}/concepts/{ident}", headers=fixture.headers(subject)
                )
                if ident not in visible:
                    assert actual.status_code == 404
                    continue
                expected = deepcopy(next(c for c in concepts if c["concept_id"] == ident))
                expected["links"] = [e for e in expected["links"] if e["target_id"] in visible]
                assert actual.json() == expected
            legacy = client.get(
                f"/v1/domains/{domain}/concepts", headers=fixture.headers(subject)
            ).json()
            assert {v["concept_id"] for v in legacy} == visible
        verify_scene_cache_overlay(client, fixture, domain, directory / "map-index.json")
        cached_v1 = client.get(scene_root, headers=fixture.headers("reader")).json()
        page = client.get(root, headers=fixture.headers(), params={"search": "STRASSE"}).json()
        assert page["scope_totals"]["concepts"] == 1
        # Visibility tokens remain principal-specific, even when pages overlap.
        owner = client.get(root, headers=fixture.headers()).json()
        assert (
            client.get(
                root, headers=fixture.headers("reader"), params={"visibility": owner["visibility"]}
            ).status_code
            == 409
        )
        stale = client.get(root, headers=fixture.headers("reader"), params={"limit": 2}).json()
        changed = deepcopy(concepts[0])
        changed["title"] = "Straße · version 2"
        proposal = prepare(client, fixture, domain, 1, [changed], "sql-projection-v2")
        publish(client, fixture, domain, proposal, 1)
        assert (
            client.get(
                scene_root,
                headers=fixture.headers("reader"),
                params={"at_version": 1, "visibility": cached_v1["visibility"]},
            ).status_code
            == 409
        )
        current_scene = client.get(scene_root, headers=fixture.headers("reader")).json()
        assert (
            current_scene["at_version"] == 2
            and current_scene["visibility"] != cached_v1["visibility"]
        )
        assert (
            client.get(
                root,
                headers=fixture.headers("reader"),
                params={
                    "after": stale["next_after"],
                    "at_version": 1,
                    "visibility": stale["visibility"],
                },
            ).status_code
            == 409
        )
        current = client.get(root, headers=fixture.headers("reader")).json()
        assert current["at_version"] == 2 and current["domain_totals"] == {
            "concepts": 3,
            "relations": 6,
        }
        with db.begin() as locked:
            locked.execute(
                text("SELECT id FROM cf_domains WHERE tenant_id=:t AND id=:d FOR UPDATE"),
                {"t": fixture.tenant, "d": domain},
            )
            started = time.monotonic()
            blocked = client.get(root, headers=fixture.headers())
            elapsed = time.monotonic() - started
            assert blocked.status_code == 503 and 1.5 <= elapsed < 4, (blocked.status_code, elapsed)
        assert client.get(root, headers=fixture.headers("reader")).json() == current
        head = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini"))).get_current_head()
        assert client.get("/ready").json() == {"status": "ready", "schema_revision": head}
    with native_client(binary, {**env, "CORTEX_TERMINUS_URL": "http://127.0.0.1:1"}) as client:
        assert client.get(root, headers=fixture.headers("reader")).json() == current
        assert (
            client.get(
                f"/v1/domains/{domain}/concepts/{concepts[4]['concept_id']}",
                headers=fixture.headers("reader"),
            ).status_code
            == 404
        )
    with db.connect() as c:
        counts = [
            c.execute(
                text(f"SELECT count(*) FROM {table} WHERE tenant_id=:t"), {"t": fixture.tenant}
            ).scalar_one()
            for table in [
                "cf_graph_read_versions",
                "cf_graph_read_nodes",
                "cf_graph_read_sources",
                "cf_graph_read_edges",
            ]
        ]
    assert counts == [2, 12, 14, 60]
    # Database-level tenant isolation applies to every new table for the application role.
    with create_engine(
        os.environ["CORTEX_RUST_DATABASE_URL"].replace("postgresql://", "postgresql+pg8000://", 1)
    ).begin() as c:
        c.execute(text("SELECT set_config('cortex.tenant',:t,true)"), {"t": str(uuid4())})
        for table in [
            "cf_graph_read_versions",
            "cf_graph_read_nodes",
            "cf_graph_read_sources",
            "cf_graph_read_edges",
        ]:
            assert (
                c.execute(
                    text(f"SELECT count(*) FROM {table} WHERE tenant_id=:t"), {"t": fixture.tenant}
                ).scalar_one()
                == 0
            )
    report = {
        "status": "passed",
        "tenant": fixture.tenant,
        "domain": domain,
        "versions": 2,
        "owner_concepts": 6,
        "viewer_concepts": 3,
        "checks": [
            "empty_v0",
            "cold_engine_failure_without_partial_index",
            "viewer_first_build_without_scope_poisoning",
            "all_sources_required",
            "spatial_map_and_documentary_overlay_filter_both_endpoints",
            "scene_cache_overlay_content_change_same_mtime_and_restore",
            "scene_cache_fresh_publication_version",
            "hidden_endpoints_filtered",
            "single_detail_matches_legacy",
            "unicode_casefold",
            "version_fence",
            "principal_token",
            "warm_engine_outage",
            "readiness_0026",
            "database_rls",
            "lock_timeout_and_recovery",
        ],
        "limits": "Static source rights; no access change or membership removal tested",
    }
    (directory / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    run(parser.parse_args().directory)
