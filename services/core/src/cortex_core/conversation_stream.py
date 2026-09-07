"""SSE delivery of an idempotent extractive query; no token simulation or provider calls."""

import math

from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from .auth import CoreError
from .contracts import QueryStreamError, QueryStreamResult, QueryStreamStarted

SSE_CONTENT = {
    "schema": {"type": "string"},
    "x-cortex-events": {
        "started": {"$ref": "#/components/schemas/QueryStreamStarted"},
        "result": {"$ref": "#/components/schemas/QueryStreamResult"},
        "error": {"$ref": "#/components/schemas/QueryStreamError"},
    },
}


def wants_stream(accept):
    priorities = {}
    for part in accept.lower().split(","):
        media, *parameters = part.strip().split(";")
        quality = 1.0
        for parameter in parameters:
            name, _, value = parameter.strip().partition("=")
            if name == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        if not math.isfinite(quality) or not 0 <= quality <= 1:
            quality = 0.0
        priorities[media] = max(priorities.get(media, 0), quality)
    # Explicit SSE preference only. Ties and generic Accept keep the JSON contract.
    return priorities.get("text/event-stream", 0) > priorities.get(
        "application/json", priorities.get("*/*", 0)
    )


def encode_event(event):
    # JSON escapes embedded newlines; private text cannot inject an SSE event boundary.
    return f"event: {event.event}\ndata: {event.model_dump_json()}\n\n".encode()


async def stream_query(service, principal, request, p, domain, ident, data):
    if request.headers.get("last-event-id"):
        raise CoreError("STREAM_CURSOR_UNSUPPORTED", "Retry the same POST and idempotency key", 422)

    def prepare():
        with service.db.transaction(p, domain) as conn:
            service.k._conversation(conn, p, domain, ident, active=True)
            service.k._conversation_retry(conn, p, domain, ident, data)

    # Auth, ownership, archived conversations and existing-key conflicts fail as ordinary HTTP errors.
    await run_in_threadpool(prepare)

    async def events():
        yield encode_event(QueryStreamStarted(idempotency_key=data.idempotency_key))
        try:
            result = await run_in_threadpool(
                service.k.query, p, domain, data, conversation_id=ident
            )
            # The query can have committed before a disconnect. Revalidate the token and
            # current source access before delivery; do not claim cancellation rolled it back.
            current = await run_in_threadpool(
                principal, request.headers.get("authorization"), request.headers.get("x-tenant-id")
            )
            result = await run_in_threadpool(
                service.k.episode, current, domain, result["episode_id"]
            )
            event = QueryStreamResult(result=result)
        except CoreError as exc:
            event = QueryStreamError(error=exc.code, http_status=exc.status)
        except Exception:
            event = QueryStreamError(error="QUERY_STREAM_FAILED", http_status=503)
        yield encode_event(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
