import base64
import json
import os
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.confirmations import sign_confirmed_action
from cortex_core.contracts import AccessInput
from cortex_core.settings import Settings
from fastapi.testclient import TestClient


def rpc(world, name, arguments=None, client=None, subject="alice", confirmation=None):
    headers = {**world.headers(subject), "Accept": "application/json, text/event-stream"}
    if confirmation:
        headers["X-Cortex-Confirmation"] = confirmation
    response = (client or world.client).post(
        "/mcp/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]


def data(result, status=200):
    result = json.loads(result["content"][0]["text"])
    assert result["http_status"] == status, result
    return result["data"]


@pytest.fixture
def trusted_client(world, identity_keys):
    settings = Settings(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        confirmation_public_key_file=identity_keys[1],
    )
    with TestClient(create_app(settings), base_url="http://localhost:8000") as client:
        yield client


def token(world, identity_keys, action, arguments, subject="alice", tenant=None):
    return sign_confirmed_action(
        identity_keys[0], subject, tenant or world.tenant, action, arguments
    )


def test_exhaustive_tool_inventory_and_no_identity_arguments(world):
    response = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
    )
    tools = response.json()["result"]["tools"]
    generated = {t["name"]: t for t in tools if t["name"].startswith("api_")}
    spec = world.app.openapi()
    expected = {
        "api_" + op["operationId"].replace(".", "_")
        for methods in spec["paths"].values()
        for op in methods.values()
    }
    assert set(generated) == expected
    assert len(generated) == len(expected) and len(tools) == len(expected) + 16
    for tool in generated.values():
        assert tool["outputSchema"]["properties"]["data"]
        properties = tool["inputSchema"]["properties"]
        assert "confirmation" not in properties and "token" not in properties
        headers = properties.get("header", {}).get("properties", {})
        assert not set(headers) & {"authorization", "x-tenant-id", "x-cortex-confirmation"}


def test_generated_source_read_write_and_revocation(world):
    arguments = {
        "path": {"domain": world.domain},
        "body": {
            "title": "Synthetic MCP source",
            "location": "fixture://" + str(uuid4()),
            "content": "Une procédure synthétique.",
            "allowed_subjects": ["alice", "bob"],
        },
    }
    source = data(rpc(world, "api_sources_create", arguments), 201)
    path = {"domain": world.domain, "source_id": source["id"]}
    assert (
        data(rpc(world, "api_sources_read", {"path": path}, subject="bob"))["content"]
        == arguments["body"]["content"]
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert (
        data(rpc(world, "api_sources_read", {"path": path}, subject="bob"), 404)["error"]
        == "NOT_FOUND"
    )
    assert (
        data(rpc(world, "api_sources_create", arguments, subject="bob"), 403)["error"]
        == "NOT_AUTHORIZED"
    )


def test_transport_rejects_arbitrary_paths_identity_and_unknown_tools(world):
    assert (
        data(
            rpc(
                world,
                "api_sources_read",
                {"path": {"domain": "../../health", "source_id": str(uuid4())}},
            ),
            422,
        )["error"]
        == "VALIDATION_FAILED"
    )
    assert (
        data(
            rpc(world, "api_identity_read", {"header": {"authorization": "Bearer invented"}}), 422
        )["error"]
        == "VALIDATION_FAILED"
    )
    assert data(rpc(world, "api_unknown"), 404)["error"] == "UNKNOWN_TOOL"


def test_sensitive_action_requires_confirmation_and_role(world, trusted_client, identity_keys):
    arguments = {"path": {"domain": world.domain}}
    missing = rpc(world, "api_domain_publish", arguments, client=trusted_client)
    assert data(missing, 428)["error"] == "CONFIRMATION_REQUIRED"
    signed = token(world, identity_keys, "domain.publish", arguments)
    assert (
        data(
            rpc(world, "api_domain_publish", arguments, client=trusted_client, confirmation=signed)
        )["changed"]
        is False
    )
    assert (
        data(
            rpc(world, "api_domain_publish", arguments, client=trusted_client, confirmation=signed),
            409,
        )["error"]
        == "CONFIRMATION_USED"
    )
    bob_token = token(world, identity_keys, "domain.publish", arguments, subject="bob")
    assert (
        data(
            rpc(
                world,
                "api_domain_publish",
                arguments,
                client=trusted_client,
                subject="bob",
                confirmation=bob_token,
            ),
            403,
        )["error"]
        == "NOT_AUTHORIZED"
    )


def test_confirmation_is_bound_to_payload_actor_and_tenant(world, trusted_client, identity_keys):
    source = world.source()
    arguments = {
        "path": {"domain": world.domain, "source_id": source["id"]},
        "body": {"allowed_subjects": ["alice"]},
    }
    for signed in [
        token(
            world,
            identity_keys,
            "sources.access",
            {**arguments, "body": {"allowed_subjects": ["bob"]}},
        ),
        token(world, identity_keys, "domain.publish", arguments),
        token(world, identity_keys, "sources.access", arguments, subject="bob"),
        token(world, identity_keys, "sources.access", arguments, tenant=world.other_tenant),
    ]:
        assert (
            data(
                rpc(
                    world,
                    "api_sources_access",
                    arguments,
                    client=trusted_client,
                    confirmation=signed,
                ),
                403,
            )["error"]
            == "CONFIRMATION_INVALID"
        )
    signed = token(world, identity_keys, "sources.access", arguments)
    assert data(
        rpc(world, "api_sources_access", arguments, client=trusted_client, confirmation=signed)
    )["allowed_subjects"] == ["alice"]


def test_approve_publish_round_trip_through_generated_tools(world, trusted_client, identity_keys):
    proposal = world.proposal()
    arguments = {
        "path": {"domain": world.domain, "proposal_id": proposal["id"]},
        "body": {
            "digest": proposal["digest"],
            "expected_version": proposal["base_version"],
            "expected_review_revision": 0,
            "reason": "Reviewed synthetic evidence",
            "idempotency_key": str(uuid4()),
        },
    }
    signed = token(world, identity_keys, "proposals.approve", arguments)
    assert (
        data(
            rpc(
                world,
                "api_proposals_approve",
                arguments,
                client=trusted_client,
                confirmation=signed,
            )
        )["accepted"]
        is True
    )
    publish = {"path": {"domain": world.domain}}
    signed = token(world, identity_keys, "domain.publish", publish)
    assert (
        data(rpc(world, "api_domain_publish", publish, client=trusted_client, confirmation=signed))[
            "published_version"
        ]
        == 1
    )
    answer = data(
        rpc(
            world,
            "api_knowledge_query",
            {"path": {"domain": world.domain}, "body": {"question": "incident"}},
        )
    )
    assert answer["citations"] and answer["served_version"] == 1


def test_binary_download_uses_explicit_base64_envelope(world):
    collection = data(
        rpc(
            world,
            "api_collections_create",
            {
                "path": {"domain": world.domain},
                "body": {
                    "name": "Synthetic",
                    "description": "",
                    "allowed_subjects": ["alice"],
                    "idempotency_key": str(uuid4()),
                },
            },
        ),
        201,
    )
    original = b"Private synthetic bytes."
    upload = data(
        rpc(
            world,
            "api_files_upload",
            {
                "path": {"domain": world.domain, "collection": collection["id"]},
                "body": {
                    "filename": "example.txt",
                    "content_base64": base64.b64encode(original).decode(),
                    "allowed_subjects": ["alice"],
                    "idempotency_key": str(uuid4()),
                },
            },
        ),
        202,
    )
    result = data(
        rpc(world, "api_files_download", {"path": {"domain": world.domain, "ident": upload["id"]}})
    )
    assert base64.b64decode(result["base64"]) == original


def test_expired_and_forged_confirmations_are_rejected(world, trusted_client, identity_keys):
    import time

    import jwt

    args = {"path": {"domain": world.domain}}
    signed = token(world, identity_keys, "domain.publish", args)
    claims = jwt.decode(signed, options={"verify_signature": False})
    claims.update(iat=int(time.time()) - 400, exp=int(time.time()) - 100)
    expired = jwt.encode(claims, identity_keys[0], algorithm="RS256")
    forged = jwt.encode(claims, "synthetic-wrong-key-with-at-least-32-bytes", algorithm="HS256")
    for value in (expired, forged):
        assert (
            data(
                rpc(world, "api_domain_publish", args, client=trusted_client, confirmation=value),
                403,
            )["error"]
            == "CONFIRMATION_INVALID"
        )


def test_confirmation_consumed_on_failed_business_precondition(
    world, trusted_client, identity_keys
):
    args = {
        "path": {"domain": world.domain, "proposal_id": str(uuid4())},
        "body": {
            "digest": "a" * 64,
            "expected_version": 0,
            "reason": "Synthetic",
            "idempotency_key": str(uuid4()),
        },
    }
    signed = token(world, identity_keys, "proposals.approve", args)
    data(rpc(world, "api_proposals_approve", args, client=trusted_client, confirmation=signed), 404)
    assert (
        data(
            rpc(world, "api_proposals_approve", args, client=trusted_client, confirmation=signed),
            409,
        )["error"]
        == "CONFIRMATION_USED"
    )


def test_unexpected_bridge_errors_are_sanitized(world, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("private database diagnostics")

    monkeypatch.setattr("cortex_core.mcp_bridge.dispatch", broken)
    result = data(rpc(world, "api_identity_read"), 503)
    assert result["error"] == "MCP_OPERATION_FAILED"
    assert "private database diagnostics" not in str(result)


def test_concurrent_confirmation_reuse_accepts_one_call(world, trusted_client, identity_keys):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    arguments = {"path": {"domain": world.domain}}
    signed = token(world, identity_keys, "domain.publish", arguments)
    barrier = Barrier(2)

    def invoke(_):
        barrier.wait(timeout=5)
        result = rpc(
            world, "api_domain_publish", arguments, client=trusted_client, confirmation=signed
        )
        return json.loads(result["content"][0]["text"])["http_status"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(invoke, range(2))) == [200, 409]


def test_member_can_confirm_only_their_own_feedback_preferences(
    world, trusted_client, identity_keys
):
    args = {
        "path": {"domain": world.domain},
        "body": {"allow_observed": True, "allow_inferred": False, "expected_revision": 0},
    }
    signed = token(world, identity_keys, "feedback.configure", args, subject="bob")
    result = data(
        rpc(
            world,
            "api_feedback_configure",
            args,
            client=trusted_client,
            subject="bob",
            confirmation=signed,
        )
    )
    assert result == {"allow_observed": True, "allow_inferred": False, "revision": 1}
    assert data(rpc(world, "api_feedback_preferences", {"path": args["path"]})) == {
        "allow_observed": False,
        "allow_inferred": False,
        "revision": 0,
    }
    assert (
        data(
            rpc(world, "api_feedback_configure", args, client=trusted_client, confirmation=signed),
            403,
        )["error"]
        == "CONFIRMATION_INVALID"
    )
