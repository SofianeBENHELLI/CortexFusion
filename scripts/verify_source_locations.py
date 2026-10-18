"""Locate exact excerpts with bounded output, Unicode positions and current ACLs."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT


def main():
    state = json.loads((OUT / "reference-passage-native-report.json").read_text())
    assert state["synthetic_only"]
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
    db = create_engine(url)
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"
        path = base + f"/sources/{state['source']}/locate"
        before = client.get(base + "/version", headers=fixture.headers()).json()

        def locate(body, status=200, actor="reader", target=path):
            r = client.post(target, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (status, r.status_code, r.text[:150])
            if status == 200:
                assert len(r.content) < 16384
                assert set(r.json()) == {
                    "source_id",
                    "title",
                    "location",
                    "content_hash",
                    "start",
                    "end",
                    "total_characters",
                    "offset_unit",
                }
            return r.json()

        proof = "La revue dure cinq jours."
        body = {"excerpt": proof, "expected_hash": state["source_hash"]}
        found = locate(body)
        assert (
            found["start"] == 150010
            and found["end"] == 150035
            and found["offset_unit"] == "unicode_code_point"
        )
        assert locate({**body, "start": 150010}) == found
        checks.append("unique_tail_beyond150000_exact_unicode_metadata_only_under16384bytes")
        ambiguous = locate({"excerpt": "abcé🧠"}, 422)
        assert ambiguous["error"] == "AMBIGUOUS_EXCERPT"
        chosen = locate({"excerpt": "abcé🧠", "start": 14})
        assert chosen["start"] == 14 and chosen["end"] == 19
        overlapping = client.post(
            base + "/sources",
            headers=fixture.headers(),
            json={
                "title": "Occurrences chevauchantes",
                "location": f"synthetic://overlap/{uuid4()}",
                "content": "🧠aaaa",
                "allowed_subjects": ["alice", "reader"],
            },
        )
        assert overlapping.status_code == 201
        overlap_path = base + "/sources/" + overlapping.json()["id"] + "/locate"
        assert locate({"excerpt": "aaa"}, 422, target=overlap_path)["error"] == "AMBIGUOUS_EXCERPT"
        assert locate({"excerpt": "aaa", "start": 2}, target=overlap_path)["end"] == 5
        checks.append(
            "repetition_across_source_and_overlapping_matches_require_explicit_occurrence"
        )
        for bad in [
            {"excerpt": "absent"},
            {"excerpt": " "},
            {"excerpt": "x" * 200001},
            {"excerpt": "nul\0"},
            {**body, "start": 150011},
            {**body, "start": 2147483646},
            {**body, "start": -1},
            {**body, "extra": 1},
            {**body, "expected_hash": "bad"},
        ]:
            locate(bad, 422)
        locate({**body, "expected_hash": "0" * 64}, 409)
        assert client.post(path, json=body).status_code == 401
        locate(body, 404, actor="task-viewer")
        checks.append("bounds_empty_nonliteral_invalid_arguments_hash_and_current_acl_refused")
        maxtext = "🧠" * 199999 + "z"
        maxi = client.post(
            base + "/sources",
            headers=fixture.headers(),
            json={
                "title": "Extrait maximal",
                "location": f"synthetic://max-excerpt/{uuid4()}",
                "content": maxtext,
                "allowed_subjects": ["alice", "reader"],
            },
        )
        assert maxi.status_code == 201
        result = locate(
            {"excerpt": maxtext}, target=base + "/sources/" + maxi.json()["id"] + "/locate"
        )
        assert result["start"] == 0 and result["end"] == 200000
        checks.append("maximum200000_nonbmp_input_validated_without_returning_the_source_body")
        with db.begin() as tx:
            old = tx.execute(
                text(
                    "SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                state,
            ).scalar_one()
            tx.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                state,
            )
        try:
            locate(body, 404)
        finally:
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                    ),
                    {**state, "acl": json.dumps(old)},
                )
        assert locate(body) == found
        with ThreadPoolExecutor(max_workers=4) as pool:
            assert all(r == found for r in pool.map(lambda _: locate(body), range(4)))
        checks.append("revocation_restored_exactly_and_four_concurrent_reads_same_result")
        mcp = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_sources_locate",
                    "arguments": {
                        "path": {"domain": state["domain"], "source_id": state["source"]},
                        "body": body,
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200 and mcp["data"] == found
        assert client.get(base + "/version", headers=fixture.headers()).json() == before
        checks.append("mcp_exact_parity_no_knowledge_version_or_publication_change")
    db.dispose()
    (OUT / "source-locate-native-report.json").write_text(
        json.dumps(
            {
                "synthetic_only": True,
                "domain": state["domain"],
                "passed": len(checks),
                "checks": checks,
            },
            indent=2,
        )
    )
    print(json.dumps({"passed": len(checks), "checks": checks}))


if __name__ == "__main__":
    main()
