from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import (
    EpisodePage,
    IdentityView,
    ProposalInput,
    ProposalPage,
    ProposalView,
    ReviewInput,
    ReviewPage,
    ReviewReceipt,
)


def workspace_router(service, principal):
    router = APIRouter(tags=["workspace"])

    @router.get("/v1/me", response_model=IdentityView)
    def me(p=Depends(principal)):
        return service.identity(p)

    @router.get("/v1/domains/{domain}/proposals", response_model=ProposalPage)
    def proposals(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        status: Literal[
            "ready",
            "approved",
            "published",
            "rejected",
            "deferred",
            "changes_requested",
            "superseded",
        ]
        | None = None,
        p=Depends(principal),
    ):
        return service.proposals(p, str(domain), limit, str(after) if after else None, status)

    @router.get("/v1/domains/{domain}/episodes", response_model=EpisodePage)
    def episodes(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.episodes(p, str(domain), limit, str(after) if after else None)

    @router.post(
        "/v1/domains/{domain}/proposals/{ident}/reviews",
        status_code=201,
        response_model=ReviewReceipt,
    )
    def review(domain: UUID, ident: UUID, data: ReviewInput, p=Depends(principal)):
        return service.review(p, str(domain), str(ident), data)

    @router.get("/v1/domains/{domain}/proposals/{ident}/reviews", response_model=ReviewPage)
    def reviews(
        domain: UUID,
        ident: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.reviews(p, str(domain), str(ident), limit, str(after) if after else None)

    @router.post(
        "/v1/domains/{domain}/proposals/{ident}/revise",
        status_code=201,
        response_model=ProposalView,
    )
    def revise(domain: UUID, ident: UUID, data: ProposalInput, p=Depends(principal)):
        return service.revise(p, str(domain), str(ident), data)

    return router
