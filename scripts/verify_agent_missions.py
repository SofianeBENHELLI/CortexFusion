"""Exercise bounded named mission protocol on isolated synthetic data only."""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = task_fixture()
    u = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert u.host == "127.0.0.1" and u.port == 55432 and u.database.endswith("_test")
    db = create_engine(u)
    state = {**state, "domain": str(uuid4())}
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Missions bornées synthétiques')"
            ),
            {"t": state["tenant"], "d": state["domain"]},
        )
        for subject, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-manager", "corpus_manager"),
            ("task-peer", "contributor"),
            ("task-viewer", "viewer"),
            ("task-agent", "agent"),
            ("other-agent", "agent"),
        ] + [(f"agent-page-{i:02}", "agent") for i in range(22)]:
            tx.execute(
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
            assert r.status_code == status, (
                path,
                r.status_code,
                status,
                r.text[:200] if r.status_code != status else "",
            )
            return r.json()

        version = req("GET", "/version")
        body = "Préface 🧠. La revue dure cinq jours. Fin."
        source = req(
            "POST",
            "/sources",
            {
                "title": "Source de mission synthétique",
                "content": body,
                "location": f"synthetic://mission/{uuid4()}",
                "allowed_subjects": ["alice", "task-agent", "task-manager"],
            },
            status=201,
        )
        state["source"] = source["id"]
        m = {
            "title": "Vérifier le délai synthétique",
            "objective": "Lire le passage autorisé puis rédiger un rapport candidat.",
            "criteria": "Citer la plage lue et distinguer observation et hypothèse.",
            "agent": "task-agent",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "max_reads": 3,
            "max_chars": len(body) * 2,
            "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        }

        def make(mandate=None):
            v = mandate or m
            p = req("POST", "/agent-missions/prepare", v)
            b = {
                "mandate": v,
                "preparation_id": p["preparation_id"],
                "idempotency_key": str(uuid4()),
            }
            r = req("POST", "/agent-missions/create", b)
            return r["mission_id"], r, b

        a = req("GET", "/agent-missions/candidates?limit=20")
        b = req("GET", "/agent-missions/candidates?limit=20&after=" + a["next_after"])
        assert len(a["items"]) == 20 and len(b["items"]) == 4 and b["next_after"] is None
        req("GET", "/agent-missions/candidates", actor="task-agent", status=403)
        for actor in ["reader", "task-viewer", "task-agent"]:
            req("POST", "/agent-missions/prepare", m, actor=actor, status=403)
        req("POST", "/agent-missions/prepare", {**m, "agent": "other-agent"}, status=404)
        req("POST", "/agent-missions/prepare", {**m, "max_chars": 100001}, status=422)
        req("POST", "/agent-missions/prepare", {**m, "provider": "external"}, status=422)
        expired_p = req("POST", "/agent-missions/prepare", m)
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role=role,revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='task-agent'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req(
            "POST",
            "/agent-missions/create",
            {
                "mandate": m,
                "preparation_id": expired_p["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
            status=409,
        )
        checks.append(
            "candidate pagination, roles, existing source access, strict fields and preparation authorization binding"
        )
        ident, r, create = make()
        state["mission"] = ident
        path = "/agent-missions/" + ident
        assert req("POST", "/agent-missions/create", create) == r
        req(
            "POST",
            "/agent-missions/create",
            {**create, "idempotency_key": str(uuid4())},
            status=409,
        )
        for actor in ["task-manager", "other-agent"]:
            req("GET", path, actor=actor, status=404)
        assert req("GET", path)["provider"] == "none" and req("GET", path)["allowed_actions"] == [
            "stop"
        ]
        claim = {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())}
        req("POST", path + "/commands", claim, status=403)
        with ThreadPoolExecutor(2) as pool:
            responses = list(
                pool.map(
                    lambda k: client.post(
                        base + path + "/commands",
                        headers=fixture.headers("task-agent"),
                        json={**claim, "idempotency_key": k},
                    ),
                    [claim["idempotency_key"], str(uuid4())],
                )
            )
        assert sorted(r.status_code for r in responses) == [200, 409]
        claimed = next(r.json() for r in responses if r.status_code == 200)
        lease = claimed["lease_id"]
        revision = claimed["revision"]
        checks.append(
            "immutable creation idempotence, named isolation and concurrent lease claim single winner"
        )
        read = {
            "expected_revision": revision,
            "lease_id": lease,
            "start": 0,
            "end": len(body),
            "idempotency_key": str(uuid4()),
        }
        got = req("POST", path + "/read-source", read, actor="task-agent")
        assert (
            got["excerpt"] == body
            and got["total_characters"] == len(body)
            and got["receipt"]["chars_used"] == len(body)
        )
        assert req("POST", path + "/read-source", read, actor="task-agent") == got
        req(
            "POST",
            path + "/read-source",
            {**read, "end": len(body) - 1},
            actor="task-agent",
            status=409,
        )
        revision = got["receipt"]["revision"]
        req(
            "POST",
            path + "/read-source",
            {
                **read,
                "expected_revision": revision,
                "end": len(body) + 1,
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
            status=422,
        )
        second = req(
            "POST",
            path + "/read-source",
            {**read, "expected_revision": revision, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        revision = second["receipt"]["revision"]
        req(
            "POST",
            path + "/read-source",
            {
                **read,
                "expected_revision": revision,
                "start": 0,
                "end": 1,
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
            status=429,
        )
        assert req("GET", path)["chars_used"] == len(body) * 2
        checks.append("Unicode exact reads, range refusal, durable budget and replay charged once")
        stop = req(
            "POST",
            path + "/commands",
            {
                "action": "stop",
                "expected_revision": revision,
                "reason": "Pause synthétique",
                "idempotency_key": str(uuid4()),
            },
        )
        revision = stop["revision"]
        req("POST", path + "/read-source", read, actor="task-agent", status=409)
        resumed = req(
            "POST",
            path + "/commands",
            {
                "action": "resume",
                "expected_revision": revision,
                "reason": "Reprise explicite",
                "idempotency_key": str(uuid4()),
            },
        )
        assert resumed["chars_used"] == len(body) * 2
        claimed = req(
            "POST",
            path + "/commands",
            {
                "action": "claim",
                "expected_revision": resumed["revision"],
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
        )
        assert claimed["lease_id"] != lease
        lease = claimed["lease_id"]
        revision = claimed["revision"]
        report = {
            "expected_revision": revision,
            "lease_id": lease,
            "idempotency_key": str(uuid4()),
            "report": "Observation synthétique : le passage indique cinq jours.",
            "hypotheses": "Point de départ non évalué, rapport candidat uniquement.",
            "evidence": [{"start": 11, "end": 34}],
        }
        req(
            "POST",
            path + "/complete",
            {**report, "evidence": [{"start": 0, "end": len(body) + 1}]},
            actor="task-agent",
            status=422,
        )
        final = req("POST", path + "/complete", report, actor="task-agent")
        assert final["status"] == "completed"
        assert req("POST", path + "/complete", report, actor="task-agent") == final
        req(
            "POST",
            path + "/commands",
            {
                "action": "stop",
                "expected_revision": final["revision"],
                "reason": "Non applicable",
                "idempotency_key": str(uuid4()),
            },
            status=409,
        )
        detail = req("GET", path)
        assert detail["report"] == report["report"] and detail["allowed_actions"] == []
        checks.append(
            "stop/restart retains budgets, replaces lease, verified read references and candidate report idempotence"
        )
        ident2, r2, _ = make()
        path2 = "/agent-missions/" + ident2
        c2 = req(
            "POST",
            path2 + "/commands",
            {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_agent_missions SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                ),
                {"t": state["tenant"], "d": state["domain"], "i": ident2},
            )
        req(
            "POST",
            path2 + "/commands",
            {
                "action": "renew",
                "expected_revision": 2,
                "lease_id": c2["lease_id"],
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
            status=409,
        )
        c3 = req(
            "POST",
            path2 + "/commands",
            {"action": "claim", "expected_revision": 2, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        assert c3["lease_id"] != c2["lease_id"]
        req(
            "POST",
            path2 + "/read-source",
            {
                **read,
                "expected_revision": 3,
                "lease_id": c2["lease_id"],
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
            status=409,
        )
        renewed = req(
            "POST",
            path2 + "/commands",
            {
                "action": "renew",
                "expected_revision": 3,
                "lease_id": c3["lease_id"],
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
        )
        assert renewed["revision"] == 4 and renewed["lease_id"] == c3["lease_id"]
        checks.append(
            "expired lease cannot renew/read, recovery replaces lease and renewal is versioned"
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                ),
                {
                    "acl": json.dumps(["alice", "task-manager"]),
                    "t": state["tenant"],
                    "d": state["domain"],
                    "i": source["id"],
                },
            )
        req("GET", path, status=404)
        req("GET", path, actor="task-agent", status=404)
        req("POST", path + "/read-source", read, actor="task-agent", status=404)
        assert req("GET", "/agent-missions")["items"] == []
        lookup = req(
            "GET", "/agent-mission-receipts/" + report["idempotency_key"], actor="task-agent"
        )
        assert lookup["receipt"] == final and "report" not in json.dumps(lookup)
        req("GET", "/agent-mission-receipts/" + report["idempotency_key"], status=404)
        controls = req("GET", "/agent-mission-controls?limit=1")
        continuation = req("GET", "/agent-mission-controls?limit=1&after=" + controls["next_after"])
        controls_all = controls["items"] + continuation["items"]
        assert {c["id"] for c in controls_all} == {ident, ident2} and continuation[
            "next_after"
        ] is None
        control_keys = {
            "id",
            "status",
            "revision",
            "max_reads",
            "max_chars",
            "reads_used",
            "chars_used",
            "expires_at",
            "created_at",
            "expired",
            "can_stop",
            "content_withheld",
        }
        assert all(set(c) == control_keys and c["content_withheld"] is True for c in controls_all)
        minimal = req("GET", "/agent-mission-controls/" + ident2)
        assert minimal["can_stop"] and minimal["revision"] == 4
        for actor in ["task-agent", "reader", "task-viewer"]:
            req("GET", "/agent-mission-controls", actor=actor, status=403)
            req("GET", "/agent-mission-controls/" + ident2, actor=actor, status=403)
        assert req("GET", "/agent-mission-controls", actor="task-manager")["items"] == []
        req("GET", "/agent-mission-controls/" + ident2, actor="task-manager", status=404)
        checks.append(
            "author-only paginated control projection survives source loss without source, mandate, service or report fields"
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req("GET", "/agent-mission-controls", status=403)
        req("GET", "/agent-mission-controls/" + ident2, status=403)
        req(
            "POST",
            path2 + "/commands",
            {
                "action": "stop",
                "expected_revision": 4,
                "reason": "Refus de coordination synthétique",
                "idempotency_key": str(uuid4()),
            },
            status=403,
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='owner',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        checks.append(
            "loss of current coordinator role revokes both content-free controls and stop command"
        )
        stopped = req(
            "POST",
            path2 + "/commands",
            {
                "action": "stop",
                "expected_revision": 4,
                "reason": "Arrêt après retrait de source",
                "idempotency_key": str(uuid4()),
            },
        )
        assert stopped["status"] == "stopped"
        assert not req("GET", "/agent-mission-controls/" + ident2)["can_stop"]
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                ),
                {
                    "acl": json.dumps(["alice", "task-manager", "task-agent"]),
                    "t": state["tenant"],
                    "d": state["domain"],
                    "i": source["id"],
                },
            )
        checks.append(
            "source revocation masks lists/detail/replays but preserves own content-free receipt and author stop"
        )
        first = req("GET", path + "/events?limit=2")
        last = first["next_after"]
        events = first["items"][:]
        while last:
            page = req("GET", path + "/events?limit=2&after=" + last)
            events.extend(page["items"])
            last = page["next_after"]
        assert [e["revision"] for e in events] == list(range(1, final["revision"] + 1)) and len(
            {e["id"] for e in events}
        ) == len(events)
        assert all(
            "lease_id" not in e and "report" not in e and "idempotency_key" not in e for e in events
        )
        headers = {**fixture.headers("task-agent"), "accept": "application/json, text/event-stream"}
        response = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_agent_missions_read",
                    "arguments": {"path": {"domain": state["domain"], "mission": ident}},
                },
            },
        )
        assert response.status_code == 200, response.text[:200]
        structured = response.json()["result"]["structuredContent"]
        assert structured["http_status"] == 200 and structured["data"]["report"] == report["report"]
        assert req("GET", "/version") == version
        checks.append(
            "ordered immutable event pagination, MCP parity and accepted/published knowledge unchanged"
        )
        # Independent read-count exhaustion, even while character budget remains.
        bounded_id, bounded_receipt, _ = make({**m, "max_reads": 1, "max_chars": 10})
        bp = "/agent-missions/" + bounded_id
        lease = req(
            "POST",
            bp + "/commands",
            {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        read_body = {
            "expected_revision": 2,
            "idempotency_key": str(uuid4()),
            "lease_id": lease["lease_id"],
            "start": 0,
            "end": 1,
        }
        req("POST", bp + "/read-source", read_body, actor="task-agent")
        req(
            "POST",
            bp + "/read-source",
            {**read_body, "expected_revision": 3, "idempotency_key": str(uuid4())},
            actor="task-agent",
            status=429,
        )
        status = req("GET", bp)
        assert status["reads_used"] == 1 and status["chars_used"] == 1 and status["revision"] == 3
        checks.append("read-count budget independently enforced with character capacity remaining")
        # Real deadline; no database clock or immutable mandate bypass.
        deadline = datetime.now(UTC) + timedelta(seconds=4)
        expiring, _, _ = make({**m, "expires_at": deadline.isoformat()})
        ep = "/agent-missions/" + expiring
        lease = req(
            "POST",
            ep + "/commands",
            {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        read_body = {
            "expected_revision": 2,
            "idempotency_key": str(uuid4()),
            "lease_id": lease["lease_id"],
            "start": 0,
            "end": 1,
        }
        req("POST", ep + "/read-source", read_body, actor="task-agent")
        time.sleep(max(0, (deadline - datetime.now(UTC)).total_seconds()) + 0.1)
        status = req("GET", ep)
        assert status["expired"] and not status["allowed_actions"] and status["revision"] == 3
        req("POST", ep + "/read-source", read_body, actor="task-agent", status=409)
        req(
            "POST",
            ep + "/commands",
            {
                "action": "renew",
                "lease_id": lease["lease_id"],
                "expected_revision": 3,
                "idempotency_key": str(uuid4()),
            },
            actor="task-agent",
            status=409,
        )
        req(
            "POST",
            ep + "/complete",
            {
                "expected_revision": 3,
                "idempotency_key": str(uuid4()),
                "lease_id": lease["lease_id"],
                "report": "Candidat synthétique",
                "hypotheses": "Limite",
                "evidence": [{"start": 0, "end": 1}],
            },
            actor="task-agent",
            status=409,
        )
        assert req("GET", ep)["revision"] == 3
        req(
            "POST", "/agent-missions/prepare", {**m, "expires_at": deadline.isoformat()}, status=422
        )
        checks.append(
            "real mandate expiry revokes actions, old read replay, renewal and completion without resetting budgets"
        )
        with db.connect() as t:
            rows = t.execute(
                text(
                    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('cf_agent_missions','cf_agent_mission_preparations','cf_agent_mission_commands')"
                )
            ).all()
            assert len(rows) == 3 and all(a and b for _, a, b in rows)
        checks.append("forced RLS on all additive mission tables")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "agent-missions-native-report.json").write_text(
        json.dumps({"fixture": state, "checks": checks, "count": len(checks)}, indent=2)
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
