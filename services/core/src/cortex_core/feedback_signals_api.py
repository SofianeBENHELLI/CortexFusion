from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import (
    FeedbackPreferences,
    FeedbackPreferencesInput,
    FeedbackSignalInput,
    FeedbackSignalPage,
    FeedbackSignalView,
)


def feedback_signals_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["feedback-signals"])

    @router.get("/feedback-preferences", response_model=FeedbackPreferences)
    def preferences(domain: UUID, p=Depends(principal)):
        return service.preferences(p, str(domain))

    @router.put("/feedback-preferences", response_model=FeedbackPreferences)
    def preferences_update(domain: UUID, data: FeedbackPreferencesInput, p=Depends(principal)):
        return service.set_preferences(p, str(domain), data)

    @router.post(
        "/episodes/{episode_id}/signals", response_model=FeedbackSignalView, status_code=201
    )
    def record(domain: UUID, episode_id: UUID, data: FeedbackSignalInput, p=Depends(principal)):
        return service.record(p, str(domain), str(episode_id), data)

    @router.get("/feedback-signals", response_model=FeedbackSignalPage)
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
