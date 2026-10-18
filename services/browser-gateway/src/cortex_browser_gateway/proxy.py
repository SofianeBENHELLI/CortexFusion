"""Reviewed console operations only; no arbitrary target, headers or command signer."""

import asyncio
import json
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlsplit

import httpx
from starlette.requests import ClientDisconnect, Request

from .oidc import IdentityGrant, LoginError, _endpoint, _unique_object

UUID = r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}"
BASE = r"/v1/domains/" + UUID
PAGE = frozenset({"limit", "after"})
STAMP = frozenset({"at_version", "visibility"})


class ProxyError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class Operation:
    method: str
    path: str
    query: frozenset[str] = frozenset()
    request_bytes: int = 0
    response_bytes: int = 8_000_000


# This list is intentionally independent of all core routes. Contract tests compare
# it with the current console transport; adding an operation requires a review here.
OPERATIONS = (
    Operation(
        "POST", BASE + "/sources/" + UUID + "/locate", request_bytes=2000000, response_bytes=16384
    ),
    Operation("GET", r"/v1/companion-guides", response_bytes=65536),
    Operation(
        "GET",
        BASE + "/sources/" + UUID + "/passage",
        frozenset({"offset", "limit", "expected_hash"}),
        response_bytes=65536,
    ),
    Operation("GET", BASE + "/work-activity", PAGE, response_bytes=262144),
    Operation(
        "POST", BASE + "/work-activity/" + UUID + "/read", request_bytes=4096, response_bytes=4096
    ),
    Operation("GET", BASE + "/agent-mission-controls", PAGE, response_bytes=65536),
    Operation("GET", BASE + "/agent-mission-controls/" + UUID, response_bytes=4096),
    Operation(
        "GET",
        BASE + "/agent-missions/" + UUID + "/evidence/(?:[1-9]|10)",
        frozenset({"expected_revision"}),
        response_bytes=65536,
    ),
    Operation("GET", BASE + "/agent-missions", PAGE, response_bytes=262144),
    Operation("GET", BASE + "/agent-missions/candidates", PAGE, response_bytes=262144),
    Operation("POST", BASE + "/agent-missions/prepare", request_bytes=65536, response_bytes=262144),
    Operation("POST", BASE + "/agent-missions/create", request_bytes=65536, response_bytes=262144),
    Operation("GET", BASE + "/agent-missions/" + UUID, response_bytes=262144),
    Operation(
        "POST",
        BASE + "/agent-missions/" + UUID + "/commands",
        request_bytes=65536,
        response_bytes=262144,
    ),
    Operation("GET", BASE + "/agent-missions/" + UUID + "/events", PAGE, response_bytes=262144),
    Operation("GET", BASE + "/agent-mission-receipts/" + UUID, response_bytes=262144),
    Operation("GET", BASE + "/reference-drafts/" + UUID + "/reviewers", PAGE, response_bytes=16384),
    Operation("GET", BASE + "/reference-reviews", PAGE | {"scope"}, response_bytes=262144),
    Operation("GET", BASE + "/reference-reviews/" + UUID, response_bytes=131072),
    Operation(
        "GET",
        BASE + "/reference-reviews/" + UUID + "/events",
        PAGE | {"expected_revision"},
        response_bytes=131072,
    ),
    Operation(
        "POST", BASE + "/reference-reviews/prepare", request_bytes=4096, response_bytes=131072
    ),
    Operation("POST", BASE + "/reference-reviews/submit", request_bytes=4096, response_bytes=4096),
    Operation(
        "POST",
        BASE + "/reference-reviews/" + UUID + "/commands",
        request_bytes=16384,
        response_bytes=4096,
    ),
    Operation("GET", BASE + "/reference-review-receipts/" + UUID, response_bytes=4096),
    Operation("GET", BASE + "/reference-draft-receipts/" + UUID, response_bytes=4096),
    Operation("GET", BASE + "/reference-drafts", PAGE, response_bytes=262144),
    Operation("GET", BASE + "/reference-drafts/" + UUID, response_bytes=131072),
    Operation(
        "POST", BASE + "/reference-drafts/" + UUID, request_bytes=131072, response_bytes=4096
    ),
    Operation("POST", BASE + "/tasks/" + UUID + "/plan", request_bytes=16384, response_bytes=4096),
    Operation("GET", BASE + "/work-brief", frozenset({"scope"}), response_bytes=262144),
    Operation("GET", BASE + "/work-overview", frozenset({"scope"}), response_bytes=262144),
    Operation("GET", BASE + "/imports/" + UUID + "/command-state", response_bytes=65536),
    Operation(
        "POST", BASE + "/imports/" + UUID + "/commands", request_bytes=4096, response_bytes=4096
    ),
    Operation(
        "POST",
        BASE + "/collections/" + UUID + "/imports",
        request_bytes=3000000,
        response_bytes=32768,
    ),
    Operation("GET", BASE + "/collections", PAGE | {"q"}, response_bytes=262144),
    Operation("POST", BASE + "/collections", request_bytes=32768, response_bytes=65536),
    Operation(
        "GET", BASE + "/shared-cases", PAGE | {"scope"}, request_bytes=0, response_bytes=524288
    ),
    Operation(
        "GET", BASE + "/shared-cases/recipients", PAGE, request_bytes=0, response_bytes=524288
    ),
    Operation(
        "POST",
        BASE + "/shared-cases/prepare",
        frozenset(),
        request_bytes=32768,
        response_bytes=524288,
    ),
    Operation(
        "POST",
        BASE + "/shared-cases/share",
        frozenset(),
        request_bytes=32768,
        response_bytes=524288,
    ),
    Operation(
        "GET",
        BASE + "/shared-cases/" + UUID + "",
        frozenset(),
        request_bytes=0,
        response_bytes=524288,
    ),
    Operation(
        "POST",
        BASE + "/shared-cases/" + UUID + "/commands",
        frozenset(),
        request_bytes=32768,
        response_bytes=524288,
    ),
    Operation(
        "GET",
        BASE + "/shared-cases/" + UUID + "/events",
        PAGE,
        request_bytes=0,
        response_bytes=524288,
    ),
    Operation("GET", BASE + "/task-command-receipts", PAGE, response_bytes=1048576),
    Operation("GET", BASE + "/task-command-receipts/" + UUID, response_bytes=16384),
    Operation("GET", BASE + "/task-notifications", PAGE, response_bytes=1048576),
    Operation(
        "POST",
        BASE + "/task-notifications/" + UUID + "/read",
        request_bytes=4096,
        response_bytes=4096,
    ),
    Operation(
        "GET", BASE + "/tasks", PAGE | {"active_only", "assigned_to_me"}, response_bytes=1048576
    ),
    Operation("POST", BASE + "/tasks", request_bytes=32768, response_bytes=4096),
    Operation("GET", BASE + "/tasks/candidates", PAGE, response_bytes=65536),
    Operation("GET", BASE + "/tasks/" + UUID + "/proposals", response_bytes=65536),
    Operation(
        "POST", BASE + "/tasks/" + UUID + "/proposals", request_bytes=4096, response_bytes=4096
    ),
    Operation(
        "GET",
        BASE + "/tasks/" + UUID + "/proposals/" + UUID + "/expert-reviews",
        PAGE,
        response_bytes=1048576,
    ),
    Operation("GET", BASE + "/proposals/" + UUID + "/expert-reviews", PAGE, response_bytes=1048576),
    Operation(
        "POST",
        BASE + "/tasks/" + UUID + "/expert-reviews",
        request_bytes=32768,
        response_bytes=4096,
    ),
    Operation("GET", BASE + "/tasks/" + UUID, response_bytes=65536),
    Operation("GET", BASE + "/tasks/" + UUID + "/events", PAGE, response_bytes=1048576),
    Operation(
        "POST", BASE + "/tasks/" + UUID + "/commands", request_bytes=32768, response_bytes=4096
    ),
    Operation("GET", BASE + "/conversation-drafts/(?:new|" + UUID + ")", response_bytes=16384),
    Operation(
        "POST",
        BASE + "/conversation-drafts/(?:new|" + UUID + ")",
        request_bytes=16384,
        response_bytes=4096,
    ),
    Operation("GET", BASE + "/imports", PAGE, response_bytes=262144),
    Operation("GET", BASE + "/imports/" + UUID, response_bytes=32768),
    Operation("GET", BASE + "/collections/" + UUID, response_bytes=65536),
    Operation("GET", "/v1/me", response_bytes=65536),
    Operation("GET", BASE + "/version", response_bytes=65536),
    Operation("GET", BASE + "/graph/map"),
    Operation(
        "GET",
        BASE + "/graph/scene",
        STAMP
        | {
            "layout",
            "x",
            "y",
            "w",
            "h",
            "focus",
            "target",
            "search",
            "direction",
            "kind",
            "offset",
        },
        response_bytes=65536,
    ),
    Operation(
        "GET",
        BASE + "/graph/map/nodes",
        STAMP | {"layout", "search", "focus", "direction", "kind", "offset"},
        response_bytes=65536,
    ),
    Operation(
        "GET",
        BASE + "/graph/window",
        STAMP | {"limit", "after", "before", "focus", "locate", "direction", "search"},
    ),
    Operation(
        "GET",
        BASE + "/publications",
        frozenset({"limit", "before", "at_version", "since", "until"}),
        response_bytes=1_000_000,
    ),
    Operation("GET", BASE + "/commits", PAGE),
    Operation("GET", BASE + "/concepts"),
    Operation("GET", BASE + "/concepts/" + UUID),
    Operation("GET", BASE + "/sources", PAGE | {"q", "collection_id"}),
    Operation("GET", BASE + "/sources/" + UUID),
    Operation("GET", BASE + "/episodes/" + UUID),
    Operation("POST", BASE + "/episodes/" + UUID + "/feedback", request_bytes=16384),
    Operation("GET", BASE + "/shared-cases/" + UUID + "/tasks", response_bytes=32768),
    Operation(
        "POST", BASE + "/shared-cases/" + UUID + "/tasks", request_bytes=4096, response_bytes=4096
    ),
    Operation("GET", BASE + "/contribution-draft", response_bytes=2_000_000),
    Operation("POST", BASE + "/contribution-draft", request_bytes=2_000_000, response_bytes=4096),
    Operation("GET", BASE + "/proposals", PAGE | {"status", "source_id"}),
    Operation("POST", BASE + "/proposals", request_bytes=2_000_000),
    Operation("GET", BASE + "/proposals/" + UUID),
    Operation("GET", BASE + "/proposals/" + UUID + "/diff"),
    Operation("GET", BASE + "/proposals/" + UUID + "/diff/summary", response_bytes=1_000_000),
    Operation("GET", BASE + "/proposals/" + UUID + "/reviews", PAGE),
    Operation("GET", BASE + "/issues", PAGE | {"status", "episode_id"}),
    Operation("GET", BASE + "/issues/" + UUID),
    Operation("POST", BASE + "/issues/" + UUID + "/decisions", request_bytes=16384),
    Operation("GET", BASE + "/conversations", PAGE | {"archived"}),
    Operation("POST", BASE + "/conversations", request_bytes=16384),
    Operation("GET", BASE + "/conversations/" + UUID + "/messages", PAGE),
    Operation("POST", BASE + "/conversations/" + UUID + "/query", request_bytes=16384),
)


def operation(method: str, path: str) -> Operation:
    matches = [item for item in OPERATIONS if re.fullmatch(item.path, path)]
    for item in matches:
        if method == item.method:
            return item
    raise ProxyError(405 if matches else 404, "OPERATION_NOT_ALLOWED")


def query_string(raw: bytes, op: Operation) -> str:
    try:
        value = raw.decode("ascii")
        if len(raw) > 4096 or re.search(r"%(?![0-9a-fA-F]{2})", value):
            raise ValueError
        pairs = parse_qsl(value, max_num_fields=20, keep_blank_values=True, errors="strict")
        if len(dict(pairs)) != len(pairs) or any(
            key not in op.query or len(item) > 2000 or any(ord(c) < 32 for c in item)
            for key, item in pairs
        ):
            raise ValueError
        return urlencode(pairs)
    except (UnicodeError, ValueError):
        raise ProxyError(422, "INVALID_PROXY_QUERY") from None


def _no_constant(value):
    raise ValueError("non-JSON constant")


async def request_body(request: Request, op: Operation) -> bytes:
    lengths = request.headers.getlist("content-length")
    if len(lengths) > 1 or (lengths and not re.fullmatch(r"[0-9]{1,10}", lengths[0])):
        raise ProxyError(400, "INVALID_PROXY_BODY")
    if lengths and int(lengths[0]) > op.request_bytes:
        raise ProxyError(413, "REQUEST_TOO_LARGE")
    if request.headers.get("content-encoding", "identity") != "identity":
        raise ProxyError(415, "INVALID_PROXY_BODY")
    if op.method == "POST" and request.headers.getlist("content-type") != ["application/json"]:
        raise ProxyError(415, "INVALID_PROXY_BODY")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > op.request_bytes:
            raise ProxyError(413, "REQUEST_TOO_LARGE")
        body.extend(chunk)
    if lengths and len(body) != int(lengths[0]):
        raise ProxyError(400, "INVALID_PROXY_BODY")
    if op.method == "POST":
        try:
            value = json.loads(
                body.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_no_constant
            )
            if not isinstance(value, dict):
                raise ValueError
        except (ValueError, UnicodeError, RecursionError):
            raise ProxyError(422, "INVALID_PROXY_BODY") from None
    return bytes(body)


PUBLIC_ERRORS = {
    "AMBIGUOUS_EXCERPT": 422,
    "SCENE_CAPACITY_EXCEEDED": 422,
    "MAP_CAPACITY_EXCEEDED": 422,
    "ORIGIN_NOT_ALLOWED": 403,
    "CORRECTION_NOT_PUBLISHED": 409,
    "CORRECTION_NOT_ACTIVE": 409,
}


@dataclass(frozen=True)
class ApiResult:
    status: int
    body: bytes = field(repr=False)


class ApiProxy:
    def __init__(
        self,
        api_origin: str,
        *,
        allow_loopback_http: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        _endpoint(api_origin, allow_loopback_http)
        if urlsplit(api_origin).path not in {"", "/"}:
            raise LoginError("LOGIN_CONFIGURATION")
        self.origin = api_origin.rstrip("/")
        self._client = httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=25,
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
        )

    async def aclose(self):
        await self._client.aclose()

    async def call(
        self, grant: IdentityGrant, op: Operation, path: str, query: str, body: bytes
    ) -> ApiResult:
        try:
            async with asyncio.timeout(25):
                # Recheck the reviewed route even for internal callers. Never take a URL.
                if operation(op.method, path) != op:
                    raise ProxyError(404, "OPERATION_NOT_ALLOWED")
                url = self.origin + path + ("?" + query if query else "")
                headers = {
                    "Authorization": "Bearer " + grant.access_token,
                    "X-Tenant-Id": grant.tenant,
                    "Accept": "application/json",
                    "Accept-Encoding": "identity",
                }
                if op.method == "POST":
                    headers["Content-Type"] = "application/json"
                req = self._client.build_request(op.method, url, headers=headers, content=body)
                req.headers.pop("cookie", None)
                result = await self._client.send(req, stream=True)
                self._client.cookies.clear()
                try:
                    if result.status_code == 401:
                        return ApiResult(401, b'{"error":"SESSION_EXPIRED"}')
                    if not 200 <= result.status_code < 300 and result.status_code not in {
                        400,
                        403,
                        404,
                        409,
                        413,
                        422,
                        429,
                        500,
                        501,
                        502,
                        503,
                        504,
                    }:
                        raise ProxyError(502, "CORE_UNAVAILABLE")
                    if (
                        result.headers.get("content-type", "").split(";")[0] != "application/json"
                        or result.headers.get("content-encoding", "identity") != "identity"
                    ):
                        raise ProxyError(502, "CORE_UNAVAILABLE")
                    maximum = op.response_bytes if result.is_success else 8192
                    if int(result.headers.get("content-length", "0")) > maximum:
                        raise ProxyError(502, "RESPONSE_TOO_LARGE")
                    output = bytearray()
                    async for chunk in result.aiter_raw():
                        if len(output) + len(chunk) > maximum:
                            raise ProxyError(502, "RESPONSE_TOO_LARGE")
                        output.extend(chunk)
                    if not result.is_success:
                        code = "CORE_REQUEST_REJECTED"
                        try:
                            upstream = json.loads(output, object_pairs_hook=_unique_object)
                            candidate = (
                                upstream.get("error") if isinstance(upstream, dict) else None
                            )
                            if (
                                isinstance(candidate, str)
                                and PUBLIC_ERRORS.get(candidate) == result.status_code
                            ):
                                code = candidate
                        except (ValueError, UnicodeError, RecursionError):
                            pass
                        output = json.dumps({"error": code}).encode()
                    return ApiResult(result.status_code, bytes(output))
                finally:
                    await result.aclose()
        except (httpx.HTTPError, ValueError, UnicodeError, TimeoutError):
            # A sent mutation may have committed. Never retry or expose upstream details.
            raise ProxyError(502, "CORE_UNAVAILABLE") from None


async def until_disconnect(request: Request, call):
    """The body is consumed first. A disconnect cancels work, never replays it."""

    async def disconnected():
        while (await request.receive())["type"] != "http.disconnect":
            pass
        raise ClientDisconnect()

    task, disconnect = asyncio.create_task(call), asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({task, disconnect}, return_when=asyncio.FIRST_COMPLETED)
        if disconnect in done:
            await disconnect
        return await task
    finally:
        for pending in (task, disconnect):
            if not pending.done():
                pending.cancel()
        await asyncio.gather(task, disconnect, return_exceptions=True)
