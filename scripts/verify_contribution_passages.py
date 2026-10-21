"""Synthetic long-source contribution flow without full source HTTP reads."""

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
    assert (
        url.host == "127.0.0.1"
        and url.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and url.database.endswith("_test")
    )
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

        def req(method, path, body=None, status=200, actor="reader"):
            r = client.request(method, base + path, json=body, headers=fixture.headers(actor))
            assert r.status_code == status, (path, status, r.status_code, r.json().get("error"))
            return r.json()

        before = req("GET", "/version")
        proof = "La revue dure cinq jours."
        source = req(
            "POST",
            "/sources",
            {
                "title": "Contribution longue synthétique",
                "location": f"synthetic://contribution-pages/{uuid4()}",
                "content": "🧠" * 150000 + proof,
                "allowed_subjects": ["alice", "reader"],
            },
            201,
            "alice",
        )
        sid = source["id"]
        digest = source["content_hash"]
        path = f"/sources/{sid}"
        first = req("GET", path + "/passage?offset=0&limit=8192")
        assert len(first["excerpt"]) == 8192 and first["total_characters"] == 150025
        located = req("POST", path + "/locate", {"excerpt": proof, "expected_hash": digest})
        assert located["start"] == 150000 and located["end"] == 150025 and "excerpt" not in located
        tail = req("GET", path + f"/passage?offset=150000&expected_hash={digest}")
        assert tail["excerpt"] == proof
        checks.append("tail_after150000_located_without_full_http_source_read")
        current = req("GET", "/contribution-draft")
        content = {
            "source_id": sid,
            "source_hash": digest,
            "title": "Règle à relire",
            "excerpt": proof,
            "reason": "Preuve exacte distante",
            "selection": {"start": 150000, "end": 150025},
        }
        save = {
            "content": content,
            "expected_revision": current["revision"],
            "idempotency_key": str(uuid4()),
        }
        receipt = req("POST", "/contribution-draft", save)
        assert req("GET", "/contribution-draft")["content"] == content
        assert req("POST", "/contribution-draft", save) == receipt
        checks.append("private_draft_keeps_exact_range_and_replays_same_receipt")

        def proposal(excerpt, start, end, source_id=sid):
            return {
                "base_version": before["published_version"],
                "reason": "Recette de contribution progressive",
                "idempotency_key": str(uuid4()),
                "changes": [
                    {
                        "kind": "put_concept",
                        "concept": {
                            "concept_id": str(uuid4()),
                            "title": "Passage candidat",
                            "body": excerpt,
                            "maturity": "emerging",
                            "sources": [{"source_id": source_id, "start": start, "end": end}],
                            "links": [],
                        },
                    }
                ],
            }

        body = proposal(proof, 150000, 150025)
        created = req("POST", "/proposals", body, 201)
        replay = req("POST", "/proposals", body, 201)
        assert (
            created["id"] == replay["id"]
            and created["payload"] == body["changes"]
            and created["status"] == "ready"
        )
        assert req("GET", f"/proposals/{created['id']}")["payload"] == body["changes"]
        checks.append("located_tail_creates_one_ready_proposal_exact_idempotent_payload")
        maximum = "🧠" * 199999 + "z"
        maxi = req(
            "POST",
            "/sources",
            {
                "title": "Contribution maximale synthétique",
                "location": f"synthetic://contribution-max/{uuid4()}",
                "content": maximum,
                "allowed_subjects": ["alice", "reader"],
            },
            201,
            "alice",
        )
        found = req(
            "POST",
            f"/sources/{maxi['id']}/locate",
            {"excerpt": maximum, "expected_hash": maxi["content_hash"]},
        )
        assert found["start"] == 0 and found["end"] == 200000
        large = req("POST", "/proposals", proposal(maximum, 0, 200000, maxi["id"]), 201)
        assert large["payload"][0]["concept"]["body"] == maximum
        req("POST", "/proposals", proposal(proof, 150001, 150026), 422)
        checks.append("existing200000_unicode_limit_preserved_wrong_range_rejected")
        with db.begin() as tx:
            old = tx.execute(
                text(
                    "SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                {**state, "source": sid},
            ).scalar_one()
            tx.execute(
                text(
                    "UPDATE cf_sources SET allowed_subjects='[\"alice\"]'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                {**state, "source": sid},
            )
        try:
            req("POST", path + "/locate", {"excerpt": proof, "start": 150000}, 404)
            req("GET", "/contribution-draft")
            assert req("GET", "/contribution-draft")["state"] == "source_unavailable"
            req("GET", f"/proposals/{created['id']}", status=404)
        finally:
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                    ),
                    {**state, "source": sid, "acl": json.dumps(old)},
                )
        assert req("GET", "/contribution-draft")["content"] == content
        assert req("GET", "/version") == before
        checks.append(
            "rights_withdrawal_hides_source_draft_proposal_exact_acl_restored_no_knowledge_change"
        )
        state.update(
            source=sid,
            source_hash=digest,
            proposal=created["id"],
            draft_revision=receipt["revision"],
        )
    db.dispose()
    report = {**state, "synthetic_only": True, "passed": len(checks), "checks": checks}
    (OUT / "contribution-passage-native-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"passed": len(checks), "checks": checks}))


if __name__ == "__main__":
    main()
