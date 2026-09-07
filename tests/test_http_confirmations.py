import json
import os
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.confirmations import command_hash, sign_confirmed_action
from cortex_core.settings import Settings
from fastapi.testclient import TestClient


@pytest.fixture
def strict_client(world, identity_keys):
    settings = Settings(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        confirmation_public_key_file=identity_keys[1],
    )
    assert settings.http_confirmation_mode == "required"
    with TestClient(create_app(settings), base_url="http://localhost:8000") as client:
        yield client


def signed(world, keys, action, args, subject="alice"):
    return sign_confirmed_action(keys[0], subject, world.tenant, action, args)


def test_http_confirmation_required_and_no_header_can_forge_bridge_proof(world, strict_client):
    assert (
        strict_client.get("/openapi.json").json()["x-cortex-http-confirmation-mode"] == "required"
    )
    args = {"path": {"domain": world.domain}}
    response = strict_client.post(
        world.prefix + "/publish",
        headers={**world.headers(), "X-Cortex-Confirmed": "true", "Cortex.Confirmed": "true"},
    )
    assert response.status_code == 428
    data = response.json()
    assert data["error"] == "CONFIRMATION_REQUIRED"
    assert data["confirmation_request"]["command_hash"] == command_hash("domain.publish", args)
    assert data["confirmation_request"]["action"] == "domain.publish"
    assert world.tenant not in json.dumps(data)
    denied = strict_client.post(world.prefix + "/publish", headers=world.headers("bob"))
    assert denied.status_code == 403


def test_required_mode_without_verification_key_fails_closed(world, identity_keys):
    settings = Settings(
        database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        assert client.post(world.prefix + "/publish", headers=world.headers()).status_code == 428


@pytest.mark.parametrize("first", ["http", "mcp"])
def test_confirmation_is_single_use_across_http_and_mcp_without_double_consumption(
    world, strict_client, identity_keys, first
):
    args = {"path": {"domain": world.domain}}
    token = signed(world, identity_keys, "domain.publish", args)
    headers = {**world.headers(), "X-Cortex-Confirmation": token}

    def http():
        response = strict_client.post(world.prefix + "/publish", headers=headers)
        return response.status_code, response.json()

    def mcp():
        response = strict_client.post(
            "/mcp/",
            headers={**headers, "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_domain_publish", "arguments": args},
            },
        )
        result = response.json()["result"]["structuredContent"]
        return result["http_status"], result["data"]

    primary, other = (http, mcp) if first == "http" else (mcp, http)
    assert primary()[0] == 200
    status, result = other()
    assert status == 409 and result["error"] == "CONFIRMATION_USED"


def test_http_confirmation_binds_body_actor_and_unknown_parameters(
    world, strict_client, identity_keys
):
    source = world.source()
    args = {
        "path": {"domain": world.domain, "source_id": source["id"]},
        "body": {"allowed_subjects": ["alice"]},
    }
    token = signed(world, identity_keys, "sources.access", args)
    headers = {**world.headers(), "X-Cortex-Confirmation": token}
    url = world.prefix + "/sources/" + source["id"] + "/access"
    altered = {"allowed_subjects": ["alice", "bob"]}
    assert (
        strict_client.put(url, headers=headers, json=altered).json()["error"]
        == "CONFIRMATION_INVALID"
    )
    assert (
        strict_client.put(
            url, headers={**world.headers("bob"), "X-Cortex-Confirmation": token}, json=args["body"]
        ).status_code
        == 403
    )
    assert (
        strict_client.put(url + "?extra=ignored", headers=headers, json=args["body"]).status_code
        == 422
    )
    assert strict_client.put(url, headers=headers, content="{invalid").status_code == 422
    accepted = strict_client.put(url, headers=headers, json=args["body"])
    assert accepted.status_code == 200, accepted.text
    assert (
        strict_client.get(
            world.prefix + "/sources/" + source["id"], headers=world.headers("bob")
        ).status_code
        == 404
    )


def test_viewer_can_confirm_only_their_own_feedback_preference(world, strict_client, identity_keys):
    args = {
        "path": {"domain": world.domain},
        "body": {"allow_observed": True, "allow_inferred": False, "expected_revision": 0},
    }
    token = signed(world, identity_keys, "feedback.configure", args, subject="bob")
    url = world.prefix + "/feedback-preferences"
    invalid = strict_client.put(
        url, headers={**world.headers(), "X-Cortex-Confirmation": token}, json=args["body"]
    )
    assert invalid.status_code == 403
    response = strict_client.put(
        url, headers={**world.headers("bob"), "X-Cortex-Confirmation": token}, json=args["body"]
    )
    assert response.status_code == 200
    assert response.json()["allow_observed"] is True
    assert strict_client.get(url, headers=world.headers()).json()["allow_observed"] is False


def test_failed_business_condition_consumes_confirmation_but_invalid_input_does_not(
    world, strict_client, identity_keys
):
    args = {
        "path": {"domain": world.domain, "proposal_id": str(uuid4())},
        "body": {
            "digest": "a" * 64,
            "expected_version": 0,
            "reason": "Synthetic decision",
            "idempotency_key": str(uuid4()),
        },
    }
    headers = {
        **world.headers(),
        "X-Cortex-Confirmation": signed(world, identity_keys, "proposals.approve", args),
    }
    url = world.prefix + "/proposals/" + args["path"]["proposal_id"] + "/approve"
    assert (
        strict_client.post(url, headers=headers, json={**args["body"], "unknown": True}).status_code
        == 422
    )
    assert strict_client.post(url, headers=headers, json=args["body"]).status_code == 404
    assert (
        strict_client.post(url, headers=headers, json=args["body"]).json()["error"]
        == "CONFIRMATION_USED"
    )
