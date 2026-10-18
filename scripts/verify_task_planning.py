"""Synthetic task planning: rights, exact recovery, immutable evidence and ordering."""

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
    state = json.loads((OUT / "overview-native-report.json").read_text())
    assert state["synthetic_only"] is True
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
    state = {"tenant": state["tenant"], "domain": str(uuid4()), "synthetic_only": True}
    db = create_engine(url)
    params = {"t": state["tenant"], "d": state["domain"]}
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette planification des tâches')"
            ),
            params,
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
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {**params, "s": subject, "r": role},
            )
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

        def create(title):
            return req(
                "POST",
                "/tasks",
                {
                    "title": title,
                    "instructions": "Vérifier la règle synthétique.",
                    "criteria": "Conserver une preuve.",
                    "idempotency_key": str(uuid4()),
                },
            )["task_id"]

        ids = [create("Planification synthétique " + name) for name in ["basse", "haute", "future"]]
        path = f"/tasks/{ids[0]}"
        initial = req("GET", path)
        before = req("GET", "/version")
        assert (
            initial["priority"] == "normal"
            and initial["priority_reason"] == ""
            and initial["planning_allowed"]
        )
        body = {
            "expected_revision": 1,
            "priority": "high",
            "due_at": "2026-11-01T12:00:00Z",
            "reason": "Date explicite pour la recette.",
            "idempotency_key": str(uuid4()),
        }
        for actor in ["reader", "task-viewer", "task-agent", "outsider"]:
            req("POST", path + "/plan", body, actor, status=404 if actor == "outsider" else 403)
        bad = [
            {**body, "priority": "critical"},
            {**body, "reason": " "},
            {**body, "due_at": "nonsense"},
            {**body, "due_at": {}},
            {**body, "due_at": "+10000-01-01T00:00:00Z"},
            {k: v for k, v in body.items() if k != "due_at"},
        ]
        for b in bad:
            req("POST", path + "/plan", b, status=422)
        unchanged = {**body, "priority": "normal", "due_at": None}
        req("POST", path + "/plan", unchanged, status=409)
        checks.append(
            "current_coordinator_only_strict_required_nullable_deadline_and_noop_rejection"
        )
        receipt = req("POST", path + "/plan", body)
        assert req("POST", path + "/plan", body) == receipt
        current = req("GET", path)
        assert current["priority"] == "high" and current["due_at"] == "2026-11-01T12:00:00+00:00"
        for key in [
            "status",
            "assignee",
            "created_at",
            "offered_at",
            "accepted_at",
            "instructions",
            "criteria",
            "result_summary",
        ]:
            assert current[key] == initial[key]
        events = req("GET", path + "/events")["items"]
        assert len(events) == 2 and events[0]["planning"] is None and events[1]["action"] == "plan"
        assert (
            events[1]["planning"]["before"] == {"priority": "normal", "due_at": None}
            and events[1]["planning"]["after"]["priority"] == "high"
        )
        req("POST", path + "/plan", {**body, "reason": "Changed"}, status=409)
        checks.append(
            "exact_receipt_before_after_evidence_preserves_state_assignment_age_and_result"
        )
        race = {**body, "expected_revision": 2, "priority": "low", "due_at": None}

        def send(key):
            return client.post(
                base + path + "/plan",
                json={**race, "idempotency_key": key},
                headers=fixture.headers("task-manager"),
            ).status_code

        with ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(send, [str(uuid4()), str(uuid4())])) == [200, 409]
        assert req("GET", path)["revision"] == 3 and req("GET", path)["due_at"] is None
        assert (
            req("POST", path + "/plan", body) == receipt and req("GET", path)["priority"] == "low"
        )
        checks.append(
            "concurrent_revision_one_winner_clear_deadline_and_old_receipt_never_reapplies"
        )
        for tid, priority, due in [
            (ids[0], "low", "1900-01-01T00:00:00Z"),
            (ids[1], "high", "1900-01-01T00:00:00Z"),
            (ids[2], "high", "2099-01-01T00:00:00Z"),
        ]:
            rev = req("GET", f"/tasks/{tid}")["revision"]
            req(
                "POST",
                f"/tasks/{tid}/plan",
                {
                    "expected_revision": rev,
                    "priority": priority,
                    "due_at": due,
                    "reason": "Ordre explicite de recette.",
                    "idempotency_key": str(uuid4()),
                },
            )
        brief = req("GET", "/work-brief?scope=domain")
        assert [i["task"]["id"] for i in brief["items"]][:3] == [ids[1], ids[0], ids[2]]
        assert (
            brief["sort"]
            == "overdue_priority_review_offer_blocked_unassigned_progress_due_created_id"
        )
        checks.append("overdue_first_then_explicit_priority_bounded_brief")
        tid = ids[1]
        p2 = f"/tasks/{tid}"
        rev = req("GET", p2)["revision"]
        req(
            "POST",
            p2 + "/commands",
            {
                "action": "offer",
                "assignee": "reader",
                "reason": "Recette suivi de priorité",
                "expected_revision": rev,
                "idempotency_key": str(uuid4()),
            },
        )
        assigned = req("GET", p2, actor="reader")
        assert assigned["priority"] == "high" and not assigned["planning_allowed"]
        req(
            "POST", p2 + "/plan", {**body, "expected_revision": assigned["revision"]}, "reader", 403
        )
        notifications = req("GET", "/task-notifications")["items"]
        assert any(n["action"] == "plan" for n in notifications)
        rev = req("GET", path)["revision"]
        req(
            "POST",
            path + "/commands",
            {
                "action": "cancel",
                "reason": "Recette terminale",
                "expected_revision": rev,
                "idempotency_key": str(uuid4()),
            },
        )
        cancelled = req("GET", path)
        assert not cancelled["planning_allowed"]
        req(
            "POST",
            path + "/plan",
            {**body, "expected_revision": cancelled["revision"], "idempotency_key": str(uuid4())},
            status=409,
        )
        assert req("POST", path + "/plan", body) == receipt
        checks.append("assignee_read_only_internal_activity_terminal_block_and_exact_recovery")
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                ),
                params,
            )
        try:
            req("POST", path + "/plan", body, status=403)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_memberships SET role='corpus_manager' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                    ),
                    params,
                )
        p3 = f"/tasks/{ids[2]}"
        latest = req("GET", p3)
        mcpbody = {
            **body,
            "expected_revision": latest["revision"],
            "priority": "normal",
            "due_at": None,
            "idempotency_key": str(uuid4()),
        }
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
                    "name": "api_tasks_plan",
                    "arguments": {
                        "path": {"domain": state["domain"], "task_id": ids[2]},
                        "body": mcpbody,
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200 and req("POST", p3 + "/plan", mcpbody) == mcp["data"]
        assert req("GET", "/version") == before
        checks.append("revoked_role_blocks_recovery_http_mcp_exact_parity_no_publication")
        (OUT / "planning-native-report.json").write_text(
            json.dumps({**state, "tasks": ids, "checks": checks, "passed": len(checks)}, indent=2)
        )
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
