"""Search ranking and cursor qualification on a fresh synthetic governed history.

Static roles/source ACLs only. No membership removal or private data.
"""

import argparse
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

from brain_browser_fixture import prepare, publish, source_concept
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


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
    with native_client(binary, env) as client:
        concepts = []
        for i in range(1, 18):
            c = source_concept(
                client,
                fixture,
                domain,
                f"Straße evidence {i}",
                ["alice"] if i == 16 else ["alice", "reader"],
            )
            c["concept_id"] = str(UUID(int=i))
            c["title"] = {
                13: "A Straße mention",
                14: "Straße prefix",
                15: "Straße",
                16: "Straße",
                17: "Literal % title",
            }.get(i, f"Body mention {i}")
            concepts.append(c)
        proposal = prepare(client, fixture, domain, 0, concepts, "search-ranked-first")
        publish(client, fixture, domain, proposal, 0)

        def get(subject="alice", **params):
            response = client.get(
                root + "/graph/window", headers=fixture.headers(subject), params=params
            )
            assert response.status_code == 200, (response.status_code, response.text)
            return response.json()

        for subject, expected in [
            ("alice", [15, 16, 14, 13, *range(1, 13), 17]),
            ("reader", [15, 14, 13, *range(1, 13), 17]),
        ]:
            expected = [str(UUID(int=i)) for i in expected]
            seen = []
            query = {"search": " STRASSE ", "limit": 3}
            while True:
                page = get(subject, **query)
                assert page["scope_totals"]["concepts"] == len(expected)
                ids = [n["concept_id"] for n in page["nodes"]]
                assert len(ids) <= 3 and all("body" not in n for n in page["nodes"])
                seen += ids
                if page["previous_before"]:
                    previous = get(
                        subject,
                        search=" STRASSE ",
                        limit=3,
                        before=page["previous_before"],
                        at_version=1,
                        visibility=page["visibility"],
                    )
                    again = get(
                        subject,
                        search=" STRASSE ",
                        limit=3,
                        after=previous["next_after"],
                        at_version=1,
                        visibility=page["visibility"],
                    )
                    assert again["nodes"] == page["nodes"]
                if page["next_after"] is None:
                    break
                query.update(after=page["next_after"], at_version=1, visibility=page["visibility"])
            assert seen == expected
        regular = get(limit=50)
        assert [n["concept_id"] for n in regular["nodes"]] == sorted(
            c["concept_id"] for c in concepts
        )
        assert get(search="%", limit=8)["scope_totals"]["concepts"] == 1
        assert get(search="missing phrase")["nodes"] == []
        for cursor in [str(UUID(int=16)), str(uuid4())]:
            assert (
                client.get(
                    root + "/graph/window",
                    headers=fixture.headers("reader"),
                    params={
                        "search": "STRASSE",
                        "after": cursor,
                        "at_version": 1,
                        "visibility": get("reader")["visibility"],
                    },
                ).status_code
                == 422
            )
        assert (
            client.get(
                root + "/graph/window",
                headers=fixture.headers(),
                params={"search": "STRASSE", "at_version": 0},
            ).status_code
            == 409
        )
        assert (
            client.get(
                root + "/graph/window",
                headers=fixture.headers("outsider"),
                params={"search": "STRASSE"},
            ).status_code
            == 404
        )
        report = {
            "status": "passed",
            "concepts": 17,
            "checks": [
                "exact_prefix_contains_before_body",
                "unicode_casefold",
                "deterministic_uuid_ties",
                "forward_backward_complete",
                "static_source_permissions",
                "unknown_hidden_cursor_422",
                "literal_percent",
                "normal_order_unchanged",
                "stale_version_409",
                "nonmember_404",
            ],
        }
        (directory / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    run(parser.parse_args().directory)
