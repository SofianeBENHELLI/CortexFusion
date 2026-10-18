"""Verify mission overview scopes and source masking on an isolated synthetic domain."""

import json
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = {**task_fixture(), "domain": str(uuid4())}
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert u.host == "127.0.0.1" and u.port == 55432 and u.database.endswith("_test")
    db = create_engine(u)
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    with db.begin() as t:
        t.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Accueil des missions synthétiques')"
            ),
            {"t": state["tenant"], "d": state["domain"]},
        )
        for subject, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-manager", "corpus_manager"),
            ("task-agent", "agent"),
            ("task-viewer", "viewer"),
        ]:
            t.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": state["tenant"], "d": state["domain"], "s": subject, "r": role},
            )
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

        def req(method, path, body=None, actor="alice", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (path, r.status_code, r.text[:180])
            return r.json()

        def overview(actor="alice", scope="assigned"):
            return req("GET", "/work-overview?scope=" + scope, actor=actor)

        before = req("GET", "/version")
        source = req(
            "POST",
            "/sources",
            {
                "title": "Source synthétique du brief missions",
                "content": "La revue dure cinq jours.",
                "location": f"synthetic://mission-overview/{uuid4()}",
                "allowed_subjects": ["alice", "task-manager", "task-agent"],
            },
            status=201,
        )
        state["source"] = source["id"]

        def make(title, seconds=7200):
            mandate = {
                "title": title,
                "objective": "Lire la durée du passage synthétique.",
                "criteria": "Citer la plage lue, sans validation automatique.",
                "agent": "task-agent",
                "source_id": source["id"],
                "source_hash": source["content_hash"],
                "max_reads": 3,
                "max_chars": 100,
                "expires_at": (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat(),
            }
            p = req("POST", "/agent-missions/prepare", mandate)
            return req(
                "POST",
                "/agent-missions/create",
                {
                    "mandate": mandate,
                    "preparation_id": p["preparation_id"],
                    "idempotency_key": str(uuid4()),
                },
            )["mission_id"]

        ids = [make(f"Mission synthétique {i + 1}") for i in range(6)]
        state["missions"] = ids
        g = overview()["my_missions"]
        assert (
            g["total"] == 6
            and len(g["items"]) == 5
            and g["has_more"]
            and g["waiting"] == 6
            and g["withheld"] == 0
        )
        assert [i["id"] for i in g["items"]] == ids[:5]
        assert overview("task-manager")["my_missions"]["total"] == 0
        assert (
            overview("reader")["my_missions"] is None
            and overview("task-viewer")["my_missions"] is None
        )
        assert overview(scope="domain")["my_missions"] == g
        checks.append(
            "complete total/top5, stable order, personal scope even in domain mode and null for contributor/viewer"
        )

        def command(i, action, revision, actor="alice", **extra):
            return req(
                "POST",
                f"/agent-missions/{i}/commands",
                {
                    "action": action,
                    "expected_revision": revision,
                    "idempotency_key": str(uuid4()),
                    **extra,
                },
                actor=actor,
            )

        claim = command(ids[1], "claim", 1, "task-agent")
        command(ids[2], "claim", 1, "task-agent")
        path = f"/agent-missions/{ids[1]}"
        reading = req(
            "POST",
            path + "/read-source",
            {
                "expected_revision": 2,
                "lease_id": claim["lease_id"],
                "idempotency_key": str(uuid4()),
                "start": 0,
                "end": 24,
            },
            actor="task-agent",
        )
        result = req(
            "POST",
            path + "/complete",
            {
                "expected_revision": 3,
                "lease_id": claim["lease_id"],
                "idempotency_key": str(uuid4()),
                "report": "Le passage indique cinq jours.",
                "hypotheses": "Le point de départ reste à préciser.",
                "evidence": [{"start": 0, "end": 24}],
            },
            actor="task-agent",
        )
        assert reading["receipt"]["revision"] == 3 and result["revision"] == 4
        command(ids[3], "stop", 1, reason="Arrêt synthétique pour tester le compteur.")
        expired = make("Mission synthétique expirée", seconds=2)
        time.sleep(2.1)
        state["expired"] = expired
        v = overview()
        g = v["my_missions"]
        assert (g["total"], g["waiting"], g["claimed"], g["expired"], g["reports"]) == (
            6,
            3,
            1,
            1,
            1,
        ), g
        assert [i["id"] for i in g["items"][:2]] == [expired, ids[1]]
        assert all(
            "report" not in i and "source_id" not in i and "agent" not in i for i in g["items"]
        )
        checks.append(
            "real deadline expiry, disjoint status counters, completed reports distinct from approval, stopped excluded and consumed budgets preserved"
        )
        params = {"t": state["tenant"], "d": state["domain"], "i": source["id"]}
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                ),
                {**params, "acl": json.dumps(["alice", "task-manager"])},
            )
        masked = overview()["my_missions"]
        assert masked["total"] == 6 and masked["withheld"] == 6
        assert all(i["title"] is None and not i["content_available"] for i in masked["items"])
        assert all(i["id"] in ids + [expired] for i in masked["items"])
        req("GET", f"/agent-missions/{ids[1]}", status=404)
        assert req("GET", f"/agent-mission-controls/{expired}")["can_stop"]
        checks.append(
            "source loss removes every title before serialization while preserving only author control metadata"
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                params,
            )
        assert overview()["my_missions"] is None
        req("GET", "/agent-mission-controls", status=403)
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='owner',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                params,
            )
            t.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                ),
                {**params, "acl": json.dumps(["alice", "task-manager", "task-agent"])},
            )
        assert overview()["my_missions"]["withheld"] == 0
        checks.append(
            "current author role loss removes category and control rights; restoration recovers exact visibility"
        )
        old = overview()["work_version"]
        receipt = command(expired, "stop", 1, reason="Fin de mandat expiré synthétique.")
        now = overview()
        assert (
            now["my_missions"]["expired"] == 0
            and now["my_missions"]["total"] == 5
            and now["work_version"] == old + 1
        )
        assert receipt["status"] == "stopped"
        checks.append(
            "confirmed stop updates work version and removes only its own non-stopped row"
        )
        r = client.post(
            "/mcp",
            headers={**fixture.headers("alice"), "accept": "application/json, text/event-stream"},
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
        assert r.status_code == 200, r.text[:100]
        wire = r.json()["result"]["structuredContent"]
        assert wire["http_status"] == 200 and wire["data"]["my_missions"] == now["my_missions"]
        assert req("GET", "/version") == before
        checks.append(
            "MCP uses same counts and authorized rows, accepted/published knowledge unchanged"
        )
    (OUT / "mission-overview-native-report.json").write_text(
        json.dumps({"synthetic_only": True, **state, "checks": checks}, indent=2)
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
