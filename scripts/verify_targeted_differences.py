"""Targeted difference parity on a fresh, synthetic governed history.

Static roles/source ACLs only. No membership removal or private data.
"""

import argparse
import hashlib
import json
import os
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from brain_browser_fixture import prepare, publish, source_concept
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def compact(value):
    value = deepcopy(value)
    for item in value["items"]:
        for side in ("before", "after"):
            if item[side] is not None:
                item[side] = dict(item[side])
                body = item[side].pop("body")
                item[side]["body_sha256"] = hashlib.sha256(body.encode()).hexdigest()
    return value


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
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'reader','contributor')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    binary = ROOT / "target/debug/cortex-rust-core"
    root = f"/v1/domains/{domain}"
    expected = {}
    with native_client(binary, env) as client:

        def diff(proposal, version, before, after, subject="alice", base=None, committed=True):
            value = {
                "proposal_id": proposal,
                "base_version": version - 1 if base is None else base,
                "published_version": version,
                "comparison": "accepted_before_state" if committed else "current_published_state",
                "stale_base": not committed and base != version,
                "items": [
                    {"concept_id": ident, "before": before.get(ident), "after": after.get(ident)}
                    for ident in dict.fromkeys([*after, *before])
                ],
            }
            url = root + f"/proposals/{proposal}/diff"
            for suffix, wanted in [("", value), ("/summary", compact(value))]:
                response = client.get(url + suffix, headers=fixture.headers(subject))
                assert response.status_code == 200, (response.status_code, response.text)
                assert response.json() == wanted, (response.json(), wanted)
            return value

        def denied(proposal, subject="reader", status=404):
            for suffix in ("", "/summary"):
                assert (
                    client.get(
                        root + f"/proposals/{proposal}/diff" + suffix,
                        headers=fixture.headers(subject),
                    ).status_code
                    == status
                )

        def draft(version, changes, key):
            response = client.post(
                root + "/proposals",
                headers=fixture.headers(),
                json={
                    "base_version": version,
                    "changes": changes,
                    "reason": "Synthetic draft",
                    "idempotency_key": key,
                },
            )
            response.raise_for_status()
            return response.json()["id"]

        a = source_concept(client, fixture, domain, "Origin 🧠", ["alice", "reader"])
        b = source_concept(client, fixture, domain, "Endpoint", ["alice", "reader"])
        secret = source_concept(client, fixture, domain, "Restricted evidence", ["alice"])
        mixed = deepcopy(a)
        mixed["concept_id"] = str(uuid4())
        mixed["sources"] += secret["sources"]
        mixed["body"] += "\n\n" + secret["body"]
        a["links"] = [
            {"target_id": b["concept_id"], "kind": "associative", "weight": 0.5, "primary": False}
        ]
        initial = [a, b, secret, mixed]
        changes = [{"kind": "put_concept", "concept": c} for c in initial]
        zero = draft(0, changes, "targeted-diff-v0-draft")
        diff(zero, 0, {}, {c["concept_id"]: c for c in initial}, base=0, committed=False)
        denied(zero)
        with native_client(
            binary, {k: v for k, v in env.items() if not k.startswith("CORTEX_TERMINUS_")}
        ) as no_engine:
            url = root + f"/proposals/{zero}/diff"
            assert (
                no_engine.get(url, headers=fixture.headers()).json()
                == client.get(url, headers=fixture.headers()).json()
            )
        first = prepare(client, fixture, domain, 0, initial, "targeted-diff-first")
        publish(client, fixture, domain, first, 0)
        diff(first, 1, {}, {c["concept_id"]: c for c in initial})
        denied(first)

        a2 = deepcopy(a)
        a2["title"] += " · revised"
        waiting = draft(1, [{"kind": "put_concept", "concept": a2}], "targeted-diff-waiting")
        diff(
            waiting,
            1,
            {a["concept_id"]: a},
            {a["concept_id"]: a2},
            base=1,
            committed=False,
            subject="reader",
        )
        second = prepare(client, fixture, domain, 1, [a2], "targeted-diff-second")
        # Accepted and not yet published still compares with the immutable before state.
        diff(second, 1, {a["concept_id"]: a}, {a["concept_id"]: a2}, base=1)
        publish(client, fixture, domain, second, 1)
        diff(second, 2, {a["concept_id"]: a}, {a["concept_id"]: a2}, subject="reader")
        diff(waiting, 2, {a["concept_id"]: a2}, {a["concept_id"]: a2}, base=1, committed=False)

        a3 = deepcopy(a2)
        a3["links"] = []
        b3 = deepcopy(secret)
        b3["concept_id"] = b["concept_id"]
        b3["title"] = "Endpoint with restricted evidence"
        third = prepare(client, fixture, domain, 2, [a3, b3], "targeted-diff-third")
        publish(client, fixture, domain, third, 2)
        diff(
            third,
            3,
            {a["concept_id"]: a2, b["concept_id"]: b},
            {a["concept_id"]: a3, b["concept_id"]: b3},
        )
        denied(third)
        denied(second)  # Historical link's endpoint now exists with inaccessible evidence.
        diff(
            waiting,
            3,
            {a["concept_id"]: a3},
            {a["concept_id"]: a2},
            base=1,
            committed=False,
            subject="reader",
        )

        fourth = prepare(
            client,
            fixture,
            domain,
            3,
            [],
            "targeted-diff-retire-endpoint",
            retired_ids=[b["concept_id"]],
        )
        publish(client, fixture, domain, fourth, 3)
        diff(fourth, 4, {b["concept_id"]: b3}, {})
        denied(fourth)
        # Retired endpoints retain the accepted historical link; no hidden live target.
        diff(second, 4, {a["concept_id"]: a}, {a["concept_id"]: a2}, base=1, subject="reader")
        fifth = prepare(
            client,
            fixture,
            domain,
            4,
            [],
            "targeted-diff-retire-origin",
            retired_ids=[a["concept_id"]],
        )
        publish(client, fixture, domain, fifth, 4)
        diff(fifth, 5, {a["concept_id"]: a3}, {}, subject="reader")
        diff(waiting, 5, {}, {a["concept_id"]: a2}, base=1, committed=False, subject="reader")
        denied(first, subject="absent")
        for pid in [first, second, third, fourth, fifth, waiting]:
            for subject in ["alice", "reader"]:
                for suffix in ["", "/summary"]:
                    url = root + f"/proposals/{pid}/diff" + suffix
                    response = client.get(url, headers=fixture.headers(subject))
                    expected[(url, subject)] = (response.status_code, response.json())
        response = client.get(root + "/publications", headers=fixture.headers())
        assert response.status_code == 200 and len(response.json()["items"]) == 5
        journal = response.json()
        assert (
            client.get(root + "/publications", headers=fixture.headers("reader")).status_code == 403
        )
        url = root + f"/proposals/{second}/diff/summary"
        assert client.get(url).status_code == 401
        # Tokens name their tenant, so another tenant's header is rejected (401).
        assert (
            client.get(url, headers={**fixture.headers(), "X-Tenant-ID": str(uuid4())}).status_code
            == 401
        )

    with native_client(binary, {**env, "CORTEX_TERMINUS_URL": "http://127.0.0.1:1"}) as client:
        for (url, subject), wanted in expected.items():
            response = client.get(url, headers=fixture.headers(subject))
            assert (response.status_code, response.json()) == wanted
        assert client.get(root + "/publications", headers=fixture.headers()).json() == journal
    report = {
        "status": "passed",
        "tenant": fixture.tenant,
        "domain": domain,
        "publications": 5,
        "offline_response_parity": len(expected),
        "checks": [
            "v0_draft_without_configured_engine",
            "accepted_unpublished",
            "immutable_before_state",
            "stale_draft_current_before",
            "multiple_sources",
            "hidden_current_endpoint",
            "retired_historical_endpoint",
            "retired_origin",
            "compact_exact_hashes",
            "owner_journal",
            "role_tenant_auth",
            "warm_engine_outage",
        ],
        "limits": "Static rights only; no membership or ACL mutation, no volume measurement",
    }
    (directory / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    run(parser.parse_args().directory)
