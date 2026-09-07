"""Opt-in exact browser origins; authentication remains mandatory on business calls."""

from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

CORS_HEADERS = [
    "Authorization",
    "X-Tenant-ID",
    "Content-Type",
    "Accept",
    "Idempotency-Key",
    "X-Cortex-Confirmation",
    "MCP-Protocol-Version",
    "Mcp-Session-Id",
    "Last-Event-ID",
]
EXPOSE_HEADERS = [
    "Content-Disposition",
    "X-Content-Type-Options",
    "WWW-Authenticate",
    "Retry-After",
    "Mcp-Session-Id",
    "MCP-Protocol-Version",
]


class BrowserOriginMiddleware:
    def __init__(self, app, origins):
        self.app = app
        self.origins = frozenset(origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            origins = [
                v.decode("latin-1") for k, v in scope.get("headers", []) if k.lower() == b"origin"
            ]
            if origins and (len(origins) != 1 or origins[0] not in self.origins):
                return await JSONResponse(
                    {"error": "ORIGIN_NOT_ALLOWED", "message": "Browser origin is not allowed"},
                    status_code=403,
                    headers={"Vary": "Origin"},
                )(scope, receive, send)
        await self.app(scope, receive, send)


def install_browser_transport(app, settings):
    if not settings.cors_origins:
        return
    # Added after the body/auth boundary: valid preflights do not need bearer tokens.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=CORS_HEADERS,
        expose_headers=EXPOSE_HEADERS,
        allow_credentials=False,
        max_age=600,
    )
    app.add_middleware(BrowserOriginMiddleware, origins=settings.cors_origins)
