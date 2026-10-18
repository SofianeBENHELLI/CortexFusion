"""Governed synthetic >4 MB snapshot recipe with a temporary browser server.

Uses only a dedicated loopback *_test database and fresh synthetic identities.
Never imports private OKF data or changes existing membership permissions.
"""

import argparse
import hashlib
import json
import os
import signal
import time
from pathlib import Path
from uuid import uuid4

import httpx
from brain_browser_fixture import prepare, publish
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def run(directory, serve_seconds):
    directory = directory.resolve()
    if not directory.is_relative_to((ROOT / ".runtime/brain").resolve()) or directory.exists():
        raise ValueError("Choose a fresh private runtime directory")
    urls = [make_url(os.environ[key]) for key in ("CORTEX_TEST_ADMIN_URL", "CORTEX_RUST_DATABASE_URL")]
    if any(u.host != "127.0.0.1" or not u.database.endswith("_test") for u in urls):
        raise ValueError("Only isolated loopback test databases are permitted")
    if (urls[0].host, urls[0].port, urls[0].database) != (urls[1].host, urls[1].port, urls[1].database):
        raise ValueError("Database identities must use the same test database")
    if os.environ["CORTEX_TERMINUS_URL"] != "http://127.0.0.1:6363":
        raise ValueError("Use the existing synthetic engine, never the private corpus engine")
    directory.mkdir(mode=0o700)
    keys = fixture_keys(directory)
    for name, value in keys.items():
        path = directory / f"{name}-private.pem"
        path.write_bytes(value)
        path.chmod(0o600)
    fixture = Fixture(str(uuid4()), keys)
    domain = str(uuid4())
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    with db.begin() as conn:
        conn.execute(text("INSERT INTO cf_tenants(id,name) VALUES(:tenant,'Synthetic paged snapshot')"), {"tenant": fixture.tenant})
        conn.execute(text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Recette snapshot paginé')"), {"tenant": fixture.tenant, "domain": domain})
        conn.execute(text("INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,'alice','owner')"), {"tenant": fixture.tenant, "domain": domain})
    db.dispose()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update({key: os.environ[key] for key in ("CORTEX_RUST_DATABASE_URL", "CORTEX_TERMINUS_URL", "CORTEX_TERMINUS_USER", "CORTEX_TERMINUS_PASSWORD")})
    env.update({
        "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
        "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
        "CORTEX_JWT_ISSUER": "https://identity.test", "CORTEX_JWT_AUDIENCE": "cortex-core",
        "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174"]', "CORTEX_RUST_BIND": "127.0.0.1:8011",
    })
    stop = False

    def shutdown(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        client.timeout = httpx.Timeout(60)
        concepts = []
        for i in range(180):
            content = (f"Preuve synthétique du snapshot paginé {i:03}. " + "Évidence 🧠. " * 3000)[:30000]
            response = client.post(f"/v1/domains/{domain}/sources", headers=fixture.headers(), json={
                "title": f"Preuve synthétique {i:03}", "location": f"synthetic://paged-snapshot/{i}",
                "content": content, "allowed_subjects": ["alice"],
            })
            response.raise_for_status()
            concepts.append({"concept_id": str(uuid4()), "title": f"Snapshot paginé {i:03}", "body": content, "maturity": "emerging", "links": [], "sources": [{"source_id": response.json()["id"], "start": 0, "end": len(content)}]})
        version = 0
        for phase in range(2):
            if phase == 1:
                for i, c in enumerate(concepts):
                    c["links"] = [{"target_id": concepts[(i + 1) % len(concepts)]["concept_id"], "kind": "associative", "primary": False, "weight": 0.5}]
            for start in range(0, len(concepts), 50):
                if stop:
                    raise RuntimeError("Synthetic recipe stopped before another publication")
                proposal = prepare(client, fixture, domain, version, concepts[start:start + 50], f"paged-{phase}-{start}")
                publish(client, fixture, domain, proposal, version)
                version += 1
        seen = []
        request_bytes = []
        query = {"limit": 50}
        while True:
            response = client.get(f"/v1/domains/{domain}/graph/window", headers=fixture.headers(), params=query)
            response.raise_for_status()
            page = response.json()
            assert page["at_version"] == version
            assert page["domain_totals"] == {"concepts": 180, "relations": 180}
            seen.extend(n["concept_id"] for n in page["nodes"])
            request_bytes.append(len(response.content))
            if not page["next_after"]:
                break
            query = {"limit": 50, "after": page["next_after"], "at_version": version, "visibility": page["visibility"]}
        assert len(seen) == len(set(seen)) == 180 and set(seen) == {c["concept_id"] for c in concepts}
        sample = concepts[-1]
        actual = client.get(f"/v1/domains/{domain}/concepts/{sample['concept_id']}", headers=fixture.headers())
        actual.raise_for_status()
        assert all(actual.json()[key] == value for key, value in sample.items())
        source = client.get(f"/v1/domains/{domain}/sources/{sample['sources'][0]['source_id']}", headers=fixture.headers())
        source.raise_for_status()
        assert source.json()["content_hash"] == hashlib.sha256(sample["body"].encode()).hexdigest()
        report = {"tenant": fixture.tenant, "domain": domain, "version": version, "concepts": concepts, "concept_count": len(concepts), "relation_count": sum(len(c["links"]) for c in concepts), "concept_json_bytes": len(json.dumps(concepts, ensure_ascii=False).encode()), "window_bytes": request_bytes}
        path = directory / "state.json"
        path.write_text(json.dumps(report, ensure_ascii=False))
        path.chmod(0o600)
        print(json.dumps({k: v for k, v in report.items() if k != "concepts"}), flush=True)
        deadline = time.monotonic() + serve_seconds
        while not stop and time.monotonic() < deadline:
            time.sleep(0.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--serve-seconds", type=int, default=1800)
    args = parser.parse_args()
    if not 0 <= args.serve_seconds <= 3600:
        parser.error("Browser serving time must be 0–3600 seconds")
    run(args.directory, args.serve_seconds)
