"""Explicit local access, synthetic identity only; normal OIDC remains separate."""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from cortex_browser_gateway.app import GatewayConfig, create_app
from cortex_browser_gateway.identity import NativeIdentity
from cortex_browser_gateway.oidc import IdentityGrant, LoginError
from cortex_browser_gateway.proxy import ApiProxy
from cortex_browser_gateway.sessions import SessionStore

ORIGIN = "http://127.0.0.1:5175"
CORE = "http://127.0.0.1:8013"
TENANT = "00000000-0000-0000-0000-000000000001"
DOMAIN = "00000000-0000-0000-0000-000000000002"


@asynccontextmanager
async def local_gateway():
    state = SimpleNamespace(status=200, calls=[], issued=0, sessions=SessionStore())

    def grant():
        state.issued += 1
        return IdentityGrant("local-user", TENANT, time.time() + 1800, "synthetic-server-token")

    def upstream(request):
        state.calls.append(request)
        assert request.headers["authorization"] == "Bearer synthetic-server-token"
        assert request.headers["x-tenant-id"] == TENANT
        assert "x-cortex-confirmation" not in request.headers
        value = (
            {
                "subject": "local-user",
                "tenant_id": TENANT,
                "domains": [
                    {"id": DOMAIN, "name": "Synthetic", "role": "viewer", "capabilities": ["query"]}
                ],
            }
            if request.url.path == "/v1/me"
            else {"ok": True}
        )
        return httpx.Response(
            state.status,
            stream=httpx.ByteStream(json.dumps(value).encode()),
            headers={"content-type": "application/json"},
        )

    transport = httpx.MockTransport(upstream)
    app = create_app(
        GatewayConfig(ORIGIN, allow_loopback_http=True),
        None,
        NativeIdentity(CORE, allow_loopback_http=True, transport=transport),
        api_proxy=ApiProxy(CORE, allow_loopback_http=True, transport=transport),
        sessions=state.sessions,
        local_grant=grant,
    )
    async with app.app.router.lifespan_context(app.app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=ORIGIN
        ) as client:
            state.client = client
            yield state


def test_direct_local_session_reload_expiry_and_native_rights():
    async def scenario():
        async with local_gateway() as g:
            r = await g.client.get("/auth/session")
            assert r.status_code == 200
            assert "synthetic-server-token" not in r.text
            assert r.json()["identity"]["domains"][0]["role"] == "viewer"
            assert "httponly" in r.headers["set-cookie"].lower()
            first = g.client.cookies.get("cortex-dev-session")
            assert (await g.client.get("/auth/session")).status_code == 200
            assert g.issued == 1
            # Expired/removed local cookie is replaced on the next page restore.
            await g.sessions.remove(first)
            assert (await g.client.get("/auth/session")).status_code == 200
            assert g.issued == 2
            assert g.client.cookies.get("cortex-dev-session") != first
            r = await g.client.get(
                f"/api/v1/domains/{DOMAIN}/version",
                headers={
                    "Authorization": "Bearer attacker",
                    "X-Tenant-ID": DOMAIN,
                    "X-Cortex-Confirmation": "not-a-confirmation",
                },
            )
            assert r.status_code == 200
            g.status = 403
            assert (await g.client.get("/auth/session")).status_code == 401
            assert (await g.client.get("/api/v1/me")).status_code == 401

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://outside.example"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Host": "outside.example"},
        {"Origin": "null"},
    ],
)
def test_cross_site_cannot_create_local_session(headers):
    async def scenario():
        async with local_gateway() as g:
            assert (await g.client.get("/auth/session", headers=headers)).status_code == 403
            assert not g.issued and not g.calls

    asyncio.run(scenario())


def test_proxy_requires_cookie_and_csrf_and_excludes_mcp_and_approval():
    async def scenario():
        async with local_gateway() as g:
            assert (await g.client.get("/api/v1/me")).status_code == 401
            r = await g.client.get("/auth/session")
            csrf = r.json()["csrf_token"]
            url = f"/api/v1/domains/{DOMAIN}/conversations"
            assert (
                await g.client.post(url, json={}, headers={"Origin": ORIGIN})
            ).status_code == 403
            assert (
                await g.client.post(url, json={}, headers={"X-Cortex-CSRF": csrf})
            ).status_code == 403
            assert (
                await g.client.post(url, json={}, headers={"Origin": ORIGIN, "X-Cortex-CSRF": csrf})
            ).status_code == 200
            for path in (
                "/api/mcp/",
                f"/api/v1/domains/{DOMAIN}/publish",
                "/auth/login",
                "/auth/callback",
            ):
                assert (await g.client.get(path)).status_code in {404, 405}
            assert (
                await g.client.post(
                    "/auth/logout", headers={"Origin": ORIGIN, "X-Cortex-CSRF": csrf}
                )
            ).status_code == 204
            assert (await g.client.get("/api/v1/me")).status_code == 401

    asyncio.run(scenario())


def test_unavailable_core_does_not_install_local_cookie():
    async def scenario():
        async with local_gateway() as g:
            g.status = 503
            r = await g.client.get("/auth/session")
            assert r.status_code == 502
            assert "set-cookie" not in r.headers
            assert "synthetic-server-token" not in r.text

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "origin,core",
    [
        ("https://public.example", CORE),
        (ORIGIN, "https://remote.example"),
    ],
)
def test_local_access_cannot_use_remote_origin_or_core(origin, core):
    async def scenario():
        identity = NativeIdentity(core, allow_loopback_http=True)
        try:
            with pytest.raises(LoginError, match="LOGIN_CONFIGURATION"):
                create_app(
                    GatewayConfig(origin, allow_loopback_http=True),
                    None,
                    identity,
                    local_grant=lambda: None,
                )
        finally:
            await identity.aclose()

    asyncio.run(scenario())


def test_frontend_environment_never_contains_identity_credentials(monkeypatch):
    from scripts.okf_browser import browser_environment

    monkeypatch.setenv("VITE_TOKEN", "old-secret")
    monkeypatch.setenv("CORTEX_JWT_PRIVATE_KEY", "old-key")
    env = browser_environment("local", DOMAIN)
    assert env["VITE_AUTH_MODE"] == "session"
    assert env["VITE_LOCAL_DOMAIN"] == DOMAIN
    assert "old-secret" not in json.dumps(env) and "old-key" not in json.dumps(env)
    manual = browser_environment("manual", DOMAIN)
    assert manual["VITE_AUTH_MODE"] == "manual"
    assert manual["VITE_LOCAL_ACCESS"] == "0"
    assert "CORTEX_BROWSER_GATEWAY_TARGET" not in manual
