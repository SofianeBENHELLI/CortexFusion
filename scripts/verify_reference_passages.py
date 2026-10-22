"""Synthetic long-source reference preparation: bounded reads and unchanged governance."""

import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = {**task_fixture(), "domain": str(uuid4())}
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert (
        url.host == "127.0.0.1"
        and url.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and url.database.endswith("_test")
    )
    db = create_engine(url)
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Références sur source longue')"
            ),
            state,
        )
        for subject, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-viewer", "viewer"),
        ]:
            tx.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:subject,:role)"
                ),
                {**state, "subject": subject, "role": role},
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
            assert r.status_code == status, (path, status, r.status_code)
            return r.json()

        version = req("GET", "/version")
        source_text = "Début 🧠.\n" + "abcé🧠" * 30000 + "\nLa revue dure cinq jours."
        source = req(
            "POST",
            "/sources",
            {
                "title": "Référence longue Unicode",
                "location": f"synthetic://reference-passage/{uuid4()}",
                "content": source_text,
                "allowed_subjects": ["alice", "reader"],
            },
            actor="alice",
            status=201,
        )
        state["source"] = source["id"]
        state["source_hash"] = source["content_hash"]
        proof = "La revue dure cinq jours."
        start = source_text.index(proof)
        state["proof_start"] = start
        state["length"] = len(source_text)
        content = {
            "theme": "Revue",
            "question": "Combien de jours dure la revue ?",
            "criteria": "Citer cinq jours et la source.",
            "source_id": source["id"],
            "source_hash": source["content_hash"],
            "excerpt": proof,
            "selection": {"start": start, "end": start + len(proof)},
        }
        key, question = str(uuid4()), str(uuid4())
        state["question"] = question
        body = {"content": content, "expected_revision": 0, "idempotency_key": key}
        path = "/reference-drafts/" + question
        receipt = req("POST", path, body)
        assert req("GET", path)["content"] == content
        assert req("POST", path, body) == receipt
        checks.append("exact_unicode_tail_beyond150000_saved_private_idempotent")
        start2 = 10000
        proof2 = source_text[start2 : start2 + 10000]
        part1 = req(
            "GET",
            f"/sources/{source['id']}/passage?offset={start2}&limit=8192&expected_hash={source['content_hash']}",
        )
        part2 = req(
            "GET",
            f"/sources/{source['id']}/passage?offset={start2 + 8192}&limit=1808&expected_hash={source['content_hash']}",
        )
        assert part1["excerpt"] + part2["excerpt"] == proof2
        long_content = {
            **content,
            "excerpt": proof2,
            "selection": {"start": start2, "end": start2 + 10000},
        }
        long_question = str(uuid4())
        req(
            "POST",
            "/reference-drafts/" + long_question,
            {**body, "content": long_content, "idempotency_key": str(uuid4())},
        )
        assert req("GET", "/reference-drafts/" + long_question)["content"] == long_content
        checks.append("maximum10000proof_uses_two_pages_repeated_occurrence_preserved")
        for bad in [
            {**content, "excerpt": "texte différent"},
            {
                **long_content,
                "excerpt": proof2 + "a",
                "selection": {"start": start2, "end": start2 + 10001},
            },
            {**content, "selection": {"start": 2147483646, "end": 2147483647}},
            {**content, "selection": {"start": 9007199254740990, "end": 9007199254740991}},
            {**content, "selection": {"start": start, "end": start + 1}},
        ]:
            req(
                "POST",
                "/reference-drafts/" + str(uuid4()),
                {**body, "content": bad, "idempotency_key": str(uuid4())},
                status=422,
            )
        req("POST", path, {**body, "content": {**content, "source_hash": "0" * 64}}, status=409)
        checks.append("overflow_wrong_length_wrong_text_10001_and_hash_change_refused")
        with db.begin() as tx:
            tx.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                state,
            )
        try:
            req("GET", path, status=404)
            req("POST", path, body, status=404)
        finally:
            with db.begin() as tx:
                tx.execute(
                    text(
                        'UPDATE cf_sources SET allowed_subjects=\'["alice","reader"]\'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source'
                    ),
                    state,
                )
        req("GET", path, actor="alice", status=404)
        req("GET", path, actor="task-viewer", status=403)
        assert req("GET", path)["content"] == content
        checks.append("current_acl_replay_scope_no_owner_override_restored")
        result = client.post(
            "/mcp",
            headers={**fixture.headers("reader"), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_reference_drafts_save",
                    "arguments": {
                        "path": {"domain": state["domain"], "question": question},
                        "body": body,
                    },
                },
            },
        ).json()["result"]["structuredContent"]
        assert result["http_status"] == 200 and result["data"] == receipt
        assert req("GET", "/version") == version
        checks.append("mcp_same_receipt_no_knowledge_change_no_publication")
    report = {**state, "synthetic_only": True, "passed": len(checks), "checks": checks}
    (OUT / "reference-passage-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"passed": len(checks), "checks": checks}))
    db.dispose()


if __name__ == "__main__":
    main()
