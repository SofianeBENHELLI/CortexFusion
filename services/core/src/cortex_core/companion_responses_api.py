from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import CompanionResponseInput, CompanionResponsePage, CompanionResponseView


def companion_responses_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["companion-responses"])

    @router.post(
        "/episodes/{episode_id}/companion-responses",
        response_model=CompanionResponseView,
        status_code=201,
    )
    def create(domain: UUID, episode_id: UUID, data: CompanionResponseInput, p=Depends(principal)):
        return service.create(p, str(domain), str(episode_id), data)

    @router.get("/companion-responses/{response_id}", response_model=CompanionResponseView)
    def detail(domain: UUID, response_id: UUID, p=Depends(principal)):
        return service.detail(p, str(domain), str(response_id))

    @router.get("/companion-responses", response_model=CompanionResponsePage)
    def listing(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        episode_id: UUID | None = None,
        p=Depends(principal),
    ):
        return service.listing(
            p,
            str(domain),
            limit,
            str(after) if after else None,
            str(episode_id) if episode_id else None,
        )

    return router
