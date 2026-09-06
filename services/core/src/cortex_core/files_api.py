from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from .contracts import FilePage, FileUploadInput, FileView


def files_router(service, principal):
    router = APIRouter(prefix="/v1/domains/{domain}", tags=["files"])

    @router.post("/collections/{collection}/files", response_model=FileView, status_code=202)
    def upload(domain: UUID, collection: UUID, data: FileUploadInput, p=Depends(principal)):
        return service.upload(p, str(domain), str(collection), data)

    @router.get("/files", response_model=FilePage)
    def listing(
        domain: UUID,
        limit: int = Query(20, ge=1, le=100),
        after: UUID | None = None,
        pending: bool = False,
        p=Depends(principal),
    ):
        return service.listing(p, str(domain), limit, str(after) if after else None, pending)

    @router.get("/files/{ident}", response_model=FileView)
    def detail(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.detail(p, str(domain), str(ident))

    @router.get("/files/{ident}/download")
    def download(domain: UUID, ident: UUID, p=Depends(principal)):
        return Response(
            service.download(p, str(domain), str(ident)),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": 'attachment; filename="source.bin"',
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store",
            },
        )

    @router.post("/files/{ident}/process", response_model=FileView)
    def process(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.process(p, str(domain), str(ident))

    @router.post("/files/{ident}/retry", response_model=FileView)
    def retry(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.control(p, str(domain), str(ident), "retry")

    @router.post("/files/{ident}/cancel", response_model=FileView)
    def cancel(domain: UUID, ident: UUID, p=Depends(principal)):
        return service.control(p, str(domain), str(ident), "cancel")

    return router
