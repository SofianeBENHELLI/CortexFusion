"""Qualify proposal-level expert history using existing synthetic corpus only."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT


def main():
    state = json.loads((OUT / "expert-browser-state.json").read_text())
    assert state["synthetic_only"] is True
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
        path = f"/proposals/{state['proposal']}/expert-reviews"

        def req(method, path, body=None, actor="alice", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (method, status, r.status_code, r.json().get("error"))
            return r.json()

        prop = req("GET", f"/proposals/{state['proposal']}")
        before = req("GET", "/version")
        existing = req("GET", path, actor="reader")
        assert (
            existing["total"] >= 3
            and existing["proposal_digest"] == prop["digest"]
            and existing["proposal_review_revision"] == prop["review_revision"]
        )
        assert any(i["validity"] == "stale" for i in existing["items"])
        for actor in ["task-peer", "task-viewer", "task-agent"]:
            req("GET", path, actor=actor, status=404)
        checks.append("fresh_proposal_identity_history_and_role_source_guards")
        owner_before = req("GET", path)["total"]
        task = req(
            "POST",
            "/tasks",
            {
                "title": "Seconde mission de revue synthétique",
                "instructions": "Avis séparé pour qualifier la portée des lectures.",
                "criteria": "Aucun vote ni publication.",
                "idempotency_key": str(uuid4()),
            },
            status=200,
        )["task_id"]
        taskpath = f"/tasks/{task}"
        req(
            "POST",
            taskpath + "/proposals",
            {
                "proposal_id": state["proposal"],
                "expected_task_revision": 1,
                "idempotency_key": str(uuid4()),
            },
        )
        req(
            "POST",
            taskpath + "/commands",
            {
                "action": "offer",
                "assignee": "task-manager",
                "reason": "Mission synthétique distincte",
                "expected_revision": 2,
                "idempotency_key": str(uuid4()),
            },
        )
        req(
            "POST",
            taskpath + "/commands",
            {
                "action": "accept",
                "reason": "Recette de portée",
                "expected_revision": 3,
                "idempotency_key": str(uuid4()),
            },
            actor="task-manager",
        )
        req(
            "POST",
            taskpath + "/expert-reviews",
            {
                "proposal_id": state["proposal"],
                "digest": prop["digest"],
                "expected_review_revision": prop["review_revision"],
                "expected_task_revision": 4,
                "opinion": "insufficient_evidence",
                "justification": "Il faut définir le déclencheur du délai synthétique.",
                "evidence_source_ids": [],
                "idempotency_key": str(uuid4()),
            },
            actor="task-manager",
        )
        owner = req("GET", path)
        reader = req("GET", path, actor="reader")
        assert owner["total"] == owner_before + 1 and reader["total"] == existing["total"]
        assert all(i["task_id"] == state["task"] for i in reader["items"])
        assert req("GET", path, actor="task-manager")["total"] == owner["total"]
        checks.append("totals_and_rows_filtered_by_current_task_visibility")
        first = req("GET", path + "?limit=2")
        ids = [i["id"] for i in first["items"]]
        page = first
        while page["has_more"]:
            page = req("GET", path + "?limit=2&after=" + page["next_after"])
            ids += [i["id"] for i in page["items"]]
        assert len(ids) == len(set(ids)) == owner["total"]
        req("GET", path + "?limit=3&after=" + first["next_after"], status=409)
        req("GET", path + "?limit=2&after=" + first["next_after"], actor="reader", status=409)
        checks.append("opaque_pagination_complete_and_scope_bound")
        # Restrict only the newly created synthetic source; restore exact prior ACL.
        acl = req("GET", f"/sources/{state['source']}")["allowed_subjects"]
        try:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    {
                        "acl": json.dumps(["alice", "task-manager"]),
                        "t": state["tenant"],
                        "d": state["domain"],
                        "s": state["source"],
                    },
                )
            req("GET", path, actor="reader", status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    {
                        "acl": json.dumps(acl),
                        "t": state["tenant"],
                        "d": state["domain"],
                        "s": state["source"],
                    },
                )
        assert req("GET", path, actor="reader")["total"] == existing["total"]
        checks.append("current_source_revocation_and_authorized_recovery")
        first = req("GET", path + "?limit=2", actor="reader")
        try:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_work_tasks SET assignee=:a,revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND id=:id"
                    ),
                    {
                        "a": "task-peer",
                        "t": state["tenant"],
                        "d": state["domain"],
                        "id": state["task"],
                    },
                )
            assert req("GET", path, actor="reader")["total"] == 0
            req("GET", path + "?limit=2&after=" + first["next_after"], actor="reader", status=409)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_work_tasks SET assignee=:a,revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND id=:id"
                    ),
                    {
                        "a": "reader",
                        "t": state["tenant"],
                        "d": state["domain"],
                        "id": state["task"],
                    },
                )
        checks.append("assignment_revocation_hides_reviews_and_invalidates_cursor")
        rpc = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_proposals_expert_reviews",
                    "arguments": {
                        "path": {"domain": state["domain"], "proposal_id": state["proposal"]},
                        "query": {"limit": 20},
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert rpc["http_status"] == 200 and rpc["data"]["total"] == existing["total"]
        assert req("GET", "/version") == before
        checks.append("mcp_filtered_read_and_unchanged_knowledge_versions")
    result = {
        "passed": len(checks),
        "checks": checks,
        "synthetic_only": True,
        "limits": [
            "Source ACL and assignment revocation simulated only on isolated synthetic fixture; no production mutation.",
            "No owner approval or publication performed.",
        ],
    }
    (OUT / "decision-reviews-native-report.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    db.dispose()


if __name__ == "__main__":
    main()
