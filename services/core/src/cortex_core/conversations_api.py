from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from starlette.concurrency import run_in_threadpool

from .contracts import (
    ConversationInput,
    ConversationMessages,
    ConversationPage,
    ConversationQueryInput,
    ConversationUpdate,
    ConversationView,
    QueryResult,
)
from .conversation_stream import SSE_CONTENT, stream_query, wants_stream


def conversations_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}/conversations", tags=["conversations"])

    @router.post("", response_model=ConversationView, status_code=201)
    def create(domain: UUID, data: ConversationInput, p=Depends(principal)):
        return service.create(p, str(domain), data)

    @router.get("", response_model=ConversationPage)
    def listing(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        archived: bool = False,
        p=Depends(principal),
    ):
        return service.listing(p, str(domain), limit, str(after) if after else None, archived)

    @router.get("/{ident}", response_model=ConversationView)
    def detail(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.detail(p, str(domain), str(ident))

    @router.put("/{ident}", response_model=ConversationView)
    def update(domain: UUID, ident: UUID, data: ConversationUpdate, p=Depends(principal)):
        return service.update(p, str(domain), str(ident), data)

    @router.get("/{ident}/messages", response_model=ConversationMessages)
    def messages(
        domain: UUID,
        ident: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: int = Query(0, ge=0),
        p=Depends(principal),
    ):
        return service.messages(p, str(domain), str(ident), limit, after)

    @router.post(
        "/{ident}/query",
        response_model=QueryResult,
        responses={200: {"content": {"text/event-stream": SSE_CONTENT}}},
    )
    async def query(
        domain: UUID,
        ident: UUID,
        data: ConversationQueryInput,
        request: Request,
        p=Depends(principal),
    ):
        if wants_stream(request.headers.get("accept", "")):
            return await stream_query(service, principal, request, p, str(domain), str(ident), data)
        return await run_in_threadpool(
            service.k.query, p, str(domain), data, conversation_id=str(ident)
        )

    return router
