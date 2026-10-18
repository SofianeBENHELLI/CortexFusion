"""Private contribution draft invariants over native HTTP/MCP, synthetic only."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = {**task_fixture(), "domain": str(uuid4())}
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
    db = create_engine(url)
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Brouillon à preuve distante')"
            ),
            state,
        )
        for actor, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-manager", "corpus_manager"),
            ("task-viewer", "viewer"),
        ]:
            tx.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:actor,:role)"
                ),
                {**state, "actor": actor, "role": role},
            )
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

        source = req(
            "POST",
            "/sources",
            {
                "title": "Brouillon synthétique Unicode",
                "content": "🧠" * 150000 + "Préface 🧠. La revue dure cinq jours. Fin.",
                "location": f"synthetic://draft/{uuid4()}",
                "allowed_subjects": ["alice", "reader", "task-manager"],
            },
            actor="alice",
            status=201,
        )
        path = "/contribution-draft"
        previous = req("GET", path)
        req(
            "POST",
            path,
            {"expected_revision": previous["revision"], "idempotency_key": str(uuid4())},
            status=422,
        )
        owner_before = req("GET", path, actor="alice")
        version = req("GET", "/version")
        content = {
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "title": "Projet Unicode",
            "excerpt": "La revue dure cinq jours.",
            "reason": "",
            "selection": {"start": 150011, "end": 150036},
        }
        body = {
            "content": content,
            "expected_revision": previous["revision"],
            "idempotency_key": str(uuid4()),
        }
        saved = req("POST", path, body)
        assert saved["revision"] == previous["revision"] + 1
        assert set(saved) == {"receipt_id", "revision"}
        assert req("POST", path, body) == saved
        read = req("GET", path)
        assert read["content"] == content and read["state"] == "available"
        assert req("GET", path, actor="alice") == owner_before
        req("GET", path, actor="task-viewer", status=403)
        req("GET", path, actor="outsider", status=404)
        checks.append("private_author_scope_current_role_unicode_partial_content")
        req("POST", path, {**body, "content": {**content, "title": "different"}}, status=409)
        req("POST", path, {**body, "idempotency_key": str(uuid4())}, status=409)
        candidates = [
            {
                "content": {**content, "title": f"Concurrent {i}"},
                "expected_revision": saved["revision"],
                "idempotency_key": str(uuid4()),
            }
            for i in range(2)
        ]

        def race(b):
            r = client.post(base + path, headers=fixture.headers("reader"), json=b)
            return r.status_code

        with ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(race, candidates)) == [200, 409]
        current = req("GET", path)
        assert req("POST", path, body) == saved
        assert req("GET", path) == current
        checks.append("concurrent_compare_and_swap_replay_never_overwrites_newer")
        for changes in [
            {"source_hash": "a" * 64},
            {"selection": {"start": 150012, "end": 150037}},
            {"selection": {"start": 150011, "end": 150035}},
            {"selection": {"start": 2147483646, "end": 2147483671}},
            {"selection": {"start": 9007199254740966, "end": 9007199254740991}},
            {"excerpt": "Prèface 🧠.", "selection": {"start": 150000, "end": 150010}},
            {"excerpt": "🧠" * 200001},
            {"title": "x" * 201},
            {"reason": "x" * 2001},
        ]:
            status = 409 if "source_hash" in changes else 422
            req(
                "POST",
                path,
                {
                    "content": {**content, **changes},
                    "expected_revision": current["revision"],
                    "idempotency_key": str(uuid4()),
                },
                status=status,
            )
        checks.append("source_fingerprint_unicode_span_and_size_refused_without_truncation")
        with db.begin() as c:
            c.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                ),
                {"t": state["tenant"], "d": state["domain"], "s": source["id"]},
            )
        try:
            hidden = req("GET", path)
            assert hidden["content"] is None and hidden["state"] == "source_unavailable"
            assert hidden["revision"] == current["revision"]
            req("POST", path, body, status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader","task-manager"]\'::jsonb WHERE tenant_id=:t AND domain_id=:d AND id=:s'
                    ),
                    {"t": state["tenant"], "d": state["domain"], "s": source["id"]},
                )
        assert req("GET", path)["content"] == current["content"]
        checks.append("revoked_source_masks_content_and_blocks_receipt_then_restore")
        # Corrupt only this synthetic draft fingerprint to qualify the defensive read. Sources remain immutable.
        with db.begin() as c:
            c.execute(
                text(
                    "UPDATE cf_contribution_drafts SET content=jsonb_set(content, '{source_hash}', to_jsonb(CAST(:h AS text))) WHERE tenant_id=:t AND domain_id=:d AND author='reader'"
                ),
                {"h": "f" * 64, "t": state["tenant"], "d": state["domain"], "s": source["id"]},
            )
        try:
            changed = req("GET", path)
            assert changed["state"] == "source_changed" and changed["content"] is None
            assert req("POST", path, body) == saved  # receipt only, never resurrects contents
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_contribution_drafts SET content=jsonb_set(content, '{source_hash}', to_jsonb(CAST(:h AS text))) WHERE tenant_id=:t AND domain_id=:d AND author='reader'"
                    ),
                    {
                        "h": source["content_hash"],
                        "t": state["tenant"],
                        "d": state["domain"],
                        "s": source["id"],
                    },
                )
        checks.append("mismatched_draft_fingerprint_masked_old_receipt_is_not_current_content")
        clear = {
            "content": None,
            "expected_revision": current["revision"],
            "idempotency_key": str(uuid4()),
        }
        cleared = req("POST", path, clear)
        assert req("GET", path)["state"] == "empty"
        assert req("POST", path, body) == saved
        assert req("GET", path)["state"] == "empty"
        # Leave a useful synthetic draft for browser restore, retaining the clear receipt.
        last = req(
            "POST",
            path,
            {**body, "expected_revision": cleared["revision"], "idempotency_key": str(uuid4())},
        )
        headers = {**fixture.headers("reader"), "Accept": "application/json, text/event-stream"}
        mcp = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_contribution_drafts_read",
                    "arguments": {"path": {"domain": state["domain"]}},
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp["http_status"] == 200 and mcp["data"] == req("GET", path)
        mcp_body = {**body, "expected_revision": last["revision"], "idempotency_key": str(uuid4())}
        mcp_save = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "api_contribution_drafts_save",
                    "arguments": {"path": {"domain": state["domain"]}, "body": mcp_body},
                },
            },
        ).json()["result"]["structuredContent"]
        assert mcp_save["http_status"] == 200 and mcp_save["data"] == req("POST", path, mcp_body)
        last = mcp_save["data"]
        maximum = "🧠" * 199999 + "z"
        maximum_source = req(
            "POST",
            "/sources",
            {
                "title": "Brouillon maximal synthétique",
                "content": maximum,
                "location": f"synthetic://draft-maximum/{uuid4()}",
                "allowed_subjects": ["alice", "reader"],
            },
            actor="alice",
            status=201,
        )
        maximum_body = {
            "content": {
                **content,
                "source_id": maximum_source["id"],
                "source_hash": maximum_source["content_hash"],
                "excerpt": maximum,
                "selection": {"start": 0, "end": 200000},
            },
            "expected_revision": last["revision"],
            "idempotency_key": str(uuid4()),
        }
        maximum_receipt = req("POST", path, maximum_body)
        assert req("GET", path)["content"] == maximum_body["content"]
        assert req("POST", path, maximum_body) == maximum_receipt
        # An incomplete, unselected personal draft remains intentionally legal.
        partial = {
            "content": {**content, "excerpt": "Projet incomplet à retrouver", "selection": None},
            "expected_revision": maximum_receipt["revision"],
            "idempotency_key": str(uuid4()),
        }
        partial_receipt = req("POST", path, partial)
        assert req("GET", path)["content"] == partial["content"]
        last = req(
            "POST",
            path,
            {
                **body,
                "expected_revision": partial_receipt["revision"],
                "idempotency_key": str(uuid4()),
            },
        )
        assert req("GET", path)["content"] == content
        checks.append("maximum200000_nonbmp_exact_roundtrip_and_unselected_partial_draft_preserved")
        assert req("GET", "/version") == version
        checks.append("explicit_clear_immutable_replay_mcp_same_view_no_proposal_publication")
        (OUT / "contribution-draft-native-report.json").write_text(
            json.dumps(
                {
                    "synthetic_only": True,
                    "domain": state["domain"],
                    "source": source["id"],
                    "revision": last["revision"],
                    "passed": len(checks),
                    "checks": checks,
                },
                indent=2,
            )
        )
        print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
