from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import (
    IssueDecisionInput,
    IssueEvent,
    IssueEventPage,
    IssuePage,
    IssueStatus,
    IssueView,
)


def issues_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}/issues", tags=["issues"])

    @router.get("", response_model=IssuePage)
    def issues(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        status: IssueStatus | None = None,
        p=Depends(principal),
    ):
        return service.list(p, str(domain), limit, str(after) if after else None, status)

    @router.get("/{ident}", response_model=IssueView)
    def issue(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.get(p, str(domain), str(ident))

    @router.get("/{ident}/events", response_model=IssueEventPage)
    def events(
        domain: UUID,
        ident: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.events(p, str(domain), str(ident), limit, str(after) if after else None)

    @router.post("/{ident}/decisions", response_model=IssueEvent, status_code=201)
    def decide(domain: UUID, ident: UUID, data: IssueDecisionInput, p=Depends(principal)):
        return service.decide(p, str(domain), str(ident), data)

    return router
