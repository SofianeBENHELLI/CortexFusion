"""Native draft isolation/concurrency over an existing synthetic fixture, no ingestion."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import OUT, schema_head

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = Path(
    os.environ.get("CORTEX_QUALIFICATION_FIXTURE") or ROOT / ".runtime/brain/aud02-native-20261005"
)


def main():
    state = json.loads((DIRECTORY / "state.json").read_text())
    assert state["synthetic_only"] is True
    database = make_url(os.environ["CORTEX_RUST_DATABASE_URL"])
    assert database.host == "127.0.0.1" and database.database.endswith("_test")
    fixture = Fixture(
        state["tenant"], {"identity": (DIRECTORY / "identity-private.pem").read_bytes()}
    )
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(DIRECTORY / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:

        def request(method, path, status=200, actor="reader", payload=None):
            response = client.request(method, path, headers=fixture.headers(actor), json=payload)
            assert response.status_code == status, (method, status, response.status_code)
            return response.json()

        assert request("GET", "/ready")["schema_revision"] == schema_head()
        checks.append("ready0029")
        domain = state["domain"]
        base = f"/v1/domains/{domain}"
        conversation = request(
            "POST",
            base + "/conversations",
            201,
            payload={"title": "Recette brouillons privés", "idempotency_key": str(uuid4())},
        )["id"]
        path = base + "/conversation-drafts/" + conversation
        empty = request("GET", path)
        assert empty["text"] == "" and empty["revision"] == 0
        checks.append("empty_private_draft")
        body = {
            "text": "Brouillon synthétique 🧠",
            "expected_revision": 0,
            "idempotency_key": str(uuid4()),
        }
        first = request("POST", path, payload=body)
        assert first["revision"] == 1 and "text" not in first
        assert request("POST", path, payload=body) == first
        checks.append("save_and_exact_retry")
        assert request("GET", path)["text"] == body["text"]
        checks.append("fresh_readback")
        request("POST", path, 409, payload={**body, "text": "Different"})
        checks.append("idempotency_conflict")
        request("GET", path, 404, actor="alice")
        request("GET", path, 404, actor="outsider")
        checks.append("owner_and_nonmember_cannot_read_private_draft")
        request("POST", path, 404, actor="alice", payload=body)
        checks.append("owner_cannot_write_private_draft")
        request("POST", path, 409, payload={**body, "idempotency_key": str(uuid4())})
        checks.append("stale_revision_refused")

        def concurrent(text):
            response = client.post(
                path,
                headers=fixture.headers("reader"),
                json={"text": text, "expected_revision": 1, "idempotency_key": str(uuid4())},
            )
            return response.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(concurrent, ["Concurrent A", "Concurrent B"]))
        assert statuses == [200, 409]
        assert request("GET", path)["revision"] == 2
        checks.append("two_writers_one_success_one_conflict")
        assert request("POST", path, payload=body) == first
        assert request("GET", path)["revision"] == 2
        checks.append("old_receipt_does_not_overwrite_later_save")
        for invalid in [
            {**body, "text": "🧠" * 2001},
            {**body, "expected_revision": -1},
            {**body, "author": "alice"},
            {**body, "expected_revision": 9007199254740991},
        ]:
            request("POST", path, 422, payload=invalid)
        checks.append("unicode_limit_revision_bound_unknown_fields")
        request("GET", base + "/conversation-drafts/arbitrary", 422)
        checks.append("invalid_key")
        clear = request(
            "POST",
            path,
            payload={"text": "", "expected_revision": 2, "idempotency_key": str(uuid4())},
        )
        assert clear["revision"] == 3 and request("GET", path)["text"] == ""
        checks.append("explicit_clear_preserves_revision_history")
        owner_conv = request(
            "POST",
            base + "/conversations",
            201,
            actor="alice",
            payload={"title": "Owner draft test", "idempotency_key": str(uuid4())},
        )["id"]
        request("GET", base + "/conversation-drafts/" + owner_conv, 404)
        checks.append("cross_subject_conversation_isolation")

        def rpc(name, args, actor="reader"):
            result = client.post(
                "/mcp/",
                headers={**fixture.headers(actor), "Accept": "application/json, text/event-stream"},
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": args},
                },
            )
            assert result.status_code == 200
            return result.json()["result"]["structuredContent"]

        args = {"path": {"domain": domain, "draft_key": conversation}}
        assert rpc("api_drafts_read", args)["data"]["revision"] == 3
        assert rpc("api_drafts_read", args, "alice")["http_status"] == 404
        checks.append("mcp_read_same_ownership")
        draft = {
            "text": "MCP synthetic draft",
            "expected_revision": 3,
            "idempotency_key": str(uuid4()),
        }
        mcp_save = rpc("api_drafts_save", {**args, "body": draft})
        assert mcp_save["http_status"] == 200 and mcp_save["data"]["revision"] == 4
        assert request("POST", path, payload=draft) == mcp_save["data"]
        checks.append("mcp_save_http_retry_same_receipt")

    report = {
        "status": "passed",
        "checks": checks,
        "denominator": len(checks),
        "fixture_reingested": False,
        "private_okf_touched": False,
    }
    (OUT / "draft-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
