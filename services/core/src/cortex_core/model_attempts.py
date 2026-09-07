"""Reserve each potential model call durably; no transparent replay of uncertain calls."""

import re
from hashlib import sha256
from uuid import uuid4

from .auth import CoreError
from .service import encoded, one, run
from .workspace import WorkspaceService


class ModelAttemptService:
    def __init__(self, knowledge, daily_limit=100):
        self.k, self.db, self.daily_limit = knowledge, knowledge.db, daily_limit

    def _usage(self, conn, p, domain):
        row = one(
            conn,
            """SELECT (now() AT TIME ZONE 'UTC')::date AS utc_day,count(*) AS reserved_attempts
            FROM cf_model_attempts WHERE tenant_id=:tenant AND domain_id=:domain
            AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
            **self.k.keys(p, domain),
        )
        return {
            "utc_day": row["utc_day"],
            "daily_limit": self.daily_limit,
            "reserved_attempts": row["reserved_attempts"],
            "remaining_attempts": max(0, self.daily_limit - row["reserved_attempts"]),
            "scope": "All model attempt reservations in this domain; not a monetary budget or provider invoice.",
        }

    def usage(self, p, domain):
        with self.db.transaction(p, domain, owner=True) as conn:
            return self._usage(conn, p, domain)

    def reserve(
        self, p, domain, source_id, key, fingerprint, provider, requested_model, start, end, content
    ):
        with self.db.transaction(p, domain, owner=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            self.k._source(conn, p, domain, source_id)
            old = one(
                conn,
                "SELECT * FROM cf_model_attempts WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.k.keys(p, domain),
                author=p.subject,
                key=key,
            )
            if old:
                if old["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Model attempt key reused")
                raise CoreError(
                    "MODEL_ATTEMPT_RECORDED",
                    "A prior attempt exists. Inspect model-attempts; this key will not trigger another provider call",
                    409,
                )
            if self._usage(conn, p, domain)["remaining_attempts"] == 0:
                raise CoreError(
                    "MODEL_DAILY_LIMIT", "The domain's daily model attempt limit is reached", 429
                )
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_model_attempts(tenant_id,domain_id,id,author,source_id,provider,requested_model,input_span,input_sha256,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:author,:source,:provider,:model,CAST(:span AS jsonb),:hash,:key,:request)""",
                **self.k.keys(p, domain),
                id=ident,
                author=p.subject,
                source=source_id,
                provider=provider,
                model=requested_model,
                span=encoded({"source_id": source_id, "start": start, "end": end}),
                hash=sha256(content.encode("utf-8")).hexdigest(),
                key=key,
                request=fingerprint,
            )
            # Force a concurrent repeatable-read quota reserver to refresh its snapshot.
            run(
                conn,
                "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=:tenant AND id=:domain",
                **self.k.keys(p, domain),
            )
            return ident

    def succeeded(self, conn, p, domain, attempt_id, extraction_id):
        run(
            conn,
            """INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,extraction_id)
            VALUES(:tenant,:domain,:attempt,'succeeded',:extraction)""",
            **self.k.keys(p, domain),
            attempt=attempt_id,
            extraction=extraction_id,
        )

    def failed(self, p, domain, attempt_id, error):
        code = (
            error.code
            if isinstance(error, CoreError) and re.fullmatch(r"[A-Z_]{1,100}", error.code)
            else "MODEL_OPERATION_FAILED"
        )
        # Internal completion of a previously authorized attempt, even after membership/source revocation.
        # No public operation can append an outcome or supply this identity.
        with self.db.engine.begin() as conn:
            run(conn, "SELECT set_config('cortex.tenant',:tenant,true)", tenant=p.tenant_id)
            run(
                conn,
                """INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,error_code)
                SELECT tenant_id,domain_id,id,'failed',:code FROM cf_model_attempts
                WHERE tenant_id=:tenant AND domain_id=:domain AND id=:attempt AND author=:author
                ON CONFLICT(tenant_id,domain_id,attempt_id) DO NOTHING""",
                **self.k.keys(p, domain),
                attempt=attempt_id,
                author=p.subject,
                code=code,
            )

    def _view(self, conn, p, domain, row):
        outcome = one(
            conn,
            "SELECT * FROM cf_model_outcomes WHERE tenant_id=:tenant AND domain_id=:domain AND attempt_id=:attempt",
            **self.k.keys(p, domain),
            attempt=row["id"],
        )
        return {
            **{
                k: row[k]
                for k in (
                    "id",
                    "source_id",
                    "provider",
                    "requested_model",
                    "input_span",
                    "input_sha256",
                    "idempotency_key",
                    "created_at",
                )
            },
            "status": outcome["status"] if outcome else "unresolved",
            "finished_at": outcome["created_at"] if outcome else None,
            "error_code": outcome["error_code"] if outcome else None,
            "extraction_id": outcome["extraction_id"] if outcome else None,
        }

    def listing(self, p, domain, limit, after):
        with self.db.transaction(p, domain, owner=True) as conn:
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_model_attempts",
                limit,
                after,
                lambda row: self.k._source(conn, p, domain, row["source_id"]),
                lambda row: self._view(conn, p, domain, row),
                "AND author=:author",
                {"author": p.subject},
            )

    def detail(self, p, domain, ident):
        with self.db.transaction(p, domain, owner=True) as conn:
            row = one(
                conn,
                "SELECT * FROM cf_model_attempts WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND author=:author",
                **self.k.keys(p, domain),
                id=ident,
                author=p.subject,
            )
            if not row:
                raise CoreError("NOT_FOUND", "Model attempt not found", 404)
            self.k._source(conn, p, domain, row["source_id"])
            return self._view(conn, p, domain, row)
