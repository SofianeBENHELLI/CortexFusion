"""Verify reference receipts without source content, on a new synthetic source only."""

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

        def request(method, path, body=None, actor="reader", status=200):
            r = client.request(method, base + path, headers=fixture.headers(actor), json=body)
            assert r.status_code == status, (path, r.status_code, status)
            return r.json()

        version = request("GET", "/version")
        source = request(
            "POST",
            "/sources",
            {
                "title": "Preuve de reçu synthétique",
                "content": "Cinq jours.",
                "location": f"synthetic://receipt/{uuid4()}",
                "allowed_subjects": ["alice", "reader"],
            },
            actor="alice",
            status=201,
        )
        question = str(uuid4())
        command = str(uuid4())
        body = {
            "content": {
                "theme": "Revue",
                "question": "Quelle durée ?",
                "criteria": "Cinq jours.",
                "excerpt": "Cinq jours.",
                "source_id": source["id"],
                "source_hash": source["content_hash"],
                "selection": {"start": 0, "end": 11},
            },
            "expected_revision": 0,
            "idempotency_key": command,
        }
        path = "/reference-drafts/" + question
        rp = "/reference-draft-receipts/" + command
        receipt = request("POST", path, body)
        record = request("GET", rp)
        assert record == {"command_id": command, "receipt": receipt}
        for actor, status in [
            ("alice", 404),
            ("task-peer", 404),
            ("task-viewer", 403),
            ("outsider", 404),
        ]:
            request("GET", rp, actor=actor, status=status)
        request("GET", "/reference-draft-receipts/" + str(uuid4()), status=404)
        checks.append("exact_author_receipt_no_owner_override_or_missing_success")
        params = {"t": state["tenant"], "d": state["domain"], "s": source["id"]}
        try:
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    params,
                )
            request("GET", path, status=404)
            request("POST", path, body, status=404)
            assert request("GET", rp) == record
            raw = json.dumps(record)
            assert "Cinq" not in raw and "source" not in raw and "content" not in raw
            checks.append("receipt_survives_source_revocation_without_revealing_content")
        finally:
            with db.begin() as tx:
                tx.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    params,
                )
        request(
            "POST",
            path,
            {
                **body,
                "expected_revision": 1,
                "idempotency_key": str(uuid4()),
                "content": {**body["content"], "theme": "Révision suivante"},
            },
        )
        assert request("GET", rp) == record and request("GET", path)["revision"] == 2
        checks.append("historical_receipt_does_not_overwrite_newer_revision")
        mcp = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_reference_draft_receipts_read",
                    "arguments": {"path": {"domain": state["domain"], "command_id": command}},
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200 and mcp["data"] == record
        assert request("GET", "/version") == version
        checks.append("mcp_same_receipt_no_knowledge_version_change")
        report = {
            "synthetic_only": True,
            "tenant": state["tenant"],
            "domain": state["domain"],
            "source": source["id"],
            "question": question,
            "command": command,
            "passed": len(checks),
            "checks": checks,
        }
        (OUT / "reference-receipts-native-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
