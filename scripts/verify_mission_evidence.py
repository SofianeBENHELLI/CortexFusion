"""Verify completed mission evidence and bounded long Unicode source reads."""

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
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Preuves des missions synthétiques')"
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

        before = req("GET", "/version")
        prefix = "Préface 🧠 é. " * 10000
        excerpt = "La revue 🧠 dure cinq jours. é"
        body = prefix + excerpt + " Fin."
        start, end = len(prefix), len(prefix) + len(excerpt)
        source = req(
            "POST",
            "/sources",
            {
                "title": "Longue source synthétique",
                "content": body,
                "location": f"synthetic://mission-evidence/{uuid4()}",
                "allowed_subjects": ["alice", "task-manager", "task-agent"],
            },
            status=201,
        )
        state["source"] = source["id"]
        mandate = {
            "title": "Vérifier le passage final",
            "objective": "Relire un passage Unicode en fin de source longue.",
            "criteria": "Citer exactement le passage lu.",
            "agent": "task-agent",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "max_reads": 1,
            "max_chars": len(excerpt),
            "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        }
        prep = req("POST", "/agent-missions/prepare", mandate)
        assert prep["source"]["characters"] == len(body) and "content" not in prep["source"]
        created = req(
            "POST",
            "/agent-missions/create",
            {
                "mandate": mandate,
                "preparation_id": prep["preparation_id"],
                "idempotency_key": str(uuid4()),
            },
        )
        state["mission"] = created["mission_id"]
        path = "/agent-missions/" + state["mission"]
        claim = req(
            "POST",
            path + "/commands",
            {"action": "claim", "expected_revision": 1, "idempotency_key": str(uuid4())},
            actor="task-agent",
        )
        read = req(
            "POST",
            path + "/read-source",
            {
                "expected_revision": 2,
                "idempotency_key": str(uuid4()),
                "lease_id": claim["lease_id"],
                "start": start,
                "end": end,
            },
            actor="task-agent",
        )
        assert (
            read["excerpt"] == excerpt
            and read["total_characters"] == len(body)
            and read["receipt"]["chars_used"] == len(excerpt)
        )
        checks.append(
            "long source tail is exact in Unicode with a budget only as large as that passage"
        )
        req("GET", path + "/evidence/1?expected_revision=3", status=409)
        done = req(
            "POST",
            path + "/complete",
            {
                "expected_revision": 3,
                "idempotency_key": str(uuid4()),
                "lease_id": claim["lease_id"],
                "report": "Le passage annonce cinq jours.",
                "hypotheses": "Le début du délai reste à vérifier.",
                "evidence": [{"start": start, "end": end}],
            },
            actor="task-agent",
        )
        assert done["revision"] == 4
        snapshot = req("GET", path)
        events = req("GET", path + "/events")
        endpoint = path + "/evidence/1?expected_revision=4"
        got = req("GET", endpoint)
        assert (
            got["excerpt"] == excerpt
            and got["start"] == start
            and got["end"] == end
            and got["total_characters"] == len(body)
        )
        assert (
            got["source_hash"] == source["content_hash"]
            and got["read_kind"] == "human_report_review"
            and got["mission_revision"] == 4
        )
        assert len(json.dumps(got).encode()) < 2048
        assert (
            req("GET", endpoint) == got
            and req("GET", path) == snapshot
            and req("GET", path + "/events") == events
        )
        checks.append(
            "author proof is version/hash bound, exact, repeatable and changes neither counters nor journal"
        )
        for actor, status in [
            ("task-agent", 403),
            ("task-manager", 404),
            ("reader", 403),
            ("task-viewer", 403),
        ]:
            req("GET", endpoint, actor=actor, status=status)
        for query in ["", "?expected_revision=0", "?expected_revision=4&unknown=1"]:
            req("GET", path + "/evidence/1" + query, status=422)
        req("GET", path + "/evidence/1?expected_revision=3", status=409)
        for index in [0, 2, 10, 11]:
            req("GET", path + f"/evidence/{index}?expected_revision=4", status=422)
        checks.append(
            "other identities, wrong revision, missing/extra query and unlisted spans are refused"
        )

        def acl(subjects):
            with db.begin() as t:
                t.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:i"
                    ),
                    {
                        "acl": json.dumps(subjects),
                        "t": state["tenant"],
                        "d": state["domain"],
                        "i": source["id"],
                    },
                )

        for subjects in [["alice", "task-manager"], ["task-agent", "task-manager"]]:
            acl(subjects)
            req("GET", endpoint, status=404)
        acl(["alice", "task-manager", "task-agent"])
        assert req("GET", endpoint) == got
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='contributor',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='task-agent'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        req("GET", endpoint, status=404)
        with db.begin() as t:
            t.execute(
                text(
                    "UPDATE cf_memberships SET role='agent',revision=revision+1 WHERE tenant_id=:t AND domain_id=:d AND subject='task-agent'"
                ),
                {"t": state["tenant"], "d": state["domain"]},
            )
        assert req("GET", endpoint) == got
        checks.append(
            "author or agent source revocation and agent role loss revoke proof access; restoration is exact"
        )
        response = client.post(
            "/mcp",
            headers={**fixture.headers("alice"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_agent_missions_evidence",
                    "arguments": {
                        "path": {
                            "domain": state["domain"],
                            "mission": state["mission"],
                            "index": "1",
                        },
                        "query": {"expected_revision": 4},
                    },
                },
            },
        )
        result = response.json()["result"]["structuredContent"]
        assert result["http_status"] == 200 and result["data"] == got
        checks.append("MCP uses the same author-only version-bound read contract")
        assert req("GET", "/version") == before
        checks.append("no knowledge version or publication change")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "mission-evidence-native-report.json").write_text(
        json.dumps(
            {
                "fixture": state,
                "source_characters": len(body),
                "passage_characters": len(excerpt),
                "checks": checks,
                "count": len(checks),
            },
            indent=2,
        )
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
