"""Collection browsing and durable, caller-driven text import steps.

No files are fetched from paths/URLs and no model runs here. Each bounded process
request commits source registration and its receipt atomically; an interrupted
transaction leaves the pending work available to a later caller.
"""

from uuid import uuid4

from .auth import CoreError
from .chunks import source_chunks
from .contracts import SourceInput
from .service import digest, encoded, one, run


class CorpusService:
    def chunks(self, p, domain, source_id, offset, limit):
        with self.db.transaction(p, domain) as conn:
            source = self.knowledge._source(conn, p, domain, source_id)
            chunks = list(source_chunks(source["content"]))
            if offset not in {c["start"] for c in chunks} | {len(source["content"])}:
                raise CoreError("INVALID_CURSOR", "Offset must be a chunk boundary", 422)
            remaining = [c for c in chunks if c["start"] >= offset]
            page = remaining[:limit]
            return {
                "source_id": source_id,
                "algorithm": "unicode-2000-6000-v1",
                "items": page,
                "next_offset": page[-1]["end"] if len(remaining) > limit else None,
            }

    def __init__(self, knowledge):
        self.knowledge = knowledge
        self.db = knowledge.db
        self.keys = knowledge.keys

    def _collection(self, conn, p, domain, ident):
        row = one(
            conn,
            """SELECT * FROM cf_collections WHERE tenant_id=:tenant
            AND domain_id=:domain AND id=:id AND allowed_subjects @> CAST(:acl AS jsonb)""",
            **self.keys(p, domain),
            id=ident,
            acl=encoded([p.subject]),
        )
        if not row:
            raise CoreError("NOT_FOUND", "Collection not found", 404)
        return row

    @staticmethod
    def _collection_view(row):
        return {k: row[k] for k in ("id", "name", "description", "allowed_subjects")}

    @staticmethod
    def _page(rows, limit, view):
        return {
            "items": [view(r) for r in rows[:limit]],
            "next_after": rows[limit - 1]["id"] if len(rows) > limit else None,
        }

    def create_collection(self, p, domain, data):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.knowledge._domain(conn, p, domain, lock=True)
            fingerprint = digest(data.model_dump(mode="json"))
            existing = one(
                conn,
                """SELECT * FROM cf_collections WHERE tenant_id=:tenant
                AND domain_id=:domain AND author=:author AND idempotency_key=:key""",
                **self.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                self._collection(conn, p, domain, existing["id"])
                if existing["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Collection key reused")
                return self._collection_view(existing)
            self.knowledge._validate_subjects(conn, p, domain, data.allowed_subjects)
            if p.subject not in data.allowed_subjects:
                raise CoreError("VALIDATION_FAILED", "Creator must retain collection access", 422)
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_collections
                (tenant_id,domain_id,id,name,description,allowed_subjects,author,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:name,:description,CAST(:acl AS jsonb),:author,:key,:hash)""",
                **self.keys(p, domain),
                id=ident,
                name=data.name,
                description=data.description,
                acl=encoded(sorted(set(data.allowed_subjects))),
                author=p.subject,
                key=data.idempotency_key,
                hash=fingerprint,
            )
            return self._collection_view(self._collection(conn, p, domain, ident))

    def collection(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._collection_view(self._collection(conn, p, domain, ident))

    def collections(self, p, domain, limit, after, q):
        with self.db.transaction(p, domain) as conn:
            rows = (
                run(
                    conn,
                    """SELECT * FROM cf_collections WHERE tenant_id=:tenant
                AND domain_id=:domain AND allowed_subjects @> CAST(:acl AS jsonb)
                AND id>:after AND strpos(lower(name),lower(:q))>0 ORDER BY id LIMIT :limit""",
                    **self.keys(p, domain),
                    acl=encoded([p.subject]),
                    after=after or "",
                    q=q,
                    limit=limit + 1,
                )
                .mappings()
                .all()
            )
            return self._page(rows, limit, self._collection_view)

    def sources(self, p, domain, limit, after, q, collection_id):
        with self.db.transaction(p, domain) as conn:
            if collection_id:
                self._collection(conn, p, domain, collection_id)
            rows = (
                run(
                    conn,
                    """SELECT s.* FROM cf_sources s WHERE s.tenant_id=:tenant
                AND s.domain_id=:domain AND s.allowed_subjects @> CAST(:acl AS jsonb)
                AND s.id>:after AND strpos(lower(s.title),lower(:q))>0
                AND (:collection='' OR EXISTS (SELECT 1 FROM cf_collection_sources cs
                    WHERE cs.tenant_id=s.tenant_id AND cs.domain_id=s.domain_id
                    AND cs.source_id=s.id AND cs.collection_id=:collection))
                ORDER BY s.id LIMIT :limit""",
                    **self.keys(p, domain),
                    acl=encoded([p.subject]),
                    after=after or "",
                    q=q,
                    collection=collection_id or "",
                    limit=limit + 1,
                )
                .mappings()
                .all()
            )
            return self._page(rows, limit, self.knowledge._source_view)

    # Job receipts are private to their submitter, further intersected with the
    # collection, original item ACLs and every registered source's current ACL.
    ACCESS = """j.author=:author AND c.allowed_subjects @> CAST(:acl AS jsonb)
        AND NOT EXISTS (SELECT 1 FROM cf_import_items i
          LEFT JOIN cf_sources s ON s.tenant_id=i.tenant_id AND s.domain_id=i.domain_id AND s.id=i.source_id
          WHERE i.tenant_id=j.tenant_id AND i.domain_id=j.domain_id AND i.import_id=j.id
          AND (NOT (i.payload->'allowed_subjects' @> CAST(:acl AS jsonb))
            OR (i.source_id IS NOT NULL AND (s.id IS NULL OR NOT (s.allowed_subjects @> CAST(:acl AS jsonb))))))"""

    def _job(self, conn, p, domain, ident):
        row = one(
            conn,
            f"""SELECT j.* FROM cf_imports j JOIN cf_collections c
            ON c.tenant_id=j.tenant_id AND c.domain_id=j.domain_id AND c.id=j.collection_id
            WHERE j.tenant_id=:tenant AND j.domain_id=:domain AND j.id=:id AND {self.ACCESS}""",
            **self.keys(p, domain),
            id=ident,
            author=p.subject,
            acl=encoded([p.subject]),
        )
        if not row:
            raise CoreError("NOT_FOUND", "Import not found", 404)
        return row

    def _job_view(self, conn, p, domain, row):
        items = (
            run(
                conn,
                """SELECT position,payload,status,source_id,error_code,attempts
            FROM cf_import_items WHERE tenant_id=:tenant AND domain_id=:domain
            AND import_id=:id ORDER BY position""",
                **self.keys(p, domain),
                id=row["id"],
            )
            .mappings()
            .all()
        )
        states = {i["status"] for i in items}
        if row["cancelled"]:
            status = "cancelled"
        elif states == {"succeeded"}:
            status = "succeeded"
        elif states == {"failed"}:
            status = "failed"
        elif states == {"pending"}:
            status = "pending"
        else:
            status = "partial"
        return {
            "id": row["id"],
            "collection_id": row["collection_id"],
            "status": status,
            "processing": "local_text_only",
            "items": [
                {
                    **{
                        k: i[k]
                        for k in ("position", "status", "source_id", "error_code", "attempts")
                    },
                    "filename": i["payload"]["filename"],
                }
                for i in items
            ],
        }

    def create_import(self, p, domain, collection_id, data):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.knowledge._domain(conn, p, domain, lock=True)
            collection = self._collection(conn, p, domain, collection_id)
            fingerprint = digest({"collection": collection_id, **data.model_dump(mode="json")})
            existing = one(
                conn,
                """SELECT id,request_hash FROM cf_imports WHERE tenant_id=:tenant
                AND domain_id=:domain AND author=:author AND idempotency_key=:key""",
                **self.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                job = self._job(conn, p, domain, existing["id"])
                if existing["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Import key reused")
                return self._job_view(conn, p, domain, job)
            for item in data.items:
                self.knowledge._validate_subjects(conn, p, domain, item.allowed_subjects)
                if p.subject not in item.allowed_subjects or not set(item.allowed_subjects) <= set(
                    collection["allowed_subjects"]
                ):
                    raise CoreError(
                        "VALIDATION_FAILED",
                        "Item readers must include submitter and be within collection readers",
                        422,
                    )
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_imports(tenant_id,domain_id,id,collection_id,author,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:collection,:author,:key,:hash)""",
                **self.keys(p, domain),
                id=ident,
                collection=collection_id,
                author=p.subject,
                key=data.idempotency_key,
                hash=fingerprint,
            )
            for position, item in enumerate(data.items):
                run(
                    conn,
                    """INSERT INTO cf_import_items(tenant_id,domain_id,import_id,position,payload)
                    VALUES(:tenant,:domain,:id,:position,CAST(:payload AS jsonb))""",
                    **self.keys(p, domain),
                    id=ident,
                    position=position,
                    payload=encoded(item.model_dump(mode="json")),
                )
            return self._job_view(conn, p, domain, self._job(conn, p, domain, ident))

    def import_job(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._job_view(conn, p, domain, self._job(conn, p, domain, ident))

    def imports(self, p, domain, limit, after):
        with self.db.transaction(p, domain) as conn:
            rows = (
                run(
                    conn,
                    f"""SELECT j.* FROM cf_imports j JOIN cf_collections c
                ON c.tenant_id=j.tenant_id AND c.domain_id=j.domain_id AND c.id=j.collection_id
                WHERE j.tenant_id=:tenant AND j.domain_id=:domain AND j.id>:after
                AND {self.ACCESS} ORDER BY j.id LIMIT :limit""",
                    **self.keys(p, domain),
                    author=p.subject,
                    acl=encoded([p.subject]),
                    after=after or "",
                    limit=limit + 1,
                )
                .mappings()
                .all()
            )
            return self._page(rows, limit, lambda row: self._job_view(conn, p, domain, row))

    def process(self, p, domain, ident, limit):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.knowledge._domain(conn, p, domain, lock=True)
            job = self._job(conn, p, domain, ident)
            if job["cancelled"]:
                raise CoreError("IMPORT_CANCELLED", "Cancelled import cannot be processed")
            items = (
                run(
                    conn,
                    """SELECT * FROM cf_import_items WHERE tenant_id=:tenant
                AND domain_id=:domain AND import_id=:id AND status='pending'
                ORDER BY position LIMIT :limit""",
                    **self.keys(p, domain),
                    id=ident,
                    limit=limit,
                )
                .mappings()
                .all()
            )
            for item in items:
                payload, source_id, error = item["payload"], None, None
                try:
                    with conn.begin_nested():
                        if not payload["filename"].lower().endswith((".txt", ".md", ".markdown")):
                            raise CoreError(
                                "UNSUPPORTED_FORMAT", "Only text and Markdown are supported", 422
                            )
                        if "\x00" in payload["content"]:
                            raise CoreError("INVALID_TEXT", "Text contains null characters", 422)
                        source = self.knowledge._create_source(
                            conn,
                            p,
                            domain,
                            SourceInput(
                                title=payload["filename"],
                                location=f"upload://{job['collection_id']}/{payload['filename']}",
                                content=payload["content"],
                                allowed_subjects=payload["allowed_subjects"],
                            ),
                        )
                        source_id = source["id"]
                        run(
                            conn,
                            """INSERT INTO cf_collection_sources(tenant_id,domain_id,collection_id,source_id)
                            VALUES(:tenant,:domain,:collection,:source) ON CONFLICT DO NOTHING""",
                            **self.keys(p, domain),
                            collection=job["collection_id"],
                            source=source_id,
                        )
                except CoreError as exc:
                    source_id, error = None, exc.code
                # Unexpected database/runtime failures roll back the request, leaving
                # pending items retryable, rather than recording a false success.
                run(
                    conn,
                    """UPDATE cf_import_items SET status=:status,source_id=:source,
                    error_code=:error,attempts=attempts+1 WHERE tenant_id=:tenant AND domain_id=:domain
                    AND import_id=:id AND position=:position""",
                    **self.keys(p, domain),
                    id=ident,
                    position=item["position"],
                    status="failed" if error else "succeeded",
                    source=source_id,
                    error=error,
                )
            return self._job_view(conn, p, domain, self._job(conn, p, domain, ident))

    def cancel(self, p, domain, ident):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.knowledge._domain(conn, p, domain, lock=True)
            job = self._job(conn, p, domain, ident)
            # Completed jobs stay completed; cancellation preserves registered sources.
            pending = run(
                conn,
                """UPDATE cf_import_items SET status='cancelled'
                WHERE tenant_id=:tenant AND domain_id=:domain AND import_id=:id AND status='pending'""",
                **self.keys(p, domain),
                id=ident,
            ).rowcount
            if pending:
                run(
                    conn,
                    "UPDATE cf_imports SET cancelled=true WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                    **self.keys(p, domain),
                    id=ident,
                )
            return self._job_view(conn, p, domain, self._job(conn, p, domain, job["id"]))

    def retry(self, p, domain, ident):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.knowledge._domain(conn, p, domain, lock=True)
            job = self._job(conn, p, domain, ident)
            if job["cancelled"]:
                raise CoreError("IMPORT_CANCELLED", "Cancelled import cannot be retried")
            run(
                conn,
                """UPDATE cf_import_items SET status='pending',error_code=NULL
                WHERE tenant_id=:tenant AND domain_id=:domain AND import_id=:id AND status='failed'""",
                **self.keys(p, domain),
                id=ident,
            )
            return self._job_view(conn, p, domain, job)
