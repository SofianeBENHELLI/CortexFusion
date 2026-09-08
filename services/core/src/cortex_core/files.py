"""Private immutable bytes with lease-based parsing and permission-aware retrieval."""

import base64
import binascii
import hashlib
import json
import os
import subprocess
import sys
from uuid import uuid4

from .auth import CoreError
from .contracts import SourceInput
from .service import digest, encoded, one, run


def parse_bytes(raw, filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "cortex_core.parse_document", extension],
            input=raw,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env={"PATH": os.defpath, "PYTHONNOUSERSITE": "1"},
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"error_code": "PARSE_TIMEOUT"}
    if result.returncode != 0:
        return {"error_code": "PARSE_RESOURCE_FAILURE"}
    try:
        return json.loads(result.stdout)
    except (ValueError, UnicodeDecodeError):
        return {"error_code": "PARSE_FAILED"}


class FileService:
    def __init__(self, corpus):
        self.corpus, self.k, self.db = corpus, corpus.knowledge, corpus.db

    def _file(self, conn, p, domain, ident):
        row = one(
            conn,
            """SELECT f.* FROM cf_files f JOIN cf_collections c
            ON c.tenant_id=f.tenant_id AND c.domain_id=f.domain_id AND c.id=f.collection_id
            WHERE f.tenant_id=:tenant AND f.domain_id=:domain AND f.id=:id
            AND f.allowed_subjects @> CAST(:acl AS jsonb) AND c.allowed_subjects @> CAST(:acl AS jsonb)""",
            **self.k.keys(p, domain),
            id=ident,
            acl=encoded([p.subject]),
        )
        if not row:
            raise CoreError("NOT_FOUND", "File not found", 404)
        if row["source_id"]:
            self.k._source(conn, p, domain, row["source_id"])
        return row

    @staticmethod
    def view(row):
        return {
            **{
                k: row[k]
                for k in (
                    "id",
                    "collection_id",
                    "filename",
                    "content_hash",
                    "status",
                    "source_id",
                    "error_code",
                    "attempts",
                    "spans",
                )
            },
            "size_bytes": len(row["data"]),
        }

    def upload(self, p, domain, collection, data):
        try:
            raw = base64.b64decode(data.content_base64, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise CoreError("VALIDATION_FAILED", "Invalid base64", 422) from exc
        if not raw or len(raw) > 500000:
            raise CoreError("DOCUMENT_LIMIT", "File must contain 1 to 500,000 bytes", 422)
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            col = self.corpus._collection(conn, p, domain, collection)
            self.k._validate_subjects(conn, p, domain, data.allowed_subjects)
            if p.subject not in data.allowed_subjects or not set(data.allowed_subjects) <= set(
                col["allowed_subjects"]
            ):
                raise CoreError(
                    "VALIDATION_FAILED",
                    "File readers must include uploader and be within collection readers",
                    422,
                )
            h = hashlib.sha256(raw).hexdigest()
            fingerprint = digest(
                {
                    "collection": collection,
                    "filename": data.filename,
                    "hash": h,
                    "readers": sorted(set(data.allowed_subjects)),
                }
            )
            old = one(
                conn,
                """SELECT * FROM cf_files WHERE tenant_id=:tenant AND domain_id=:domain
                AND author=:author AND idempotency_key=:key""",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if old:
                self._file(conn, p, domain, old["id"])
                if old["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Upload key reused")
                return self.view(old)
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_files(tenant_id,domain_id,id,collection_id,author,filename,
                content_hash,data,allowed_subjects,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:collection,:author,:filename,:hash,:data,CAST(:acl AS jsonb),:key,:fingerprint)""",
                **self.k.keys(p, domain),
                id=ident,
                collection=collection,
                author=p.subject,
                filename=data.filename,
                hash=h,
                data=raw,
                acl=encoded(sorted(set(data.allowed_subjects))),
                key=data.idempotency_key,
                fingerprint=fingerprint,
            )
            return self.view(self._file(conn, p, domain, ident))

    def detail(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self.view(self._file(conn, p, domain, ident))

    def download(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return bytes(self._file(conn, p, domain, ident)["data"])

    def listing(self, p, domain, limit, after, pending):
        from .workspace import WorkspaceService

        with self.db.transaction(p, domain) as conn:
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_files",
                limit,
                after,
                lambda row: self._file(conn, p, domain, row["id"]),
                self.view,
                "AND (status='pending' OR (status='processing' AND lease_until<now()))"
                if pending
                else "",
            )

    def process(self, p, domain, ident):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            row = self._file(conn, p, domain, ident)
            if row["status"] in ("succeeded", "failed"):
                return self.view(row)
            if row["status"] == "cancelled":
                raise CoreError("FILE_CANCELLED", "File processing was cancelled")
            if (
                row["status"] == "processing"
                and one(conn, "SELECT :until>now() AS active", until=row["lease_until"])["active"]
            ):
                raise CoreError("FILE_BUSY", "Another worker holds the parsing lease")
            lease = str(uuid4())
            run(
                conn,
                """UPDATE cf_files SET status='processing',attempts=attempts+1,
                lease_token=:lease,lease_until=now()+interval '60 seconds' WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id""",
                **self.k.keys(p, domain),
                id=ident,
                lease=lease,
            )
            raw, filename = bytes(row["data"]), row["filename"]
        result = parse_bytes(raw, filename)
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            row = self._file(conn, p, domain, ident)
            if row["status"] != "processing" or row["lease_token"] != lease:
                raise CoreError("STALE_LEASE", "Parsing result no longer belongs to the active job")
            source_id, error = None, result.get("error_code")
            if not error:
                try:
                    with conn.begin_nested():
                        source = self.k._create_source(
                            conn,
                            p,
                            domain,
                            SourceInput(
                                title=filename,
                                location=f"document://{row['collection_id']}/{filename}/{row['content_hash']}",
                                content=result["content"],
                                allowed_subjects=row["allowed_subjects"],
                            ),
                        )
                        source_id = source["id"]
                        run(
                            conn,
                            """INSERT INTO cf_collection_sources VALUES(:tenant,:domain,:collection,:source)
                            ON CONFLICT DO NOTHING""",
                            **self.k.keys(p, domain),
                            collection=row["collection_id"],
                            source=source_id,
                        )
                except CoreError as exc:
                    error = exc.code
            run(
                conn,
                """UPDATE cf_files SET status=:status,source_id=:source,error_code=:error,
                spans=CAST(:spans AS jsonb),lease_token=NULL,lease_until=NULL
                WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id""",
                **self.k.keys(p, domain),
                id=ident,
                status="failed" if error else "succeeded",
                source=source_id,
                error=error,
                spans=encoded(result.get("spans", []) if not error else []),
            )
            return self.view(self._file(conn, p, domain, ident))

    def control(self, p, domain, ident, action):
        with self.db.transaction(p, domain, corpus=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            row = self._file(conn, p, domain, ident)
            target = "pending" if action == "retry" else "cancelled"
            allowed = ("failed",) if action == "retry" else ("pending", "processing")
            if row["status"] in allowed:
                run(
                    conn,
                    """UPDATE cf_files SET status=:status,error_code=NULL,lease_token=NULL,lease_until=NULL
                    WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id""",
                    **self.k.keys(p, domain),
                    id=ident,
                    status=target,
                )
            return self.view(self._file(conn, p, domain, ident))
