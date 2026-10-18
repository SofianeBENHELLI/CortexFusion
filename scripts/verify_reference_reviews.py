"""Named reference review boundaries on isolated synthetic source/questions."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
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
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
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
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Revue nominative isolée')"
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
        q = str(uuid4())
        content = {
            "theme": "Délai de revue",
            "question": "Combien de jours dure la revue ?",
            "criteria": "Citer cinq jours et la preuve.",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "excerpt": "La revue dure cinq jours.",
            "selection": {"start": 0, "end": len("La revue dure cinq jours.")},
        }

        def save(revision, question=None):
            return req(
                "POST",
                "/reference-drafts/" + q,
                {
                    "content": {**content, **({"question": question} if question else {})},
                    "expected_revision": revision,
                    "idempotency_key": str(uuid4()),
                },
            )

        save(0)
        candidates = req("GET", f"/reference-drafts/{q}/reviewers?limit=1")
        assert candidates["items"][0]["subject"] == "alice" and candidates["next_after"] == "alice"
        assert req("GET", f"/reference-drafts/{q}/reviewers?after=alice")["items"] == [
            {"subject": "task-manager", "role": "corpus_manager"}
        ]
        for actor, status in [
            ("alice", 404),
            ("task-peer", 404),
            ("task-agent", 403),
            ("task-viewer", 403),
        ]:
            req("GET", f"/reference-drafts/{q}/reviewers", actor=actor, status=status)
        selection = {"question_id": q, "draft_revision": 1, "reviewer": "alice"}
        req(
            "POST", "/reference-reviews/prepare", {**selection, "reviewer": "task-peer"}, status=409
        )
        req("POST", "/reference-reviews/prepare", {**selection, "reviewer": "reader"}, status=422)
        prep = req("POST", "/reference-reviews/prepare", selection)
        assert prep["content"] == content
        submit = {
            **selection,
            "preparation_id": prep["preparation_id"],
            "idempotency_key": str(uuid4()),
        }
        req("POST", "/reference-reviews/submit", {**submit, "reviewer": "task-manager"}, status=409)
        receipt = req("POST", "/reference-reviews/submit", submit)
        rid = receipt["review_id"]
        path = "/reference-reviews/" + rid
        assert req("POST", "/reference-reviews/submit", submit) == receipt
        req(
            "POST",
            "/reference-reviews/submit",
            {**submit, "idempotency_key": str(uuid4())},
            status=409,
        )
        req("GET", path, actor="task-manager", status=404)
        req("GET", path, actor="task-agent", status=403)
        assert (
            req("GET", "/reference-reviews?scope=assigned", actor="alice")["items"][0]["id"] == rid
        )
        assert req("GET", "/reference-reviews?scope=assigned", actor="task-manager")["items"] == []
        checks.append(
            "named_recipient_only_current_source_rights_prepare_binding_pagination_idempotent_submission"
        )
        save(1, "Question privée modifiée après envoi")
        assert req("GET", path, actor="alice")["content"] == content
        params = {"t": state["tenant"], "d": state["domain"], "id": rid, "s": source["id"]}
        try:
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_reference_reviews SET content='{}'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:id"
                    ),
                    params,
                )
            raise AssertionError("snapshot mutable")
        except DBAPIError:
            pass
        checks.append("private_edit_does_not_mutate_shared_snapshot_database_guard")
        cmd = {
            "action": "request_changes",
            "expected_revision": 1,
            "note": "Préciser le déclencheur du délai.",
            "idempotency_key": str(uuid4()),
        }
        req("POST", path + "/commands", cmd, status=409)
        req("POST", path + "/commands", {**cmd, "expected_revision": 2}, actor="alice", status=409)
        opinion = req("POST", path + "/commands", cmd, actor="alice")
        assert opinion["status"] == "changes_requested" and opinion["revision"] == 2
        assert req("POST", path + "/commands", cmd, actor="alice") == opinion
        req(
            "POST",
            path + "/commands",
            {**cmd, "expected_revision": 2, "idempotency_key": str(uuid4())},
            actor="alice",
            status=409,
        )
        assert req("GET", path)["review_note"] == cmd["note"]
        checks.append("reviewer_opinion_cas_no_author_self_review_no_official_approval")
        first = req("GET", path + "/events?limit=1&expected_revision=2", actor="alice")
        assert first["total"] == 2 and first["review_revision"] == 2 and first["next_after"] == 1
        assert first["items"][0]["action"] == "submit" and first["items"][0]["actor"] == "reader"
        second = req("GET", path + "/events?limit=1&after=1&expected_revision=2", actor="alice")
        assert second["next_after"] is None and second["items"][0]["note"] == cmd["note"]
        assert second["items"][0]["id"] == opinion["event_id"]
        assert set(second["items"][0]) == {
            "id",
            "actor",
            "action",
            "revision",
            "status",
            "note",
            "created_at",
        }
        for query in [
            "limit=0",
            "limit=21",
            "after=1",
            "after=-1",
            "expected_revision=0",
            "actor=alice",
            "limit=1&limit=2",
        ]:
            req("GET", path + "/events?" + query, status=422)
        req("GET", path + "/events", actor="task-manager", status=404)
        req("GET", path + "/events", actor="task-agent", status=403)
        checks.append(
            "history_immutable_events_exact_two_idempotence_bound_pages_named_roles_no_command_keys"
        )

        try:
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects='[\"task-manager\"]'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    params,
                )
            req("GET", path, status=404)
            req("GET", path, actor="alice", status=404)
            req("GET", path + "/events", actor="alice", status=404)
            assert req("GET", "/reference-reviews")["items"] == []
            assert (
                req("GET", "/reference-review-receipts/" + submit["idempotency_key"])["receipt"]
                == receipt
            )
            req(
                "GET",
                "/reference-review-receipts/" + submit["idempotency_key"],
                actor="alice",
                status=404,
            )
            withdrawn = req(
                "POST",
                path + "/commands",
                {
                    "action": "withdraw",
                    "expected_revision": 2,
                    "note": "Retrait explicite de cette copie.",
                    "idempotency_key": str(uuid4()),
                },
            )
            assert withdrawn["status"] == "withdrawn"
            tomb = req("GET", path, actor="alice")
            assert tomb["content"] is None and tomb["review_note"] == "" and tomb["actions"] == []
            req("GET", path, actor="task-manager", status=404)
            req("GET", path + "/events?after=1&expected_revision=2", actor="alice", status=409)
            for actor in ["reader", "alice"]:
                history = req("GET", path + "/events", actor=actor)
                assert (
                    history["content_withheld"]
                    and history["review_revision"] == 3
                    and history["total"] == 3
                )
                assert all(e["note"] is None for e in history["items"])
                assert [e["revision"] for e in history["items"]] == [1, 2, 3]
                assert history["items"][-1]["action"] == "withdraw"
            checks.append(
                "history_current_acl_then_withdrawal_masks_all_notes_both_parties_stale_page_rejected"
            )

            checks.append(
                "source_revocation_masks_content_own_receipt_survives_author_withdraws_without_source_tombstone"
            )
        finally:
            with db.begin() as tx:
                tx.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager","task-peer"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    params,
                )
        selection["draft_revision"] = 2
        prep = req("POST", "/reference-reviews/prepare", selection)
        selection2 = {
            **selection,
            "preparation_id": prep["preparation_id"],
            "idempotency_key": str(uuid4()),
        }
        save(2)
        req("POST", "/reference-reviews/submit", selection2, status=409)
        selection["draft_revision"] = 3
        prep = req("POST", "/reference-reviews/prepare", selection)
        receipt2 = req(
            "POST",
            "/reference-reviews/submit",
            {
                **selection,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
        )
        ready = req(
            "POST",
            "/reference-reviews/" + receipt2["review_id"] + "/commands",
            {
                "action": "ready_for_owner",
                "expected_revision": 1,
                "note": "Version relue, à présenter à l’owner.",
                "idempotency_key": str(uuid4()),
            },
            actor="alice",
        )
        assert ready["status"] == "ready_for_owner" and req("GET", "/version") == version
        checks.append(
            "stale_preparation_refused_new_revision_review_ready_never_changes_knowledge_version"
        )
        mcp = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_reference_reviews_read",
                    "arguments": {
                        "path": {"domain": state["domain"], "review": receipt2["review_id"]}
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200 and mcp["data"]["status"] == "ready_for_owner"
        mh = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "api_reference_reviews_events",
                    "arguments": {
                        "path": {"domain": state["domain"], "review": receipt2["review_id"]},
                        "query": {"limit": 1, "expected_revision": 2},
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert (
            mh["http_status"] == 200 and mh["data"]["total"] == 2 and mh["data"]["next_after"] == 1
        )
        checks.append("mcp_same_authorized_snapshot_and_status")
        save(3)
        selection["draft_revision"] = 4
        prep = req("POST", "/reference-reviews/prepare", selection)
        expired = str(uuid4())
        with db.begin() as tx:
            tx.execute(
                text(
                    "INSERT INTO cf_reference_review_preparations(tenant_id,domain_id,author,id,payload_hash,membership_revision,expires_at) SELECT tenant_id,domain_id,author,:e,payload_hash,membership_revision,clock_timestamp()-interval '1 minute' FROM cf_reference_review_preparations WHERE tenant_id=:t AND domain_id=:d AND id=:p"
                ),
                {
                    "t": state["tenant"],
                    "d": state["domain"],
                    "p": prep["preparation_id"],
                    "e": expired,
                },
            )
        req(
            "POST",
            "/reference-reviews/submit",
            {**selection, "preparation_id": expired, "idempotency_key": str(uuid4())},
            status=409,
        )
        with db.begin() as tx:
            tx.execute(
                text(
                    "UPDATE cf_domains SET membership_revision=membership_revision+1 WHERE tenant_id=:t AND id=:d"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req(
            "POST",
            "/reference-reviews/submit",
            {
                **selection,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
            status=409,
        )
        prep = req("POST", "/reference-reviews/prepare", selection)
        latest = req(
            "POST",
            "/reference-reviews/submit",
            {
                **selection,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
        )

        def race(action):
            return client.post(
                base + "/reference-reviews/" + latest["review_id"] + "/commands",
                headers=fixture.headers("alice"),
                json={
                    "action": action,
                    "expected_revision": 1,
                    "note": "Avis concurrent synthétique",
                    "idempotency_key": str(uuid4()),
                },
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(race, ["request_changes", "ready_for_owner"]))
        assert sorted(statuses) == [200, 409]
        checks.append(
            "expired_or_membership_stale_preparation_rejected_concurrent_opinions_one_winner"
        )

        report = {
            "synthetic_only": True,
            **state,
            "source": source["id"],
            "question": q,
            "reviews": [rid, receipt2["review_id"]],
            "passed": len(checks),
            "checks": checks,
        }
        (OUT / "reference-reviews-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
