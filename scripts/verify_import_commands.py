"""Native bounded import commands on synthetic data; no provider or publication."""

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
    state = json.loads((OUT / "tasks-state.json").read_text())
    assert state["synthetic_only"] is True
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

        def req(method, path, body=None, actor="task-manager", status=200):
            response = client.request(
                method, base + path, headers=fixture.headers(actor), json=body
            )
            assert response.status_code == status, (
                method,
                path,
                status,
                response.status_code,
                response.json().get("error"),
            )
            return response.json()

        before = req("GET", "/version")
        collection = req(
            "POST",
            "/collections",
            {
                "name": "Recette imports commandés",
                "description": "Sources synthétiques locales, sans publication.",
                "allowed_subjects": ["task-manager", "alice"],
                "idempotency_key": str(uuid4()),
            },
            status=201,
        )
        payload = {
            "items": [
                {
                    "filename": name,
                    "content": "Texte synthétique de qualification des reprises.",
                    "allowed_subjects": ["task-manager"],
                }
                for name in ["premier.md", "echec.pdf", "dernier.txt"]
            ],
            "idempotency_key": str(uuid4()),
        }
        job = req("POST", f"/collections/{collection['id']}/imports", payload, status=202)
        ident = job["id"]
        path = f"/imports/{ident}"
        assert (
            req("POST", f"/collections/{collection['id']}/imports", payload, status=202)["id"]
            == ident
        )
        snap = req("GET", path + "/command-state")
        assert snap["allowed_actions"] == ["process", "cancel"]
        req("GET", path + "/command-state", actor="alice", status=404)
        checks.append("personal_create_replay_state_and_other_actor_denial")

        def body(action, snapshot=None, limit=1):
            return {
                "action": action,
                "expected_digest": (snapshot or req("GET", path + "/command-state"))["digest"],
                "limit": limit,
                "idempotency_key": str(uuid4()),
            }

        command = body("process", snap)
        receipt = req("POST", path + "/commands", command)
        assert receipt["affected_items"] == 1
        assert req("POST", path + "/commands", command) == receipt
        current = req("GET", path)
        assert [x["attempts"] for x in current["items"]] == [1, 0, 0]
        req("POST", path + "/commands", {**command, "limit": 2}, status=409)
        req("POST", path + "/commands", {**command, "idempotency_key": str(uuid4())}, status=409)
        checks.append("exact_receipt_replay_does_not_process_next_item")
        snap = req("GET", path + "/command-state")
        req("POST", path + "/process?limit=1")
        req("POST", path + "/commands", body("process", snap), status=409)
        retry = body("retry")
        reset = req("POST", path + "/commands", retry)
        assert reset["affected_items"] == 1
        failed = req("POST", path + "/commands", body("process"))
        assert failed["affected_items"] == 1
        assert req("POST", path + "/commands", retry) == reset
        assert req("GET", path)["items"][1]["status"] == "failed"
        checks.append("legacy_mutation_invalidates_snapshot_and_retry_is_not_repeated")
        snap = req("GET", path + "/command-state")
        inputs = [body("process", snap), body("cancel", snap)]

        def send(b):
            return client.post(
                base + path + "/commands", headers=fixture.headers("task-manager"), json=b
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(send, inputs))
        assert sorted(r.status_code for r in results) == [200, 409]
        checks.append("concurrent_commands_only_one_snapshot_wins")
        # A distinct pending job checks cancellation without deleting successes.
        other = req(
            "POST",
            f"/collections/{collection['id']}/imports",
            {**payload, "idempotency_key": str(uuid4())},
            status=202,
        )
        old_path = path
        path = f"/imports/{other['id']}"
        req("POST", path + "/commands", body("process"))
        cancel = body("cancel")
        stopped = req("POST", path + "/commands", cancel)
        assert stopped["status"] == "cancelled" and stopped["affected_items"] == 2
        assert req("POST", path + "/commands", cancel) == stopped
        assert req("GET", path)["items"][0]["status"] == "succeeded"
        assert req("GET", path + "/command-state")["allowed_actions"] == []
        req("POST", path + "/commands", body("retry"), status=409)
        checks.append("cancel_pending_only_preserves_success_and_has_no_resume")
        path = old_path
        with db.begin() as conn:
            conn.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        try:
            assert req("GET", path + "/command-state")["allowed_actions"] == []
            req("POST", path + "/commands", command, status=403)
        finally:
            with db.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_memberships SET role='corpus_manager' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                    ),
                    {"t": state["tenant"], "d": state["domain"]},
                )
        source = current["items"][0]["source_id"]
        with db.begin() as conn:
            acl = conn.execute(
                text(
                    "SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source},
            ).scalar_one()
            conn.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects=CAST(:revoked AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                ),
                {
                    "t": state["tenant"],
                    "d": state["domain"],
                    "s": source,
                    "revoked": json.dumps(["alice"]),
                },
            )
        try:
            req("GET", path + "/command-state", status=404)
            req("POST", path + "/commands", command, status=404)
        finally:
            with db.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:a AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    {"t": state["tenant"], "d": state["domain"], "s": source, "a": json.dumps(acl)},
                )
        checks.append("current_role_and_source_acl_guard_even_receipt_recovery")
        headers = {
            **fixture.headers("task-manager"),
            "Accept": "application/json, text/event-stream",
        }
        mcp = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_imports_command",
                    "arguments": {
                        "path": {"domain": state["domain"], "import_id": ident},
                        "body": command,
                    },
                },
            },
        ).json()
        assert mcp["result"]["structuredContent"] == {"http_status": 200, "data": receipt}, mcp
        assert req("GET", "/version") == before
        checks.append("mcp_http_identical_receipt_and_no_knowledge_publication")
        for table in ["cf_import_commands"]:
            with db.connect() as conn:
                flags = conn.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:name"
                    ),
                    {"name": table},
                ).one()
                assert all(flags)
        checks.append("receipt_table_forced_rls")
        (OUT / "import-browser-state.json").write_text(
            json.dumps(
                {
                    "synthetic_only": True,
                    "tenant": state["tenant"],
                    "domain": state["domain"],
                    "collection": collection["id"],
                    "import": ident,
                    "cancelled_import": other["id"],
                },
                indent=2,
            )
            + "\n"
        )
    report = {"synthetic_only": True, "checks": checks, "passed": len(checks), "total": 8}
    (OUT / "import-commands-native-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
