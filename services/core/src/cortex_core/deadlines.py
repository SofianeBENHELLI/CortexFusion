"""Per-operation HTTP deadlines, matching the native core's."""

import re

import anyio
from starlette.responses import JSONResponse

DEFAULT_SECONDS = 20
MODEL_SECONDS = 60
PUBLICATION_SECONDS = 120
MODEL_ROUTES = (
    "/v1/domains/{domain}/episodes/{episode_id}/syntheses",
    "/v1/domains/{domain}/sources/{source_id}/extract",
    "/v1/domains/{domain}/sources/{source_id}/extract-local",
)
PUBLICATION_ROUTES = (
    "/v1/domains/{domain}/proposals/{proposal_id}/publish",
    "/v1/domains/{domain}/publish",
    "/v1/domains/{domain}/replay",
    "/v1/domains/{domain}/commits/{sequence}/compensate",
)


def _matcher(templates):
    return re.compile("|".join("^" + re.sub(r"\{\w+\}", "[^/]+", t) + "$" for t in templates))


_MODEL, _PUBLICATION = _matcher(MODEL_ROUTES), _matcher(PUBLICATION_ROUTES)


def deadline(path):
    if _MODEL.match(path):
        return MODEL_SECONDS
    if _PUBLICATION.match(path):
        return PUBLICATION_SECONDS
    return DEFAULT_SECONDS


class DeadlineMiddleware:
    """Answer 503 REQUEST_TIMEOUT once an operation outlives its deadline, body read included.

    Synchronous handlers run in worker threads that cannot be interrupted: their work,
    already bounded by statement, parser and model timeouts, finishes and its response
    is discarded. A command's outcome is then settled by its receipt or a same-key retry.
    A response that has started, such as an event stream, is left to finish, and the MCP
    transport is never limited; bridged MCP tool calls come back through here.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"].startswith("/mcp"):
            return await self.app(scope, receive, send)
        started = expired = False
        failure = None

        async def forward(message):
            nonlocal started
            if expired:
                return
            started = started or message["type"] == "http.response.start"
            await send(message)

        async with anyio.create_task_group() as group:

            async def expire():
                nonlocal expired, failure
                await anyio.sleep(deadline(scope["path"]))
                if not started:
                    expired = True
                    try:
                        await JSONResponse(
                            {
                                "error": "REQUEST_TIMEOUT",
                                "message": "The request exceeded its deadline; read a command's "
                                "receipt or retry it with the same idempotency key",
                            },
                            status_code=503,
                        )(scope, receive, send)
                    except Exception as exc:
                        failure = exc
                    group.cancel_scope.cancel()

            group.start_soon(expire)
            try:
                await self.app(scope, receive, forward)
            except Exception as exc:
                # Raised again below, unwrapped: the task group would put it in a group.
                failure = failure or exc
            group.cancel_scope.cancel()
        if failure is not None:
            raise failure
