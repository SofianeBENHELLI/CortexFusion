"""Configured native discovery and Ollama against isolated loopback fixtures."""

import selectors
import subprocess
from contextlib import contextmanager

import httpx
from verify_rust_extraction import verify_extraction


@contextmanager
def native_client(binary, env):
    process = subprocess.Popen([str(binary.resolve())], env=env, stdout=subprocess.PIPE, text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(15), "Native configured server failed to start"
            line = process.stdout.readline().strip()
        prefix = "CortexFusion Rust migration candidate listening on "
        assert line.startswith(prefix), line
        with httpx.Client(
            base_url="http://" + line.removeprefix(prefix), timeout=10, trust_env=False
        ) as client:
            yield client
    finally:
        process.terminate()
        try:
            process.wait(5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(5)


def verify_configured(binary, env, headers, admin, tenant, domain, state, private, port):
    resource = "https://cortex.example.test:8443/mcp/"
    with native_client(
        binary, {**env, "CORTEX_MCP_PUBLIC_URL": resource, "CORTEX_JWT_AUDIENCE": resource}
    ) as client:
        meta = {
            "resource": resource,
            "authorization_servers": [env["CORTEX_JWT_ISSUER"]],
            "bearer_methods_supported": ["header"],
            "resource_name": "Cortex Fusion",
        }
        assert client.get("/.well-known/oauth-protected-resource").json() == meta
        challenge = 'Bearer resource_metadata="https://cortex.example.test:8443/.well-known/oauth-protected-resource"'
        assert client.get("/v1/me").headers["www-authenticate"] == challenge
        assert client.post("/mcp/", json={}).headers["www-authenticate"] == challenge
        h = {
            **headers(aud=resource),
            "Accept": "application/json, text/event-stream",
            "Host": "cortex.example.test:8443",
            "Origin": "https://cortex.example.test:8443",
        }
        rpc = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_system_mcp_discovery", "arguments": {}},
        }
        r = client.post("/mcp/", headers=h, json=rpc)
        assert r.json()["result"]["structuredContent"] == {"http_status": 200, "data": meta}, r.text
        for host in ["evil.test", "cortex.example.test:8444", "cortex.example.test"]:
            assert client.post("/mcp/", headers={**h, "Host": host}, json=rpc).status_code == 403
        assert (
            client.post("/mcp/", headers={**h, "Origin": "https://evil.test"}, json=rpc).status_code
            == 403
        )
        assert client.get("/v1/me", headers=headers()).status_code == 401
    with native_client(
        binary,
        {
            **env,
            "CORTEX_MODEL_PROVIDER": "ollama",
            "CORTEX_LOCAL_MODEL": "synthetic/model",
            "CORTEX_OLLAMA_URL": f"http://127.0.0.1:{port}",
        },
    ) as client:
        checks = verify_extraction(
            client, headers, admin, tenant, domain, state, private, provider="ollama"
        )
    return ["native_configured_public_discovery_challenge_audience_origin_authority", *checks]
