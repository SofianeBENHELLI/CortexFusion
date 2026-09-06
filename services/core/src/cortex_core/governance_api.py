from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import CommitPage, MemberPage, MembershipInput, MembershipReceipt


def governance_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["governance"])

    @router.get("/members", response_model=MemberPage)
    def members(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: str = Query("", max_length=300),
        p=Depends(principal),
    ):
        return service.members(p, str(domain), limit, after)

    @router.post("/members", response_model=MembershipReceipt, status_code=201)
    def membership(domain: UUID, data: MembershipInput, p=Depends(principal)):
        return service.membership(p, str(domain), data)

    @router.get("/membership-events")
    def events(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.events(p, str(domain), limit, str(after) if after else None)

    @router.get("/commits", response_model=CommitPage)
    def commits(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: int = Query(0, ge=0),
        p=Depends(principal),
    ):
        return service.commits(p, str(domain), limit, after)

    @router.get("/proposals/{ident}/diff")
    def diff(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.diff(p, str(domain), str(ident))

    return router
