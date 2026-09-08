"""Maintenance verifies journal/Terminus agreement before rebuilding compatibility state."""

import time
from uuid import uuid4

import jwt
from sqlalchemy import text
from verify_rust_proposals import canonical_hash


def rpc_factory(client, headers, tenant, private):
    def call(action, args):
        now = int(time.time())
        confirmation = jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": tenant,
                "iat": now,
                "exp": now + 120,
                "jti": str(uuid4()),
                "action": action,
                "command_hash": canonical_hash({"action": action, "arguments": args}),
            },
            private,
            algorithm="RS256",
        )
        response = client.post(
            "/mcp",
            headers={
                **headers(),
                "Accept": "application/json, text/event-stream",
                "X-Cortex-Confirmation": confirmation,
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_" + action.replace(".", "_"), "arguments": args},
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]["structuredContent"]
        assert result["http_status"] == 200, result
        return result["data"]

    return call


def verify_maintenance_empty(client, headers, domain, tenant, private):
    call = rpc_factory(client, headers, tenant, private)
    args = {"path": {"domain": domain}}
    assert call("domain.publish", args) == {"published_version": 0, "changed": False}
    assert call("domain.replay", args) == {
        "published_version": 0,
        "concept_count": 0,
        "state_hash": canonical_hash({}),
    }
    assert client.post(f"/v1/domains/{domain}/replay", headers=headers()).status_code == 428
    return ["native_signed_empty_publication_and_journal_replay"]


def verify_maintenance_published(client, headers, admin, tenant, domain, private, concept):
    call = rpc_factory(client, headers, tenant, private)
    args = {"path": {"domain": domain}}
    with admin.begin() as c:
        c.execute(
            text("DELETE FROM cf_concepts WHERE tenant_id=:t AND domain_id=:d"),
            {"t": tenant, "d": domain},
        )
    replay = call("domain.replay", args)
    assert replay == {
        "published_version": 1,
        "concept_count": 1,
        "state_hash": canonical_hash({concept["concept_id"]: concept}),
    }
    with admin.connect() as c:
        rows = c.execute(
            text("SELECT payload,version FROM cf_concepts WHERE tenant_id=:t AND domain_id=:d"),
            {"t": tenant, "d": domain},
        ).all()
    assert rows == [(concept, 1)]
    assert call("domain.publish", args) == {"published_version": 1, "changed": False}
    compensation_args = {
        "path": {"domain": domain, "sequence": 1},
        "body": {
            "expected_version": 1,
            "reason": "Annulation synthétique",
            "idempotency_key": str(uuid4()),
        },
    }
    compensation = call("commits.compensate", compensation_args)
    assert compensation["status"] == "ready"
    assert compensation["payload"] == [
        {"kind": "retire_concept", "concept_id": concept["concept_id"]}
    ]
    assert call("commits.compensate", compensation_args) == compensation
    assert (
        client.get(f"/v1/domains/{domain}/version", headers=headers()).json()["published_version"]
        == 1
    )
    return [
        "native_journal_rebuild_verified_against_real_terminus",
        "native_compensation_is_only_an_idempotent_proposal",
    ]
