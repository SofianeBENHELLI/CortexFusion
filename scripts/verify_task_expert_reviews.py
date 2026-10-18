"""Native non-binding expert reviews on isolated synthetic task/source fixtures."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
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

        def req(method, path, body=None, actor="alice", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (
                method,
                path,
                status,
                r.status_code,
                r.json().get("error"),
            )
            return r.json()

        proof = "Le délai de contrôle synthétique est de cinq jours."
        source = req(
            "POST",
            "/sources",
            {
                "title": "Preuve pour avis expert synthétique",
                "location": "synthetic://expert-review",
                "content": proof,
                "allowed_subjects": ["alice", "reader", "task-manager"],
            },
            status=201,
        )["id"]

        def proposal(actor):
            return req(
                "POST",
                "/proposals",
                {
                    "base_version": 0,
                    "changes": [
                        {
                            "kind": "put_concept",
                            "concept": {
                                "concept_id": str(uuid4()),
                                "title": "Règle synthétique à examiner",
                                "body": proof,
                                "sources": [{"source_id": source, "start": 0, "end": len(proof)}],
                            },
                        }
                    ],
                    "reason": "Avis indépendant de recette",
                    "idempotency_key": str(uuid4()),
                },
                actor,
                status=201,
            )

        prop = proposal("alice")
        own = proposal("reader")
        receipt = req(
            "POST",
            "/tasks",
            {
                "title": "Avis expert sur une proposition synthétique",
                "instructions": "Examiner la proposition liée et sa source.",
                "criteria": "Rendre un avis motivé sans approbation.",
                "idempotency_key": str(uuid4()),
            },
        )
        task = receipt["task_id"]
        path = f"/tasks/{task}"
        link = {
            "proposal_id": prop["id"],
            "expected_task_revision": 1,
            "idempotency_key": str(uuid4()),
        }
        receipt = req("POST", path + "/proposals", link)
        assert receipt["revision"] == 2 and req("POST", path + "/proposals", link) == receipt
        req("POST", path + "/proposals", {**link, "proposal_id": own["id"]}, status=409)
        req(
            "POST",
            path + "/proposals",
            {**link, "expected_task_revision": 2, "idempotency_key": str(uuid4())},
            status=409,
        )
        refs = req("GET", path + "/proposals")["items"]
        assert len(refs) == 1 and refs[0]["proposal_id"] == prop["id"] and not refs[0]["can_review"]
        for actor in ["reader", "task-peer", "task-viewer", "task-agent"]:
            req("GET", path + "/proposals", actor=actor, status=404)
        checks.append("link_idempotency_visibility_and_no_implicit_access")

        def command(action, revision, actor="alice", **extra):
            return req(
                "POST",
                path + "/commands",
                {
                    "action": action,
                    "expected_revision": revision,
                    "reason": "Recette synthétique",
                    "idempotency_key": str(uuid4()),
                    **extra,
                },
                actor,
            )

        command("offer", 2, assignee="reader")
        command("accept", 3, "reader")
        assert req("GET", path + "/proposals", actor="reader")["items"][0]["can_review"] is True

        def opinion(**extra):
            return {
                "proposal_id": prop["id"],
                "digest": prop["digest"],
                "expected_review_revision": prop["review_revision"],
                "expected_task_revision": req("GET", path, actor="reader")["revision"],
                "opinion": "supports",
                "justification": "La source confirme ce délai synthétique.",
                "evidence_source_ids": [source],
                "idempotency_key": str(uuid4()),
                **extra,
            }

        body = opinion()
        req("POST", path + "/expert-reviews", body, "task-manager", 403)
        req("POST", path + "/expert-reviews", body, "task-peer", 404)
        req("POST", path + "/expert-reviews", {**body, "opinion": "approve"}, "reader", 422)
        req("POST", path + "/expert-reviews", {**body, "author": "alice"}, "reader", 422)
        req("POST", path + "/expert-reviews", {**body, "digest": "wrong"}, "reader", 409)
        req(
            "POST",
            path + "/expert-reviews",
            {**body, "evidence_source_ids": [str(uuid4())]},
            "reader",
            422,
        )
        req(
            "POST",
            path + "/expert-reviews",
            {**body, "evidence_source_ids": [source, source]},
            "reader",
            422,
        )
        req("POST", path + "/expert-reviews", {**body, "justification": "x" * 2001}, "reader", 422)
        checks.append("assignee_revision_digest_evidence_and_input_guards")
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(
                pool.map(lambda _: req("POST", path + "/expert-reviews", body, "reader"), range(2))
            )
        assert receipts[0] == receipts[1]
        receipt = receipts[0]
        assert receipt["revision"] == 5
        rows = req("GET", path + f"/proposals/{prop['id']}/expert-reviews", actor="reader")
        assert rows["total"] == 1 and rows["items"][0]["validity"] == "current"
        assert req("GET", f"/proposals/{prop['id']}")["review_revision"] == prop["review_revision"]
        assert req("GET", f"/proposals/{prop['id']}")["status"] == prop["status"]
        req(
            "POST", path + "/expert-reviews", {**body, "justification": "Autre avis"}, "reader", 409
        )
        checks.append("concurrent_exact_retry_one_opinion_no_owner_decision")
        own_link = {
            "proposal_id": own["id"],
            "expected_task_revision": 5,
            "idempotency_key": str(uuid4()),
        }
        req("POST", path + "/proposals", own_link)
        req(
            "POST",
            path + "/expert-reviews",
            opinion(
                proposal_id=own["id"],
                digest=own["digest"],
                expected_review_revision=own["review_revision"],
            ),
            "reader",
            403,
        )
        checks.append("proposal_author_cannot_self_review")
        # Source ACL mutation only on the newly created synthetic source; restored in finally.
        with db.begin() as c:
            c.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source},
            )
        try:
            assert req("GET", path + "/proposals", actor="reader")["items"] == []
            req("GET", path + f"/proposals/{prop['id']}/expert-reviews", actor="reader", status=404)
            req("POST", path + "/expert-reviews", opinion(), "reader", 404)
            assert req("POST", path + "/expert-reviews", body, "reader") == receipt
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    {"t": state["tenant"], "d": state["domain"], "s": source},
                )
        checks.append(
            "fresh_source_revocation_masks_references_and_opinions_but_not_own_minimal_receipt"
        )
        # Controlled synthetic proposal revision change: not an owner workflow qualification.
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_proposals SET review_revision=review_revision+1 WHERE tenant_id=:t AND domain_id=:d AND id=:p"
                ),
                {"t": state["tenant"], "d": state["domain"], "p": prop["id"]},
            )
        assert (
            req("GET", path + f"/proposals/{prop['id']}/expert-reviews")["items"][0]["validity"]
            == "stale"
        )
        req("POST", path + "/expert-reviews", opinion(), "reader", 409)
        prop = req("GET", f"/proposals/{prop['id']}")
        checks.append("historical_opinion_preserved_and_marked_stale_after_revision_change")
        headers = {**fixture.headers("reader"), "Accept": "application/json, text/event-stream"}
        body2 = opinion(opinion="insufficient_evidence", evidence_source_ids=[])
        response = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_expert_reviews_submit",
                    "arguments": {
                        "path": {"domain": state["domain"], "task_id": task},
                        "body": body2,
                    },
                },
            },
        ).json()
        result = response["result"]["structuredContent"]
        assert result["http_status"] == 200, result
        assert req("POST", path + "/expert-reviews", body2, "reader") == result["data"]
        checks.append("mcp_http_same_opinion_and_receipt")
        first = req("GET", path + f"/proposals/{prop['id']}/expert-reviews?limit=1")
        assert first["has_more"] and first["total"] == 2
        second = req(
            "GET",
            path + f"/proposals/{prop['id']}/expert-reviews?limit=1&after={first['next_after']}",
        )
        assert not second["has_more"] and second["items"][0]["id"] != first["items"][0]["id"]
        req("POST", path + "/expert-reviews", opinion(opinion="changes_requested"), "reader")
        req(
            "GET",
            path + f"/proposals/{prop['id']}/expert-reviews?limit=1&after={first['next_after']}",
            status=409,
        )
        checks.append("stable_review_pagination_invalidated_by_new_opinion")
        with db.connect() as c:
            for table in ["cf_task_proposals", "cf_expert_reviews"]:
                r = c.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:n"
                    ),
                    {"n": table},
                ).one()
                assert all(r)
            assert (
                c.execute(
                    text(
                        "SELECT count(*) FROM cf_expert_reviews WHERE tenant_id=:t AND domain_id=:d AND task_id=:task"
                    ),
                    {"t": state["tenant"], "d": state["domain"], "task": task},
                ).scalar_one()
                == 3
            )
        assert req("GET", "/version")["published_version"] == 0
        checks.append("rls_and_no_publication")
        OUT.joinpath("expert-browser-state.json").write_text(
            json.dumps(
                {
                    "synthetic_only": True,
                    "tenant": state["tenant"],
                    "domain": state["domain"],
                    "task": task,
                    "proposal": prop["id"],
                    "source": source,
                },
                indent=2,
            )
        )
    report = {
        "passed": len(checks),
        "checks": checks,
        "synthetic_only": True,
        "limits": [
            "No owner decision/publication qualified here",
            "Source ACL and proposal revision mutations confined to newly created synthetic fixtures",
        ],
    }
    OUT.joinpath("expert-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    db.dispose()


if __name__ == "__main__":
    main()
