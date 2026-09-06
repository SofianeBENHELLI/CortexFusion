from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from .auth import Authenticator, CoreError
from .contracts import (
    AccessInput,
    ApprovalInput,
    FeedbackInput,
    ProposalInput,
    QueryInput,
    QueryResult,
    RollbackInput,
    SourceInput,
)
from .conversations import ConversationService
from .conversations_api import conversations_router
from .corpus import CorpusService
from .corpus_api import corpus_router
from .db import Database
from .files import FileService
from .files_api import files_router
from .governance import GovernanceService
from .governance_api import governance_router
from .service import KnowledgeService
from .settings import Settings
from .workspace import WorkspaceService
from .workspace_api import workspace_router


class BoundaryMiddleware:
    """Bound buffered request bodies and protect the MCP transport on every HTTP request."""

    def __init__(self, app, auth, limit):
        self.app, self.auth, self.limit = app, auth, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        if scope["path"].startswith("/mcp"):
            try:
                self.auth.authenticate(headers.get("authorization"), headers.get("x-tenant-id"))
            except CoreError as exc:
                return await JSONResponse(
                    {"error": exc.code, "message": exc.message}, status_code=exc.status
                )(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.limit:
                return await JSONResponse({"error": "REQUEST_TOO_LARGE"}, status_code=413)(
                    scope, receive, send
                )
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        delivered = False

        async def buffered_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, buffered_receive, send)


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    db = Database(settings.database_url)
    auth = Authenticator(settings)
    service = KnowledgeService(db)
    from .mcp_adapter import create_mcp

    mcp = create_mcp(service, auth)
    mcp_app = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(app):
        db.verify_role()
        async with mcp.session_manager.run():
            yield
        db.dispose()

    app = FastAPI(
        title="Cortex Fusion Knowledge Core",
        version="0.1.0",
        lifespan=lifespan,
        description="Local extractive prototype. No model calls. Owner approval is required before publication.",
    )
    app.state.service = service
    app.state.db = db
    app.add_middleware(BoundaryMiddleware, auth=auth, limit=settings.max_request_bytes)

    @app.exception_handler(CoreError)
    async def core_error(request, exc):
        return JSONResponse(
            {"error": exc.code, "message": exc.message},
            status_code=exc.status,
            headers={"WWW-Authenticate": "Bearer"} if exc.status == 401 else {},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            {
                "error": "VALIDATION_FAILED",
                "details": [
                    {"location": list(e["loc"]), "type": e["type"], "message": e["msg"]}
                    for e in exc.errors()
                ],
            },
            status_code=422,
        )

    @app.exception_handler(DBAPIError)
    async def database_error(request, exc):
        state = getattr(exc.orig, "sqlstate", None)
        if state is None and exc.orig.args and isinstance(exc.orig.args[0], dict):
            state = exc.orig.args[0].get("C")
        if state in ("40001", "40P01", "23505"):
            return JSONResponse(
                {
                    "error": "CONCURRENT_CHANGE",
                    "message": "Refresh and retry the same idempotent command",
                },
                status_code=409,
            )
        return JSONResponse(
            {"error": "STORAGE_ERROR", "message": "The operation did not complete"}, status_code=503
        )

    def principal(
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
    ):
        return auth.authenticate(authorization, x_tenant_id)

    app.include_router(conversations_router(ConversationService(service), principal))
    app.include_router(governance_router(GovernanceService(service), principal))
    corpus = CorpusService(service)
    app.include_router(corpus_router(corpus, principal))
    app.include_router(files_router(FileService(corpus), principal))
    app.include_router(workspace_router(WorkspaceService(service), principal))

    @app.get("/health")
    def health():
        return {"status": "ok", "version": "0.1.0", "mode": "extractive"}

    @app.get("/v1/domains/{domain}/version")
    def version(domain: UUID, p=Depends(principal)):
        return service.version(p, str(domain))

    @app.post("/v1/domains/{domain}/sources", status_code=201)
    def source_create(domain: UUID, data: SourceInput, p=Depends(principal)):
        return service.create_source(p, str(domain), data)

    @app.get("/v1/domains/{domain}/sources/{source_id}")
    def source_read(domain: UUID, source_id: UUID, p=Depends(principal)):
        return service.source(p, str(domain), str(source_id))

    @app.put("/v1/domains/{domain}/sources/{source_id}/access")
    def source_access(domain: UUID, source_id: UUID, data: AccessInput, p=Depends(principal)):
        return service.set_access(p, str(domain), str(source_id), data)

    @app.post("/v1/domains/{domain}/sources/{source_id}/propose")
    def source_propose(
        domain: UUID,
        source_id: UUID,
        idempotency_key: str = Header(min_length=8, max_length=128),
        p=Depends(principal),
    ):
        return service.ingest_source(p, str(domain), str(source_id), idempotency_key)

    @app.post("/v1/domains/{domain}/proposals", status_code=201)
    def propose(domain: UUID, data: ProposalInput, p=Depends(principal)):
        return service.propose(p, str(domain), data)

    @app.get("/v1/domains/{domain}/proposals/{proposal_id}")
    def proposal(domain: UUID, proposal_id: UUID, p=Depends(principal)):
        return service.proposal(p, str(domain), str(proposal_id))

    @app.post("/v1/domains/{domain}/proposals/{proposal_id}/approve")
    def approve(domain: UUID, proposal_id: UUID, data: ApprovalInput, p=Depends(principal)):
        return service.approve(p, str(domain), str(proposal_id), data)

    @app.post("/v1/domains/{domain}/publish")
    def publish(domain: UUID, p=Depends(principal)):
        return service.publish(p, str(domain))

    @app.post("/v1/domains/{domain}/replay")
    def replay(domain: UUID, p=Depends(principal)):
        return service.replay(p, str(domain))

    @app.post("/v1/domains/{domain}/commits/{sequence}/compensate")
    def compensate(domain: UUID, sequence: int, data: RollbackInput, p=Depends(principal)):
        if sequence < 1:
            raise CoreError("NOT_FOUND", "Published change not found", 404)
        return service.rollback_proposal(p, str(domain), sequence, data)

    @app.get("/v1/domains/{domain}/concepts")
    def concepts(domain: UUID, p=Depends(principal)):
        return service.concepts(p, str(domain))

    @app.get("/v1/domains/{domain}/concepts/{concept_id}")
    def concept(domain: UUID, concept_id: UUID, p=Depends(principal)):
        return service.concept(p, str(domain), str(concept_id))

    @app.post("/v1/domains/{domain}/query", response_model=QueryResult)
    def query(domain: UUID, data: QueryInput, p=Depends(principal)):
        return service.query(p, str(domain), data)

    @app.get("/v1/domains/{domain}/episodes/{episode_id}")
    def episode(domain: UUID, episode_id: UUID, p=Depends(principal)):
        return service.episode(p, str(domain), str(episode_id))

    @app.post("/v1/domains/{domain}/episodes/{episode_id}/feedback")
    def feedback(domain: UUID, episode_id: UUID, data: FeedbackInput, p=Depends(principal)):
        return service.feedback(p, str(domain), str(episode_id), data)

    @app.get("/v1/domains/{domain}/brief")
    def brief(domain: UUID, p=Depends(principal)):
        return service.brief(p, str(domain))

    app.mount("/mcp", mcp_app)
    return app
