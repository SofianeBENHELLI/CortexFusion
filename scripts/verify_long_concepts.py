"""Boundary and native/browser fixture for intact 200,000-character concepts.

Synthetic sources only; static access, no membership change or external provider.
"""

import argparse
import hashlib
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
            "CORTEX_RUST_BIND": "127.0.0.1:8011",
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174"]',
        }
    )
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    with db.begin() as c:
        c.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic long concepts')"),
            {"t": fixture.tenant},
        )
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic long concepts')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
        c.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'reader','contributor')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    binary = ROOT / "target/debug/cortex-rust-core"
    root = f"/v1/domains/{domain}"
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    concepts = []
    with native_client(binary, env) as client:
        bodies = [
            (
                "Long Unicode document",
                ("Preuve synthétique 🧠 é. " * 10000)[:200000],
                ["alice", "reader"],
            ),
            ("JSON escape boundary", "\x01" * 200000, ["alice"]),
            ("Casefold expansion boundary", "ΐ" * 200000, ["alice"]),
        ]
        for i, (title, body, acl) in enumerate(bodies):
            payload = {
                "title": title,
                "location": f"synthetic://long-concept/{i}",
                "content": body,
                "allowed_subjects": acl,
            }
            source = client.post(root + "/sources", headers=fixture.headers(), json=payload)
            assert source.status_code == 201, source.status_code
            concept = {
                "concept_id": str(uuid4()),
                "title": title,
                "body": body,
                "maturity": "emerging",
                "sources": [{"source_id": source.json()["id"], "start": 0, "end": len(body)}],
                "links": [],
            }
            if i == 0:
                invalid = client.post(
                    root + "/proposals",
                    headers=fixture.headers(),
                    json={
                        "base_version": 0,
                        "changes": [
                            {"kind": "put_concept", "concept": {**concept, "body": body + "x"}}
                        ],
                        "reason": "Synthetic invalid boundary",
                        "idempotency_key": "long-overflow-rejected",
                    },
                )
                assert invalid.status_code == 422
                forged = client.post(
                    root + "/proposals",
                    headers=fixture.headers(),
                    json={
                        "base_version": 0,
                        "changes": [
                            {"kind": "put_concept", "concept": {**concept, "body": "x" + body[1:]}}
                        ],
                        "reason": "Synthetic false evidence",
                        "idempotency_key": "long-inexact-rejected",
                    },
                )
                assert forged.status_code == 422
            ident = prepare(client, fixture, domain, i, [concept], f"long-concept-{i}-review")
            publish(client, fixture, domain, ident, i)
            concepts.append(concept)
            actual = client.get(
                root + "/concepts/" + concept["concept_id"], headers=fixture.headers()
            )
            assert actual.status_code == 200 and actual.json() == concept
            diff = client.get(root + f"/proposals/{ident}/diff/summary", headers=fixture.headers())
            assert diff.status_code == 200
            assert (
                diff.json()["items"][0]["after"]["body_sha256"]
                == hashlib.sha256(body.encode()).hexdigest()
            )
            assert (
                client.get(root + "/version", headers=fixture.headers()).json()["published_version"]
                == i + 1
            )
        for subject, count in [("alice", 3), ("reader", 1)]:
            window = client.get(root + "/graph/window", headers=fixture.headers(subject))
            assert window.status_code == 200 and window.json()["domain_totals"] == {
                "concepts": count,
                "relations": 0,
            }
        assert (
            client.get(
                root + "/concepts/" + concepts[1]["concept_id"], headers=fixture.headers("reader")
            ).status_code
            == 404
        )
        searched = client.get(
            root + "/graph/window", headers=fixture.headers(), params={"search": "ΐ"}
        )
        assert searched.status_code == 200 and searched.json()["scope_totals"]["concepts"] == 1
        # Legacy full list must roundtrip all the large records too.
        full = client.get(root + "/concepts", headers=fixture.headers())
        assert full.status_code == 200
        assert sorted(full.json(), key=lambda c: c["concept_id"]) == sorted(
            concepts, key=lambda c: c["concept_id"]
        )
        state = {
            "tenant": fixture.tenant,
            "domain": domain,
            "concepts": concepts,
            "version": 3,
            "synthetic_only": True,
        }
        write_state(directory, state)
        session = directory / "browser-session.json"
        session.write_text(
            json.dumps({"tenant": fixture.tenant, "token": fixture.headers()["Authorization"][7:]})
        )
        session.chmod(0o600)
        report = {
            "status": "passed",
            "concepts": 3,
            "publications": 3,
            "characters_per_concept": 200000,
            "checks": [
                "overflow_422",
                "inexact_evidence_422",
                "exact_native_readback",
                "escaped_json_record",
                "expanded_casefold_index",
                "static_rights",
                "compact_hashes",
                "full_list",
            ],
            "limits": "No concurrency/10k qualification; browser acceptance recorded separately",
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
    assert 0 <= args.duration <= 3600
    run(args.directory, args.duration)
