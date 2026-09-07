from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from .contracts import SynthesisInput, SynthesisPage, SynthesisView


def synthesis_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["synthesis"])

    @router.post("/episodes/{episode_id}/syntheses", response_model=SynthesisView)
    def execute(
        domain: UUID, episode_id: UUID, data: SynthesisInput, request: Request, p=Depends(principal)
    ):
        return service.execute(
            p,
            str(domain),
            str(episode_id),
            data,
            lambda: principal(
                request.headers.get("authorization"), request.headers.get("x-tenant-id")
            ),
        )

    @router.get("/syntheses/{ident}", response_model=SynthesisView)
    def detail(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.detail(p, str(domain), str(ident))

    @router.get("/syntheses", response_model=SynthesisPage)
    def listing(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        episode_id: UUID | None = None,
        idempotency_key: str | None = Query(None, min_length=8, max_length=128),
        p=Depends(principal),
    ):
        return service.listing(
            p,
            str(domain),
            limit,
            str(after) if after else None,
            str(episode_id) if episode_id else None,
            idempotency_key,
        )

    return router
