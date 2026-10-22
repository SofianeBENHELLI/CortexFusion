"""Qualify factual work briefs against persistent synthetic tasks, no private ingestion."""

import json
import os
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

        def req(method, path, actor="alice", body=None, status=200):
            response = client.request(
                method, base + path, headers=fixture.headers(actor), json=body
            )
            assert response.status_code == status, (
                path,
                status,
                response.status_code,
                response.json().get("error"),
            )
            return response.json()

        before = req("GET", "/version")
        for actor in ["task-agent", "task-viewer", "outsider"]:
            req("GET", "/work-brief", actor, status=404)
        req("GET", "/work-brief?scope=domain", "reader", status=403)
        for suffix in ["?scope=invalid", "?limit=100", "?scope=assigned&scope=domain"]:
            req("GET", "/work-brief" + suffix, status=422)
        checks.append("roles_explicit_scope_and_strict_query")
        created = []
        for n in range(7):
            task = req(
                "POST",
                "/tasks",
                body={
                    "title": f"Brief synthétique échéance {n}",
                    "instructions": "Contrôler le travail présenté, sans publication.",
                    "criteria": "Vérification traçable.",
                    "due_at": f"2000-01-0{n + 1}T12:00:00Z",
                    "idempotency_key": str(uuid4()),
                },
            )["task_id"]
            req(
                "POST",
                f"/tasks/{task}/commands",
                body={
                    "action": "offer",
                    "assignee": "reader",
                    "reason": "Recette du brief",
                    "expected_revision": 1,
                    "idempotency_key": str(uuid4()),
                },
            )
            created.append(task)

        def compare(actor, domain_scope=False):
            result = req("GET", "/work-brief" + ("?scope=domain" if domain_scope else ""), actor)
            with db.connect() as c:
                rows = (
                    c.execute(
                        text(
                            "SELECT id,status,assignee,due_at FROM cf_work_tasks WHERE tenant_id=:t AND domain_id=:d AND (:all OR assignee=:s) AND status NOT IN ('completed','cancelled')"
                        ),
                        {
                            "t": state["tenant"],
                            "d": state["domain"],
                            "all": domain_scope,
                            "s": actor,
                        },
                    )
                    .mappings()
                    .all()
                )
            assert result["counts"]["active"] == len(rows)
            for status in ["offered", "review", "blocked", "unassigned", "in_progress"]:
                assert result["counts"][status] == sum(r["status"] == status for r in rows)
            assert len(result["items"]) == min(5, len(rows)) and result["has_more"] == (
                len(rows) > 5
            )
            assert all(i["task"]["id"] in {r["id"] for r in rows} for i in result["items"])
            return result

        personal = compare("reader")
        assert [i["task"]["id"] for i in personal["items"]] == created[:5]
        assert all(
            i["overdue"] and "accept" in i["task"]["allowed_actions"] for i in personal["items"]
        )
        compare("task-manager", True)
        checks.append("exact_authorized_counts_top_five_and_deterministic_overdue_sort")
        empty_actor = "brief-empty"
        with db.begin() as c:
            c.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,'contributor') ON CONFLICT DO NOTHING"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": empty_actor},
            )
        empty = compare(empty_actor)
        assert empty["counts"]["active"] == 0 and empty["items"] == [] and not empty["has_more"]
        checks.append("empty_personal_scope_not_domain_completeness")
        task = created[0]
        req(
            "POST",
            f"/tasks/{task}/commands",
            "reader",
            {
                "action": "decline",
                "reason": "Recette de relecture du brief",
                "expected_revision": 2,
                "idempotency_key": str(uuid4()),
            },
        )
        after = compare("reader")
        assert (
            after["counts"]["active"] == personal["counts"]["active"] - 1
            and after["work_version"] > personal["work_version"]
        )
        assert task not in [i["task"]["id"] for i in after["items"]]
        checks.append("current_assignment_and_work_revision_after_transition")
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:t AND domain_id=:d AND subject=:s"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": empty_actor},
            )
        try:
            req("GET", "/work-brief", empty_actor, status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject=:s"
                    ),
                    {"t": state["tenant"], "d": state["domain"], "s": empty_actor},
                )
        assert (
            req("GET", "/work-brief", empty_actor)["permissions_version"]
            > empty["permissions_version"]
        )
        checks.append("current_membership_revocation_and_restoration_synthetic_only")
        headers = {**fixture.headers("reader"), "accept": "application/json, text/event-stream"}
        mcp = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_tasks_brief",
                    "arguments": {
                        "path": {"domain": state["domain"]},
                        "query": {"scope": "assigned"},
                    },
                },
            },
        ).json()
        payload = mcp["result"]["structuredContent"]
        assert payload["http_status"] == 200
        current = compare("reader")
        assert (
            payload["data"]["items"] == current["items"]
            and payload["data"]["counts"] == current["counts"]
        )
        assert req("GET", "/version") == before
        checks.append("same_mcp_http_brief_and_no_knowledge_publication")
        report = {
            "synthetic_only": True,
            "checks": checks,
            "passed": len(checks),
            "created_tasks": created,
            "empty_actor": empty_actor,
            "domain": state["domain"],
        }
        (OUT / "brief-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
