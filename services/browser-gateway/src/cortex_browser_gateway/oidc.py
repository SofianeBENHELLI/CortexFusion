"""Bounded OIDC code exchange. No bearer or signing material goes to the UI.

The first adapter supports an explicitly configured RS256 issuer, same-origin
discovery endpoints and JWT API access tokens. Other provider profiles fail
closed until a reviewed adapter exists; this is not an arbitrary OIDC broker.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass, field
from urllib.parse import quote_plus, urlencode, urlsplit
from uuid import UUID

import httpx
import jwt


class LoginError(Exception):
    """Public code only. Never forward upstream error text, codes or tokens."""

    def __init__(self, code: str = "LOGIN_REJECTED"):
        self.code = code
        super().__init__(code)


def _endpoint(value: str, allow_loopback: bool = False) -> str:
    try:
        parsed = urlsplit(value)
        if (
            not isinstance(value, str)
            or len(value) > 2048
            or any(ord(c) < 33 or ord(c) > 126 for c in value)
            or "\\" in value
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not parsed.hostname
            or parsed.scheme not in {"http", "https"}
            or (
                parsed.scheme != "https"
                and not (allow_loopback and parsed.hostname in {"127.0.0.1", "::1"})
            )
        ):
            raise ValueError
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        return f"{parsed.scheme}://{parsed.hostname}:{port}"
    except (ValueError, TypeError, AttributeError):
        raise LoginError("LOGIN_CONFIGURATION") from None


@dataclass(frozen=True)
class OidcConfig:
    issuer: str
    client_id: str
    api_audience: str
    redirect_uri: str
    client_secret: str | None = field(default=None, repr=False)
    scope: str = "openid"
    allow_loopback_http: bool = False
    key_cache_seconds: int = 60
    key_refresh_interval: int = 5
    request_timeout: float = 10

    def __post_init__(self):
        _endpoint(self.issuer, self.allow_loopback_http)
        _endpoint(self.redirect_uri, self.allow_loopback_http)
        if (
            not self.client_id
            or len(self.client_id) > 300
            or not self.api_audience
            or len(self.api_audience) > 300
            or self.client_id == self.api_audience
            or "openid" not in self.scope.split()
            or not re.fullmatch(
                r"[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*", self.scope
            )
            or len(self.scope) > 512
            or not 1 <= self.key_refresh_interval <= self.key_cache_seconds <= 300
            or not 0 < self.request_timeout <= 30
            or (self.client_secret is not None and not 1 <= len(self.client_secret) <= 4096)
        ):
            raise LoginError("LOGIN_CONFIGURATION")


@dataclass(frozen=True)
class IdentityGrant:
    subject: str
    tenant: str
    expires_at: float
    access_token: str = field(repr=False)
    refresh_token: str | None = field(default=None, repr=False)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def challenge(verifier: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier):
        raise LoginError()
    return _b64(hashlib.sha256(verifier.encode("ascii")).digest())


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


class OidcProvider:
    def __init__(self, config: OidcConfig, *, transport: httpx.AsyncBaseTransport | None = None):
        self.config = config
        self._client = httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=config.request_timeout,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            headers={"Accept": "application/json", "Accept-Encoding": "identity"},
        )
        self._metadata: dict | None = None
        self._metadata_lock = asyncio.Lock()
        self._keys: dict[str, object] = {}
        self._key_deadline = 0.0
        self._next_key_refresh = 0.0
        self._key_lock = asyncio.Lock()

    async def aclose(self):
        await self._client.aclose()

    async def _json(self, method: str, url: str, *, maximum: int = 65536, **kwargs) -> dict:
        try:
            async with asyncio.timeout(self.config.request_timeout):
                request = self._client.build_request(method, url, **kwargs)
                request.headers.pop("cookie", None)
                response = await self._client.send(request, stream=True)
                self._client.cookies.clear()
                try:
                    if (
                        response.status_code != 200
                        or response.headers.get("content-type", "").split(";")[0]
                        != "application/json"
                        or response.headers.get("content-encoding", "identity") != "identity"
                        or int(response.headers.get("content-length", "0")) > maximum
                    ):
                        raise LoginError("IDENTITY_UNAVAILABLE")
                    body = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(body) + len(chunk) > maximum:
                            raise LoginError("IDENTITY_UNAVAILABLE")
                        body.extend(chunk)
                    value = json.loads(body, object_pairs_hook=_unique_object)
                    if not isinstance(value, dict):
                        raise LoginError("IDENTITY_UNAVAILABLE")
                    return value
                finally:
                    await response.aclose()
        except (httpx.HTTPError, TimeoutError, ValueError, UnicodeError, RecursionError):
            raise LoginError("IDENTITY_UNAVAILABLE") from None

    async def metadata(self) -> dict:
        async with self._metadata_lock:
            if self._metadata is not None:
                return dict(self._metadata)
            config = self.config
            value = await self._json(
                "GET",
                config.issuer.rstrip("/") + "/.well-known/openid-configuration",
                maximum=32768,
            )
            for name in (
                "code_challenge_methods_supported",
                "response_types_supported",
                "id_token_signing_alg_values_supported",
                "token_endpoint_auth_methods_supported",
            ):
                values = value.get(
                    name,
                    ["client_secret_basic"]
                    if name == "token_endpoint_auth_methods_supported"
                    else [],
                )
                if not isinstance(values, list) or any(
                    not isinstance(item, str) for item in values
                ):
                    raise LoginError("LOGIN_CONFIGURATION")
            if (
                value.get("issuer") != config.issuer
                or "S256" not in value.get("code_challenge_methods_supported", [])
                or "code" not in value.get("response_types_supported", [])
                or "RS256" not in value.get("id_token_signing_alg_values_supported", [])
                or ("client_secret_basic" if config.client_secret else "none")
                not in value.get("token_endpoint_auth_methods_supported", ["client_secret_basic"])
            ):
                raise LoginError("LOGIN_CONFIGURATION")
            origin = _endpoint(config.issuer, config.allow_loopback_http)
            for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
                if _endpoint(value.get(key), config.allow_loopback_http) != origin:
                    raise LoginError("LOGIN_CONFIGURATION")
            self._metadata = {
                key: value[key]
                for key in (
                    "authorization_endpoint",
                    "token_endpoint",
                    "jwks_uri",
                )
            }
            return dict(self._metadata)

    async def authorization_url(self, state: str, nonce: str, verifier: str) -> str:
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", v) for v in (state, nonce)):
            raise LoginError()
        metadata = await self.metadata()
        return (
            metadata["authorization_endpoint"]
            + "?"
            + urlencode(
                {
                    "client_id": self.config.client_id,
                    "redirect_uri": self.config.redirect_uri,
                    "response_type": "code",
                    "scope": self.config.scope,
                    "state": state,
                    "nonce": nonce,
                    "code_challenge": challenge(verifier),
                    "code_challenge_method": "S256",
                }
            )
        )

    async def _key(self, kid: str):
        async with self._key_lock:
            now = time.monotonic()
            if now < self._key_deadline and kid in self._keys:
                return self._keys[kid]
            # Unknown kids cannot trigger an unbounded JWKS fetch storm.
            if now < self._next_key_refresh:
                raise LoginError("IDENTITY_UNAVAILABLE")
            self._next_key_refresh = now + self.config.key_refresh_interval
            metadata = await self.metadata()
            value = await self._json("GET", metadata["jwks_uri"])
            entries = value.get("keys")
            if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
                raise LoginError("IDENTITY_UNAVAILABLE")
            keys = {}
            try:
                for entry in entries:
                    if not isinstance(entry, dict):
                        raise ValueError
                    if (
                        entry.get("kty") != "RSA"
                        or entry.get("use", "sig") != "sig"
                        or entry.get("alg", "RS256") != "RS256"
                    ):
                        continue
                    ident = entry.get("kid")
                    if not isinstance(ident, str) or not 1 <= len(ident) <= 200 or ident in keys:
                        raise ValueError
                    if "d" in entry or entry.get("key_ops", ["verify"]) != ["verify"]:
                        raise ValueError
                    key = jwt.PyJWK.from_dict(entry, algorithm="RS256").key
                    if key.key_size < 2048:
                        raise ValueError
                    keys[ident] = key
            except (ValueError, TypeError, AttributeError, jwt.PyJWTError):
                raise LoginError("IDENTITY_UNAVAILABLE") from None
            if not keys:
                raise LoginError("IDENTITY_UNAVAILABLE")
            self._keys = keys
            self._key_deadline = time.monotonic() + self.config.key_cache_seconds
            if kid not in keys:
                raise LoginError()
            return keys[kid]

    async def _claims(self, token: str, audience: str, *, access: bool = False) -> dict:
        try:
            if (
                not isinstance(token, str)
                or not 1 <= len(token) <= 16384
                or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token)
            ):
                raise ValueError
            header = jwt.get_unverified_header(token)
            if (
                header.get("alg") != "RS256"
                or header.get("typ", "JWT") not in ({"JWT", "at+jwt"} if access else {"JWT"})
                or any(k in header for k in ("jku", "jwk", "x5u", "crit"))
                or not isinstance(header.get("kid"), str)
                or not 1 <= len(header["kid"]) <= 200
            ):
                raise ValueError
            key = await self._key(header["kid"])
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=audience,
                issuer=self.config.issuer,
                options={"require": ["iss", "aud", "sub", "exp", "iat"]},
            )
            if (
                not isinstance(claims["sub"], str)
                or not 1 <= len(claims["sub"]) <= 300
                or any(type(claims[name]) is not int for name in ("iat", "exp"))
                or ("nbf" in claims and type(claims["nbf"]) is not int)
                or claims["exp"] <= claims["iat"]
                or ("azp" in claims and claims["azp"] != self.config.client_id)
                or (
                    not access
                    and isinstance(claims["aud"], list)
                    and len(claims["aud"]) > 1
                    and claims.get("azp") != self.config.client_id
                )
            ):
                raise ValueError
            return claims
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            raise LoginError() from None

    async def exchange(self, code: str, nonce: str, verifier: str) -> IdentityGrant:
        if (
            not isinstance(code, str)
            or not 1 <= len(code) <= 4096
            or any(ord(c) < 33 for c in code)
        ):
            raise LoginError()
        challenge(verifier)
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", nonce):
            raise LoginError()
        metadata = await self.metadata()
        body = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.config.redirect_uri,
            "code_verifier": verifier,
        }
        headers = {}
        if self.config.client_secret:
            credential = (
                quote_plus(self.config.client_id) + ":" + quote_plus(self.config.client_secret)
            )
            headers["Authorization"] = "Basic " + base64.b64encode(
                credential.encode("ascii")
            ).decode("ascii")
        else:
            body["client_id"] = self.config.client_id
        result = await self._json("POST", metadata["token_endpoint"], data=body, headers=headers)
        if (
            not isinstance(result.get("token_type"), str)
            or result["token_type"].lower() != "bearer"
        ):
            raise LoginError()
        ident = await self._claims(result.get("id_token"), self.config.client_id)
        access = await self._claims(
            result.get("access_token"), self.config.api_audience, access=True
        )
        try:
            if (
                not hmac.compare_digest(ident.get("nonce", ""), nonce)
                or access["sub"] != ident["sub"]
            ):
                raise ValueError
            if "at_hash" in ident and not hmac.compare_digest(
                ident["at_hash"],
                _b64(hashlib.sha256(result["access_token"].encode("ascii")).digest()[:16]),
            ):
                raise ValueError
            tenant = str(UUID(access["tenant"]))
            expires_at = min(ident["exp"], access["exp"])
            if "expires_in" in result:
                if type(result["expires_in"]) is not int or result["expires_in"] <= 0:
                    raise ValueError
                expires_at = min(expires_at, time.time() + result["expires_in"])
            refresh = result.get("refresh_token")
            if refresh is not None and (
                not isinstance(refresh, str) or not 1 <= len(refresh) <= 16384
            ):
                raise ValueError
            if expires_at <= time.time():
                raise ValueError
        except (ValueError, TypeError, KeyError, AttributeError):
            raise LoginError() from None
        return IdentityGrant(ident["sub"], tenant, expires_at, result["access_token"], refresh)
