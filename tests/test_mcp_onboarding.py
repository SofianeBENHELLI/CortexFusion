import json
from pathlib import Path
from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, QueryInput


def rpc(world, method, params=None, subject="bob", headers=None):
    result = world.client.post(
        "/mcp/",
        headers={
            **(world.headers(subject) if headers is None else headers),
            "Accept": "application/json, text/event-stream",
        },
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )
    return result


def resource(world, uri, subject="bob"):
    result = rpc(world, "resources/read", {"uri": uri}, subject).json()
    assert "error" not in result, result
    return json.loads(result["result"]["contents"][0]["text"])


def test_discovery_inventory_and_initialize(world):
    initialized = rpc(
        world,
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "synthetic", "version": "1"},
        },
    ).json()["result"]
    assert {"tools", "resources", "prompts"} <= set(initialized["capabilities"])
    assert "silence" in initialized["instructions"]
    resources = rpc(world, "resources/list").json()["result"]["resources"]
    assert {r["uri"] for r in resources} == {
        "cortex://workspace",
        "cortex://guide",
        "cortex://actions",
        "cortex://guides",
    }
    templates = rpc(world, "resources/templates/list").json()["result"]["resourceTemplates"]
    assert {r["uriTemplate"] for r in templates} == {
        "cortex://domains/{domain_id}/context",
        "cortex://guides/{guide_id}",
    }
    prompts = rpc(world, "prompts/list").json()["result"]["prompts"]
    assert {p["name"] for p in prompts} == {
        "ask_cortex",
        "openbrain_workflow",
        "review_cortex_proposal",
        "report_cortex_feedback",
    }
    assert all("ctx" not in {a["name"] for a in p["arguments"]} for p in prompts)


@pytest.mark.parametrize(
    "method,params",
    [
        ("resources/list", {}),
        ("resources/read", {"uri": "cortex://workspace"}),
        ("prompts/list", {}),
        (
            "prompts/get",
            {
                "name": "ask_cortex",
                "arguments": {"domain_id": str(uuid4()), "question": "Synthetic"},
            },
        ),
    ],
)
def test_all_discovery_primitives_require_authentication(world, method, params):
    r = rpc(world, method, params, headers={})
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


def test_resources_are_personal_and_do_not_cache_authority(world):
    bob = resource(world, "cortex://workspace")
    alice = resource(world, "cortex://workspace", "alice")
    assert bob["subject"] == "bob" and alice["subject"] == "alice"
    assert "approve" not in bob["domains"][0]["capabilities"]
    assert "approve" in alice["domains"][0]["capabilities"]
    context = resource(world, f"cortex://domains/{world.domain}/context")
    assert context["feedback_preferences"]["allow_inferred"] is False
    assert (
        "error"
        in rpc(
            world, "resources/read", {"uri": f"cortex://domains/{world.other_domain}/context"}
        ).json()
    )
    assert (
        "error"
        in rpc(world, "resources/read", {"uri": "cortex://domains/not-a-uuid/context"}).json()
    )
    assert resource(world, "cortex://actions")["items"]


def test_prompt_preparation_has_no_query_or_feedback_side_effects(world):
    response = rpc(
        world,
        "prompts/get",
        {
            "name": "ask_cortex",
            "arguments": {"domain_id": world.domain, "question": "Escalation procedure"},
        },
    ).json()
    assert "error" not in response, response
    assert "api_knowledge_query" in response["result"]["messages"][0]["content"]["text"]
    assert (
        world.client.get(world.prefix + "/episodes", headers=world.headers("bob")).json()["items"]
        == []
    )
    assert (
        "error"
        in rpc(
            world,
            "prompts/get",
            {
                "name": "ask_cortex",
                "arguments": {"domain_id": world.other_domain, "question": "Synthetic"},
            },
        ).json()
    )
    assert (
        "error"
        in rpc(
            world,
            "prompts/get",
            {"name": "ask_cortex", "arguments": {"domain_id": world.domain, "question": " "}},
        ).json()
    )


def test_review_and_feedback_prompts_recheck_evidence_and_scope(world):
    source = world.source()
    proposal = world.proposal(source)
    review = {
        "name": "review_cortex_proposal",
        "arguments": {"domain_id": world.domain, "proposal_id": proposal["id"]},
    }
    assert "error" in rpc(world, "prompts/get", review).json()
    assert "error" not in rpc(world, "prompts/get", review, "alice").json()
    world.approve(proposal)
    eid = world.service.query(world.viewer, world.domain, QueryInput(question="incident"))[
        "episode_id"
    ]
    report = {
        "name": "report_cortex_feedback",
        "arguments": {"domain_id": world.domain, "episode_id": eid},
    }
    assert "error" not in rpc(world, "prompts/get", report).json()
    assert "error" in rpc(world, "prompts/get", report, "alice").json()
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert "error" in rpc(world, "prompts/get", report).json()


def test_resource_errors_hide_storage_diagnostics(world, monkeypatch):
    def broken(*args):
        raise RuntimeError("private connection diagnostics")

    monkeypatch.setattr("cortex_core.workspace.WorkspaceService.identity", broken)
    result = rpc(world, "resources/read", {"uri": "cortex://workspace"}).json()
    assert "error" in result and "CONTEXT_UNAVAILABLE" in str(result)
    assert "private connection diagnostics" not in str(result)


def test_focused_guides_have_valid_tools_and_identical_native_metadata(world):
    from cortex_core.companion_guides import CATALOG

    catalog = resource(world, "cortex://guides")
    assert catalog == CATALOG
    assert catalog["documentation_only"] is True
    assert catalog["client_compatibility"] == "not_qualified"
    assert [g["id"] for g in catalog["guides"]] == [
        "consult",
        "feedback",
        "follow-up",
        "task",
        "correction",
        "domain",
    ]
    root = Path(__file__).resolve().parents[1]
    native = json.loads((root / "services/rust-core/src/onboarding.json").read_text())
    assert native["workflows"] == catalog
    tools = json.loads((root / "packages/contracts/mcp-tools.json").read_text())["tools"]
    tools += json.loads((root / "packages/contracts/rust-extensions.json").read_text())["tools"]
    names = {t["name"] for t in tools}
    for guide in catalog["guides"]:
        assert resource(world, "cortex://guides/" + guide["id"]) == guide
        assert set(guide["tools"]) <= names
    assert len(json.dumps(catalog).encode()) < 65536
    assert "error" in rpc(world, "resources/read", {"uri": "cortex://guides/unknown"}).json()
    assert rpc(world, "resources/read", {"uri": "cortex://guides"}, headers={}).status_code == 401


@pytest.mark.parametrize("guide", ["consult", "feedback", "domain"])
def test_selected_workflow_checks_capability_without_executing(world, guide):
    args = {
        "name": "openbrain_workflow",
        "arguments": {"domain_id": world.domain, "guide_id": guide},
    }
    response = rpc(world, "prompts/get", args, "alice").json()
    assert "error" not in response, response
    value = response["result"]["messages"][0]["content"]["text"]
    assert "no authority" in value and f'"id": "{guide}"' in value
    assert (
        world.client.get(world.prefix + "/episodes", headers=world.headers("alice")).json()["items"]
        == []
    )
    if guide == "domain":
        assert "error" in rpc(world, "prompts/get", args).json()
    args["arguments"]["domain_id"] = world.other_domain
    assert "error" in rpc(world, "prompts/get", args, "alice").json()


@pytest.mark.parametrize("guide", ["task", "follow-up", "unknown", "consult/../../private"])
def test_compatibility_does_not_claim_missing_native_workflow_capabilities(world, guide):
    response = rpc(
        world,
        "prompts/get",
        {"name": "openbrain_workflow", "arguments": {"domain_id": world.domain, "guide_id": guide}},
        "alice",
    ).json()
    assert "error" in response
