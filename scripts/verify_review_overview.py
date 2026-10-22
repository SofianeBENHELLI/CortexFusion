"""Named reference review boundaries on isolated synthetic source/questions."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
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
    state = {**state, "domain": str(uuid4())}
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Accueil des revues synthétiques')"
            ),
            {"t": state["tenant"], "d": state["domain"]},
        )
        for subject, role in [
            ("reader", "contributor"),
            ("alice", "owner"),
            ("task-manager", "corpus_manager"),
            ("task-peer", "contributor"),
            ("task-agent", "agent"),
            ("task-viewer", "viewer"),
        ]:
            tx.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": subject, "r": role},
            )
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"

        def req(method, path, body=None, actor="reader", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (
                path,
                r.status_code,
                status,
                r.text[:200] if r.status_code != status else "",
            )
            return r.json()

        version = req("GET", "/version")
        source = req(
            "POST",
            "/sources",
            {
                "title": "Revue nominative synthétique",
                "content": "La revue dure cinq jours.",
                "location": f"synthetic://named-review/{uuid4()}",
                "allowed_subjects": ["alice", "reader", "task-manager", "task-peer"],
            },
            actor="alice",
            status=201,
        )
        content = {
            "theme": "Délai",
            "question": "Combien de jours ?",
            "criteria": "Citer cinq jours.",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "excerpt": "La revue dure cinq jours.",
            "selection": {"start": 0, "end": len("La revue dure cinq jours.")},
        }

        def overview(actor="reader", scope="assigned"):
            return req("GET", "/work-overview?scope=" + scope, actor=actor)

        assert overview()["my_reference_reviews"]["total"] == 0
        assert overview()["received_reference_reviews"] is None
        assert overview("task-viewer")["my_reference_reviews"] is None
        assert overview("task-viewer")["received_reference_reviews"] is None
        req("GET", "/work-overview", actor="task-agent", status=404)
        checks.append("empty_vs_unavailable_and_human_role_boundaries")
        reviews = []
        for i in range(7):
            q = str(uuid4())
            req(
                "POST",
                "/reference-drafts/" + q,
                {
                    "content": {**content, "question": f"Question synthétique {i}"},
                    "expected_revision": 0,
                    "idempotency_key": str(uuid4()),
                },
            )
            selection = {"question_id": q, "draft_revision": 1, "reviewer": "alice"}
            prep = req("POST", "/reference-reviews/prepare", selection)
            body = {
                **selection,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            }
            before = overview()["work_version"]
            receipt = req("POST", "/reference-reviews/submit", body)
            assert overview()["work_version"] == before + 1
            assert req("POST", "/reference-reviews/submit", body) == receipt
            assert overview()["work_version"] == before + 1
            reviews.append(receipt["review_id"])
        for actor, field in [
            ("reader", "my_reference_reviews"),
            ("alice", "received_reference_reviews"),
        ]:
            group = overview(actor)[field]
            assert group["total"] == 7 and len(group["items"]) == 5 and group["has_more"]
            assert [v["id"] for v in group["items"]] == reviews[:5]
            assert all(
                "excerpt" not in v and "content" not in v and "review_note" not in v
                for v in group["items"]
            )
        assert overview("task-manager")["received_reference_reviews"]["total"] == 0
        assert (
            overview("alice", "domain")["received_reference_reviews"]
            == overview("alice")["received_reference_reviews"]
        )
        checks.append("seven_exact_counts_oldest_five_named_only_domain_scope_does_not_broaden")
        command = {
            "action": "ready_for_owner",
            "expected_revision": 1,
            "note": "Avis synthétique favorable sans approbation.",
            "idempotency_key": str(uuid4()),
        }
        path = "/reference-reviews/" + reviews[0] + "/commands"
        before = overview()["work_version"]
        receipt = req("POST", path, command, actor="alice")
        assert req("POST", path, command, actor="alice") == receipt
        assert overview()["work_version"] == before + 1
        assert overview("alice")["received_reference_reviews"]["total"] == 6
        mine = overview()["my_reference_reviews"]
        assert (
            mine["total"] == 7
            and mine["items"][0]["status"] == "ready_for_owner"
            and mine["items"][0]["revision"] == 2
        )
        checks.append("opinion_leaves_recipient_queue_author_follows_work_revision_once")
        params = {"t": state["tenant"], "d": state["domain"], "s": source["id"]}

        def sql(query, extra=None):
            with db.begin() as tx:
                tx.execute(text(query), {**params, **(extra or {})})

        try:
            sql(
                "UPDATE cf_sources SET allowed_subjects='[\"reader\"]'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s"
            )
            assert overview("alice")["received_reference_reviews"]["total"] == 0
            assert overview()["my_reference_reviews"]["total"] == 7
            try:
                sql(
                    "UPDATE cf_sources SET content_hash=:hash WHERE tenant_id=:t AND domain_id=:d AND id=:s",
                    {"hash": "f" * 64},
                )
                raise AssertionError("immutable source hash changed")
            except DBAPIError:
                pass
            assert overview()["my_reference_reviews"]["total"] == 7
        finally:
            sql(
                'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager","task-peer"]\'::jsonb,content_hash=:hash WHERE tenant_id=:t AND domain_id=:d AND id=:s',
                {"hash": source["content_hash"]},
            )
        checks.append("current_source_acl_before_full_counts_and_immutable_source_hash")
        try:
            sql(
                "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
            )
            assert overview("alice")["received_reference_reviews"] is None
        finally:
            sql(
                "UPDATE cf_memberships SET role='owner' WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
            )
        req(
            "POST",
            "/reference-reviews/" + reviews[1] + "/commands",
            {
                "action": "withdraw",
                "expected_revision": 1,
                "note": "Retrait synthétique explicite.",
                "idempotency_key": str(uuid4()),
            },
        )
        assert overview()["my_reference_reviews"]["total"] == 6
        assert overview("alice")["received_reference_reviews"]["total"] == 5
        assert not overview("alice")["received_reference_reviews"]["has_more"]
        checks.append("role_revocation_and_withdrawal_remove_counts_without_tombstone_content")
        rpc = client.post(
            "/mcp",
            headers={**fixture.headers("alice"), "Accept": "application/json, text/event-stream"},
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
        )
        assert rpc.status_code == 200, rpc.status_code
        result = rpc.json()["result"]["structuredContent"]
        assert result["http_status"] == 200
        result = result["data"]
        assert (
            result["received_reference_reviews"] == overview("alice")["received_reference_reviews"]
        )
        assert req("GET", "/version") == version
        checks.append("mcp_parity_no_approval_publication_or_knowledge_version_change")
        report = {
            "synthetic_only": True,
            **state,
            "source": source["id"],
            "reviews": reviews,
            "passed": len(checks),
            "checks": checks,
        }
        (OUT / "review-overview-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
