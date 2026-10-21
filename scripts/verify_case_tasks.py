"""Case/task reference acceptance on synthetic fixture only, without content transfer."""

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
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert (
        u.host == "127.0.0.1"
        and u.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and u.database.endswith("_test")
    )
    db = create_engine(u)
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
            r = client.request(method, base + path, json=body, headers=fixture.headers(actor))
            assert r.status_code == status, (path, status, r.status_code, r.json().get("error"))
            return r.json()

        def share():
            content = {
                "title": "Dossier synthétique à traiter",
                "excerpt": "Extrait réservé au coordinateur, jamais copié dans la tâche.",
                "target": "delivered_answer",
                "recipients": ["task-manager"],
                "policy_version": "named-excerpt-v1",
            }
            prep = req("POST", "/shared-cases/prepare", content, actor="task-viewer")
            return req(
                "POST",
                "/shared-cases/share",
                {
                    "content": content,
                    "preparation_id": prep["preparation_id"],
                    "idempotency_key": str(uuid4()),
                },
                actor="task-viewer",
            )["case_id"]

        def task(title="Vérification indépendante"):
            return req(
                "POST",
                "/tasks",
                {
                    "title": title,
                    "instructions": "Examiner la règle synthétique disponible dans les sources autorisées.",
                    "criteria": "Avis justifié avec provenance.",
                    "idempotency_key": str(uuid4()),
                },
            )["task_id"]

        cid = share()
        tid = task()
        path = f"/shared-cases/{cid}/tasks"
        before = req("GET", "/version")

        def body(action="link", target=tid):
            return {
                "action": action,
                "task_id": target,
                "expected_case_revision": req("GET", f"/shared-cases/{cid}")["revision"],
                "expected_task_revision": req("GET", f"/tasks/{target}")["revision"],
                "idempotency_key": str(uuid4()),
            }

        b = body()
        saved = req("POST", path, b)
        assert req("POST", path, b) == saved
        refs = req("GET", path)
        assert refs["linked_count"] == 1 and refs["items"][0]["task_id"] == tid
        author = req("GET", path, actor="task-viewer")
        assert author["items"] == [] and author["linked_count"] == 1 and not author["can_link"]
        assert tid not in json.dumps(author) and "Vérification indépendante" not in json.dumps(
            author
        )
        req("GET", path, actor="alice", status=404)
        req("POST", path, b, actor="reader", status=403)
        req("POST", path, b, actor="alice", status=404)
        req("GET", path, actor="task-agent", status=404)
        req("GET", path, actor="outsider", status=404)
        checks.append("named_recipient_only_declarant_count_no_internal_task_data")
        original = req("GET", f"/tasks/{tid}")
        assert (
            original["revision"] == 1
            and original["instructions"]
            == "Examiner la règle synthétique disponible dans les sources autorisées."
        )
        req("POST", path, {**b, "action": "unlink"}, status=409)
        req("POST", path, body(), status=409)
        unlink = body("unlink")
        cleared = req("POST", path, unlink)
        assert req("GET", path)["linked_count"] == 0
        assert req("POST", path, b) == saved and req("GET", path)["linked_count"] == 0
        assert req("POST", path, unlink) == cleared
        race = body()

        def attempt(k):
            return client.post(
                base + path,
                headers=fixture.headers("task-manager"),
                json={**race, "idempotency_key": k},
            ).status_code

        with ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(attempt, [str(uuid4()), str(uuid4())])) == [200, 409]
        assert req("GET", path)["linked_count"] == 1
        checks.append("reversible_reference_exact_receipts_race_no_task_mutation")
        req(
            "POST",
            f"/tasks/{tid}/commands",
            {
                "action": "offer",
                "expected_revision": 1,
                "assignee": "task-peer",
                "reason": "Avis autonome synthétique",
                "idempotency_key": str(uuid4()),
            },
        )
        req("GET", f"/tasks/{tid}", actor="task-peer")
        req("GET", f"/shared-cases/{cid}", actor="task-peer", status=404)
        req("GET", path, actor="task-peer", status=404)
        stale = body("unlink")
        stale["expected_task_revision"] = 1
        req("POST", path, stale, status=409)
        req("POST", path, {**body("unlink"), "excerpt": "must never copy"}, status=422)
        checks.append("assignment_does_not_grant_case_access_revisions_strict_input")
        # Reference limits are mutation limits, not a silent read truncation.
        extra = [task(f"Tâche de capacité synthétique {i + 1}") for i in range(20)]
        for target in extra[:19]:
            req("POST", path, body(target=target))
        req("POST", path, body(target=extra[-1]), status=409)
        refs = req("GET", path)
        assert refs["linked_count"] == len(refs["items"]) == 20
        req("POST", path, body("unlink", extra[0]))
        req("POST", path, body(target=extra[-1]))
        checks.append("twenty_active_references_explicit_limit_unlink_releases_slot")
        current = req("GET", f"/shared-cases/{cid}")
        req(
            "POST",
            f"/shared-cases/{cid}/commands",
            {
                "action": "close_without_change",
                "expected_revision": current["revision"],
                "public_conclusion": "Clôture synthétique sans changement du savoir.",
                "idempotency_key": str(uuid4()),
            },
        )
        req("POST", path, body(target=extra[0]), status=409)
        remove = body("unlink", extra[1])
        receipt = req("POST", path, remove)
        assert req("GET", f"/shared-cases/{cid}")["status"] == "closed_without_change"
        mcp = client.post(
            "/mcp",
            headers={
                **fixture.headers("task-manager"),
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_case_tasks_command",
                    "arguments": {
                        "path": {"domain": state["domain"], "case_id": cid},
                        "body": remove,
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp == {"http_status": 200, "data": receipt}
        mcpread = client.post(
            "/mcp",
            headers={
                **fixture.headers("task-viewer"),
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "api_case_tasks_list",
                    "arguments": {"path": {"domain": state["domain"], "case_id": cid}},
                },
            },
        ).json()["result"]["structuredContent"]
        assert (
            mcpread["http_status"] == 200
            and mcpread["data"]["items"] == []
            and mcpread["data"]["linked_count"] == 19
        )
        checks.append("closed_case_cannot_link_unlink_allowed_http_mcp_parity")
        revision = req("GET", f"/shared-cases/{cid}", actor="task-viewer")["revision"]
        req(
            "POST",
            f"/shared-cases/{cid}/commands",
            {"action": "withdraw", "expected_revision": revision, "idempotency_key": str(uuid4())},
            actor="task-viewer",
        )
        req("GET", path, status=404)
        req("POST", path, remove, status=404)
        assert req("GET", f"/tasks/{tid}")["revision"] == 2
        assert req("GET", path, actor="task-viewer")["linked_count"] == 19
        assert req("GET", "/version") == before
        with db.begin() as c:
            c.execute(text("SET LOCAL ROLE cortex_app"))
            c.execute(text("SELECT set_config('cortex.tenant',:t,true)"), {"t": str(uuid4())})
            assert c.execute(text("SELECT count(*) FROM cf_case_tasks")).scalar_one() == 0
        checks.append("withdrawal_masks_recovery_rls_knowledge_unchanged")
        with db.begin() as c:
            events = c.execute(
                text(
                    "SELECT task_id,action FROM cf_case_events WHERE tenant_id=:t AND domain_id=:d AND case_id=:c AND action IN ('link_task','unlink_task')"
                ),
                {"t": state["tenant"], "d": state["domain"], "c": cid},
            ).all()
            assert events and all(e.task_id for e in events)
            assert any(e.task_id == tid and e.action == "unlink_task" for e in events)
        public_history = req("GET", f"/shared-cases/{cid}/events", actor="task-viewer")
        assert all("task_id" not in e for e in public_history["items"])
        checks.append("immutable_event_task_targets_kept_out_of_public_history")
        # Fresh opt-in fixture for Chrome, no association yet.
        browser_case = share()
        browser_task = task("Vérifier le délai de revue synthétique")
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "case-tasks-native-report.json").write_text(
            json.dumps(
                {
                    "checks": checks,
                    "passed": len(checks),
                    "case_id": browser_case,
                    "task_id": browser_task,
                    "withdrawn_case_id": cid,
                },
                indent=2,
            )
            + "\n"
        )
        print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
