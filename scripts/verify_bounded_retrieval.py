"""Native long-passage acceptance and Chrome fixture; synthetic, static rights only."""

import argparse
import json
import os
import signal
import time
from pathlib import Path
from uuid import uuid4

from brain_browser_fixture import prepare, publish, write_state
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def run(directory, duration):
    directory = directory.resolve()
    assert directory.is_relative_to(ROOT / ".runtime/brain") and not directory.exists()
    urls = [make_url(os.environ[k]) for k in ["CORTEX_TEST_ADMIN_URL", "CORTEX_RUST_DATABASE_URL"]]
    assert all(u.host == "127.0.0.1" and u.database.endswith("_test") for u in urls)
    assert (urls[0].port, urls[0].database) == (urls[1].port, urls[1].database)
    assert os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363"
    directory.mkdir(mode=0o700)
    keys = fixture_keys(directory)
    for name, value in keys.items():
        path = directory / f"{name}-private.pem"
        path.write_bytes(value)
        path.chmod(0o600)
    fixture = Fixture(str(uuid4()), keys)
    domain = str(uuid4())
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    for key in [
        "CORTEX_RUST_DATABASE_URL",
        "CORTEX_TERMINUS_URL",
        "CORTEX_TERMINUS_USER",
        "CORTEX_TERMINUS_PASSWORD",
    ]:
        env[key] = os.environ[key]
    env.update(
        {
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_RUST_BIND": "127.0.0.1:8011",
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174"]',
        }
    )
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    with db.begin() as c:
        c.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic passage acceptance')"),
            {"t": fixture.tenant},
        )
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette des passages longs')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
        c.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'reader','contributor')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        root = f"/v1/domains/{domain}"
        concepts = []
        bodies = []
        for i, position in enumerate([0, 100_000, 199_900]):
            body = (
                "Bruit.\n" * (position // 7)
                + f"La constellation{i} violette contient sept étoiles 🧠.\n"
            )
            body += ("Bruit.\n" * 30000)[: 200000 - len(body)]
            bodies.append((f"Dossier astronomique {i}", body, ["alice", "reader"]))
        bodies.extend(
            [
                ("Bloc indivisible", ("quartz " * 30000)[:200000], ["alice", "reader"]),
                ("Dossier réservé", "Confidentielsynthetique.\n" * 1000, ["alice"]),
            ]
        )
        for i, (title, body, subjects) in enumerate(bodies):
            source = client.post(
                root + "/sources",
                headers=fixture.headers(),
                json={
                    "title": title,
                    "location": f"synthetic://bounded-retrieval/{i}",
                    "content": body,
                    "allowed_subjects": subjects,
                },
            )
            assert source.status_code == 201, source.status_code
            concept = {
                "concept_id": str(uuid4()),
                "title": title,
                "body": body,
                "maturity": "emerging",
                "sources": [{"source_id": source.json()["id"], "start": 0, "end": len(body)}],
                "links": [],
            }
            ident = prepare(client, fixture, domain, i, [concept], f"bounded-retrieval-{i}")
            publish(client, fixture, domain, ident, i)
            concepts.append(concept)
        result_ids = []
        for i, budget in ((i, budget) for i in range(3) for budget in [100, 8000]):
            response = client.post(
                root + "/query",
                headers=fixture.headers("reader"),
                json={"question": f"constellation{i} violette", "max_chars": budget},
            )
            assert response.status_code == 200, response.status_code
            result = response.json()
            assert result["status"] == "evidence_found" and len(result["answer"]) <= 100
            assert "sept étoiles 🧠" in result["answer"] and result["concepts"] == []
            p = result["context_passages"][0]
            citation = result["citations"][0]
            assert p["body_total_chars"] == 200000
            assert (
                concepts[i]["body"][p["body_start"] : p["body_end"]]
                == p["text"]
                == result["answer"]
            )
            assert (
                concepts[i]["body"][citation["start"] : citation["end"]]
                == citation["excerpt"]
                == p["text"]
            )
            assert (
                client.get(
                    root + "/episodes/" + result["episode_id"], headers=fixture.headers("reader")
                ).json()
                == result
            )
            assert (
                client.get(
                    root + "/concepts/" + concepts[i]["concept_id"],
                    headers=fixture.headers("reader"),
                ).json()
                == concepts[i]
            )
            result_ids.append(result["episode_id"])
        limited = client.post(
            root + "/query", headers=fixture.headers("reader"), json={"question": "quartz"}
        ).json()
        assert limited["status"] == "context_limited" and not limited["citations"]
        missing = client.post(
            root + "/query", headers=fixture.headers("reader"), json={"question": "absentxyz"}
        ).json()
        hidden = client.post(
            root + "/query",
            headers=fixture.headers("reader"),
            json={"question": "Confidentielsynthetique"},
        ).json()
        assert missing["status"] == hidden["status"] == "knowledge_gap"
        assert not hidden["context_passages"] and not hidden["citations"]
        with db.connect() as c:
            assert c.execute(
                text("SELECT source_ids FROM cf_episodes WHERE tenant_id=:t AND id=:e"),
                {"t": fixture.tenant, "e": limited["episode_id"]},
            ).scalar_one() == [concepts[3]["sources"][0]["source_id"]]
            for ident in [*result_ids, limited["episode_id"]]:
                assert (
                    c.execute(
                        text(
                            "SELECT count(*) FROM cf_issues WHERE tenant_id=:t AND episode_id=:e AND kind='knowledge_gap'"
                        ),
                        {"t": fixture.tenant, "e": ident},
                    ).scalar_one()
                    == 0
                )
            assert (
                c.execute(
                    text(
                        "SELECT count(*) FROM cf_issues WHERE tenant_id=:t AND episode_id=:e AND kind='knowledge_gap'"
                    ),
                    {"t": fixture.tenant, "e": missing["episode_id"]},
                ).scalar_one()
                == 1
            )
        conversation = client.post(
            root + "/conversations",
            headers=fixture.headers("reader"),
            json={"title": "Passages longs", "idempotency_key": "bounded-conversation"},
        ).json()
        payload = {
            "question": "constellation1 violette",
            "idempotency_key": "bounded-turn",
            "max_chars": 100,
        }
        path = root + "/conversations/" + conversation["id"] + "/query"
        first = client.post(path, headers=fixture.headers("reader"), json=payload)
        assert first.status_code == 200, first.status_code
        assert (
            client.post(path, headers=fixture.headers("reader"), json=payload).json()
            == first.json()
        )
        state = {
            "tenant": fixture.tenant,
            "domain": domain,
            "version": 5,
            "concepts": concepts,
            "synthetic_only": True,
            "conversation": conversation["id"],
        }
        write_state(directory, state)
        report = {
            "status": "passed",
            "concepts": 5,
            "long_characters": 200000,
            "checks": [
                "start_middle_end",
                "unicode_source_offsets",
                "answer_budgets_100_and_8000",
                "intact_concept_readback",
                "limited_not_gap",
                "missing_is_gap",
                "static_source_permissions",
                "limited_episode_source_dependencies",
                "episode_readback",
                "conversation_retry",
            ],
            "limits": "No model calls, no ACL changes, no load qualification; Chrome recorded separately",
        }
        (directory / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)
        deadline = time.monotonic() + duration
        while not stopped and time.monotonic() < deadline:
            time.sleep(0.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--duration", type=int, default=0)
    args = parser.parse_args()
    run(args.directory, args.duration)
