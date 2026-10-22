"""Private reference-question preparation HTTP/MCP; isolated synthetic fixtures."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = task_fixture()
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert (
        url.host == "127.0.0.1"
        and url.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and url.database.endswith("_test")
    )
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

        def req(method, path, body=None, actor="reader", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (path, status, r.status_code, r.json().get("error"))
            return r.json()

        version = req("GET", "/version")
        source = req(
            "POST",
            "/sources",
            {
                "title": "Référence de recette Unicode",
                "content": "Préface 🧠. La revue dure cinq jours. Fin.",
                "location": f"synthetic://reference/{uuid4()}",
                "allowed_subjects": ["alice", "reader", "task-manager"],
            },
            actor="alice",
            status=201,
        )
        content = {
            "theme": "Revue",
            "question": "Combien de jours dure la revue ?",
            "criteria": "Indiquer cinq jours et citer le passage exact.",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "excerpt": "La revue dure cinq jours.",
            "selection": {"start": 11, "end": 36},
        }
        ident = str(uuid4())
        path = "/reference-drafts/" + ident
        body = {"content": content, "expected_revision": 0, "idempotency_key": str(uuid4())}
        receipt = req("POST", path, body)
        assert receipt["revision"] == 1 and receipt["question_id"] == ident
        assert req("POST", path, body) == receipt
        saved = req("GET", path)
        assert (
            saved["content"] == content
            and saved["status"] == "draft"
            and saved["visibility"] == "personal"
        )
        req("GET", path, actor="alice", status=404)
        req("GET", path, actor="task-viewer", status=403)
        req("GET", path, actor="outsider", status=404)
        assert not any(
            x["id"] == ident for x in req("GET", "/reference-drafts", actor="alice")["items"]
        )
        checks.append("private_scope_role_unicode_proof_no_owner_override")
        for bad in [
            {**content, "excerpt": "cinq jours reformulés"},
            {**content, "question": ""},
            {**content, "criteria": "x" * 8001},
            {**content, "selection": {"start": 12, "end": 36}},
        ]:
            req(
                "POST",
                "/reference-drafts/" + str(uuid4()),
                {**body, "content": bad, "idempotency_key": str(uuid4())},
                status=422,
            )
        req(
            "POST",
            path,
            {
                **body,
                "content": {**content, "source_hash": "0" * 64},
                "idempotency_key": str(uuid4()),
            },
            status=409,
        )
        checks.append("strict_limits_exact_unicode_span_fingerprint")
        req("POST", path, {**body, "content": {**content, "theme": "Autre"}}, status=409)
        req("POST", path, {**body, "idempotency_key": str(uuid4())}, status=409)
        bodies = [
            {
                **body,
                "content": {**content, "theme": f"Concurrent {i}"},
                "expected_revision": 1,
                "idempotency_key": str(uuid4()),
            }
            for i in range(2)
        ]

        def race(b):
            return client.post(base + path, headers=fixture.headers("reader"), json=b).status_code

        with ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(race, bodies)) == [200, 409]
        assert req("POST", path, body) == receipt and req("GET", path)["revision"] == 2
        checks.append("cas_concurrency_key_conflict_old_receipt_no_overwrite")
        # ACL removal and restoration are confined to this new synthetic source.
        with db.begin() as tx:
            tx.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source["id"]},
            )
        req("GET", path, status=404)
        req("POST", path, body, status=404)
        assert not any(x["id"] == ident for x in req("GET", "/reference-drafts")["items"])
        with db.begin() as tx:
            tx.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source["id"]},
            )
        assert req("GET", path)["revision"] == 2
        checks.append("revocation_masks_read_list_replay_restoration")
        for n in range(20):
            req(
                "POST",
                "/reference-drafts/" + str(uuid4()),
                {
                    **body,
                    "content": {**content, "question": f"Question de pagination {n}"},
                    "idempotency_key": str(uuid4()),
                },
            )
        page = req("GET", "/reference-drafts?limit=20")
        seen = {x["id"] for x in page["items"]}
        assert len(seen) == 20 and page["next_after"]
        while page["next_after"]:
            page = req("GET", "/reference-drafts?limit=20&after=" + page["next_after"])
            ids = {x["id"] for x in page["items"]}
            assert not seen & ids
            seen |= ids
        assert ident in seen
        req("GET", "/reference-drafts?limit=21", status=422)
        req("GET", "/reference-drafts?subject=alice", status=422)
        checks.append("pagination_authorized_before_limit_no_subject_override")
        headers = {**fixture.headers("reader"), "Accept": "application/json, text/event-stream"}
        for n, (name, args) in enumerate(
            [
                (
                    "api_reference_drafts_read",
                    {"path": {"domain": state["domain"], "question": ident}},
                ),
                (
                    "api_reference_drafts_list",
                    {"path": {"domain": state["domain"]}, "query": {"limit": 20}},
                ),
                (
                    "api_reference_drafts_save",
                    {"path": {"domain": state["domain"], "question": ident}, "body": body},
                ),
            ]
        ):
            result = client.post(
                "/mcp",
                headers=headers,
                json={
                    "jsonrpc": "2.0",
                    "id": n + 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": args},
                },
            ).json()["result"]["structuredContent"]
            assert result["http_status"] == 200, result
        assert req("GET", "/version") == version
        checks.append("mcp_read_list_exact_replay_no_knowledge_version_change")
        report = {
            "synthetic_only": True,
            "domain": state["domain"],
            "source": source["id"],
            "question": ident,
            "passed": len(checks),
            "checks": checks,
        }
        (OUT / "reference-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
