"""Read-only operational home, synthetic domain only; real API writes seed fixtures."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    original = task_fixture()
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert u.host == "127.0.0.1" and u.port == 55432 and u.database.endswith("_test")
    db = create_engine(u)
    state = {"tenant": original["tenant"], "domain": str(uuid4()), "synthetic_only": True}
    params = {"t": state["tenant"], "d": state["domain"]}
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette accueil opérationnel')"
            ),
            params,
        )
        for actor, role in [
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
                {**params, "s": actor, "r": role},
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

        def overview(actor="task-manager", scope="assigned"):
            return req("GET", "/work-overview?scope=" + scope, actor=actor)

        before = req("GET", "/version")
        for a in ["outsider", "task-agent"]:
            req("GET", "/work-overview", actor=a, status=404)
        for a in ["reader", "task-viewer"]:
            req("GET", "/work-overview?scope=domain", actor=a, status=403)
        for q in ["scope=invalid", "limit=100", "scope=assigned&scope=domain", "author=alice"]:
            req("GET", "/work-overview?" + q, status=422)
        empty = overview()
        assert (
            empty["imports"]["total"]
            == empty["received_cases"]["total"]
            == empty["my_cases"]["total"]
            == empty["tasks"]["counts"]["active"]
            == 0
        )
        viewer = overview("task-viewer")
        assert viewer["tasks"] is viewer["received_cases"] is viewer["imports"] is None
        checks.append("roles_strict_scope_empty_distinct_from_unavailable")
        cases = []
        for n in range(7):
            content = {
                "title": f"Dossier accueil synthétique {n}",
                "excerpt": "Extrait consenti absent du résumé.",
                "target": "delivered_answer",
                "recipients": ["task-manager"],
                "policy_version": "named-excerpt-v1",
            }
            prep = req("POST", "/shared-cases/prepare", content, "task-viewer")
            receipt = req(
                "POST",
                "/shared-cases/share",
                {
                    "content": content,
                    "preparation_id": prep["preparation_id"],
                    "idempotency_key": str(uuid4()),
                },
                "task-viewer",
            )
            cases.append(receipt["case_id"])
        received = overview()["received_cases"]
        assert (
            received["total"] == 7
            and received["has_more"]
            and [i["id"] for i in received["items"]] == cases[:5]
        )
        assert overview("alice", "domain")["received_cases"]["total"] == 0
        assert overview("task-viewer")["my_cases"]["items"] == received["items"]
        assert overview("reader")["received_cases"] is None
        assert "excerpt" not in json.dumps(received) and "recipients" not in json.dumps(received)
        checks.append("complete_counts_top_five_oldest_named_recipient_and_author_only")
        req(
            "POST",
            f"/shared-cases/{cases[0]}/commands",
            {"action": "withdraw", "expected_revision": 1, "idempotency_key": str(uuid4())},
            "task-viewer",
        )
        req(
            "POST",
            f"/shared-cases/{cases[1]}/commands",
            {
                "action": "close_without_change",
                "public_conclusion": "Recette sans changement du savoir.",
                "expected_revision": 1,
                "idempotency_key": str(uuid4()),
            },
        )
        assert (
            overview()["received_cases"]["total"]
            == overview("task-viewer")["my_cases"]["total"]
            == 5
        )
        checks.append("withdrawal_and_closure_remove_open_work_without_deleting_history")
        collection = req(
            "POST",
            "/collections",
            {
                "name": "Imports accueil synthétique",
                "description": "Recette sans publication",
                "allowed_subjects": ["task-manager", "alice"],
                "idempotency_key": str(uuid4()),
            },
            status=201,
        )
        jobs = []
        for _n in range(7):
            job = req(
                "POST",
                f"/collections/{collection['id']}/imports",
                {
                    "items": [
                        {
                            "filename": name,
                            "content": "Règle synthétique de recette.",
                            "allowed_subjects": ["task-manager", "alice"],
                        }
                        for name in ["ok.txt", "unsupported.pdf", "pending.txt"]
                    ],
                    "idempotency_key": str(uuid4()),
                },
                status=202,
            )
            jobs.append(job["id"])
        # A later import with real parser failure ranks before earlier pending imports.
        processed = req("POST", f"/imports/{jobs[-1]}/process?limit=2")
        assert [i["status"] for i in processed["items"]] == ["succeeded", "failed", "pending"]
        imports = overview()["imports"]
        assert (
            imports["total"] == imports["pending_jobs"] == 7
            and imports["failed_jobs"] == 1
            and imports["has_more"]
        )
        assert (
            imports["items"][0]["id"] == jobs[-1]
            and imports["items"][0]["failed"] == 1
            and imports["items"][0]["pending"] == 1
        )
        assert (
            overview("alice", "domain")["imports"]["total"] == 0
            and overview("reader")["imports"] is None
        )
        assert "filename" not in json.dumps(imports) and "content" not in json.dumps(imports)
        checks.append(
            "own_imports_complete_counts_overlapping_categories_failed_first_metadata_only"
        )
        source = processed["items"][0]["source_id"]
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                ),
                {**params, "s": source},
            )
        try:
            hidden = overview()["imports"]
            assert (
                hidden["total"] == 6
                and hidden["failed_jobs"] == 0
                and all(i["id"] != jobs[-1] for i in hidden["items"])
            )
            req("GET", f"/imports/{jobs[-1]}", status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    {**params, "s": source},
                )
        req("POST", f"/imports/{jobs[0]}/cancel")
        assert overview()["imports"]["total"] == 6
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                ),
                params,
            )
        try:
            downgraded = overview()
            assert downgraded["received_cases"] is downgraded["imports"] is None
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_memberships SET role='corpus_manager' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                    ),
                    params,
                )
        checks.append("every_source_acl_current_role_and_cancelled_imports_enforced")
        task = req(
            "POST",
            "/tasks",
            {
                "title": "Tâche de recette accueil",
                "instructions": "Relire la règle synthétique",
                "criteria": "Preuve sourcée",
                "idempotency_key": str(uuid4()),
            },
        )["task_id"]
        assert (
            overview()["tasks"]["counts"]["active"] == 0
            and overview(scope="domain")["tasks"]["counts"]["active"] == 1
        )
        req(
            "POST",
            f"/tasks/{task}/commands",
            {
                "action": "offer",
                "assignee": "reader",
                "reason": "Recette",
                "expected_revision": 1,
                "idempotency_key": str(uuid4()),
            },
        )
        personal = overview("reader")
        assert personal["tasks"]["items"][0]["task"]["id"] == task
        assert (
            personal["as_of"] == personal["tasks"]["as_of"]
            and personal["work_version"] == personal["tasks"]["work_version"]
        )
        legacy = req("GET", "/work-brief", actor="reader")
        assert (
            legacy["items"] == personal["tasks"]["items"]
            and legacy["counts"] == personal["tasks"]["counts"]
        )
        checks.append("task_scope_preserved_and_existing_brief_identical_shared_snapshot")
        http = overview()
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
                    "name": "api_work_overview_read",
                    "arguments": {
                        "path": {"domain": state["domain"]},
                        "query": {"scope": "assigned"},
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200
        for k in ["received_cases", "my_cases", "imports"]:
            assert mcp["data"][k] == http[k]
        assert req("GET", "/version") == before
        checks.append("http_mcp_parity_no_knowledge_mutation")
        report = {
            **state,
            "checks": checks,
            "passed": len(checks),
            "cases": cases,
            "imports": jobs,
            "task": task,
        }
        (OUT / "overview-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
