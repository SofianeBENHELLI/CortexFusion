"""Verify the personal work inbox without accepting or approving business work."""

import json
import os
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
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Boîte de réception synthétique')"
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

        assert client.get("/ready").json()["schema_revision"] == "0043"
        before = req("GET", "/version")
        source = req(
            "POST",
            "/sources",
            {
                "title": "Source de la boîte de réception",
                "content": "La revue dure cinq jours.",
                "location": f"synthetic://inbox/{uuid4()}",
                "allowed_subjects": ["alice", "reader", "task-manager", "task-agent"],
            },
            status=201,
        )
        state["source"] = source["id"]
        task = req(
            "POST",
            "/tasks",
            {
                "title": "Relire le délai",
                "instructions": "Vérifier la durée synthétique.",
                "criteria": "Citer le passage.",
                "idempotency_key": str(uuid4()),
            },
        )
        task_id = task["task_id"]
        state["task"] = task_id
        req(
            "POST",
            f"/tasks/{task_id}/commands",
            {
                "action": "offer",
                "expected_revision": 1,
                "assignee": "reader",
                "reason": "Délégation de recette",
                "idempotency_key": str(uuid4()),
            },
        )
        question = str(uuid4())
        state["question"] = question
        req(
            "POST",
            f"/reference-drafts/{question}",
            {
                "expected_revision": 0,
                "idempotency_key": str(uuid4()),
                "content": {
                    "theme": "Délai",
                    "question": "Combien de jours dure la revue ?",
                    "criteria": "Citer cinq jours.",
                    "source_id": source["id"],
                    "source_hash": source["content_hash"],
                    "excerpt": "La revue dure cinq jours.",
                    "selection": {"start": 0, "end": 25},
                },
            },
            actor="reader",
        )
        selection = {"question_id": question, "draft_revision": 1, "reviewer": "alice"}
        prep = req("POST", "/reference-reviews/prepare", selection, actor="reader")
        review = req(
            "POST",
            "/reference-reviews/submit",
            {
                **selection,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
            actor="reader",
        )
        review_id = review["review_id"]
        state["review"] = review_id
        m = {
            "title": "Mission du délai",
            "objective": "Relire le passage.",
            "criteria": "Citer la durée exacte.",
            "agent": "task-agent",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "max_reads": 2,
            "max_chars": 100,
            "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        }
        prep = req("POST", "/agent-missions/prepare", m)
        created = req(
            "POST",
            "/agent-missions/create",
            {
                "mandate": m,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
        )
        mid = created["mission_id"]
        state["mission"] = mid
        mp = f"/agent-missions/{mid}"
        claim = req(
            "POST",
            mp + "/commands",
            {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        req(
            "POST",
            mp + "/read-source",
            {
                "expected_revision": 2,
                "lease_id": claim["lease_id"],
                "idempotency_key": str(uuid4()),
                "start": 0,
                "end": 25,
            },
            actor="task-agent",
        )
        req(
            "POST",
            mp + "/complete",
            {
                "expected_revision": 3,
                "lease_id": claim["lease_id"],
                "idempotency_key": str(uuid4()),
                "report": "Le délai est de cinq jours.",
                "hypotheses": "Point de départ à préciser.",
                "evidence": [{"start": 0, "end": 25}],
            },
            actor="task-agent",
        )

        def inbox(actor="alice", query=""):
            return req("GET", "/work-activity" + query, actor=actor)

        v = inbox()
        assert {n["kind"] for n in v["items"]} == {"task", "reference_review", "mission"}
        assert v["unread"] == v["total"] == len(v["items"])
        assert len([n for n in v["items"] if n["kind"] == "mission"]) == 2
        assert all(
            not any(
                k in n
                for k in [
                    "note",
                    "report",
                    "source_id",
                    "source_hash",
                    "idempotency_key",
                    "content",
                ]
            )
            for n in v["items"]
        )
        assert all(n["kind"] == "task" for n in inbox("reader")["items"])
        assert all(n["kind"] == "task" for n in inbox("task-manager")["items"])
        assert inbox("task-viewer")["total"] == 0
        for actor in ["task-agent"]:
            req("GET", "/work-activity", actor=actor, status=403)
        checks.append(
            "three personal event families, complete counters, no own review events, no agent read noise or private payload"
        )
        first = inbox(query="?limit=1")
        items = first["items"][:]
        cursor = first["next_after"]
        while cursor:
            page = inbox(query="?limit=1&after=" + cursor)
            assert page["as_of"] == first["as_of"]
            items += page["items"]
            cursor = page["next_after"]
        assert items == v["items"]
        checks.append("stable chronological opaque pagination covers every visible event once")
        event = next(n for n in v["items"] if n["kind"] == "mission" and n["action"] == "complete")
        body = {"kind": "mission", "idempotency_key": str(uuid4())}
        endpoint = f"/work-activity/{event['event_id']}/read"
        snap = req("GET", mp)
        journal = req("GET", mp + "/events")
        marked = req("POST", endpoint, body)
        assert req("POST", endpoint, body) == marked
        assert (
            inbox()["unread"] == v["total"] - 1
            and req("GET", mp) == snap
            and req("GET", mp + "/events") == journal
        )
        req("GET", "/work-activity?limit=1&after=" + first["next_after"], status=409)
        other = next(n for n in v["items"] if n["kind"] == "reference_review")
        req(
            "POST",
            f"/work-activity/{other['event_id']}/read",
            {**body, "kind": "reference_review"},
            status=409,
        )
        req("POST", endpoint, body, actor="task-manager", status=404)
        req("POST", endpoint, {**body, "kind": "task"}, status=404)
        checks.append(
            "read receipt idempotent, wrong target/key and another actor refused; no mission mutation; old cursor stale"
        )
        reader_items = inbox("reader")["items"]
        te = reader_items[0]
        req(
            "POST",
            f"/work-activity/{te['event_id']}/read",
            {"kind": "task", "idempotency_key": str(uuid4())},
            actor="reader",
        )
        assert (
            next(
                n
                for n in req("GET", "/task-notifications", actor="reader")["items"]
                if n["event_id"] == te["event_id"]
            )["read_at"]
            is not None
        )
        assert req("GET", f"/tasks/{task_id}")["status"] == "offered"
        checks.append(
            "task read marker is shared with existing task inbox without accepting the assignment"
        )
        first = inbox(query="?limit=1")
        params = {"t": state["tenant"], "d": state["domain"], "i": source["id"]}
        with db.begin() as t:
            t.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["reader","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:i'
                ),
                params,
            )
        req("GET", "/work-activity?limit=1&after=" + first["next_after"], status=409)
        masked = inbox()
        assert all(n["kind"] != "reference_review" for n in masked["items"])
        assert all(
            n["title"] is None and n["actor"] is None and not n["content_available"]
            for n in masked["items"]
            if n["kind"] == "mission"
        )
        req(
            "POST",
            f"/work-activity/{other['event_id']}/read",
            {"kind": "reference_review", "idempotency_key": str(uuid4())},
            status=404,
        )
        with db.begin() as t:
            t.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager","task-agent"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:i'
                ),
                params,
            )
        assert inbox()["total"] == v["total"]
        checks.append(
            "source ACL invalidates cursor, hides reviews and strips mission title/actor while retaining authorized control events"
        )
        opinion = req(
            "POST",
            f"/reference-reviews/{review_id}/commands",
            {
                "action": "request_changes",
                "expected_revision": 1,
                "note": "Préciser le point de départ.",
                "idempotency_key": str(uuid4()),
            },
        )
        assert any(
            n["kind"] == "reference_review" and n["action"] == "request_changes"
            for n in inbox("reader")["items"]
        )
        req(
            "POST",
            f"/reference-reviews/{review_id}/commands",
            {
                "action": "withdraw",
                "expected_revision": opinion["revision"],
                "note": "Copie retirée en recette.",
                "idempotency_key": str(uuid4()),
            },
            actor="reader",
        )
        withdrawn = [n for n in inbox()["items"] if n["kind"] == "reference_review"]
        assert len(withdrawn) == 2 and all(
            n["current_status"] == "withdrawn" and n["title"] is None and n["actor"] is None
            for n in withdrawn
        )
        checks.append(
            "review opinions reach their author; withdrawal masks old incoming event titles and actors"
        )
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='viewer' WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        assert inbox()["total"] == 0
        req("POST", endpoint, body, status=404)
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='owner' WHERE tenant_id=:t AND domain_id=:d AND subject='alice'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        checks.append(
            "viewer downgrade hides historical tasks, named reviews and own mission notifications; previous read receipt does not reopen them"
        )
        response = client.post(
            "/mcp",
            headers={**fixture.headers("alice"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_work_activity_list",
                    "arguments": {"path": {"domain": state["domain"]}},
                },
            },
        )
        result = response.json()["result"]["structuredContent"]
        assert result["http_status"] == 200 and result["data"]["items"] == inbox()["items"]
        assert req("GET", "/version") == before
        checks.append("MCP personal inbox parity and unchanged knowledge version")
    (OUT / "work-activity-native-report.json").write_text(
        json.dumps({"fixture": state, "checks": checks, "count": len(checks)}, indent=2)
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
