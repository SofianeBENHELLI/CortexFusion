import json
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.contracts import CONTRACTS, AccessInput
from cortex_core.settings import Settings


def mcp(w, name, arguments=None, subject="alice"):
    response = w.client.post(
        "/mcp/",
        headers={**w.headers(subject), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]


def value(result):
    assert not result.get("isError"), result
    return json.loads(result["content"][0]["text"])


def test_all_routes_have_explicit_interaction_and_response_contracts(world):
    spec = world.client.get("/openapi.json").json()
    actions = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            actions.append(op["operationId"])
            assert op["x-cortex-interaction"]["intent_example"]
            assert op["x-cortex-interaction"]["effect_description"]
            for status, response in op["responses"].items():
                if status.startswith("2"):
                    content = response["content"]
                    assert all(item["schema"] for item in content.values()), (method, path)
            if op["x-cortex-interaction"]["roles"]:
                assert op["security"] == [{"BearerAuth": []}]
                assert next(p for p in op["parameters"] if p["name"] == "x-tenant-id")["required"]
                assert "409" in op["responses"] and "503" in op["responses"]
    assert len(actions) == len(set(actions))
    assert len(CONTRACTS) == len(set(CONTRACTS))


def test_catalog_is_discovery_not_authority(world):
    assert world.client.get("/v1/interactions").status_code == 401
    catalog = world.client.get("/v1/interactions", headers=world.headers("bob")).json()
    approval = next(a for a in catalog["items"] if a["action_id"] == "proposals.approve")
    assert approval["roles"] == ["owner"]
    assert approval["confirmation_policy"] == "explicit_user_decision"
    assert (
        world.client.post(world.prefix + "/publish", headers=world.headers("bob")).status_code
        == 403
    )
    assert value(mcp(world, "describe_actions", subject="bob")) == catalog


def test_new_route_requires_interaction_documentation():
    app = create_app(
        Settings(
            database_url="postgresql+pg8000://unused",
            jwt_issuer="test",
            jwks_url="https://identity.invalid/keys",
            model_provider="ollama",
            local_model=None,
        )
    )
    try:

        @app.get("/undocumented")
        def undocumented():
            return {}

        with pytest.raises(RuntimeError, match="Missing interaction contract"):
            app.openapi()
    finally:
        app.state.db.dispose()


def test_mcp_and_http_share_source_permissions(world):
    source = world.source(content="Document synthétique à consulter.")
    args = {"domain_id": world.domain, "source_id": source["id"]}
    result = value(mcp(world, "read_source_chunks", args, subject="bob"))
    http = world.client.get(
        world.prefix + f"/sources/{source['id']}/chunks",
        headers=world.headers("bob"),
        params={"limit": 3},
    ).json()
    assert result == http
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert mcp(world, "read_source_chunks", args, subject="bob")["isError"]
    assert mcp(world, "read_source_chunks", {**args, "limit": 100000})["isError"]


def test_natural_language_host_can_complete_personal_workflow_through_tools(world):
    workspace = value(mcp(world, "my_workspace", subject="bob"))
    assert workspace["subject"] == "bob"
    assert workspace["domains"][0]["id"] == world.domain
    conversation = value(
        mcp(
            world,
            "create_conversation",
            {
                "domain_id": world.domain,
                "conversation": {"title": "Incidents", "idempotency_key": str(uuid4())},
            },
            subject="bob",
        )
    )
    args = {
        "domain_id": world.domain,
        "conversation_id": conversation["id"],
        "question": {"question": "Procédure inconnue", "idempotency_key": str(uuid4())},
    }
    first = value(mcp(world, "conversation_query", args, subject="bob"))
    assert first["status"] == "knowledge_gap"
    assert value(mcp(world, "conversation_query", args, subject="bob")) == first
    issues = value(mcp(world, "list_issues", {"domain_id": world.domain}, subject="bob"))
    issue = issues["items"][0]
    result = value(
        mcp(
            world,
            "decide_issue",
            {
                "domain_id": world.domain,
                "issue_id": issue["id"],
                "decision": {
                    "action": "dismiss",
                    "expected_revision": issue["revision"],
                    "reason": "Question de démonstration",
                    "idempotency_key": str(uuid4()),
                },
            },
            subject="bob",
        )
    )
    assert result["status"] == "dismissed"
    messages = value(
        mcp(
            world,
            "conversation_messages",
            {"domain_id": world.domain, "conversation_id": conversation["id"]},
            subject="bob",
        )
    )
    assert len(messages["items"]) == 1
    assert mcp(
        world,
        "conversation_messages",
        {"domain_id": world.domain, "conversation_id": conversation["id"]},
    )["isError"]
