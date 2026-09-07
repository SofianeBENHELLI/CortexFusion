"""Private, opt-in telemetry; provenance is declared by the companion, never inferred here."""

from uuid import uuid4

from .auth import CoreError
from .service import digest, encoded, one, run
from .workspace import WorkspaceService


class FeedbackSignalService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def _preferences(self, conn, p, domain):
        row = one(
            conn,
            "SELECT allow_observed,allow_inferred,revision FROM cf_feedback_preferences WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
            **self.k.keys(p, domain),
            subject=p.subject,
        )
        return (
            dict(row) if row else {"allow_observed": False, "allow_inferred": False, "revision": 0}
        )

    def preferences(self, p, domain):
        with self.db.transaction(p, domain) as conn:
            return self._preferences(conn, p, domain)

    def set_preferences(self, p, domain, data):
        with self.db.transaction(p, domain) as conn:
            self.k._domain(conn, p, domain, lock=True)
            current = self._preferences(conn, p, domain)
            if current["revision"] != data.expected_revision:
                raise CoreError("STALE_PREFERENCES", "Refresh feedback collection preferences")
            row = one(
                conn,
                """INSERT INTO cf_feedback_preferences(tenant_id,domain_id,subject,allow_observed,allow_inferred,revision)
                VALUES(:tenant,:domain,:subject,:observed,:inferred,:revision)
                ON CONFLICT(tenant_id,domain_id,subject) DO UPDATE SET allow_observed=EXCLUDED.allow_observed,allow_inferred=EXCLUDED.allow_inferred,revision=EXCLUDED.revision
                RETURNING allow_observed,allow_inferred,revision""",
                **self.k.keys(p, domain),
                subject=p.subject,
                observed=data.allow_observed,
                inferred=data.allow_inferred,
                revision=current["revision"] + 1,
            )
            # Invalidate concurrent repeatable-read writers using an old collection policy.
            run(
                conn,
                "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=:tenant AND id=:domain",
                **self.k.keys(p, domain),
            )
            return dict(row)

    def _view(self, conn, p, domain, row):
        episode = self.k._episode(conn, p, domain, row["episode_id"])
        return {
            "id": row["id"],
            "episode_id": row["episode_id"],
            "served_version": episode["served_version"],
            "source_ids": episode["source_ids"],
            "signal": row["payload"],
            "created_at": row["created_at"],
        }

    def record(self, p, domain, episode_id, data):
        with self.db.transaction(p, domain) as conn:
            self.k._domain(conn, p, domain, lock=True)
            self.k._episode(conn, p, domain, episode_id)
            fingerprint = digest({"episode_id": episode_id, **data.model_dump(mode="json")})
            existing = one(
                conn,
                "SELECT * FROM cf_feedback_signals WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject AND idempotency_key=:key",
                **self.k.keys(p, domain),
                subject=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Feedback signal key reused")
                return self._view(conn, p, domain, existing)
            prefs = self._preferences(conn, p, domain)
            if data.origin != "explicit" and not prefs["allow_" + data.origin]:
                raise CoreError(
                    "COLLECTION_DISABLED",
                    "This automatic feedback origin is disabled for this user",
                    403,
                )
            row = one(
                conn,
                """INSERT INTO cf_feedback_signals(tenant_id,domain_id,id,subject,episode_id,origin,kind,payload,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:subject,:episode,:origin,:kind,CAST(:payload AS jsonb),:key,:hash) RETURNING *""",
                **self.k.keys(p, domain),
                id=str(uuid4()),
                subject=p.subject,
                episode=episode_id,
                origin=data.origin,
                kind=data.kind,
                payload=encoded(data.model_dump(mode="json")),
                key=data.idempotency_key,
                hash=fingerprint,
            )
            if data.origin == "explicit" and data.kind == "thumbs_down":
                self.k._issue(
                    conn,
                    p,
                    domain,
                    episode_id,
                    "disputed_answer",
                    data.comment or "Explicit negative feedback",
                )
            return self._view(conn, p, domain, row)

    def listing(self, p, domain, limit, after, episode_id=None):
        with self.db.transaction(p, domain) as conn:
            if episode_id:
                self.k._episode(conn, p, domain, episode_id)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_feedback_signals",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["episode_id"]),
                lambda row: self._view(conn, p, domain, row),
                "AND subject=:subject AND (:episode='' OR episode_id=:episode)",
                {"subject": p.subject, "episode": episode_id or ""},
            )
