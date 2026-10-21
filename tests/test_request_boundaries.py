"""Authentication and event-loop boundaries of the Python core, without a database or network."""

import asyncio
import json
import threading
import time

import jwt
import pytest
from cortex_core import auth as auth_module
from cortex_core.api import BoundaryMiddleware
from cortex_core.auth import Authenticator, CoreError, ThrottledJWKClient
from cortex_core.settings import Settings
from cryptography.hazmat.primitives.asymmetric import rsa

TENANT = "00000000-0000-4000-8000-000000000001"


def keypair(kid):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    return private, {**public, "kid": kid, "use": "sig", "alg": "RS256"}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    value = Clock()
    monkeypatch.setattr(auth_module.time, "monotonic", value)
    return value


def client_serving(keys, refresh_interval=5):
    client = ThrottledJWKClient("https://identity.invalid/keys", refresh_interval=refresh_interval)
    client.fetches = 0

    def fetch_data():
        client.fetches += 1
        data = {"keys": list(keys)}
        client.jwk_set_cache.put(data)
        return data

    client.fetch_data = fetch_data
    return client


def test_known_kid_uses_the_cached_key_set(clock):
    _, jwk = keypair("current")
    client = client_serving([jwk])
    for _ in range(3):
        assert client.get_signing_key("current").key_id == "current"
    assert client.fetches == 1


def test_unknown_kid_refreshes_at_most_once_per_interval(clock):
    _, jwk = keypair("current")
    client = client_serving([jwk], refresh_interval=5)
    with pytest.raises(jwt.PyJWKClientError):
        client.get_signing_key("forged")
    assert client.fetches == 2  # initial load plus one refresh
    for _ in range(20):
        with pytest.raises(jwt.PyJWKClientError):
            client.get_signing_key("forged")
    assert client.fetches == 2
    clock.now += 5
    with pytest.raises(jwt.PyJWKClientError):
        client.get_signing_key("forged")
    assert client.fetches == 3


def test_rotated_key_is_found_by_the_next_allowed_refresh(clock):
    _, old = keypair("old")
    _, new = keypair("new")
    keys = [old]
    client = client_serving(keys)
    assert client.get_signing_key("old").key_id == "old"
    keys.append(new)
    assert client.get_signing_key("new").key_id == "new"
    assert client.fetches == 2


def test_authenticator_rejects_unknown_kids_without_repeated_fetches(clock):
    private, jwk = keypair("current")
    settings = Settings(
        database_url="postgresql+pg8000://unused",
        jwt_issuer="https://identity.invalid",
        jwks_url="https://identity.invalid/keys",
    )
    authenticator = Authenticator(settings)
    served = client_serving([jwk])
    authenticator.jwks.fetch_data = served.fetch_data
    authenticator.jwks.jwk_set_cache = served.jwk_set_cache

    def token(kid):
        now = int(time.time())
        claims = {
            "sub": "alice",
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now,
            "exp": now + 60,
        }
        return "Bearer " + jwt.encode(claims, private, "RS256", headers={"kid": kid})

    assert authenticator.authenticate(token("current"), TENANT).subject == "alice"
    for _ in range(10):
        with pytest.raises(CoreError) as raised:
            authenticator.authenticate(token("forged"), TENANT)
        assert raised.value.status == 401
    assert served.fetches == 2


async def call(middleware, path):
    scope = {"type": "http", "path": path, "headers": [(b"authorization", b"Bearer x")]}
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    await middleware(scope, receive, send)
    return sent


async def downstream(scope, receive, send):
    await send({"type": "http.response.start", "status": 204, "headers": []})
    await send({"type": "http.response.body", "body": b""})


def test_mcp_authentication_runs_off_the_event_loop():
    release = threading.Event()

    class BlockingAuth:
        def authenticate(self, authorization, tenant):
            # Only returns if the event loop stays free to set the event meanwhile.
            if not release.wait(timeout=5):
                raise AssertionError("authentication blocked the event loop")

    async def scenario():
        middleware = BoundaryMiddleware(downstream, BlockingAuth(), limit=1024)
        request = asyncio.create_task(call(middleware, "/mcp/"))
        await asyncio.sleep(0.05)
        release.set()
        return await request

    sent = asyncio.run(scenario())
    assert sent[0]["status"] == 204


def test_mcp_authentication_failure_still_returns_a_challenge():
    class RejectingAuth:
        def authenticate(self, authorization, tenant):
            raise CoreError("NOT_AUTHORIZED", "Valid identity and tenant are required", 401)

    middleware = BoundaryMiddleware(downstream, RejectingAuth(), limit=1024)
    sent = asyncio.run(call(middleware, "/mcp/"))
    assert sent[0]["status"] == 401
    assert (b"www-authenticate", b"Bearer") in sent[0]["headers"]


def test_a_tenant_claim_binds_the_tenant_header(clock):
    private, jwk = keypair("current")
    settings = Settings(
        database_url="postgresql+pg8000://unused",
        jwt_issuer="https://identity.invalid",
        jwks_url="https://identity.invalid/keys",
    )
    authenticator = Authenticator(settings)
    served = client_serving([jwk])
    authenticator.jwks.fetch_data = served.fetch_data
    authenticator.jwks.jwk_set_cache = served.jwk_set_cache
    other = "00000000-0000-4000-8000-000000000002"

    def token(**extra):
        now = int(time.time())
        claims = {
            "sub": "alice",
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now,
            "exp": now + 60,
            **extra,
        }
        return "Bearer " + jwt.encode(claims, private, "RS256", headers={"kid": "current"})

    assert authenticator.authenticate(token(), TENANT).tenant_id == TENANT
    assert authenticator.authenticate(token(tenant=TENANT.upper()), TENANT).tenant_id == TENANT
    for bound in [other, "not-a-uuid", 7, None]:
        with pytest.raises(CoreError) as raised:
            authenticator.authenticate(token(tenant=bound), TENANT)
        assert raised.value.status == 401


def test_legacy_mcp_tools_run_off_the_event_loop_with_their_signature():
    import inspect

    from cortex_core.mcp_adapter import off_loop

    def blocking(domain_id: str, question: str, max_chars: int = 8000):
        """Docstring kept for the tool description."""
        return threading.get_ident(), domain_id, question, max_chars

    tool = off_loop(blocking)
    assert inspect.iscoroutinefunction(tool)
    assert inspect.signature(tool) == inspect.signature(blocking)
    assert tool.__doc__ == blocking.__doc__

    async def scenario():
        return threading.get_ident(), await tool("d", question="q")

    loop_thread, (worker_thread, *values) = asyncio.run(scenario())
    assert worker_thread != loop_thread
    assert values == ["d", "q", 8000]


def test_non_utf8_header_bytes_are_rejected_without_a_server_error():
    class Rejecting:
        def authenticate(self, authorization, tenant):
            assert tenant == "\xff"
            raise CoreError("NOT_AUTHORIZED", "Valid identity and tenant are required", 401)

    async def scenario():
        scope = {"type": "http", "path": "/mcp/", "headers": [(b"x-tenant-id", b"\xff")]}
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        await BoundaryMiddleware(downstream, Rejecting(), limit=1024)(scope, receive, send)
        return sent

    assert asyncio.run(scenario())[0]["status"] == 401
