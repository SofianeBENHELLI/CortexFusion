"""Synthetic session/ASGI regressions; these do not qualify Chrome or a real IdP."""

import asyncio
import json
import socket
import threading
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
import test_browser_gateway_oidc as oidc_tests
import uvicorn
from cortex_browser_gateway import sessions as session_module
from cortex_browser_gateway.app import GatewayConfig, create_app
from cortex_browser_gateway.identity import NativeIdentity
from cortex_browser_gateway.login import LoginAttempts
from cortex_browser_gateway.oidc import IdentityGrant, LoginError, OidcConfig, OidcProvider
from cortex_browser_gateway.proxy import ApiProxy
from cortex_browser_gateway.return_route import safe_return_route
from cortex_browser_gateway.sessions import SessionStore
from test_browser_gateway_oidc import TENANT, Issuer, provider, response

ORIGIN = "https://console.test"
DOMAIN = "00000000-0000-0000-0000-000000000002"
CONCEPT = "00000000-0000-0000-0000-000000000003"
SESSION_COOKIE = "__Host-cortex-session"
BINDING_COOKIE = "__Host-cortex-login"


class Core:
    def __init__(self):
        self.value = {
            "subject": "synthetic-reader",
            "tenant_id": TENANT,
            "domains": [
                {
                    "id": DOMAIN,
                    "name": "Synthetic domain",
                    "role": "viewer",
                    "capabilities": ["query"],
                }
            ],
        }
        self.calls = []
        self.status = 200
        self.entered = self.release = None
        self.raw_response = None

    async def handle(self, request):
        self.calls.append(request)
        assert str(request.url) == "https://core.test/v1/me"
        assert request.method == "GET"
        assert request.headers["authorization"].startswith("Bearer ey")
        assert request.headers["x-tenant-id"] == TENANT
        if self.entered is not None:
            self.entered.set()
            await self.release.wait()
        return self.raw_response() if self.raw_response else response(self.value, self.status)


@asynccontextmanager
async def gateway(*, sessions=None, maximum_requests=32, request_timeout=30, api_handler=None):
    issuer, core = Issuer(), Core()
    oidc = provider(issuer)
    sessions = sessions or SessionStore()
    attempts = LoginAttempts(oidc)
    identity = NativeIdentity("https://core.test", transport=httpx.MockTransport(core.handle))
    app = create_app(
        GatewayConfig(ORIGIN, maximum_requests=maximum_requests, request_timeout=request_timeout),
        oidc,
        identity,
        sessions=sessions,
        attempts=attempts,
        api_proxy=ApiProxy("https://core.test", transport=httpx.MockTransport(api_handler))
        if api_handler
        else None,
    )
    async with app.app.router.lifespan_context(app.app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=ORIGIN, follow_redirects=False
        ) as client:
            yield SimpleNamespace(
                issuer=issuer,
                core=core,
                oidc=oidc,
                sessions=sessions,
                client=client,
                app=app,
                attempts=attempts,
            )


async def login_start(g, route="/"):
    result = await g.client.get("/auth/login", params={"return_to": route})
    assert result.status_code == 303
    arguments = parse_qs(urlsplit(result.headers["location"]).query)
    assert "return_to" not in arguments
    payload = g.issuer.authorize(
        SimpleNamespace(
            authorization_url=result.headers["location"],
            binding_cookie=g.client.cookies.get(BINDING_COOKIE),
        )
    )
    return {"state": payload["state"], "code": payload["code"]}, result


async def login(g, route="/"):
    payload, _ = await login_start(g, route)
    result = await g.client.get("/auth/callback", params=payload)
    assert result.status_code == 303, result.text
    return result


def test_http_roundtrip_cookie_re_read_membership_logout_and_no_bearer_exposure():
    async def scenario():
        async with gateway() as g:
            route = f"/?api_domain={DOMAIN}&api_conversation={CONCEPT}&api_import={CONCEPT}&api_proposal={CONCEPT}&api_view=work"
            callback = await login(g, route)
            assert callback.headers["location"] == route
            for item in callback.headers.get_list("set-cookie"):
                assert "HttpOnly" in item and "Secure" in item and "SameSite=lax" in item
                assert "Path=/" in item and "Domain=" not in item
            assert BINDING_COOKIE not in g.client.cookies
            current = await g.client.get("/auth/session")
            assert current.status_code == 200 and current.json()["authenticated"] is True
            assert current.json()["identity"] == {**g.core.value, "extraction_provider": None}
            assert len(g.core.calls) == 2
            cookie = g.client.cookies.get(SESSION_COOKIE)
            assert len(cookie) == 43
            for secret in (cookie, "synthetic-refresh", "Bearer ", "eyJ"):
                assert secret not in current.text
            assert current.headers["cache-control"] == "no-store"
            assert current.headers["referrer-policy"] == "no-referrer"
            # Fresh native membership, with no role/rights inferred from OIDC or session.
            g.core.value["domains"] = []
            assert (await g.client.get("/auth/session")).json()["identity"]["domains"] == []
            assert g.core.calls[-1].headers.get("cookie") is None
            ended = await g.client.post(
                "/auth/logout",
                headers={"Origin": ORIGIN, "X-Cortex-CSRF": current.json()["csrf_token"]},
            )
            assert ended.status_code == 204
            assert SESSION_COOKIE not in g.client.cookies
            assert (await g.client.get("/auth/session")).status_code == 401
            with pytest.raises(LoginError):
                await g.sessions.get(cookie)
        assert not g.sessions._sessions and g.oidc._client.is_closed

    asyncio.run(scenario())


def test_callback_binding_replay_duplicates_and_single_exchange():
    async def scenario():
        async with gateway() as g:
            payload, _ = await login_start(g)
            binding = g.client.cookies.get(BINDING_COOKIE)
            g.client.cookies.clear()
            assert (await g.client.get("/auth/callback", params=payload)).status_code == 400
            assert not g.core.calls
            g.client.cookies.set(BINDING_COOKIE, binding, domain="console.test", path="/")
            result = await g.client.get("/auth/callback", params=payload)
            assert result.status_code == 303
            first = g.client.cookies.get(SESSION_COOKIE)
            replay = await g.client.get(
                "/auth/callback", params=payload, headers={"cookie": f"{BINDING_COOKIE}={binding}"}
            )
            assert replay.status_code == 400
            assert sum(r.method == "POST" for r in g.issuer.calls) == 1
            assert (await g.sessions.get(first)).grant.tenant == TENANT
            payload, _ = await login_start(g)
            duplicate = await g.client.get(
                "/auth/callback?" + urlencode(payload) + "&state=duplicate"
            )
            assert duplicate.status_code == 403

    asyncio.run(scenario())


def test_provider_denial_consumes_attempt_without_echoing_sensitive_error():
    async def scenario():
        async with gateway() as g:
            payload, _ = await login_start(g)
            binding = g.client.cookies.get(BINDING_COOKIE)
            denied = await g.client.get(
                "/auth/callback",
                params={
                    "state": payload["state"],
                    "error": "access_denied",
                    "error_description": "PRIVATE upstream detail",
                },
            )
            assert denied.status_code == 400 and "PRIVATE" not in denied.text
            assert not g.core.calls
            assert not any(r.method == "POST" for r in g.issuer.calls)
            replay = await g.client.get(
                "/auth/callback", params=payload, headers={"cookie": f"{BINDING_COOKIE}={binding}"}
            )
            assert replay.status_code == 400

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"origin": ORIGIN},
        {"origin": "https://other.test", "x-cortex-csrf": "valid"},
        {"origin": "null", "x-cortex-csrf": "valid"},
        {"origin": ORIGIN, "x-cortex-csrf": "wrong"},
        {"origin": ORIGIN, "x-cortex-csrf": "valid", "sec-fetch-site": "same-site"},
    ],
)
def test_logout_requires_same_origin_and_session_bound_csrf(headers):
    async def scenario():
        async with gateway() as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            supplied = {k: csrf if v == "valid" else v for k, v in headers.items()}
            assert (await g.client.post("/auth/logout", headers=supplied)).status_code == 403
            assert (await g.client.get("/auth/session")).status_code == 200

    asyncio.run(scenario())


def test_login_rotates_id_csrf_and_revokes_old_session_even_at_capacity():
    async def scenario():
        store = SessionStore(capacity=1)
        async with gateway(sessions=store) as g:
            await login(g)
            old = g.client.cookies.get(SESSION_COOKIE)
            old_csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            await login(g)
            assert old != g.client.cookies.get(SESSION_COOKIE)
            with pytest.raises(LoginError):
                await store.get(old)
            assert (
                await g.client.post(
                    "/auth/logout", headers={"origin": ORIGIN, "x-cortex-csrf": old_csrf}
                )
            ).status_code == 403
            assert len(store._sessions) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [401, 403, 500])
def test_native_identity_failure_masks_response_and_never_installs_session(status):
    async def scenario():
        async with gateway() as g:
            g.core.status = status
            payload, _ = await login_start(g)
            result = await g.client.get("/auth/callback", params=payload)
            assert result.status_code == (401 if status in {401, 403} else 502)
            assert SESSION_COOKIE not in g.client.cookies and not g.sessions._sessions
            assert "Synthetic domain" not in result.text

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [401, 403, 500])
def test_native_re_read_failure_does_not_return_cached_identity(status):
    async def scenario():
        async with gateway() as g:
            await login(g)
            g.core.status = status
            result = await g.client.get("/auth/session")
            assert result.status_code == (401 if status in {401, 403} else 502)
            assert "Synthetic domain" not in result.text
            assert bool(g.sessions._sessions) == (status == 500)
            assert SESSION_COOKIE in g.client.cookies

    asyncio.run(scenario())


def test_logout_during_identity_read_suppresses_late_private_data():
    async def scenario():
        async with gateway() as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            g.core.entered, g.core.release = asyncio.Event(), asyncio.Event()
            pending = asyncio.create_task(g.client.get("/auth/session"))
            await g.core.entered.wait()
            assert (
                await g.client.post(
                    "/auth/logout", headers={"origin": ORIGIN, "x-cortex-csrf": csrf}
                )
            ).status_code == 204
            g.core.release.set()
            finished = await pending
            assert finished.status_code == 401 and "Synthetic domain" not in finished.text

    asyncio.run(scenario())


def test_logout_during_relogin_cannot_resurrect_the_old_browser_session():
    async def scenario():
        async with gateway() as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            payload, _ = await login_start(g)
            g.core.entered, g.core.release = asyncio.Event(), asyncio.Event()
            pending = asyncio.create_task(g.client.get("/auth/callback", params=payload))
            await g.core.entered.wait()
            assert (
                await g.client.post(
                    "/auth/logout", headers={"origin": ORIGIN, "x-cortex-csrf": csrf}
                )
            ).status_code == 204
            g.core.release.set()
            finished = await pending
            assert finished.status_code == 401
            assert not g.sessions._sessions and SESSION_COOKIE not in g.client.cookies

    asyncio.run(scenario())


def test_old_session_response_cannot_delete_a_newly_rotated_cookie():
    async def scenario():
        async with gateway() as g:
            await login(g)
            g.core.entered, g.core.release = asyncio.Event(), asyncio.Event()
            pending = asyncio.create_task(g.client.get("/auth/session"))
            await g.core.entered.wait()
            g.core.entered = None
            await login(g)
            new_cookie = g.client.cookies.get(SESSION_COOKIE)
            g.core.release.set()
            result = await pending
            assert result.status_code == 401
            assert g.client.cookies.get(SESSION_COOKIE) == new_cookie
            assert (await g.client.get("/auth/session")).status_code == 200

    asyncio.run(scenario())


def test_request_capacity_is_bounded_and_recovers_after_cancellation():
    async def scenario():
        async with gateway(maximum_requests=1) as g:
            await login(g)
            g.core.entered, g.core.release = asyncio.Event(), asyncio.Event()
            pending = asyncio.create_task(g.client.get("/auth/session"))
            await g.core.entered.wait()
            result = await g.client.get("/auth/session")
            assert result.status_code == 429 and len(g.core.calls) == 2
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            g.core.release.set()
            assert (await g.client.get("/auth/session")).status_code == 200

    asyncio.run(scenario())


def test_gateway_deadline_covers_waiting_for_native_identity_without_replay():
    async def scenario():
        async with gateway(request_timeout=0.03) as g:
            await login(g)
            g.core.entered, g.core.release = asyncio.Event(), asyncio.Event()
            result = await g.client.get("/auth/session")
            assert result.status_code == 504 and result.json() == {"error": "GATEWAY_TIMEOUT"}
            assert "Synthetic domain" not in result.text and len(g.core.calls) == 2
            assert g.app.inflight == 0
            g.core.release.set()
            assert (await g.client.get("/auth/session")).status_code == 200

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "path,headers",
    [
        ("/auth/session", {"host": "other.test"}),
        ("/auth/session", {"origin": "https://other.test"}),
        ("/auth/session", {"sec-fetch-site": "cross-site"}),
        ("/auth/session?secret=not-allowed", {}),
        ("/auth/session", {"cookie": f"{SESSION_COOKIE}=a; {SESSION_COOKIE}=b"}),
        ("/auth/session?" + "x" * 4097, {}),
        ("/auth/session", {"cookie": "x" * 16385}),
        ("/auth/login?return_to=%FF", {}),
        ("/auth/login?return_to=%ZZ", {}),
    ],
)
def test_boundary_rejects_untrusted_origin_ambiguous_or_unbounded_input(path, headers):
    async def scenario():
        async with gateway() as g:
            assert (await g.client.get(path, headers=headers)).status_code == 403
            assert not g.core.calls and not g.issuer.calls

    asyncio.run(scenario())


def test_no_proxy_no_auth_get_logout_no_head_no_cors_and_forwarded_header_ignored():
    async def scenario():
        async with gateway() as g:
            assert (await g.client.get("/v1/me")).status_code == 404
            assert (await g.client.get("/auth/logout")).status_code == 405
            assert (await g.client.head("/auth/login")).status_code == 405
            assert (await g.client.options("/auth/session")).status_code == 405
            response = await g.client.get(
                "/auth/login",
                headers={"x-forwarded-host": "evil.test", "x-forwarded-proto": "http"},
            )
            assert response.status_code == 303
            assert parse_qs(urlsplit(response.headers["location"]).query)["redirect_uri"] == [
                ORIGIN + "/auth/callback"
            ]
            assert "access-control-allow-origin" not in response.headers

    asyncio.run(scenario())


def test_protected_logout_has_no_body_and_unknown_callback_fields_do_not_exchange():
    async def scenario():
        async with gateway() as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            assert (
                await g.client.post(
                    "/auth/logout",
                    content=b"not allowed",
                    headers={"origin": ORIGIN, "x-cortex-csrf": csrf},
                )
            ).status_code == 403
            payload, _ = await login_start(g)
            payload["binding_cookie"] = "never-from-url"
            assert (await g.client.get("/auth/callback", params=payload)).status_code == 403
            assert sum(r.method == "POST" for r in g.issuer.calls) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "bad",
    [
        "https://evil.test/",
        "//evil.test/",
        "/\\evil",
        "/%2fevil",
        "javascript:alert(1)",
        "/auth/callback",
        "/#fragment",
        "/?token=private",
        "/?question=private",
        "/?api_domain=no",
        "/?api_view=brain&api_view=work",
        "/?api_view=unknown",
        "/?colors=2",
        "/?domains_page=-1",
        "/?time_from=2026-02-31T00%3A00%3A00Z",
        "/?history_pages=100",
        "/?api_view=%FF",
        "/?api_view=%ZZ",
        f"/?api_conversation={CONCEPT}",
        f"/?api_import={CONCEPT}",
        f"/?api_proposal={CONCEPT}",
        f"/?api_domain={DOMAIN}&api_proposal=private",
        f"/?api_domain={DOMAIN}&api_proposal={CONCEPT}&api_proposal={CONCEPT}",
        f"/?api_domain={DOMAIN}&api_import=private",
        "/?api_view=%0d%0aLocation%3Aevil",
        "/?map_event=%5B%5D",
        "http://[",
        "/" + "a" * 2049,
        " /",
        "/\n",
    ],
)
def test_return_route_rejects_open_redirect_free_text_and_invalid_context(bad):
    with pytest.raises(LoginError, match="RETURN_ROUTE_REJECTED"):
        safe_return_route(bad)


@pytest.mark.parametrize(
    "kind", ["concept_created", "relation_created", "relation_removed", "relation_strengthened"]
)
def test_return_route_preserves_real_journal_identity_tuple(kind):
    relation = (
        json.dumps([DOMAIN, CONCEPT, TENANT, "structural"]) if kind.startswith("relation") else ""
    )
    event = json.dumps([DOMAIN, 22, CONCEPT, kind, relation])
    values = {
        "api_domain": DOMAIN,
        "map_node": CONCEPT,
        "map_event": event,
        "time_from": "2026-10-05T19:39:00.123Z",
        "history_pages": "5",
        "map_transport": "viewport",
    }
    output = safe_return_route("/?" + urlencode(values))
    assert {k: v[0] for k, v in parse_qs(urlsplit(output).query).items()} == values


@pytest.mark.parametrize(
    "change",
    [
        {"subject": "another"},
        {"tenant_id": DOMAIN},
        {"domains": None},
        {"domains": [None]},
        {"domains": [{"id": "bad"}]},
        {"extraction_provider": []},
    ],
)
def test_invalid_native_identity_cannot_establish_session(change):
    async def scenario():
        async with gateway() as g:
            g.core.value.update(change)
            payload, _ = await login_start(g)
            result = await g.client.get("/auth/callback", params=payload)
            assert result.status_code == 502 and not g.sessions._sessions

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "make_response",
    [
        lambda: response(b"x" * 65537),
        lambda: response(b"{}", **{"content-length": "65537"}),
        lambda: response(b"{}", **{"content-length": "invalid"}),
        lambda: response({}, 302, location="https://elsewhere.test"),
        lambda: response(b'{"subject":"a","subject":"b"}'),
        lambda: response({}, **{"content-encoding": "gzip"}),
    ],
)
def test_bounded_native_identity_responses_fail_closed(make_response):
    async def scenario():
        async with gateway() as g:
            g.core.raw_response = make_response
            payload, _ = await login_start(g)
            assert (await g.client.get("/auth/callback", params=payload)).status_code == 502
            assert not g.sessions._sessions

    asyncio.run(scenario())


def synthetic_grant(expiry=1000):
    return IdentityGrant("subject", TENANT, expiry, "server-secret", "refresh-secret")


def test_store_expiry_idle_absolute_wall_and_backward_clock(monkeypatch):
    clock = SimpleNamespace(wall=100, mono=100)
    monkeypatch.setattr(
        session_module,
        "time",
        SimpleNamespace(time=lambda: clock.wall, monotonic=lambda: clock.mono),
    )

    async def scenario():
        store = SessionStore(idle_seconds=10, absolute_seconds=30)
        first = await store.create(synthetic_grant())
        assert first.max_age == 30
        assert first.cookie not in repr(first) and "secret" not in repr(first.session)
        assert first.session.grant.refresh_token is None
        assert first.cookie not in store._sessions
        clock.mono = 109
        await store.get(first.cookie, touch=True)
        clock.mono = 118
        await store.get(first.cookie, touch=True)
        clock.mono, clock.wall = 127, 50  # wall-clock rollback cannot extend absolute deadline
        await store.get(first.cookie, touch=True)
        clock.mono = 130
        with pytest.raises(LoginError, match="SESSION_EXPIRED"):
            await store.get(first.cookie)
        second = await store.create(synthetic_grant())
        clock.mono = 140
        with pytest.raises(LoginError):
            await store.get(second.cookie)  # idle
        third = await store.create(synthetic_grant(60))
        clock.wall = 60
        with pytest.raises(LoginError):
            await store.get(third.cookie)  # upstream expiry, before monotonic idle expiry

    asyncio.run(scenario())


def test_store_capacity_atomic_rotation_and_invalid_expiry():
    async def scenario():
        store = SessionStore(capacity=1)
        grant = synthetic_grant(time.time() + 90)
        results = await asyncio.gather(
            store.create(grant), store.create(grant), return_exceptions=True
        )
        assert sum(isinstance(r, LoginError) for r in results) == 1
        first = next(r for r in results if not isinstance(r, LoginError))
        with pytest.raises(LoginError):
            await store.create(synthetic_grant(time.time() - 1), previous=first.cookie)
        assert await store.get(first.cookie)
        second = await store.create(grant, previous=first.cookie)
        assert (
            first.cookie != second.cookie and first.session.csrf_token != second.session.csrf_token
        )
        with pytest.raises(LoginError):
            await store.get(first.cookie)
        with pytest.raises(LoginError):
            store.check_csrf(second.session, first.session.csrf_token)
        await store.remove(second.cookie)
        assert not store._sessions

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "options",
    [
        {"capacity": 0},
        {"capacity": True},
        {"idle_seconds": 0},
        {"idle_seconds": 100, "absolute_seconds": 10},
        {"absolute_seconds": 86401},
    ],
)
def test_store_invalid_limits(options):
    with pytest.raises(LoginError, match="LOGIN_CONFIGURATION"):
        SessionStore(**options)


@pytest.mark.parametrize(
    "origin",
    [
        "http://console.test",
        "https://console.test/",
        "https://console.test/route",
        "https://console.test?x=a",
        "HTTPS://console.test",
        "https://CONSOLE.test",
        "https://console.test:443",
    ],
)
def test_gateway_configuration_does_not_accept_implicit_insecure_or_path_origin(origin):
    with pytest.raises(LoginError, match="LOGIN_CONFIGURATION"):
        GatewayConfig(origin)


def test_revoked_handle_is_rejected_and_failed_login_does_not_replace_active_session():
    async def scenario():
        async with gateway() as g:
            await login(g)
            original = g.client.cookies.get(SESSION_COOKIE)
            g.issuer.id_overrides["nonce"] = "bad"
            payload, _ = await login_start(g)
            assert (await g.client.get("/auth/callback", params=payload)).status_code == 400
            assert g.client.cookies.get(SESSION_COOKIE) == original
            assert (await g.client.get("/auth/session")).status_code == 200
            await g.sessions.clear()  # equivalent to process restart / server-side invalidation
            result = await g.client.get("/auth/session")
            assert result.status_code == 401
            assert "set-cookie" not in result.headers
            assert g.client.cookies.get(SESSION_COOKIE) == original

    asyncio.run(scenario())


def test_logout_cancels_pending_login_and_discarded_callback_cannot_be_redeemed():
    async def scenario():
        async with gateway() as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            payload, _ = await login_start(g)
            binding = g.client.cookies.get(BINDING_COOKIE)
            assert (
                await g.client.post(
                    "/auth/logout", headers={"origin": ORIGIN, "x-cortex-csrf": csrf}
                )
            ).status_code == 204
            result = await g.client.get(
                "/auth/callback", params=payload, headers={"cookie": f"{BINDING_COOKIE}={binding}"}
            )
            assert result.status_code == 400
            assert sum(r.method == "POST" for r in g.issuer.calls) == 1

    asyncio.run(scenario())


def test_unknown_native_fields_are_not_exposed_and_credentials_are_not_forwarded_from_browser():
    async def scenario():
        async with gateway() as g:
            g.core.value["access_token"] = "PRIVATE-NATIVE-TOKEN"
            await login(g)
            result = await g.client.get(
                "/auth/session",
                headers={
                    "Authorization": "Bearer attacker",
                    "x-tenant-id": DOMAIN,
                    "x-human-confirmation": "UNTRUSTED",
                },
            )
            assert result.status_code == 200 and "PRIVATE" not in result.text
            request = g.core.calls[-1]
            assert request.headers["x-tenant-id"] == TENANT
            assert request.headers["authorization"] != "Bearer attacker"
            assert "x-human-confirmation" not in request.headers

    asyncio.run(scenario())


def test_overlapping_login_tabs_fail_old_binding_without_consuming_current_login():
    async def scenario():
        async with gateway() as g:
            first, _ = await login_start(g)
            second, _ = await login_start(g)
            current_binding = g.client.cookies.get(BINDING_COOKIE)
            assert (await g.client.get("/auth/callback", params=first)).status_code == 400
            assert g.client.cookies.get(BINDING_COOKIE) == current_binding
            assert (await g.client.get("/auth/callback", params=second)).status_code == 303

    asyncio.run(scenario())


def test_gateway_authentication_over_real_loopback_http_and_shutdown_revocation(monkeypatch):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    origin = f"http://127.0.0.1:{sock.getsockname()[1]}"
    callback = origin + "/auth/callback"
    monkeypatch.setattr(oidc_tests, "CALLBACK", callback)
    issuer, core, store = Issuer(), Core(), SessionStore()
    api_calls = []

    async def api_handler(request):
        api_calls.append(request)
        assert request.headers["x-tenant-id"] == TENANT
        assert request.headers["authorization"].startswith("Bearer ey")
        return response({"fixture": "native-contract-double"})

    oidc = OidcProvider(
        OidcConfig(oidc_tests.ISSUER, "console", "cortex-core", callback, allow_loopback_http=True),
        transport=httpx.MockTransport(issuer.handle),
    )
    identity = NativeIdentity("https://core.test", transport=httpx.MockTransport(core.handle))
    api = ApiProxy("https://core.test", transport=httpx.MockTransport(api_handler))
    app = create_app(
        GatewayConfig(origin, allow_loopback_http=True),
        oidc,
        identity,
        sessions=store,
        api_proxy=api,
    )
    # No access log: authorization codes/state and context query strings must not be logged.
    server = uvicorn.Server(
        uvicorn.Config(
            app, access_log=False, log_level="critical", proxy_headers=False, lifespan="on"
        )
    )
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        with httpx.Client(
            base_url=origin, trust_env=False, timeout=5, follow_redirects=False
        ) as client:
            denied = client.get("/auth/session")
            assert denied.status_code == 401
            started = client.get("/auth/login", params={"return_to": f"/?api_domain={DOMAIN}"})
            assert started.status_code == 303
            assert "HttpOnly" in started.headers["set-cookie"]
            assert (
                "Secure" not in started.headers["set-cookie"]
            )  # explicit loopback development mode
            params = issuer.authorize(
                SimpleNamespace(
                    authorization_url=started.headers["location"],
                    binding_cookie=client.cookies.get("cortex-dev-login"),
                )
            )
            result = client.get("/auth/callback", params={k: params[k] for k in ("code", "state")})
            assert (
                result.status_code == 303 and result.headers["location"] == f"/?api_domain={DOMAIN}"
            )
            current = client.get("/auth/session")
            assert current.status_code == 200
            assert client.get("/auth/session").json()["identity"] == current.json()["identity"]
            assert client.get(f"/api/v1/domains/{DOMAIN}/version").status_code == 200
            created = client.post(
                f"/api/v1/domains/{DOMAIN}/conversations",
                json={"idempotency_key": "synthetic-local"},
                headers={"Origin": origin, "X-Cortex-CSRF": current.json()["csrf_token"]},
            )
            assert (
                created.status_code == 200 and created.json()["fixture"] == "native-contract-double"
            )
            assert (
                client.post(
                    "/auth/logout",
                    headers={"Origin": origin, "X-Cortex-CSRF": current.json()["csrf_token"]},
                ).status_code
                == 204
            )
            assert client.get("/auth/session").status_code == 401
        assert len(core.calls) == 3
        assert [request.method for request in api_calls] == ["GET", "POST"]
        assert all("cookie" not in request.headers for request in api_calls)
        assert not store._sessions
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
    assert not thread.is_alive()
    assert oidc._client.is_closed and identity._client.is_closed
    assert api._client.is_closed


def test_return_route_preserves_opaque_work_targets_only():
    assert "api_dossier=references" in safe_return_route(
        "/?" + urlencode({"api_domain": DOMAIN, "api_dossier": "references"})
    )
    assert "api_dossier=referenceReviews" in safe_return_route(
        "/?" + urlencode({"api_domain": DOMAIN, "api_dossier": "referenceReviews"})
    )
    values = {"api_domain": DOMAIN, "api_dossier": "cases", "api_case": CONCEPT, "api_task": TENANT}
    route = safe_return_route("/?" + urlencode(values))
    assert {k: v[0] for k, v in parse_qs(urlsplit(route).query).items()} == values
    for values in (
        {"api_case": CONCEPT},
        {"api_task": TENANT},
        {"api_domain": DOMAIN, "api_case": "private excerpt"},
        {"api_domain": DOMAIN, "api_dossier": "private title"},
    ):
        with pytest.raises(LoginError, match="RETURN_ROUTE_REJECTED"):
            safe_return_route("/?" + urlencode(values))
