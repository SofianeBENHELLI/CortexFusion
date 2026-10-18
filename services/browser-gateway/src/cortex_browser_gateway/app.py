"""Opt-in ASGI session boundary and reviewed API proxy. Console wiring is separate."""

import asyncio
import json
import re
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

from starlette.applications import Starlette
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .identity import NativeIdentity
from .login import LoginAttempts
from .oidc import IdentityGrant, LoginError, OidcProvider, _endpoint
from .proxy import (
    ApiProxy,
    ApiResult,
    ProxyError,
    operation,
    query_string,
    request_body,
    until_disconnect,
)
from .sessions import SessionStore


@dataclass(frozen=True)
class GatewayConfig:
    origin: str
    allow_loopback_http: bool = False
    maximum_requests: int = 32
    request_timeout: float = 30

    def __post_init__(self):
        _endpoint(self.origin, self.allow_loopback_http)
        parsed = urlsplit(self.origin)
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        default_port = 443 if parsed.scheme == "https" else 80
        port = f":{parsed.port}" if parsed.port and parsed.port != default_port else ""
        canonical_origin = f"{parsed.scheme}://{host}{port}"
        if (
            self.origin != canonical_origin
            or urlsplit(self.origin).path != ""
            or "?" in self.origin
            or "#" in self.origin
            or type(self.maximum_requests) is not int
            or not 1 <= self.maximum_requests <= 256
            or type(self.request_timeout) not in {float, int}
            or not 0 < self.request_timeout <= 60
        ):
            raise LoginError("LOGIN_CONFIGURATION")

    @property
    def secure(self):
        return urlsplit(self.origin).scheme == "https"

    @property
    def session_cookie(self):
        return "__Host-cortex-session" if self.secure else "cortex-dev-session"

    @property
    def binding_cookie(self):
        return "__Host-cortex-login" if self.secure else "cortex-dev-login"


ERROR_STATUS = {
    "LOGIN_CONFIGURATION": 503,
    "LOGIN_CAPACITY": 429,
    "SESSION_CAPACITY": 429,
    "SESSION_EXPIRED": 401,
    "REQUEST_REJECTED": 403,
    "IDENTITY_UNAVAILABLE": 502,
    "CORE_UNAVAILABLE": 502,
}


def failure(error: LoginError) -> JSONResponse:
    return JSONResponse({"error": error.code}, status_code=ERROR_STATUS.get(error.code, 400))


def cookie(request: Request, name: str) -> str | None:
    values = []
    for header in request.headers.getlist("cookie"):
        for pair in header.split(";"):
            key, separator, value = pair.strip().partition("=")
            if key == name and separator:
                values.append(value)
    if len(values) > 1:
        raise LoginError("REQUEST_REJECTED")
    return values[0] if values else None


def params(request: Request, allowed: set[str]) -> dict[str, str]:
    try:
        raw = request.scope["query_string"].decode("ascii")
        if len(raw) > 4096 or re.search(r"%(?![0-9A-Fa-f]{2})", raw):
            raise ValueError
        pairs = parse_qsl(raw, keep_blank_values=True, max_num_fields=8, errors="strict")
        result = dict(pairs)
        if len(pairs) != len(result) or not set(result) <= allowed:
            raise ValueError
        return result
    except (ValueError, UnicodeError):
        raise LoginError("REQUEST_REJECTED") from None


class GatewayBoundary:
    """No forwarded-header trust, CORS, caches, diagnostic bodies or unbounded work."""

    def __init__(self, app, config: GatewayConfig):
        self.app, self.config, self.inflight = app, config, 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            await self.app(scope, receive, send)
            return

        response_started = False

        async def protected_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                message = dict(message)
                message["headers"] = list(message.get("headers", [])) + [
                    (b"cache-control", b"no-store"),
                    (b"pragma", b"no-cache"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-content-type-options", b"nosniff"),
                    (
                        b"content-security-policy",
                        b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                    ),
                ]
            await send(message)

        request = Request(scope, receive)
        try:
            if (
                len(request.headers.getlist("host")) != 1
                or len(scope.get("query_string", b"")) > 4096
                or sum(len(k) + len(v) for k, v in scope["headers"]) > 16384
                or scope.get("root_path", "")
            ):
                raise LoginError("REQUEST_REJECTED")
            expected = _endpoint(self.config.origin, self.config.allow_loopback_http)
            actual = _endpoint(
                f"{scope['scheme']}://{request.headers['host']}", self.config.allow_loopback_http
            )
            if actual != expected:
                raise LoginError("REQUEST_REJECTED")
        except LoginError:
            await failure(LoginError("REQUEST_REJECTED"))(scope, receive, protected_send)
            return
        if self.inflight >= self.config.maximum_requests:
            await JSONResponse({"error": "REQUEST_CAPACITY"}, status_code=429)(
                scope, receive, protected_send
            )
            return
        self.inflight += 1
        try:
            async with asyncio.timeout(self.config.request_timeout):
                await self.app(scope, receive, protected_send)
        except TimeoutError:
            if response_started:
                raise
            await JSONResponse({"error": "GATEWAY_TIMEOUT"}, status_code=504)(
                scope, receive, protected_send
            )
        finally:
            self.inflight -= 1


def create_app(
    config: GatewayConfig,
    provider: OidcProvider | None,
    identity: NativeIdentity,
    *,
    sessions: SessionStore | None = None,
    attempts: LoginAttempts | None = None,
    api_proxy: ApiProxy | None = None,
    local_grant: Callable[[], IdentityGrant] | None = None,
):
    """The app owns these clients/stores and closes/revokes them on lifespan exit."""
    if local_grant is not None:
        # Explicit personal-machine mode. Never activate on a public origin or
        # combine it with an OIDC login flow. Native rights still apply.
        if (
            provider is not None
            or attempts is not None
            or not config.allow_loopback_http
            or urlsplit(config.origin).hostname not in {"127.0.0.1", "::1"}
            or urlsplit(identity.url).hostname not in {"127.0.0.1", "::1"}
        ):
            raise LoginError("LOGIN_CONFIGURATION")
    elif provider is None:
        raise LoginError("LOGIN_CONFIGURATION")
    if provider is not None and provider.config.redirect_uri != config.origin + "/auth/callback":
        raise LoginError("LOGIN_CONFIGURATION")
    if api_proxy is not None and api_proxy.origin + "/v1/me" != identity.url:
        raise LoginError("LOGIN_CONFIGURATION")
    sessions = sessions or SessionStore()
    attempts = attempts or (LoginAttempts(provider) if provider is not None else None)

    def set_cookie(response, name, value, max_age):
        response.set_cookie(
            name,
            value,
            max_age=max_age,
            path="/",
            secure=config.secure,
            httponly=True,
            samesite="lax",
        )

    def clear_cookie(response, name):
        response.delete_cookie(name, path="/", secure=config.secure, httponly=True, samesite="lax")

    def same_origin(request: Request, *, required=False):
        origins = request.headers.getlist("origin")
        if (
            (required and not origins)
            or len(origins) > 1
            or (origins and origins[0] != config.origin)
            or request.headers.get("sec-fetch-site") not in {None, "same-origin", "none"}
        ):
            raise LoginError("REQUEST_REJECTED")

    async def login(request: Request):
        if attempts is None:
            return Response(status_code=404)
        if request.method != "GET":
            return Response(status_code=405)
        query = params(request, {"return_to"})
        start = await attempts.begin(return_to=query.get("return_to", "/"))
        response = RedirectResponse(start.authorization_url, status_code=303)
        set_cookie(response, config.binding_cookie, start.binding_cookie, start.expires_in)
        return response

    async def callback(request: Request):
        if attempts is None:
            return Response(status_code=404)
        if request.method != "GET":
            return Response(status_code=405)
        previous, binding = None, None
        try:
            binding = cookie(request, config.binding_cookie)
            query = params(request, {"code", "state", "error", "error_description", "iss"})
            if query.get("iss", provider.config.issuer) != provider.config.issuer:
                raise LoginError()
            if "error" in query:
                if "code" in query:
                    raise LoginError()
                await attempts.cancel(state=query.get("state", ""), binding_cookie=binding)
                raise LoginError()
            if "error_description" in query or not query.get("code"):
                raise LoginError()
            previous = cookie(request, config.session_cookie)
            try:
                await sessions.get(previous)
                require_previous = True
            except LoginError:
                require_previous = False
            completed = await attempts.complete_with_return(
                state=query.get("state", ""), binding_cookie=binding, code=query["code"]
            )
            await identity.read(completed.grant)
            started = await sessions.create(
                completed.grant, previous=previous, require_previous=require_previous
            )
            response = RedirectResponse(completed.return_to, status_code=303)
            set_cookie(response, config.session_cookie, started.cookie, started.max_age)
        except LoginError as error:
            response = failure(error)
            if error.code == "SESSION_EXPIRED":
                await sessions.remove(previous)
        if binding and not await attempts.has_pending_binding(binding):
            clear_cookie(response, config.binding_cookie)
        return response

    async def session(request: Request):
        if request.method != "GET":
            return Response(status_code=405)
        same_origin(request)
        params(request, set())
        handle = cookie(request, config.session_cookie)
        try:
            started = None
            try:
                entry = await sessions.get(handle)
            except LoginError as error:
                if local_grant is None or error.code != "SESSION_EXPIRED":
                    raise
                grant = local_grant()
                # Authenticate the fixed existing identity before installing a
                # browser session; never manufacture membership or a role.
                current_identity = await identity.read(grant)
                started = await sessions.create(grant, previous=handle)
                handle, entry = started.cookie, started.session
            current_identity = await identity.read(entry.grant)
            # A concurrent logout or expiry during /me must suppress the old identity.
            entry = await sessions.get(handle, touch=True)
            response = JSONResponse(
                {
                    "authenticated": True,
                    "identity": current_identity,
                    "csrf_token": entry.csrf_token,
                    "expires_at": entry.expires_at,
                }
            )
            if started is not None:
                set_cookie(response, config.session_cookie, started.cookie, started.max_age)
            return response
        except LoginError as error:
            response = failure(error)
            if error.code == "SESSION_EXPIRED":
                await sessions.remove(handle)
                # A late response from an old session must not clear a newer login cookie.
                # The invalid handle expires at its Max-Age or is replaced by a new login.
            return response

    async def logout(request: Request):
        same_origin(request, required=True)
        params(request, set())
        csrf = request.headers.getlist("x-cortex-csrf")
        if len(csrf) != 1:
            raise LoginError("REQUEST_REJECTED")
        # Logout is body-free. Bound a malicious chunked body and its time as well.
        try:
            async with asyncio.timeout(2):
                async for chunk in request.stream():
                    if chunk:
                        raise LoginError("REQUEST_REJECTED")
        except TimeoutError:
            raise LoginError("REQUEST_REJECTED") from None
        handle = cookie(request, config.session_cookie)
        binding = cookie(request, config.binding_cookie)
        entry = await sessions.get(handle)
        sessions.check_csrf(entry, csrf[0])
        await sessions.remove(handle)
        if attempts is not None:
            await attempts.cancel_binding(binding)
        response = Response(status_code=204)
        clear_cookie(response, config.session_cookie)
        clear_cookie(response, config.binding_cookie)
        return response

    async def proxy(request: Request):
        # Refuse path decoding/normalization tricks instead of interpreting them twice.
        path = request.scope["path"]
        if request.scope.get("raw_path", b"") != path.encode("ascii", errors="replace"):
            raise ProxyError(404, "OPERATION_NOT_ALLOWED")
        path = path.removeprefix("/api")
        op = operation(request.method, path)
        query = query_string(request.scope["query_string"], op)
        same_origin(request, required=op.method != "GET")
        handle = cookie(request, config.session_cookie)
        entry = await sessions.get(handle)
        if op.method != "GET":
            csrf = request.headers.getlist("x-cortex-csrf")
            if len(csrf) != 1:
                raise LoginError("REQUEST_REJECTED")
            sessions.check_csrf(entry, csrf[0])
        body = await request_body(request, op)
        # Logout during a slow request body must prevent forwarding the mutation.
        entry = await sessions.get(handle)

        async def upstream():
            if path == "/v1/me":
                return ApiResult(200, json.dumps(await identity.read(entry.grant)).encode())
            return await api_proxy.call(entry.grant, op, path, query, body)

        try:
            result = await until_disconnect(request, upstream())
        except LoginError as error:
            if error.code == "SESSION_EXPIRED":
                await sessions.remove(handle)
            raise
        if result.status == 401:
            await sessions.remove(handle)
        # Suppress late private responses after logout, rotation or token expiry.
        await sessions.get(handle, touch=200 <= result.status < 300)
        return Response(result.body, status_code=result.status, media_type="application/json")

    async def login_error(request, error):
        return failure(error)

    async def internal_error(request, error):
        return JSONResponse({"error": "GATEWAY_UNAVAILABLE"}, status_code=500)

    async def proxy_error(request, error):
        return JSONResponse({"error": error.code}, status_code=error.status)

    async def disconnected(request, error):
        return Response(status_code=499)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await sessions.clear()
            if attempts is not None:
                await attempts.clear()
            if api_proxy is not None:
                await api_proxy.aclose()
            await identity.aclose()
            if provider is not None:
                await provider.aclose()

    app = Starlette(
        debug=False,
        routes=[
            Route("/auth/login", login, methods=["GET"]),
            Route("/auth/callback", callback, methods=["GET"]),
            Route("/auth/session", session, methods=["GET"]),
            Route("/auth/logout", logout, methods=["POST"]),
        ]
        + (
            [Route("/api/{path:path}", proxy, methods=["GET", "POST"])]
            if api_proxy is not None
            else []
        ),
        exception_handlers={
            LoginError: login_error,
            ProxyError: proxy_error,
            ClientDisconnect: disconnected,
            Exception: internal_error,
        },
        lifespan=lifespan,
    )
    return GatewayBoundary(app, config)
