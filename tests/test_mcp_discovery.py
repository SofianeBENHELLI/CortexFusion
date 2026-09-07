import os

import pytest
from cortex_core.api import create_app
from cortex_core.settings import Settings
from fastapi.testclient import TestClient
from pydantic import ValidationError

RESOURCE = "https://cortex.example.test/mcp/"


def configured(identity_keys, **overrides):
    return Settings(
        **{
            "database_url": os.environ["CORTEX_TEST_DATABASE_URL"],
            "jwt_issuer": "https://identity.test",
            "jwt_public_key_file": identity_keys[1],
            "jwt_audience": RESOURCE,
            "mcp_public_url": RESOURCE,
            **overrides,
        }
    )


def test_metadata_is_opt_in_and_public(world):
    response = world.client.get("/.well-known/oauth-protected-resource")
    assert response.status_code == 404 and response.json()["error"] == "DISCOVERY_DISABLED"


def test_challenge_metadata_and_audience_binding(world, identity_keys):
    with TestClient(
        create_app(configured(identity_keys)), base_url="https://cortex.example.test"
    ) as client:
        response = client.post("/mcp/", json={})
        assert response.status_code == 401
        assert (
            response.headers["www-authenticate"]
            == 'Bearer resource_metadata="https://cortex.example.test/.well-known/oauth-protected-resource"'
        )
        metadata = client.get("/.well-known/oauth-protected-resource")
        assert metadata.status_code == 200
        assert metadata.json() == {
            "resource": RESOURCE,
            "authorization_servers": ["https://identity.test"],
            "bearer_methods_supported": ["header"],
            "resource_name": "Cortex Fusion",
        }
        rpc = {"jsonrpc": "2.0", "id": 1, "method": "resources/list", "params": {}}
        accept = {"Accept": "application/json, text/event-stream"}
        assert (
            client.post("/mcp/", json=rpc, headers={**world.headers(), **accept}).status_code == 401
        )
        headers = {**world.headers(aud=RESOURCE), **accept}
        assert client.post("/mcp/", json=rpc, headers=headers).status_code == 200
        assert (
            client.post(
                "/mcp/", json=rpc, headers={**headers, "Host": "evil.example.test"}
            ).status_code
            == 421
        )
        assert (
            client.post(
                "/mcp/", json=rpc, headers={**headers, "Origin": "https://evil.example.test"}
            ).status_code
            == 403
        )
        # Forwarded headers cannot alter the configured discovery URL.
        result = client.get(
            "/.well-known/oauth-protected-resource",
            headers={"X-Forwarded-Host": "evil.example.test"},
        )
        assert result.json()["resource"] == RESOURCE


@pytest.mark.parametrize(
    "overrides",
    [
        {"mcp_public_url": "http://cortex.example.test/mcp/"},
        {"mcp_public_url": "https://cortex.example.test/other/"},
        {"mcp_public_url": "https://user:password@cortex.example.test/mcp/"},
        {"mcp_public_url": "https://cortex.example.test/mcp/?token=unused"},
        {"mcp_public_url": "https://cortex.example.test/mcp/#fragment"},
        {"jwt_audience": "unrelated-service"},
        {"jwt_issuer": "http://identity.test"},
        {"jwt_issuer": "https://user:password@identity.test"},
    ],
)
def test_discovery_rejects_unsafe_or_unbound_configuration(identity_keys, overrides):
    with pytest.raises(ValidationError):
        configured(identity_keys, **overrides)
