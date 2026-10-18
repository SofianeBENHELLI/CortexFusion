"""Synthetic native proof for versioned task files and private notification reads."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = task_fixture()
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"

        def req(method, path, status=200, actor="alice", body=None):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (
                method,
                path,
                status,
                r.status_code,
                r.json().get("error"),
            )
            return r.json()

        def create(title):
            return req(
                "POST",
                "/tasks",
                body={
                    "title": title,
                    "instructions": "Consigne synthétique",
                    "criteria": "Compte rendu de recette",
                    "due_at": "2026-11-01T12:00:00Z",
                    "idempotency_key": str(uuid4()),
                },
            )

        made = [create("Pagination synthétique " + str(n)) for n in range(5)]
        first = req("GET", "/tasks?limit=2&active_only=true")
        assert first["total"] >= 5 and first["has_more"] and first["scope"] == "domain"
        items = []
        page = first
        while True:
            items += page["items"]
            assert page["as_of"] == first["as_of"] and page["work_version"] == first["work_version"]
            if not page["next_after"]:
                break
            page = req("GET", "/tasks?limit=2&active_only=true&after=" + page["next_after"])
        assert len(items) == first["total"] == len({x["id"] for x in items})
        assert [(x["created_at"], x["id"]) for x in items] == sorted(
            (x["created_at"], x["id"]) for x in items
        )
        assert all(x["status"] not in ["completed", "cancelled"] for x in items)
        checks.append("stable_chronological_traversal_exact_scope_total")
        cursor = first["next_after"]
        for suffix, actor in [
            ("&active_only=false", "alice"),
            ("&active_only=true", "task-manager"),
            ("&active_only=true&assigned_to_me=true", "alice"),
        ]:
            req("GET", "/tasks?limit=2&after=" + cursor + suffix, 409, actor)
        req("GET", "/tasks?limit=3&active_only=true&after=" + cursor, 409)
        checks.append("cursor_bound_to_actor_filters_and_page_size")
        create("Concurrent insertion synthétique")
        req("GET", "/tasks?limit=2&active_only=true&after=" + cursor, 409)
        checks.append("concurrent_write_invalidates_traversal_instead_of_skipping")
        fresh = req("GET", "/tasks?limit=2")
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_memberships SET role=role WHERE tenant_id=:t AND domain_id=:d AND subject='task-peer'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req("GET", "/tasks?limit=2&after=" + fresh["next_after"], 409)
        checks.append("membership_epoch_invalidates_even_after_same_role_update")
        expired = str(uuid4())
        with db.begin() as c:
            c.execute(
                text(
                    "INSERT INTO cf_workspace_cursors SELECT tenant_id,domain_id,subject,:new,kind,fingerprint,position,work_revision,membership_revision,as_of,clock_timestamp()-interval '1 second' FROM cf_workspace_cursors WHERE tenant_id=:t AND id=:id"
                ),
                {"new": expired, "t": state["tenant"], "id": fresh["next_after"]},
            )
        req("GET", "/tasks?limit=2&after=" + expired, 409)
        checks.append("expired_cursor_requires_restart")
        ident = made[0]["task_id"]
        offered = req(
            "POST",
            f"/tasks/{ident}/commands",
            body={
                "action": "offer",
                "expected_revision": 1,
                "assignee": "reader",
                "reason": "Revue synthétique",
                "idempotency_key": str(uuid4()),
            },
        )
        mine = req("GET", "/tasks?assigned_to_me=true", actor="reader")
        assert mine["scope"] == "assigned" and all(x["assignee"] == "reader" for x in mine["items"])
        notes = req("GET", "/task-notifications?limit=2", actor="reader")
        collected = []
        page = notes
        while True:
            collected += page["items"]
            if not page["next_after"]:
                break
            page = req(
                "GET", "/task-notifications?limit=2&after=" + page["next_after"], actor="reader"
            )
        assert len(collected) == notes["total"] == len({x["event_id"] for x in collected})
        notification = next(x for x in collected if x["event_id"] == offered["event_id"])
        assert notification["task_id"] == ident and notification["read_at"] is None
        assert all("instructions" not in x and "reason" not in x for x in collected)
        checks.append("personal_notifications_current_acl_bounded_metadata")
        npath = "/task-notifications/" + offered["event_id"] + "/read"
        key = {"idempotency_key": str(uuid4())}
        before = req("GET", "/task-notifications", actor="alice")["unread"]
        read = req("POST", npath, actor="reader", body=key)
        assert req("POST", npath, actor="reader", body=key) == read
        assert req("GET", "/task-notifications", actor="reader")["unread"] == notes["unread"] - 1
        assert req("GET", "/task-notifications", actor="alice")["unread"] == before
        if notes["next_after"]:
            req("GET", "/task-notifications?limit=2&after=" + notes["next_after"], 409, "reader")
        req("POST", npath, 404, "task-peer", key)
        checks.append("read_receipt_idempotent_personal_and_invalidates_own_cursor")
        req(
            "POST",
            f"/tasks/{ident}/commands",
            actor="reader",
            body={
                "action": "decline",
                "expected_revision": 2,
                "reason": "Indisponible pour cette recette",
                "idempotency_key": str(uuid4()),
            },
        )
        hidden = req("GET", "/task-notifications", actor="reader")
        assert all(x["task_id"] != ident for x in hidden["items"])
        req("POST", npath, 404, "reader", key)
        checks.append("assignment_loss_hides_notification_and_denies_old_acknowledgement")
        for actor in ["task-viewer", "task-agent", "outsider"]:
            req("GET", "/task-notifications", 404, actor)
        checks.append("notifications_role_boundary")

        def rpc(name, args):
            r = client.post(
                "/mcp/",
                headers={
                    **fixture.headers("alice"),
                    "Accept": "application/json, text/event-stream",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": args},
                },
            )
            assert r.status_code == 200
            return r.json()["result"]["structuredContent"]

        result = rpc(
            "api_task_notifications_list",
            {"path": {"domain": state["domain"]}, "query": {"limit": 2}},
        )
        assert result["http_status"] == 200 and result["data"]["scope"] == "personal"
        result = rpc(
            "api_tasks_list",
            {
                "path": {"domain": state["domain"]},
                "query": {"active_only": True, "assigned_to_me": True},
            },
        )
        assert result["http_status"] == 200 and result["data"]["scope"] == "assigned"
        checks.append("mcp_filters_and_notification_contract")
        assert req("GET", "/version")["published_version"] == 0
        checks.append("coordination_preserves_unpublished_knowledge")
    db.dispose()
    report = {
        "status": "passed",
        "checks": checks,
        "denominator": len(checks),
        "synthetic_only": True,
        "ingestion": False,
        "external_notifications": False,
    }
    (OUT / "tasks-read-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
