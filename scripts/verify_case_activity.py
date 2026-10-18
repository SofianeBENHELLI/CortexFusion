"""Exercise named case inbox and viewer MCP without exposing personal origins."""

import json
import os
from uuid import uuid4
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    s = {**task_fixture(), "domain": str(uuid4())}
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert u.host == "127.0.0.1" and u.port == 55432 and u.database.endswith("_test")
    db = create_engine(u)
    with db.begin() as t:
        t.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Suivi des partages synthétiques')"
            ),
            s,
        )
        for actor, role in [
            ("alice", "owner"),
            ("task-manager", "corpus_manager"),
            ("reader", "contributor"),
            ("task-viewer", "viewer"),
            ("task-agent", "agent"),
        ]:
            t.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:actor,:role)"
                ),
                {**s, "actor": actor, "role": role},
            )
    f = Fixture(s["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
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
        base = f"/v1/domains/{s['domain']}"

        def req(method, path, body=None, actor="alice", status=200):
            r = client.request(method, base + path, headers=f.headers(actor), json=body)
            assert r.status_code == status, (path, r.status_code, r.text[:180])
            return r.json()

        def inbox(actor="alice", query=""):
            return req("GET", "/work-activity" + query, actor=actor)

        def share(actor, title):
            content = {
                "title": title,
                "excerpt": "Extrait explicitement partagé, sans copie de conversation.",
                "target": "delivered_answer",
                "recipients": ["alice"],
                "policy_version": "named-excerpt-v1",
            }
            p = req("POST", "/shared-cases/prepare", content, actor)
            return req(
                "POST",
                "/shared-cases/share",
                {
                    "content": content,
                    "preparation_id": p["preparation_id"],
                    "idempotency_key": str(uuid4()),
                },
                actor,
            )

        def command(case, rev, action, actor="alice", **kw):
            return req(
                "POST",
                f"/shared-cases/{case}/commands",
                {"action": action, "expected_revision": rev, "idempotency_key": str(uuid4()), **kw},
                actor,
            )

        before = req("GET", "/version")
        created = share("task-viewer", "Délai remonté par le lecteur")
        s["case"] = created["case_id"]
        second = share("reader", "Partage à retirer")
        s["withdrawn_case"] = second["case_id"]
        events = inbox()
        assert events["total"] == events["unread"] == 2
        assert all(
            n["kind"] == "shared_case" and n["action"] == "share" and n["actor"] is None
            for n in events["items"]
        )
        assert (
            inbox("task-viewer")["total"]
            == inbox("reader")["total"]
            == inbox("task-manager")["total"]
            == 0
        )
        req("GET", "/work-activity", actor="task-agent", status=403)
        assert (
            "work_activity"
            in next(
                x
                for x in client.get("/v1/me", headers=f.headers("task-viewer")).json()["domains"]
                if x["id"] == s["domain"]
            )["capabilities"]
        )
        checks.append(
            "named coordinator receives only incoming shares; other manager and authors do not receive their own events; viewer capability without agent access"
        )
        task = req(
            "POST",
            "/tasks",
            {
                "title": "Tâche du suivi",
                "instructions": "Vérifier le délai",
                "criteria": "Donner une preuve",
                "idempotency_key": str(uuid4()),
            },
        )
        req(
            "POST",
            f"/tasks/{task['task_id']}/commands",
            {
                "action": "offer",
                "expected_revision": 1,
                "assignee": "reader",
                "reason": "Recette",
                "idempotency_key": str(uuid4()),
            },
        )
        # A task notification from a former contributor must disappear after viewer downgrade.
        assert any(n["kind"] == "task" for n in inbox("reader")["items"])
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:tenant AND domain_id=:domain AND subject='reader'"
                ),
                s,
            )
        assert inbox("reader")["total"] == 0
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:tenant AND domain_id=:domain AND subject='reader'"
                ),
                s,
            )
        checks.append(
            "viewer downgrade hides existing task notifications without granting other work families"
        )
        q = command(s["case"], 1, "qualify", qualification="unclear")
        close = command(
            s["case"],
            q["revision"],
            "close_without_change",
            public_conclusion="Le délai publié reste inchangé ; aucune modification nécessaire dans cette recette.",
        )
        v = inbox("task-viewer")
        assert v["total"] == v["unread"] == 2
        assert {n["action"] for n in v["items"]} == {"qualify", "close_without_change"}
        assert all(
            n["current_status"] == "closed_without_change" and n["actor"] is None
            for n in v["items"]
        )
        forbidden = {
            "excerpt",
            "personal_signal_id",
            "public_conclusion",
            "recipients",
            "report",
            "source_id",
            "note",
        }
        assert all(not forbidden.intersection(n) for n in v["items"])
        assert req("GET", f"/shared-cases/{s['case']}", actor="task-viewer")[
            "public_conclusion"
        ].startswith("Le délai publié")
        checks.append(
            "viewer receives qualification and conclusion events, reads conclusion from authorized case, no private origin or copied excerpt in inbox"
        )
        cursor = inbox("task-viewer", "?limit=1")["next_after"]
        n = v["items"][0]
        b = {"kind": "shared_case", "idempotency_key": str(uuid4())}
        path = f"/work-activity/{n['event_id']}/read"
        snap = req("GET", f"/shared-cases/{s['case']}", actor="task-viewer")
        journal = req("GET", f"/shared-cases/{s['case']}/events", actor="task-viewer")
        receipt = req("POST", path, b, actor="task-viewer")
        assert req("POST", path, b, actor="task-viewer") == receipt
        assert req("GET", f"/shared-cases/{s['case']}", actor="task-viewer") == snap
        assert (
            req("GET", f"/shared-cases/{s['case']}/events", actor="task-viewer")["items"]
            == journal["items"]
        )
        assert inbox("task-viewer")["unread"] == 1
        req("GET", "/work-activity?limit=1&after=" + cursor, actor="task-viewer", status=409)
        req("POST", path, b, actor="reader", status=404)
        checks.append(
            "viewer read marker is idempotent and personal, stale cursor refused, case and history unchanged"
        )
        command(s["withdrawn_case"], 1, "withdraw", actor="reader")
        hidden = [n for n in inbox()["items"] if n["target_id"] == s["withdrawn_case"]]
        assert len(hidden) == 2 and all(
            n["title"] is None and n["actor"] is None and not n["content_available"] for n in hidden
        )
        snapshot = inbox(query="?limit=1")
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:tenant AND domain_id=:domain AND subject='alice'"
                ),
                s,
            )
        assert all(n["kind"] != "shared_case" for n in inbox()["items"])
        req("GET", "/work-activity?limit=1&after=" + snapshot["next_after"], status=409)
        req(
            "POST",
            f"/work-activity/{hidden[0]['event_id']}/read",
            {"kind": "shared_case", "idempotency_key": str(uuid4())},
            status=404,
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='owner' WHERE tenant_id=:tenant AND domain_id=:domain AND subject='alice'"
                ),
                s,
            )
        checks.append(
            "withdrawal masks prior incoming title; losing manager role removes recipient events and invalidates cursor; roles restored exactly"
        )

        def mcp(name, args):
            r = client.post(
                "/mcp",
                headers={
                    **f.headers("task-viewer"),
                    "Accept": "application/json, text/event-stream",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": args},
                },
            )
            return r.json()["result"]["structuredContent"]

        r = mcp("api_work_activity_list", {"path": {"domain": s["domain"]}})
        assert r["http_status"] == 200 and r["data"]["items"] == inbox("task-viewer")["items"]
        r = mcp(
            "api_work_activity_read",
            {"path": {"domain": s["domain"], "event": n["event_id"]}, "body": b},
        )
        assert r["http_status"] == 200 and r["data"] == receipt
        assert req("GET", "/version") == before
        checks.append(
            "viewer MCP list/read parity without knowledge mutation or external chatbot/provider"
        )
    (OUT / "case-activity-native-report.json").write_text(
        json.dumps({"fixture": s, "checks": checks, "count": len(checks)}, indent=2)
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
