"""Qualify the verbatim contribution flow against native HTTP/MCP, synthetic only."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
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
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"

        def req(method, path, body=None, actor="reader", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (path, status, r.status_code, r.json().get("error"))
            return r.json()

        before = req("GET", "/version")
        source = req(
            "POST",
            "/sources",
            {
                "title": "Preuve de contribution Unicode",
                "content": "Préface 🧠. La revue dure cinq jours. Fin.",
                "location": "synthetic://source-contribution",
                "allowed_subjects": ["alice", "reader", "task-manager"],
            },
            actor="alice",
            status=201,
        )["id"]
        payload = {
            "base_version": before["published_version"],
            "reason": "Extrait synthétique à examiner",
            "idempotency_key": str(uuid4()),
            "changes": [
                {
                    "kind": "put_concept",
                    "concept": {
                        "concept_id": str(uuid4()),
                        "title": "Délai de revue à examiner",
                        "body": "La revue dure cinq jours.",
                        "maturity": "emerging",
                        "sources": [{"source_id": source, "start": 11, "end": 36}],
                        "links": [],
                    },
                }
            ],
        }
        result = req("POST", "/proposals", payload, status=201)
        assert result["status"] == "ready" and result["payload"] == payload["changes"]
        assert req("POST", "/proposals", payload, status=201) == result
        req("POST", "/proposals", {**payload, "reason": "different"}, status=409)
        checks.append("unicode_verbatim_ready_receipt_same_key_and_conflict")
        invalid = json.loads(json.dumps(payload))
        invalid["idempotency_key"] = str(uuid4())
        invalid["changes"][0]["concept"]["body"] = "La revue dure trois jours."
        req("POST", "/proposals", invalid, status=422)
        invalid["changes"][0]["concept"]["body"] = "La revue dure cinq jours."
        invalid["changes"][0]["concept"]["sources"][0]["start"] = 12
        req("POST", "/proposals", invalid, status=422)
        checks.append("reformulation_and_utf16_offset_rejected")
        req("POST", "/proposals", payload, actor="task-viewer", status=403)
        req("GET", f"/proposals/{result['id']}", actor="task-peer", status=404)
        with db.begin() as c:
            c.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source},
            )
        try:
            req("POST", "/proposals", payload, status=404)
            req("GET", f"/proposals/{result['id']}", status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    {"t": state["tenant"], "d": state["domain"], "s": source},
                )
        assert req("POST", "/proposals", payload, status=201)["id"] == result["id"]
        checks.append("current_role_and_source_acl_even_for_recovery")
        headers = {**fixture.headers("reader"), "Accept": "application/json, text/event-stream"}
        mcp = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_proposals_create",
                    "arguments": {"path": {"domain": state["domain"]}, "body": payload},
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 201 and mcp["data"]["id"] == result["id"]
        assert req("GET", "/version") == before
        checks.append("same_native_mcp_proposal_no_approval_or_publication")
        (OUT / "contribution-native-report.json").write_text(
            json.dumps(
                {
                    "synthetic_only": True,
                    "domain": state["domain"],
                    "source": source,
                    "proposal": result["id"],
                    "checks": checks,
                    "passed": len(checks),
                },
                indent=2,
            )
        )
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
