"""Named-excerpt sharing acceptance on the persistent synthetic task domain only."""

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

        def req(method, path, body=None, actor="reader", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (
                method,
                path,
                status,
                r.status_code,
                r.json().get("error"),
            )
            return r.json()

        def content(title="Extrait synthétique explicite"):
            return {
                "title": title,
                "excerpt": "Texte volontaire de recette, sans conversation privée.",
                "target": "delivered_answer",
                "recipients": ["task-manager"],
                "policy_version": "named-excerpt-v1",
            }

        def prepare(c, actor="reader"):
            return req("POST", "/shared-cases/prepare", c, actor)

        def share(c, actor="reader"):
            p = prepare(c, actor)
            b = {
                "content": c,
                "preparation_id": p["preparation_id"],
                "idempotency_key": str(uuid4()),
            }
            return req("POST", "/shared-cases/share", b, actor), b

        def command(ident, revision, action, actor="task-manager", **kw):
            return {
                "action": action,
                "expected_revision": revision,
                "idempotency_key": str(uuid4()),
                **kw,
            }

        candidates = req("GET", "/shared-cases/recipients", actor="task-viewer")
        assert {c["subject"] for c in candidates["items"]} == {"alice", "task-manager"}
        assert all(set(c) == {"subject", "role"} for c in candidates["items"])
        req("GET", "/shared-cases", actor="task-agent", status=404)
        req("POST", "/shared-cases/prepare", content(), actor="task-agent", status=403)
        checks.append("human_recipient_directory_and_agent_denial")
        c = content()
        p = prepare(c)
        before = req("GET", "/shared-cases?scope=team", actor="task-manager")["total"]
        assert req("GET", "/shared-cases?scope=team", actor="task-manager")["total"] == before
        altered = {**c, "excerpt": "Autre texte synthétique"}
        req(
            "POST",
            "/shared-cases/share",
            {
                "content": altered,
                "preparation_id": p["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
            status=409,
        )
        req(
            "POST",
            "/shared-cases/share",
            {"content": c, "preparation_id": p["preparation_id"], "idempotency_key": str(uuid4())},
            actor="task-viewer",
            status=409,
        )
        checks.append("preparation_is_private_and_bound_to_exact_payload_actor")
        shared, body = share(c)
        ident = shared["case_id"]
        path = "/shared-cases/" + ident
        assert req("POST", "/shared-cases/share", body) == shared
        req("POST", "/shared-cases/share", {**body, "idempotency_key": str(uuid4())}, status=409)
        req("POST", "/shared-cases/share", {**body, "content": altered}, status=409)
        checks.append("share_idempotent_and_preparation_single_use")
        own = req("GET", path)
        team = req("GET", path, actor="task-manager")
        assert own["audience"] == "declarant" and own["recipients"] == ["task-manager"]
        assert team["audience"] == "team" and team["declarant"] == "reader"
        assert not {
            "personal_signal_id",
            "recipients",
            "episode_id",
            "conversation_id",
            "source_ids",
        } & set(team)
        for actor in ["alice", "task-peer", "task-viewer", "task-agent", "outsider"]:
            req("GET", path, actor=actor, status=404)
        assert all(
            x["id"] != ident for x in req("GET", "/shared-cases?scope=team", actor="alice")["items"]
        )
        checks.append("named_current_recipient_only_not_all_managers_and_distinct_dtos")
        qual = command(ident, 1, "qualify", qualification="unclear")
        req("POST", path + "/commands", qual, actor="reader", status=404)
        qualified = req("POST", path + "/commands", qual, actor="task-manager")
        assert qualified["revision"] == 2
        req(
            "POST",
            path + "/commands",
            {**qual, "idempotency_key": str(uuid4())},
            actor="task-manager",
            status=409,
        )
        req(
            "POST",
            path + "/commands",
            command(
                ident,
                2,
                "close_without_change",
                public_conclusion="Après vérification synthétique, aucune modification nécessaire.",
            ),
            actor="task-manager",
        )
        own = req("GET", path)
        assert (
            own["public_conclusion"].startswith("Après vérification")
            and own["status"] == "closed_without_change"
        )
        req(
            "POST",
            path + "/commands",
            command(ident, 3, "corrected"),
            actor="task-manager",
            status=409,
        )
        reopened = req(
            "POST",
            path + "/commands",
            command(ident, 3, "reopen", public_conclusion="Nouvel examen demandé."),
            actor="task-manager",
        )
        assert reopened["revision"] == 4
        checks.append("team_triage_public_followup_without_knowledge_correction_claim")
        req("POST", path + "/commands", command(ident, 4, "withdraw"), actor="reader")
        tombstone = req("GET", path, actor="task-manager")
        assert set(tombstone) == {
            "audience",
            "id",
            "status",
            "revision",
            "created_at",
            "updated_at",
            "allowed_actions",
        }
        assert tombstone["audience"] == "withdrawn" and tombstone["allowed_actions"] == []
        assert req("GET", path)["excerpt"] == c["excerpt"]
        req(
            "POST",
            path + "/commands",
            command(ident, 5, "qualify", qualification="missing"),
            actor="task-manager",
            status=404,
        )
        assert req("POST", "/shared-cases/share", body) == shared  # Old receipt never re-shares.
        assert req("GET", path, actor="task-manager")["status"] == "withdrawn"
        history = req("GET", path + "/events", actor="task-manager")
        assert len(history["items"]) == 5 and all(
            set(x) == {"id", "action", "revision", "status", "created_at"} for x in history["items"]
        )
        checks.append("withdrawal_hides_all_text_and_preserves_minimal_audit_receipts")
        # Explicit small synthetic origin, no ingestion and no access to real knowledge.
        episode, signal = str(uuid4()), str(uuid4())
        with db.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO cf_episodes(tenant_id,domain_id,id,subject,question,result,source_ids,served_version) VALUES(:t,:d,:e,'reader','Question synthétique privée','{}','[]',0)"
                ),
                {"t": state["tenant"], "d": state["domain"], "e": episode},
            )
            conn.execute(
                text(
                    "INSERT INTO cf_feedback_signals(tenant_id,domain_id,id,subject,episode_id,origin,kind,payload,idempotency_key,request_hash) VALUES(:t,:d,:s,'reader',:e,'observed','reformulation','{}',:s,'synthetic')"
                ),
                {"t": state["tenant"], "d": state["domain"], "e": episode, "s": signal},
            )
        sc = {**content("Origine synthétique séparée"), "personal_signal_id": signal}
        s2, _ = share(sc)
        v = req("GET", "/shared-cases/" + s2["case_id"], actor="task-manager")
        assert (
            v["origin"] == "observed"
            and signal not in json.dumps(v)
            and episode not in json.dumps(v)
        )
        req("POST", "/shared-cases/prepare", sc, actor="task-viewer", status=404)
        req("GET", "/episodes/" + episode, actor="task-manager", status=404)
        checks.append("personal_origin_verified_preserved_without_raw_access_or_auto_copy")
        # Expired and permission-stale consent using metadata-only fixture insertion.
        pp = prepare(c)
        expired = str(uuid4())
        with db.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO cf_case_preparations SELECT tenant_id,domain_id,subject,:new,payload_hash,membership_revision,clock_timestamp()-interval '1 second' FROM cf_case_preparations WHERE tenant_id=:t AND id=:id"
                ),
                {"t": state["tenant"], "new": expired, "id": pp["preparation_id"]},
            )
        req(
            "POST",
            "/shared-cases/share",
            {"content": c, "preparation_id": expired, "idempotency_key": str(uuid4())},
            status=409,
        )
        with db.begin() as conn:
            conn.execute(
                text(
                    "UPDATE cf_memberships SET role=role WHERE tenant_id=:t AND domain_id=:d AND subject='task-peer'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req(
            "POST",
            "/shared-cases/share",
            {"content": c, "preparation_id": pp["preparation_id"], "idempotency_key": str(uuid4())},
            status=409,
        )
        checks.append("expired_or_membership_changed_consent_rejected")
        # Losing the coordinate role hides even a formerly consented recipient.
        with db.begin() as conn:
            conn.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        try:
            req("GET", "/shared-cases/" + s2["case_id"], actor="task-manager", status=404)
        finally:
            with db.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_memberships SET role='corpus_manager' WHERE tenant_id=:t AND domain_id=:d AND subject='task-manager'"
                    ),
                    {"t": state["tenant"], "d": state["domain"]},
                )
        checks.append("current_role_rechecked_on_every_read")
        pp = prepare(c)
        race = {
            "content": c,
            "preparation_id": pp["preparation_id"],
            "idempotency_key": str(uuid4()),
        }
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: req("POST", "/shared-cases/share", race), range(2)))
        assert results[0] == results[1]
        checks.append("concurrent_exact_share_single_case_receipt")
        first = req("GET", "/shared-cases?limit=1")
        assert first["next_after"]
        got = []
        page = first
        while True:
            got += page["items"]
            if not page["next_after"]:
                break
            page = req("GET", "/shared-cases?limit=1&after=" + page["next_after"])
            assert page["as_of"] == first["as_of"]
        assert len(got) == first["total"] == len({v["id"] for v in got})
        share(content("Changement de file synthétique"))
        req("GET", "/shared-cases?limit=1&after=" + first["next_after"], status=409)
        checks.append("exact_scoped_chronological_pagination_and_stale_restart")
        for c_bad in [
            {**c, "excerpt": "x" * 2001},
            {**c, "recipients": ["task-manager", "task-manager"]},
            {**c, "policy_version": "unknown"},
            {**c, "origin": "inferred"},
        ]:
            req("POST", "/shared-cases/prepare", c_bad, status=422)
        req("POST", "/shared-cases/prepare", {**c, "recipients": ["task-peer"]}, status=409)
        checks.append("bounds_policy_unknown_fields_and_recipient_validation")
        headers = {
            **fixture.headers("task-viewer"),
            "Accept": "application/json, text/event-stream",
        }
        r = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_cases_prepare",
                    "arguments": {"path": {"domain": state["domain"]}, "body": c},
                },
            },
        )
        result = r.json()["result"]["structuredContent"]
        assert result["http_status"] == 200
        body = {
            "content": c,
            "preparation_id": result["data"]["preparation_id"],
            "idempotency_key": str(uuid4()),
        }
        r = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "api_cases_share",
                    "arguments": {"path": {"domain": state["domain"]}, "body": body},
                },
            },
        )
        result = r.json()["result"]["structuredContent"]
        assert result["http_status"] == 200
        assert req("POST", "/shared-cases/share", body, actor="task-viewer") == result["data"]
        checks.append("viewer_mcp_prepare_share_and_http_receipt_parity")
        assert req("GET", "/version")["published_version"] == 0
        with db.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM cf_case_events WHERE tenant_id=:t AND domain_id=:d AND case_id=:id"
                    ),
                    {"t": state["tenant"], "d": state["domain"], "id": results[0]["case_id"]},
                ).scalar_one()
                == 1
            )
        checks.append("no_knowledge_publication_and_one_durable_event")
    db.dispose()
    report = {
        "status": "passed",
        "checks": checks,
        "denominator": len(checks),
        "synthetic_only": True,
        "ingestion": False,
        "external_distribution": False,
    }
    (OUT / "cases-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
