"""At-most-one provider attempt per personal key; ambiguous attempts never replay."""

import re
from uuid import uuid4

from .auth import CoreError
from .companion_responses import CompanionResponseService
from .contracts import CompanionResponseInput, SynthesisUsage
from .model_attempts import ModelAttemptService
from .service import digest, encoded, one, run
from .workspace import WorkspaceService


class SynthesisService:
    def __init__(self, knowledge, factory=None, daily_limit=100):
        self.k, self.db, self.factory = knowledge, knowledge.db, factory
        self.quota = ModelAttemptService(knowledge, daily_limit)
        self.responses = CompanionResponseService(knowledge)

    def _lock(self, conn, p, domain, *, write=False):
        run(
            conn,
            "SELECT id FROM cf_domains WHERE tenant_id=:tenant AND id=:domain "
            + ("FOR UPDATE" if write else "FOR KEY SHARE"),
            **self.k.keys(p, domain),
        )
        if not one(
            conn,
            "SELECT role FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
            **self.k.keys(p, domain),
            subject=p.subject,
        ):
            raise CoreError("NOT_FOUND", "Domain not found", 404)

    def _attempt(self, conn, p, domain, ident):
        row = one(
            conn,
            "SELECT * FROM cf_synthesis_attempts WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND subject=:subject",
            **self.k.keys(p, domain),
            id=ident,
            subject=p.subject,
        )
        if not row:
            raise CoreError("NOT_FOUND", "Synthesis not found", 404)
        self.k._episode(conn, p, domain, row["episode_id"])
        return row

    def _view(self, conn, p, domain, row):
        outcome = one(
            conn,
            "SELECT * FROM cf_synthesis_outcomes WHERE tenant_id=:tenant AND domain_id=:domain AND attempt_id=:id",
            **self.k.keys(p, domain),
            id=row["id"],
        )
        return {
            **{
                key: row[key]
                for key in (
                    "id",
                    "episode_id",
                    "provider",
                    "requested_model",
                    "prompt_version",
                    "budget_reserved",
                    "idempotency_key",
                    "created_at",
                )
            },
            "status": outcome["status"] if outcome else "unresolved",
            "response_id": outcome["response_id"] if outcome else None,
            "error_code": outcome["error_code"] if outcome else None,
            "usage": outcome["usage"] if outcome else None,
            "finished_at": outcome["created_at"] if outcome else None,
        }

    def detail(self, p, domain, ident):
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            self._lock(conn, p, domain)
            return self._view(conn, p, domain, self._attempt(conn, p, domain, ident))

    def listing(self, p, domain, limit, after, episode_id=None, key=None):
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            self._lock(conn, p, domain)
            if episode_id:
                self.k._episode(conn, p, domain, episode_id)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_synthesis_attempts",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["episode_id"]),
                lambda row: self._view(conn, p, domain, row),
                "AND subject=:subject AND (:episode='' OR episode_id=:episode) AND (:key='' OR idempotency_key=:key)",
                {"subject": p.subject, "episode": episode_id or "", "key": key or ""},
            )

    @staticmethod
    def _identity(p, authenticate):
        current = authenticate()
        if current != p:
            raise CoreError("NOT_AUTHORIZED", "Identity changed during synthesis", 403)

    def _reserve(self, p, domain, episode_id, data):
        fingerprint = digest({"episode_id": episode_id, **data.model_dump(mode="json")})
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            self._lock(conn, p, domain, write=True)
            episode = self.k._episode(conn, p, domain, episode_id)
            old = one(
                conn,
                "SELECT * FROM cf_synthesis_attempts WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject AND idempotency_key=:key",
                **self.k.keys(p, domain),
                subject=p.subject,
                key=data.idempotency_key,
            )
            if old:
                if old["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Synthesis key reused")
                return old["id"], None, False
            if self.factory is None:
                raise CoreError("SYNTHESIS_DISABLED", "Backend synthesis is not configured", 503)
            model = self.factory()
            paid = bool(episode["result"]["citations"])
            prepared = (
                model.prepare(episode["question"], episode["result"])
                if paid
                else {"abstention": episode_id}
            )
            if paid and self.quota._usage(conn, p, domain)["remaining_attempts"] == 0:
                raise CoreError(
                    "MODEL_DAILY_LIMIT", "The domain model attempt allowance is exhausted", 429
                )
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_synthesis_attempts(tenant_id,domain_id,id,subject,episode_id,provider,requested_model,prompt_version,budget_reserved,input_sha256,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:subject,:episode,:provider,:model,:prompt,:paid,:input,:key,:hash)""",
                **self.k.keys(p, domain),
                id=ident,
                subject=p.subject,
                episode=episode_id,
                provider="openrouter" if paid else "none",
                model=model.model if paid else None,
                prompt=model.PROMPT_VERSION if paid else "deterministic-abstention-v1",
                paid=paid,
                input=digest(prepared),
                key=data.idempotency_key,
                hash=fingerprint,
            )
            # Also invalidate repeatable-read extraction quota snapshots.
            run(
                conn,
                "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=:tenant AND id=:domain",
                **self.k.keys(p, domain),
            )
            return ident, model if paid else None, True

    def _failed(self, p, domain, ident, exc, usage):
        code = (
            exc.code
            if isinstance(exc, CoreError) and re.fullmatch(r"[A-Z_]{1,100}", exc.code)
            else "SYNTHESIS_FAILED"
        )
        # An in-flight attempt may outlive membership revocation. This internal
        # append records only a safe outcome for its original authenticated author.
        with self.db.engine.begin() as conn:
            run(conn, "SELECT set_config('cortex.tenant',:tenant,true)", tenant=p.tenant_id)
            run(
                conn,
                """INSERT INTO cf_synthesis_outcomes(tenant_id,domain_id,attempt_id,status,error_code,usage)
                SELECT tenant_id,domain_id,id,'failed',:code,CAST(:usage AS jsonb) FROM cf_synthesis_attempts
                WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND subject=:subject
                ON CONFLICT(tenant_id,domain_id,attempt_id) DO NOTHING""",
                **self.k.keys(p, domain),
                id=ident,
                subject=p.subject,
                code=code,
                usage=encoded(usage),
            )

    def execute(self, p, domain, episode_id, data, authenticate):
        self._identity(p, authenticate)
        ident, model, fresh = self._reserve(p, domain, episode_id, data)
        if not fresh:
            self._identity(p, authenticate)
            return self.detail(p, domain, ident)
        usage = None
        try:
            self._identity(p, authenticate)
            with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
                self._lock(conn, p, domain)
                episode = self.k._episode(conn, p, domain, episode_id)
            if model:
                draft = model.synthesize(episode["question"], episode["result"])
                usage = SynthesisUsage.model_validate(draft["usage"]).model_dump(mode="json")
            else:
                draft = {
                    "answer_text": "Aucune preuve exploitable dans cet épisode ; je ne peux pas fournir une réponse sourcée.",
                    "answer_kind": "abstention",
                    "citations": [],
                    "model": None,
                }
            self._identity(p, authenticate)
            with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
                self._lock(conn, p, domain, write=True)
                self._attempt(conn, p, domain, ident)
                receipt = self.responses._create(
                    conn,
                    p,
                    domain,
                    episode_id,
                    CompanionResponseInput(
                        **{
                            key: draft[key]
                            for key in ("answer_text", "answer_kind", "citations", "model")
                        },
                        companion="cortex-backend-synthesis-v1",
                        idempotency_key="synthesis:" + ident,
                    ),
                )
                run(
                    conn,
                    """INSERT INTO cf_synthesis_outcomes(tenant_id,domain_id,attempt_id,status,response_id,usage)
                    VALUES(:tenant,:domain,:id,'succeeded',:response,CAST(:usage AS jsonb))""",
                    **self.k.keys(p, domain),
                    id=ident,
                    response=receipt["id"],
                    usage=encoded(usage),
                )
        except Exception as exc:
            try:
                if usage is None and model and getattr(model, "last_usage", None):
                    usage = SynthesisUsage.model_validate(model.last_usage).model_dump(mode="json")
            except ValueError:
                usage = None
            try:
                self._failed(p, domain, ident, exc, usage)
            except Exception:
                raise CoreError(
                    "SYNTHESIS_STORAGE_UNCERTAIN",
                    "Inspect the existing attempt; do not automatically retry with a new key",
                    503,
                ) from None
            if isinstance(exc, CoreError) and exc.status in (401, 403, 404):
                raise
        self._identity(p, authenticate)
        return self.detail(p, domain, ident)
