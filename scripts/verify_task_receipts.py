"""Synthetic personal receipt readback: no replay, actor isolation, current ACL masking."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT


def main():
    previous = json.loads((OUT / "planning-native-report.json").read_text())
    assert previous["synthetic_only"]
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert u.host == "127.0.0.1" and u.port == 55432 and u.database.endswith("_test")
    state = {"tenant": previous["tenant"], "domain": str(uuid4()), "synthetic_only": True}
    db = create_engine(u)
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Recette reçus personnels')"
            ),
            state,
        )
        for subject, role in [
            ("alice", "owner"),
            ("task-manager", "corpus_manager"),
            ("reader", "contributor"),
            ("task-viewer", "viewer"),
            ("task-agent", "agent"),
        ]:
            c.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:s,:r)"
                ),
                {**state, "s": subject, "r": role},
            )
    f = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
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
            r = client.request(method, base + path, headers=f.headers(actor), json=body)
            assert r.status_code == status, (path, status, r.status_code, r.json().get("error"))
            return r.json()

        before = req("GET", "/version")
        for actor in ["task-viewer", "task-agent", "outsider"]:
            req("GET", "/task-command-receipts", actor=actor, status=404)
        for query in ["?limit=0", "?limit=51", "?unknown=1", "?limit=1&limit=2"]:
            req("GET", "/task-command-receipts" + query, status=422)
        empty = req("GET", "/task-command-receipts")
        assert empty["items"] == [] and empty["total"] == 0
        checks.append("eligible_current_role_strict_query_and_exact_empty_scope")
        keys = []
        ids = []
        for n in range(5):
            k = str(uuid4())
            keys.append(k)
            ids.append(
                req(
                    "POST",
                    "/tasks",
                    {
                        "title": f"Reçu synthétique {n}",
                        "instructions": "Instruction synthétique privée",
                        "criteria": "Critère synthétique privé",
                        "idempotency_key": k,
                    },
                )["task_id"]
            )
        first = req("GET", "/task-command-receipts?limit=2")
        assert first["total"] == 5 and first["has_more"] and len(first["items"]) == 2
        all_rows = first["items"]
        page = first
        while page["next_after"]:
            page = req("GET", "/task-command-receipts?limit=2&after=" + page["next_after"])
            all_rows += page["items"]
        assert [r["command_id"] for r in all_rows] == list(reversed(keys))
        assert len({r["receipt"]["event_id"] for r in all_rows}) == 5
        checks.append("stable_descending_pagination_complete_denominator_no_duplicate")
        record = req("GET", "/task-command-receipts/" + keys[0])
        assert record["receipt"]["revision"] == 1 and record["task_title"] == "Reçu synthétique 0"
        for actor in ["reader", "alice"]:
            assert req("GET", "/task-command-receipts", actor=actor)["total"] == 0
            req("GET", "/task-command-receipts/" + keys[0], actor=actor, status=404)
        other = Fixture(str(uuid4()), {"identity": (KEYS / "identity-private.pem").read_bytes()})
        assert (
            client.get(
                base + "/task-command-receipts/" + keys[0], headers=other.headers("task-manager")
            ).status_code
            == 404
        )
        req(
            "GET",
            "/task-command-receipts?limit=2&after=" + first["next_after"],
            actor="alice",
            status=409,
        )
        req("GET", "/task-command-receipts/" + str(uuid4()), status=404)
        assert all(
            word not in json.dumps(all_rows)
            for word in [
                "Instruction synthétique privée",
                "Critère synthétique privé",
                "request_hash",
                "result_summary",
                "reason",
            ]
        )
        checks.append("own_receipts_only_even_owner_no_payload_or_unknown_existence")
        offer = req(
            "POST",
            f"/tasks/{ids[0]}/commands",
            {
                "action": "offer",
                "expected_revision": 1,
                "assignee": "reader",
                "reason": "Revue synthétique",
                "idempotency_key": str(uuid4()),
            },
        )
        decline_key = str(uuid4())
        decline = req(
            "POST",
            f"/tasks/{ids[0]}/commands",
            {
                "action": "decline",
                "expected_revision": offer["revision"],
                "reason": "Indisponibilité synthétique",
                "idempotency_key": decline_key,
            },
            actor="reader",
        )
        own = req("GET", "/task-command-receipts/" + decline_key, actor="reader")
        assert (
            own["receipt"] == decline
            and own["task_title"] is None
            and own["current_status"] is None
            and own["current_revision"] is None
        )
        assert req("GET", "/task-command-receipts", actor="reader")["total"] == 1
        req("GET", f"/tasks/{ids[0]}", actor="reader", status=404)
        changed = req("GET", "/task-command-receipts/" + keys[0])
        assert changed["receipt"] == record["receipt"] and changed["current_revision"] == 3
        checks.append(
            "declined_assignment_retains_content_free_receipt_not_task_access_current_vs_recorded"
        )
        req("GET", "/task-command-receipts?limit=2&after=" + first["next_after"], status=409)
        role_params = {**state, "s": "reader"}
        try:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:s"
                    ),
                    role_params,
                )
            req("GET", "/task-command-receipts/" + decline_key, actor="reader", status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:s"
                    ),
                    role_params,
                )
        checks.append("changed_work_invalidates_cursor_revoked_role_blocks_receipt")
        http = req("GET", "/task-command-receipts/" + decline_key, actor="reader")
        r = client.post(
            "/mcp",
            headers={**f.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_task_receipts_read",
                    "arguments": {"path": {"domain": state["domain"], "command_id": decline_key}},
                },
            },
        )
        assert r.status_code == 200, r.text[:150]
        result = r.json()["result"]["structuredContent"]
        assert result["http_status"] == 200 and result["data"] == http
        assert req("GET", "/version") == before
        checks.append("mcp_http_readback_parity_no_reexecution_or_knowledge_mutation")
        state.update(
            tasks=ids, commands=keys, decline_command=decline_key, checks=checks, passed=len(checks)
        )
    (OUT / "receipts-native-report.json").write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps({"passed": len(checks), "checks": checks}))


if __name__ == "__main__":
    main()
