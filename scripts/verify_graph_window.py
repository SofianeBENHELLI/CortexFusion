"""Bounded graph reads over real, governed publications in an isolated local test DB."""

import argparse
import hashlib
import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import jsonschema
from brain_browser_fixture import prepare, publish, source_concept
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def run(directory):
    admin_url = os.environ["CORTEX_TEST_ADMIN_URL"]
    rust_url = os.environ["CORTEX_RUST_DATABASE_URL"]
    urls = [make_url(admin_url), make_url(rust_url)]
    assert all(u.host in {"127.0.0.1", "localhost"} and u.database.endswith("_test") for u in urls)
    assert (urls[0].host, urls[0].port, urls[0].database) == (
        urls[1].host,
        urls[1].port,
        urls[1].database,
    )
    fixture = Fixture(str(uuid4()), fixture_keys(directory))
    domain = str(uuid4())
    with create_engine(admin_url).begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic graph window')"),
            {"t": fixture.tenant},
        )
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic graph window')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    env = {k: v for k, v in os.environ.items() if not k.startswith("CORTEX_")}
    env.update(
        {
            key: os.environ[key]
            for key in [
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
    schema = json.loads((ROOT / "packages/contracts/schema/GraphWindow.json").read_text())
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        root = f"/v1/domains/{domain}/graph/window"

        def page(subject="alice", **params):
            r = client.get(root, headers=fixture.headers(subject), params=params)
            assert r.status_code == 200, r.text
            value = r.json()
            validator.validate(value)
            return value

        empty = page()
        assert empty["at_version"] == 0 and empty["nodes"] == []
        concepts = [
            source_concept(
                client, fixture, domain, f"Window {i:02}", ["alice", "bob"] if i < 25 else ["alice"]
            )
            for i in range(30)
        ]
        for c in concepts:
            c["links"] = [
                {
                    "target_id": other["concept_id"],
                    "kind": "associative",
                    "weight": 0.5,
                    "primary": False,
                }
                for other in concepts
                if other is not c
            ]
        proposal = prepare(client, fixture, domain, 0, concepts, "graph-window-initial")
        summary_schema = json.loads(
            (ROOT / "packages/contracts/schema/ProposalDifferenceSummary.json").read_text()
        )
        summary_validator = jsonschema.Draft202012Validator(summary_schema)

        def check_summary(ident):
            diff_root = f"/v1/domains/{domain}/proposals/{ident}/diff"
            full_diff = client.get(diff_root, headers=fixture.headers())
            full_diff.raise_for_status()
            compact = client.get(diff_root + "/summary", headers=fixture.headers())
            compact.raise_for_status()
            value = compact.json()
            summary_validator.validate(value)
            expected = full_diff.json()
            for item in expected["items"]:
                for field in ["before", "after"]:
                    if item[field] is not None:
                        body = item[field].pop("body")
                        item[field]["body_sha256"] = hashlib.sha256(body.encode()).hexdigest()
            assert value == expected
            assert (
                client.get(diff_root + "/summary", headers=fixture.headers("bob")).status_code
                == 403
            )
            rpc = client.post(
                "/mcp",
                headers={**fixture.headers(), "Accept": "application/json, text/event-stream"},
                json={
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        "name": "api_proposals_diff_summary",
                        "arguments": {"path": {"domain": domain, "proposal_id": ident}},
                    },
                },
            )
            assert rpc.json()["result"]["structuredContent"] == {
                "http_status": 200,
                "data": value,
            }, rpc.text
            return len(full_diff.content), len(compact.content)

        check_summary(proposal)  # Approval is still not publication.
        assert page() == empty  # Approval does not publish a graph.
        publish(client, fixture, domain, proposal, 0)
        summary_bytes = check_summary(proposal)
        checks.append(
            "compact_difference_schema_exact_body_hashes_unchanged_evidence_and_mcp_parity"
        )
        checks.append("approval_without_graph_effect_and_real_publication")
        full = client.get(f"/v1/domains/{domain}/concepts", headers=fixture.headers())
        full.raise_for_status()
        first = page()
        assert first["domain_totals"] == {"concepts": 30, "relations": 870}
        assert first["scope_totals"] == first["domain_totals"]
        assert first["internal_relations"] == 552 and first["boundary_outgoing_relations"] == 144
        assert len(first["edges"]) == 120 and first["edges_truncated"]
        assert all("body" not in n and "sources" not in n for n in first["nodes"])
        seen = set()
        query = {"limit": 7}
        while True:
            value = page(**query)
            assert value["domain_totals"] == first["domain_totals"]
            ids = {n["concept_id"] for n in value["nodes"]}
            assert not seen & ids
            seen |= ids
            assert all(e["from"] in ids and e["to"] in ids for e in value["edges"])
            if value["next_after"] is None:
                break
            query = {
                "limit": 7,
                "at_version": 1,
                "visibility": value["visibility"],
                "after": value["next_after"],
            }
        assert seen == {c["concept_id"] for c in concepts}
        assert page() == first
        checks.append("bounded_transport_dense_edges_exact_counts_stable_disjoint_pages")
        bob = page("bob")
        public_ids = {c["concept_id"] for c in concepts[:25]}
        assert bob["domain_totals"] == {"concepts": 25, "relations": 600}
        assert all(n["concept_id"] in public_ids for n in bob["nodes"])
        assert all(e["from"] in public_ids and e["to"] in public_ids for e in bob["edges"])
        assert page("bob", focus=concepts[0]["concept_id"])["scope_totals"] == bob["domain_totals"]
        assert (
            client.get(
                root, headers=fixture.headers("bob"), params={"focus": concepts[-1]["concept_id"]}
            ).status_code
            == 404
        )
        assert (
            client.get(
                root, headers=fixture.headers("bob"), params={"visibility": first["visibility"]}
            ).status_code
            == 409
        )
        for params in [
            {"after": first["next_after"]},
            {"limit": 0},
            {"limit": 51},
            {"at_version": -1},
            {"visibility": "bad"},
            {"offset": 1},
            {"focus": "bad"},
        ]:
            assert client.get(root, headers=fixture.headers(), params=params).status_code == 422
        other = {**fixture.headers(), "X-Tenant-ID": str(uuid4())}
        assert client.get(root, headers=other).status_code == 404
        assert client.get(root).status_code == 401
        rpc = client.post(
            "/mcp",
            headers={**fixture.headers("bob"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_graph_window",
                    "arguments": {"path": {"domain": domain}, "query": {}},
                },
            },
        )
        assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": bob}, (
            rpc.text
        )
        located = page(
            focus=concepts[0]["concept_id"],
            direction="outgoing",
            locate=sorted(c["concept_id"] for c in concepts[1:])[-1],
        )
        assert len(located["scope_ids"]) == 30
        assert any(n["concept_id"] == concepts[0]["concept_id"] for n in located["nodes"])
        back = page(
            focus=concepts[0]["concept_id"],
            direction="outgoing",
            before=located["previous_before"],
            at_version=1,
            visibility=located["visibility"],
        )
        again = page(
            focus=concepts[0]["concept_id"],
            direction="outgoing",
            after=back["next_after"],
            at_version=1,
            visibility=back["visibility"],
        )
        assert again["nodes"] == located["nodes"]
        assert page("bob", search="WINDOW 29")["scope_totals"]["concepts"] == 0
        assert page(search="WINDOW 29")["scope_totals"]["concepts"] == 1
        checks.append(
            "pinned_focus_backwards_locate_complete_outgoing_membership_and_authorized_search"
        )
        checks.append("viewer_tenant_hidden_focus_validation_and_mcp_parity")
        changed = deepcopy(concepts[0])
        changed["title"] += " published v2"
        changed["body"] = (changed["body"] * 400)[:30000]
        proof = client.post(
            f"/v1/domains/{domain}/sources",
            headers=fixture.headers(),
            json={
                "title": "Synthetic long verbatim proof",
                "location": "synthetic://summary-long-proof",
                "content": changed["body"],
                "allowed_subjects": ["alice", "bob"],
            },
        )
        proof.raise_for_status()
        changed["sources"] = [
            {"source_id": proof.json()["id"], "start": 0, "end": len(changed["body"])}
        ]
        proposal = prepare(client, fixture, domain, 1, [changed], "graph-window-next")
        publish(client, fixture, domain, proposal, 1)
        large_summary_bytes = check_summary(proposal)
        assert large_summary_bytes[1] < large_summary_bytes[0] / 2
        assert client.get(root, headers=fixture.headers(), params=query).status_code == 409
        assert page()["at_version"] == 2
        before_revoke = page("bob", limit=7)
        source = changed["sources"][0]["source_id"]
        body = {"allowed_subjects": ["alice"]}
        response = client.put(
            f"/v1/domains/{domain}/sources/{source}/access",
            headers=fixture.signed(
                "sources.access", {"path": {"domain": domain, "source_id": source}, "body": body}
            ),
            json=body,
        )
        response.raise_for_status()
        continuation = {
            "after": before_revoke["next_after"],
            "at_version": 2,
            "visibility": before_revoke["visibility"],
        }
        assert (
            client.get(root, headers=fixture.headers("bob"), params=continuation).status_code == 409
        )
        revoked = page("bob")
        assert revoked["domain_totals"] == {"concepts": 24, "relations": 552}
        assert all(n["concept_id"] != concepts[0]["concept_id"] for n in revoked["nodes"])
        assert (
            client.get(
                root, headers=fixture.headers("bob"), params={"focus": concepts[0]["concept_id"]}
            ).status_code
            == 404
        )
        checks.append("publication_fence_and_current_source_revocation_invalidate_continuation")
        catalog = client.get("/v1/interactions", headers=fixture.headers()).json()
        assert len(catalog["items"]) == 90
        graph_op = next(op for op in catalog["items"] if op["operation_id"] == "graph.window")
        assert "viewer" in graph_op["roles"]
        tools = client.post(
            "/mcp",
            headers={**fixture.headers(), "Accept": "application/json, text/event-stream"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ).json()["result"]["tools"]
        assert len(tools) == 106
        checks.append("native_90_http_106_mcp_inventory_and_member_role_contract")
        summary_root = f"/v1/domains/{domain}/proposals/{proposal}/diff/summary"
        assert client.get(summary_root, headers=other).status_code == 404
        assert client.get(summary_root).status_code == 401
        body = {"allowed_subjects": ["bob"]}
        response = client.put(
            f"/v1/domains/{domain}/sources/{source}/access",
            headers=fixture.signed(
                "sources.access", {"path": {"domain": domain, "source_id": source}, "body": body}
            ),
            json=body,
        )
        response.raise_for_status()
        assert client.get(summary_root, headers=fixture.headers()).status_code == 404
        checks.append(
            "summary_large_body_reduction_cross_tenant_and_current_owner_evidence_revocation"
        )
        return {
            "status": "passed",
            "checks": checks,
            "concepts": 30,
            "relations": 870,
            "full_concepts_response_bytes": len(full.content),
            "graph_first_page_json_bytes": len(
                json.dumps(first, ensure_ascii=False, separators=(",", ":")).encode()
            ),
            "initial_difference_bytes": {"full": summary_bytes[0], "summary": summary_bytes[1]},
            "large_body_difference_bytes": {
                "full": large_summary_bytes[0],
                "summary": large_summary_bytes[1],
            },
            "limits": "Real engine recipe has 30 concepts; no production or 100k capacity qualification. Browser integration is a separate acceptance recipe. Server aggregation remains pending.",
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / ".runtime"):
        parser.error("Write reports only under the ignored .runtime directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="graph-window-", dir=output.parent) as temp:
        report = run(Path(temp))
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
