"""Browser-facing corpus operations; no owner decision credentials are needed."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .contracts import (
    CollectionInput,
    CollectionPage,
    CollectionView,
    ImportPage,
    ImportView,
    SourceChunkPage,
    SourcePage,
    TextImportInput,
)


def corpus_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["corpus"])

    @router.get("/sources/{source_id}/chunks", response_model=SourceChunkPage)
    def chunks(
        domain: UUID,
        source_id: UUID,
        offset: int = Query(0, ge=0),
        limit: int = Query(10, ge=1, le=50),
        p=Depends(principal),
    ):
        return service.chunks(p, str(domain), str(source_id), offset, limit)

    @router.post("/collections", response_model=CollectionView, status_code=201)
    def create_collection(domain: UUID, data: CollectionInput, p=Depends(principal)):
        return service.create_collection(p, str(domain), data)

    @router.get("/collections", response_model=CollectionPage)
    def collections(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        q: str = Query("", max_length=200),
        p=Depends(principal),
    ):
        return service.collections(p, str(domain), limit, str(after) if after else None, q)

    @router.get("/collections/{collection_id}", response_model=CollectionView)
    def collection(domain: UUID, collection_id: UUID, p=Depends(principal)):
        return service.collection(p, str(domain), str(collection_id))

    @router.get("/sources", response_model=SourcePage)
    def sources(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        q: str = Query("", max_length=200),
        collection_id: UUID | None = None,
        p=Depends(principal),
    ):
        return service.sources(
            p,
            str(domain),
            limit,
            str(after) if after else None,
            q,
            str(collection_id) if collection_id else None,
        )

    @router.post("/collections/{collection_id}/imports", response_model=ImportView, status_code=202)
    def create_import(
        domain: UUID, collection_id: UUID, data: TextImportInput, p=Depends(principal)
    ):
        return service.create_import(p, str(domain), str(collection_id), data)

    @router.get("/imports", response_model=ImportPage)
    def imports(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        p=Depends(principal),
    ):
        return service.imports(p, str(domain), limit, str(after) if after else None)

    @router.get("/imports/{import_id}", response_model=ImportView)
    def import_job(domain: UUID, import_id: UUID, p=Depends(principal)):
        return service.import_job(p, str(domain), str(import_id))

    @router.post("/imports/{import_id}/process", response_model=ImportView)
    def process(
        domain: UUID, import_id: UUID, limit: int = Query(1, ge=1, le=20), p=Depends(principal)
    ):
        return service.process(p, str(domain), str(import_id), limit)

    @router.post("/imports/{import_id}/cancel", response_model=ImportView)
    def cancel(domain: UUID, import_id: UUID, p=Depends(principal)):
        return service.cancel(p, str(domain), str(import_id))

    @router.post("/imports/{import_id}/retry", response_model=ImportView)
    def retry(domain: UUID, import_id: UUID, p=Depends(principal)):
        return service.retry(p, str(domain), str(import_id))

    return router
