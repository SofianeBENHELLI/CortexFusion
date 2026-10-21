"""Task coordination against persistent synthetic-only domain, no ingestion or old ACL changes."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]
# The retained local qualification fixture by default. CI builds a fresh one with
# verify_bounded_retrieval.py and points these variables at it.
OUT = Path(
    os.environ.get("CORTEX_QUALIFICATION_OUTPUT") or ROOT / ".runtime/brain/openbrain-20261016"
)
KEYS = Path(
    os.environ.get("CORTEX_QUALIFICATION_FIXTURE") or ROOT / ".runtime/brain/aud02-native-20261005"
)


def schema_head():
    """Current migration head, so readiness checks follow new migrations."""
    return ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini"))).get_current_head()


def task_fixture():
    base = json.loads((KEYS / "state.json").read_text())
    assert base["synthetic_only"] is True
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.database.endswith("_test")
    path = OUT / "tasks-state.json"
    if path.exists():
        state = json.loads(path.read_text())
        assert state["synthetic_only"] is True and state["tenant"] == base["tenant"]
        return state
    state = {"synthetic_only": True, "tenant": base["tenant"], "domain": str(uuid4())}
    db = create_engine(url)
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette coordination des tâches')"
            ),
            {"t": state["tenant"], "d": state["domain"]},
        )
        for actor, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-manager", "corpus_manager"),
            ("task-peer", "contributor"),
            ("task-viewer", "viewer"),
            ("task-agent", "agent"),
        ]:
            c.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": actor, "r": role},
            )
    db.dispose()
    path.write_text(json.dumps(state, indent=2))
    path.chmod(0o600)
    return state


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
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}/tasks"

        def req(method, path, status=200, actor="alice", body=None):
            result = client.request(method, path, headers=fixture.headers(actor), json=body)
            assert result.status_code == status, (
                method,
                status,
                result.status_code,
                result.json().get("error"),
            )
            return result.json()

        assert req("GET", "/ready")["schema_revision"] == schema_head()
        assert req("GET", base, actor="reader")["items"] == [] or all(
            x["assignee"] == "reader" for x in req("GET", base, actor="reader")["items"]
        )
        for actor in ["task-viewer", "task-agent", "outsider"]:
            req("GET", base, 404, actor)
        checks.append("list_role_boundary")
        candidates = req("GET", base + "/candidates", actor="task-manager")["items"]
        assert {c["subject"] for c in candidates} == {
            "alice",
            "reader",
            "task-manager",
            "task-peer",
        }
        req("GET", base + "/candidates", 403, "reader")
        checks.append("minimal_eligible_candidates")
        body = {
            "title": "Relire la fiche synthétique",
            "instructions": "Vérifier la formulation et proposer un compte rendu.",
            "criteria": "Un compte rendu explicite, sans publication de savoir.",
            "due_at": "2026-10-18T12:00:00Z",
            "idempotency_key": str(uuid4()),
        }
        req("POST", base, 403, "reader", body)
        receipt = req("POST", base, actor="task-manager", body=body)
        ident = receipt["task_id"]
        path = base + "/" + ident
        assert req("POST", base, actor="task-manager", body=body) == receipt
        req("POST", base, 409, "task-manager", {**body, "title": "Different"})
        current = req("GET", path)
        created = current["created_at"]
        assert current["status"] == "unassigned"
        req("GET", path, 404, "reader")
        req("GET", path + "/events", 404, "reader")
        checks.append("create_idempotent_and_private_until_assignment")

        def command(action, revision, actor="alice", status=200, **more):
            payload = {
                "action": action,
                "expected_revision": revision,
                "reason": "Décision de recette synthétique",
                "idempotency_key": str(uuid4()),
                **more,
            }
            result = req("POST", path + "/commands", status, actor, payload)
            return result, payload

        command("offer", 1, status=403, assignee="task-viewer")
        command("offer", 1, status=403, assignee="task-agent")
        offered, offer = command("offer", 1, assignee="reader")
        assert offered["status"] == "offered"
        assert req("GET", path, actor="reader")["allowed_actions"] == ["accept", "decline"]
        req("GET", path, 404, "task-peer")
        checks.append("offer_requires_current_eligible_assignee")
        refused, refusal = command("decline", 2, "reader")
        assert refused["status"] == "unassigned"
        assert req("POST", path + "/commands", actor="reader", body=refusal) == refused
        req("GET", path, 404, "reader")
        checks.append("decline_receipt_recoverable_without_task_access")
        command("offer", 3, assignee="reader")
        accepted, accept = command("accept", 4, "reader")
        assert accepted["status"] == "in_progress"
        command("complete", 5, "reader", 403)
        command("submit", 4, "reader", 409, result_summary="Old revision")
        checks.append("accept_revision_and_actor_checked")
        command("block", 5, "reader")
        command("resume", 6, "reader")
        command(
            "submit",
            7,
            "reader",
            result_summary="La relecture est terminée : formulation cohérente avec la consigne synthétique.",
        )
        command("request_changes", 8, "task-manager")
        command(
            "submit",
            9,
            "reader",
            result_summary="Compte rendu corrigé avec justification explicite.",
        )
        completed, _ = command("complete", 10, "task-manager")
        assert completed["status"] == "completed"
        current = req("GET", path)
        assert current["created_at"] == created and current["revision"] == 11
        assert req("POST", path + "/commands", actor="reader", body=accept) == accepted
        assert req("GET", path)["revision"] == 11
        checks.append("full_review_cycle_preserves_age_and_old_receipts")
        events = req("GET", path + "/events?limit=3")
        assert len(events["items"]) == 3 and events["next_after"] == "3"
        rest = req("GET", path + "/events?after=3&limit=50")["items"]
        assert [x["revision"] for x in rest] == list(range(4, 12))
        checks.append("ordered_paged_history")
        command("reopen", 11, "task-manager")
        assert req("GET", path)["status"] == "unassigned"

        def race(target):
            return client.post(
                path + "/commands",
                headers=fixture.headers("alice"),
                json={
                    "action": "offer",
                    "expected_revision": 12,
                    "reason": "Concurrent synthetic offer",
                    "assignee": target,
                    "idempotency_key": str(uuid4()),
                },
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(race, ["reader", "task-peer"])) == [200, 409]
        command("cancel", 13, "task-manager")
        checks.append("concurrent_offer_one_winner_and_cancel")
        for bad in [
            {**body, "title": "🧠" * 201},
            {**body, "criteria": "  "},
            {**body, "actor": "reader"},
            {**body, "due_at": "tomorrow"},
        ]:
            req("POST", base, 422, "alice", bad)
        req("GET", base + "?limit=51", 422)
        req("GET", base + "?author=reader", 422)
        checks.append("bounded_input_and_unknown_fields")

        def rpc(name, args, actor="reader"):
            response = client.post(
                "/mcp/",
                headers={**fixture.headers(actor), "Accept": "application/json, text/event-stream"},
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": args},
                },
            )
            assert response.status_code == 200
            return response.json()["result"]["structuredContent"]

        data = rpc(
            "api_tasks_read",
            {"path": {"domain": state["domain"], "task_id": ident}},
            "task-manager",
        )
        assert data["http_status"] == 200 and data["data"]["revision"] == 14
        forbidden = rpc(
            "api_tasks_read", {"path": {"domain": state["domain"], "task_id": ident}}, "task-viewer"
        )
        assert forbidden["http_status"] == 404
        mcp_body = {
            **body,
            "title": "Tâche créée par MCP synthétique",
            "idempotency_key": str(uuid4()),
        }
        mcp = rpc(
            "api_tasks_create", {"path": {"domain": state["domain"]}, "body": mcp_body}, "alice"
        )
        assert mcp["http_status"] == 200
        assert req("POST", base, body=mcp_body) == mcp["data"]
        checks.append("mcp_and_http_same_authority_and_receipt")
        version = req("GET", f"/v1/domains/{state['domain']}/version")
        assert version["accepted_version"] == version["published_version"] == 0
        checks.append("no_knowledge_publication")
        db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
        with db.connect() as c:
            count = c.execute(
                text(
                    "SELECT count(*) FROM cf_task_outbox WHERE tenant_id=:t AND domain_id=:d AND task_id=:id"
                ),
                {"t": state["tenant"], "d": state["domain"], "id": ident},
            ).scalar_one()
            assert count >= 14
        db.dispose()
        checks.append("transactional_metadata_outbox")
    report = {
        "status": "passed",
        "checks": checks,
        "denominator": len(checks),
        "fixture_reingested": False,
        "old_acl_changed": False,
        "private_okf_touched": False,
    }
    (OUT / "tasks-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
