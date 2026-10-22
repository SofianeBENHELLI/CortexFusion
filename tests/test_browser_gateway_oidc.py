"""Synthetic OIDC transport only: no IdP, browser, corpus or ACL mutations."""

import asyncio
import base64
import hashlib
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cortex_browser_gateway.login import LoginAttempts
from cortex_browser_gateway.oidc import LoginError, OidcConfig, OidcProvider
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://issuer.test/realm"
CALLBACK = "https://console.test/auth/callback"
TENANT = "00000000-0000-0000-0000-000000000001"


def response(value, status=200, **headers):
    body = value if isinstance(value, bytes) else json.dumps(value).encode()
    return httpx.Response(
        status,
        stream=httpx.ByteStream(body),
        headers={"content-type": "application/json", **headers},
    )


class Issuer:
    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "first-key"
        self.jwks = None
        self.id_overrides, self.access_overrides, self.token_overrides = {}, {}, {}
        self.signing_key = None
        self.algorithm = "RS256"
        self.header_overrides = {}
        self.codes = {}
        self.calls = []
        self.failures = {}
        self.metadata = {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/authorize",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/keys",
            "code_challenge_methods_supported": ["S256"],
            "response_types_supported": ["code"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "token_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
        }

    def public_key(self):
        return {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key())),
            "kid": self.kid,
            "use": "sig",
            "alg": "RS256",
        }

    def authorize(self, start):
        params = {k: v[0] for k, v in parse_qs(urlsplit(start.authorization_url).query).items()}
        code = f"synthetic-code-{len(self.codes)}"
        self.codes[code] = params
        return {"code": code, "state": params["state"], "binding_cookie": start.binding_cookie}

    async def handle(self, request):
        self.calls.append(request)
        path = request.url.path
        if path in self.failures:
            return self.failures[path]()
        if path.endswith("openid-configuration"):
            return response(self.metadata, **{"set-cookie": "provider=not-a-user-session"})
        if path.endswith("/keys"):
            return response({"keys": self.jwks or [self.public_key()]})
        if path.endswith("/token"):
            await asyncio.sleep(0)
            body = {k: v[0] for k, v in parse_qs((await request.aread()).decode()).items()}
            params = self.codes.pop(body.get("code"), None)
            if not params or body.get("redirect_uri") != CALLBACK:
                return response({"error": "invalid_grant"}, 400)
            calculated = (
                base64.urlsafe_b64encode(
                    hashlib.sha256(body.get("code_verifier", "").encode()).digest()
                )
                .rstrip(b"=")
                .decode()
            )
            if calculated != params["code_challenge"]:
                return response({"error": "invalid_grant"}, 400)
            now = int(time.time())
            common = {"iss": ISSUER, "sub": "synthetic-reader", "iat": now, "exp": now + 120}
            access = jwt.encode(
                {**common, "aud": "cortex-core", "tenant": TENANT, **self.access_overrides},
                self.signing_key or self.key,
                algorithm=self.algorithm,
                headers={"kid": self.kid, **self.header_overrides},
            )
            at_hash = (
                base64.urlsafe_b64encode(hashlib.sha256(access.encode()).digest()[:16])
                .rstrip(b"=")
                .decode()
            )
            ident = jwt.encode(
                {
                    **common,
                    "aud": "console",
                    "nonce": params["nonce"],
                    "at_hash": at_hash,
                    **self.id_overrides,
                },
                self.signing_key or self.key,
                algorithm=self.algorithm,
                headers={"kid": self.kid, **self.header_overrides},
            )
            return response(
                {
                    "token_type": "Bearer",
                    "access_token": access,
                    "id_token": ident,
                    "expires_in": 90,
                    "refresh_token": "synthetic-refresh",
                    **self.token_overrides,
                }
            )
        raise AssertionError("unconfigured synthetic endpoint")


@pytest.fixture
def issuer():
    return Issuer()


def provider(issuer, **config):
    return OidcProvider(
        OidcConfig(ISSUER, "console", "cortex-core", CALLBACK, **config),
        transport=httpx.MockTransport(issuer.handle),
    )


async def grant(oidc, issuer):
    attempts = LoginAttempts(oidc)
    start = await attempts.begin()
    return await attempts.complete(**issuer.authorize(start))


def test_code_pkce_nonce_and_server_only_tokens(issuer):
    async def scenario():
        oidc = provider(issuer)
        try:
            result = await grant(oidc, issuer)
            assert result.subject == "synthetic-reader" and result.tenant == TENANT
            assert time.time() < result.expires_at <= time.time() + 90
            assert result.access_token not in repr(result) and "synthetic-refresh" not in repr(
                result
            )
            token_request = next(r for r in issuer.calls if r.method == "POST")
            body = parse_qs(token_request.content.decode())
            assert body["grant_type"] == ["authorization_code"]
            assert body["client_id"] == ["console"]
            assert len(body["code_verifier"][0]) == 43
            assert all("cookie" not in r.headers for r in issuer.calls)
            assert sum(r.url.path.endswith("/keys") for r in issuer.calls) == 1
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "field,value",
    [
        ("nonce", "wrong"),
        ("nonce", "🧠"),
        ("iss", "https://other.test"),
        ("aud", "cortex-core"),
        ("sub", ""),
        ("sub", "other"),
        ("exp", 1),
        ("exp", "9999999999"),
        ("iat", int(time.time()) + 3600),
        ("iat", True),
        ("nbf", int(time.time()) + 3600),
        ("azp", "other"),
        ("aud", ["console", "another"]),
        ("at_hash", "wrong"),
    ],
)
def test_rejects_id_claims(issuer, field, value):
    issuer.id_overrides[field] = value

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError, match="LOGIN_REJECTED"):
                await grant(oidc, issuer)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "field,value",
    [
        ("tenant", "not-a-uuid"),
        ("tenant", None),
        ("sub", "different"),
        ("aud", "console"),
        ("iss", "https://other.test"),
        ("exp", 1),
        ("azp", "other"),
    ],
)
def test_rejects_access_token_identity_and_audience(issuer, field, value):
    issuer.access_overrides[field] = value

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "mutation", ["signature", "algorithm", "jku", "crit", "duplicate_kid", "weak_key"]
)
def test_refuses_untrusted_signature_or_key_metadata(issuer, mutation):
    if mutation == "signature":
        issuer.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    elif mutation == "algorithm":
        issuer.algorithm, issuer.signing_key = (
            "HS256",
            "synthetic-symmetric-key-not-a-trusted-RSA-key",
        )
    elif mutation == "jku":
        issuer.header_overrides["jku"] = "https://other.test/keys"
    elif mutation == "crit":
        issuer.header_overrides["crit"] = ["unrecognized"]
    elif mutation == "duplicate_kid":
        issuer.jwks = [issuer.public_key(), issuer.public_key()]
    else:
        issuer.key = rsa.generate_private_key(public_exponent=65537, key_size=1024)

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
            assert all(r.url.host == "issuer.test" for r in issuer.calls)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "field,value",
    [
        ("issuer", "https://other.test"),
        ("jwks_uri", "http://127.0.0.1/private"),
        ("token_endpoint", "https://other.test/token"),
        ("authorization_endpoint", "https://name:secret@issuer.test/auth"),
        ("code_challenge_methods_supported", ["plain"]),
        ("code_challenge_methods_supported", None),
        ("response_types_supported", ["token"]),
        ("id_token_signing_alg_values_supported", ["HS256"]),
    ],
)
def test_metadata_never_selects_another_origin_or_weaker_profile(issuer, field, value):
    issuer.metadata[field] = value

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError, match="LOGIN_CONFIGURATION"):
                await LoginAttempts(oidc).begin()
            assert len(issuer.calls) == 1
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_browser_binding_replay_and_concurrent_callback(issuer):
    async def scenario():
        oidc = provider(issuer)
        try:
            attempts = LoginAttempts(oidc)
            started = await attempts.begin()
            payload = issuer.authorize(started)
            assert started.binding_cookie not in repr(started)
            with pytest.raises(LoginError):
                await attempts.complete(**{**payload, "binding_cookie": "x" * 43})
            results = await asyncio.gather(
                attempts.complete(**payload), attempts.complete(**payload), return_exceptions=True
            )
            assert sum(isinstance(item, LoginError) for item in results) == 1
            assert sum(r.method == "POST" for r in issuer.calls) == 1
            with pytest.raises(LoginError):
                await attempts.complete(**payload)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_transaction_expiry_capacity_and_consumption_on_failed_exchange(issuer, monkeypatch):
    class Clock:
        now = 100.0

        def monotonic(self):
            return self.now

    clock = Clock()
    monkeypatch.setattr("cortex_browser_gateway.login.time", clock)

    async def scenario():
        oidc = provider(issuer)
        try:
            attempts = LoginAttempts(oidc, capacity=1, ttl_seconds=10)
            expired = issuer.authorize(await attempts.begin())
            with pytest.raises(LoginError, match="LOGIN_CAPACITY"):
                await attempts.begin()
            clock.now += 11
            with pytest.raises(LoginError):
                await attempts.complete(**expired)
            payload = issuer.authorize(await attempts.begin())
            issuer.failures["/realm/token"] = lambda: response(
                {"error": "private-upstream-details"}, 503
            )
            with pytest.raises(LoginError) as error:
                await attempts.complete(**payload)
            assert "private-upstream-details" not in str(error.value)
            with pytest.raises(LoginError):
                await attempts.complete(**payload)
            assert sum(r.method == "POST" for r in issuer.calls) == 1
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_jwks_rotation_throttle_and_expired_cache_fail_closed(issuer, monkeypatch):
    class Clock:
        now = 100.0

        def monotonic(self):
            return self.now

        def time(self):
            return time.time()

    clock = Clock()
    monkeypatch.setattr("cortex_browser_gateway.oidc.time", clock)

    async def scenario():
        oidc = provider(issuer, key_cache_seconds=10, key_refresh_interval=2)
        try:
            await grant(oidc, issuer)
            old_key = issuer.key
            issuer.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            issuer.kid = "new-key"
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
            assert sum(r.url.path.endswith("/keys") for r in issuer.calls) == 1
            clock.now += 3
            await grant(oidc, issuer)
            assert sum(r.url.path.endswith("/keys") for r in issuer.calls) == 2
            # Once refreshed, a removed old key is no longer accepted.
            issuer.key, issuer.kid = old_key, "first-key"
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
            issuer.failures["/realm/keys"] = lambda: response({}, 503)
            clock.now += 11
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "failure", ["oversize", "redirect", "duplicate", "compressed", "malformed"]
)
def test_bounded_strict_transport_and_no_redirect_or_raw_error(issuer, failure):
    failures = {
        "oversize": lambda: response(b"x" * 65537),
        "redirect": lambda: response({}, 302, location="https://other.test/token"),
        "duplicate": lambda: response(b'{"token_type":"Bearer","token_type":"MAC"}'),
        "compressed": lambda: response({}, **{"content-encoding": "gzip"}),
        "malformed": lambda: response(b"private-upstream-details"),
    }
    issuer.failures["/realm/token"] = failures[failure]

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError) as error:
                await grant(oidc, issuer)
            assert "private-upstream-details" not in str(error.value)
            assert all(r.url.host == "issuer.test" for r in issuer.calls)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_confidential_client_uses_encoded_basic_not_url_or_body(issuer):
    async def scenario():
        oidc = provider(issuer, client_secret="synthetic:secret&+")
        try:
            await grant(oidc, issuer)
            request = next(r for r in issuer.calls if r.method == "POST")
            assert (
                base64.b64decode(request.headers["authorization"].split()[1]).decode()
                == "console:synthetic%3Asecret%26%2B"
            )
            assert "secret" not in str(request.url) and b"secret" not in request.content
            assert "synthetic:secret&+" not in repr(oidc.config)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "url",
    [
        "http://issuer.test",
        "https://a:b@issuer.test",
        "https://issuer.test?q=a",
        "https://issuer.test/#a",
        "https://issuer.test\\@other.test",
        "https://issuer.test\n",
    ],
)
def test_configuration_rejects_unsafe_urls(url):
    with pytest.raises(LoginError):
        OidcConfig(url, "console", "cortex-core", CALLBACK)


def test_loopback_requires_explicit_opt_in_and_literal_loopback():
    with pytest.raises(LoginError):
        OidcConfig(
            "http://127.0.0.1:8900", "console", "cortex-core", "http://127.0.0.1:5174/auth/callback"
        )
    OidcConfig(
        "http://127.0.0.1:8900",
        "console",
        "cortex-core",
        "http://127.0.0.1:5174/auth/callback",
        allow_loopback_http=True,
    )
    with pytest.raises(LoginError):
        OidcConfig(
            "http://localhost:8900", "console", "cortex-core", CALLBACK, allow_loopback_http=True
        )


def test_pkce_mismatch_cannot_redeem_the_code(issuer):
    async def scenario():
        oidc = provider(issuer)
        try:
            started = await LoginAttempts(oidc).begin()
            payload = issuer.authorize(started)
            nonce = parse_qs(urlsplit(started.authorization_url).query)["nonce"][0]
            with pytest.raises(LoginError):
                await oidc.exchange(payload["code"], nonce, "x" * 43)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_matching_authorized_party_allows_multi_audience_id_token(issuer):
    issuer.id_overrides = {"aud": ["console", "another"], "azp": "console"}

    async def scenario():
        oidc = provider(issuer)
        try:
            assert (await grant(oidc, issuer)).tenant == TENANT
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "field,value",
    [
        ("token_type", "MAC"),
        ("id_token", None),
        ("access_token", "opaque-access-token"),
        ("expires_in", True),
        ("expires_in", -10),
        ("refresh_token", 9),
    ],
)
def test_invalid_token_envelopes_are_not_sessions(issuer, field, value):
    issuer.token_overrides[field] = value

    async def scenario():
        oidc = provider(issuer)
        try:
            with pytest.raises(LoginError):
                await grant(oidc, issuer)
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_total_deadline_bounds_a_slow_body_and_consumes_the_attempt(issuer):
    class Slow(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"partial":'
            await asyncio.sleep(0.1)
            yield b"0}"

    issuer.failures["/realm/token"] = lambda: httpx.Response(
        200, headers={"content-type": "application/json"}, stream=Slow()
    )

    async def scenario():
        oidc = provider(issuer, request_timeout=0.03)
        try:
            attempts = LoginAttempts(oidc)
            payload = issuer.authorize(await attempts.begin())
            with pytest.raises(LoginError, match="IDENTITY_UNAVAILABLE"):
                await attempts.complete(**payload)
            with pytest.raises(LoginError):
                await attempts.complete(**payload)
            assert sum(r.method == "POST" for r in issuer.calls) == 1
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_cancellation_does_not_replay_an_ambiguous_code_exchange(issuer):
    class Waiting(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"{"
            await asyncio.Event().wait()

    issuer.failures["/realm/token"] = lambda: httpx.Response(
        200, headers={"content-type": "application/json"}, stream=Waiting()
    )

    async def scenario():
        oidc = provider(issuer)
        try:
            attempts = LoginAttempts(oidc)
            payload = issuer.authorize(await attempts.begin())
            callback = asyncio.create_task(attempts.complete(**payload))
            while not any(r.method == "POST" for r in issuer.calls):
                await asyncio.sleep(0)
            callback.cancel()
            with pytest.raises(asyncio.CancelledError):
                await callback
            with pytest.raises(LoginError):
                await attempts.complete(**payload)
            assert sum(r.method == "POST" for r in issuer.calls) == 1
        finally:
            await oidc.aclose()

    asyncio.run(scenario())


def test_protocol_over_real_loopback_http_without_an_external_provider(monkeypatch):
    synthetic = None

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.serve()

        def do_POST(self):
            self.serve()

        def serve(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            request = httpx.Request(
                self.command, origin + self.path, headers=dict(self.headers), content=body
            )
            result = asyncio.run(synthetic.handle(request))
            payload = asyncio.run(result.aread())
            self.send_response(result.status_code)
            for name, value in result.headers.items():
                if name.lower() != "content-length":
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setattr(sys.modules[__name__], "ISSUER", origin + "/realm")
    synthetic = Issuer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    async def scenario():
        oidc = OidcProvider(
            OidcConfig(ISSUER, "console", "cortex-core", CALLBACK, allow_loopback_http=True)
        )
        try:
            result = await grant(oidc, synthetic)
            assert result.subject == "synthetic-reader" and result.tenant == TENANT
            assert len(synthetic.calls) == 3  # discovery, token and JWKS
            assert all("cookie" not in call.headers for call in synthetic.calls)
        finally:
            await oidc.aclose()

    try:
        asyncio.run(scenario())
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()
