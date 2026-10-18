"""Native cumulative responsibilities in a fresh isolated synthetic domain."""

import json
import os
import time
from itertools import combinations
from uuid import uuid4

import jwt
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_rust_proposals import canonical_hash
from verify_workspace_tasks import KEYS, OUT, ROOT


def main():
    state = json.loads((KEYS / "state.json").read_text())
    assert state["synthetic_only"]
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
    domain = str(uuid4())
    tenant = state["tenant"]
    db = create_engine(url)
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette responsabilités cumulées')"
            ),
            dict(t=tenant, d=domain),
        )
        c.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner')"
            ),
            dict(t=tenant, d=domain),
        )
    fixture = Fixture(tenant, {"identity": (KEYS / "identity-private.pem").read_bytes()})
    private = (KEYS / "confirmation-private.pem").read_bytes()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_CONFIRMATION_PUBLIC_KEY_FILE=str(KEYS / "confirmation.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{domain}"

        def signed(body):
            now = int(time.time())
            return jwt.encode(
                dict(
                    iss="cortex-trusted-host",
                    aud="cortex-mcp-confirmation",
                    sub="alice",
                    tenant=tenant,
                    iat=now,
                    exp=now + 120,
                    jti=str(uuid4()),
                    action="members.change",
                    command_hash=canonical_hash(
                        {
                            "action": "members.change",
                            "arguments": {"path": {"domain": domain}, "body": body},
                        }
                    ),
                ),
                private,
                algorithm="RS256",
            )

        def change(body, status=201):
            r = client.post(
                base + "/members",
                headers={**fixture.headers("alice"), "X-Cortex-Confirmation": signed(body)},
                json=body,
            )
            assert r.status_code == status, (r.status_code, r.json().get("error"))
            return r.json()

        def identity(actor):
            r = client.get("/v1/me", headers=fixture.headers(actor))
            assert r.status_code == 200
            return next(d for d in r.json()["domains"] if d["id"] == domain)

        basebody = dict(
            subject="reader",
            role="viewer",
            reason="Synthetic responsibility check",
            idempotency_key=str(uuid4()),
        )
        first = change(basebody)
        assert first["new_roles"] == ["viewer"] and identity("reader")["roles"] == ["viewer"]
        assert change(basebody) == first
        checks.append("legacy_single_role_write_identity_and_exact_receipt")
        order = ["owner", "corpus_manager", "contributor", "viewer"]
        revision = 0
        for n in range(1, 5):
            for roles in combinations(order, n):
                body = {
                    **basebody,
                    "role": roles[0],
                    "roles": list(reversed(roles)),
                    "expected_revision": revision,
                    "idempotency_key": str(uuid4()),
                }
                receipt = change(body)
                revision += 1
                assert (
                    receipt["new_roles"] == list(roles)
                    and receipt["resulting_revision"] == revision
                )
                assert change(body) == receipt
                current = identity("reader")
                assert (
                    current["roles"] == list(roles)
                    and current["role"] == roles[0]
                    and current["membership_revision"] == revision
                )
                capabilities = current["capabilities"]
                assert ("coordinate_tasks" in capabilities) == (
                    roles[0] in ["owner", "corpus_manager"]
                )
                assert ("approve" in capabilities) == (roles[0] == "owner")
                members = client.get(base + "/members", headers=fixture.headers("reader"))
                assert members.status_code == (200 if roles[0] == "owner" else 403)
        checks.append("all_15_human_combinations_effective_rights_revision_and_replay")
        for patch in [
            dict(role="viewer", roles=[]),
            dict(role="viewer", roles=["viewer", "viewer"]),
            dict(role="viewer", roles=["owner"]),
            dict(role="agent", roles=["agent", "owner"]),
            dict(role=None, roles=["viewer"]),
            dict(role="owner", roles=["unknown"]),
        ]:
            change(
                {
                    **basebody,
                    **patch,
                    "expected_revision": revision,
                    "idempotency_key": str(uuid4()),
                },
                422,
            )
        body = {
            **basebody,
            "role": "corpus_manager",
            "roles": ["corpus_manager", "contributor"],
            "expected_revision": revision,
            "idempotency_key": str(uuid4()),
        }
        assert (
            client.post(base + "/members", headers=fixture.headers("alice"), json=body).status_code
            == 428
        )
        bad = {**body, "roles": ["corpus_manager", "viewer"]}
        assert (
            client.post(
                base + "/members",
                headers={**fixture.headers("alice"), "X-Cortex-Confirmation": signed(body)},
                json=bad,
            ).status_code
            == 403
        )
        change(body)
        revision += 1
        assert (
            client.get(
                f"/v1/domains/{state['domain']}/members", headers=fixture.headers("reader")
            ).status_code
            == 403
        )
        checks.append("malformed_mixed_service_and_confirmation_hash_binding")
        rpc = client.post(
            "/mcp",
            headers={
                **fixture.headers("alice"),
                "Accept": "application/json, text/event-stream",
                "X-Cortex-Confirmation": signed(body),
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_members_change",
                    "arguments": {"path": {"domain": domain}, "body": body},
                },
            },
        )
        assert rpc.json()["result"]["structuredContent"]["http_status"] == 201, rpc.json()
        assert identity("reader")["roles"] == ["corpus_manager", "contributor"]
        checks.append("mcp_exact_same_membership_contract")
        # Legacy replacement explicitly removes additional responsibilities without deleting identity.
        receipt = change(
            {**basebody, "expected_revision": revision, "idempotency_key": str(uuid4())}
        )
        revision += 1
        assert receipt["previous_roles"] == ["corpus_manager", "contributor"] and receipt[
            "new_roles"
        ] == ["viewer"]
        assert client.get(base + "/members", headers=fixture.headers("reader")).status_code == 403
        # Keep a useful cumulative fixture for browser reading, never change an existing domain.
        final = change(
            {
                **basebody,
                "role": "corpus_manager",
                "roles": ["corpus_manager", "contributor"],
                "expected_revision": revision,
                "idempotency_key": str(uuid4()),
            }
        )
        checks.append("legacy_replacement_clears_additional_roles_and_current_access")
        memberpage = client.get(base + "/members", headers=fixture.headers("alice")).json()
        assert next(m for m in memberpage["items"] if m["subject"] == "reader")["roles"] == [
            "corpus_manager",
            "contributor",
        ]
        with db.connect() as c:
            assert c.execute(
                text(
                    "SELECT accepted_version=0 AND published_version=0 FROM cf_domains WHERE tenant_id=:t AND id=:d"
                ),
                dict(t=tenant, d=domain),
            ).scalar()
        checks.append("audit_before_after_no_knowledge_publication_or_existing_domain_mutation")
    report = dict(
        synthetic_only=True,
        tenant=tenant,
        domain=domain,
        checks=checks,
        passed=len(checks),
        human_combinations=15,
        reader_revision=final["resulting_revision"],
    )
    (OUT / "roles-native-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
