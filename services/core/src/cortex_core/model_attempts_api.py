from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import ModelAttemptPage, ModelAttemptView, ModelUsageView


def model_attempts_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["model-attempts"])

    @router.get("/model-attempts", response_model=ModelAttemptPage)
    def listing(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.listing(p, str(domain), limit, str(after) if after else None)

    @router.get("/model-attempts/{attempt_id}", response_model=ModelAttemptView)
    def detail(domain: UUID, attempt_id: UUID, p=Depends(principal)):
        return service.detail(p, str(domain), str(attempt_id))

    @router.get("/model-usage", response_model=ModelUsageView)
    def usage(domain: UUID, p=Depends(principal)):
        return service.usage(p, str(domain))

    return router
