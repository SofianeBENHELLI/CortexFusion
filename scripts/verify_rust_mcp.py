"""Wire checks for the initial native MCP tool subset."""

import json
from pathlib import Path


def verify_mcp(client, headers, domain):
    def rpc(method, params, h=None):
        return client.post(
            "/mcp/",
            headers={
                **(headers() if h is None else h),
                "Accept": "application/json, text/event-stream",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        )

    assert rpc("tools/list", {}, {}).status_code == 401
    initialized = rpc(
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "synthetic", "version": "1"},
        },
    )
    assert initialized.status_code == 200, initialized.text
    result = rpc("tools/list", {}).json()["result"]
    expected_names = {
        "api_system_health",
        "api_system_ready",
        "api_identity_read",
        "api_domain_version",
        "api_concepts_list",
        "api_concepts_read",
        "api_proposals_publish",
        "api_proposals_create",
        "api_proposals_diff",
        "api_proposals_list",
        "api_proposals_read",
        "api_proposals_approve",
        "api_proposals_review",
        "api_proposals_reviews",
        "api_sources_create",
        "api_sources_read",
        "api_sources_list",
        "api_sources_chunks",
    }
    assert {t["name"] for t in result["tools"]} == expected_names
    expected = json.loads(
        (Path(__file__).parents[1] / "packages/contracts/mcp-tools.json").read_text()
    )["tools"]
    for tool in result["tools"]:
        original = next(t for t in expected if t["name"] == tool["name"])
        assert tool["inputSchema"] == original["inputSchema"]
        assert tool["outputSchema"] == original["outputSchema"]
    for name, arguments, path in [
        ("api_system_health", {}, "/health"),
        ("api_system_ready", {}, "/ready"),
        ("api_identity_read", {}, "/v1/me"),
        ("api_domain_version", {"path": {"domain": domain}}, f"/v1/domains/{domain}/version"),
    ]:
        response = rpc("tools/call", {"name": name, "arguments": arguments})
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert not result.get("isError"), result
        assert result["structuredContent"] == {
            "http_status": 200,
            "data": client.get(path, headers=headers()).json(),
        }
    rejected = rpc(
        "tools/call", {"name": "api_identity_read", "arguments": {"role": "owner"}}
    ).json()
    assert "error" in rejected or rejected["result"].get("isError")
    assert (
        rpc("tools/list", {}, {**headers(), "Origin": "https://untrusted.test"}).status_code == 403
    )
    assert rpc("tools/list", {}, {**headers(), "Host": "untrusted.test"}).status_code in (400, 403)
    return [
        "native_mcp_stateless_identity",
        "native_mcp_schema_subset",
        "native_mcp_http_parity",
        "native_mcp_argument_and_origin_rejection",
    ]
