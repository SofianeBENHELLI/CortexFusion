"""Immutable personal copies of companion output; references checked, claims not certified."""

from uuid import uuid4

from .auth import CoreError
from .service import digest, encoded, one
from .workspace import WorkspaceService


class CompanionResponseService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def _response(self, conn, p, domain, ident, episode_id=None):
        row = one(
            conn,
            "SELECT * FROM cf_companion_responses WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND subject=:subject",
            **self.k.keys(p, domain),
            id=ident,
            subject=p.subject,
        )
        if not row or (episode_id and row["episode_id"] != episode_id):
            raise CoreError("NOT_FOUND", "Companion response not found", 404)
        self.k._episode(conn, p, domain, row["episode_id"])
        return row

    @staticmethod
    def _references(episode, payload):
        available = {
            (c["source_id"], c["start"], c["end"]): c for c in episode["result"]["citations"]
        }
        selected = []
        for ref in payload["citations"]:
            key = (ref["source_id"], ref["start"], ref["end"])
            if key not in available:
                raise CoreError(
                    "UNSUPPORTED_RESPONSE_REFERENCE",
                    "Use exact citation references returned in this episode",
                    422,
                )
            selected.append(available[key])
        return selected

    def _view(self, conn, p, domain, row):
        episode = self.k._episode(conn, p, domain, row["episode_id"])
        citations = self._references(episode, row["payload"])
        return {
            "id": row["id"],
            "episode_id": row["episode_id"],
            "served_version": episode["served_version"],
            "response": row["payload"],
            "citations": citations,
            "reference_validation": "episode_references_checked" if citations else "no_references",
            "semantic_validation": "not_performed",
            "created_at": row["created_at"],
        }

    def create(self, p, domain, episode_id, data):
        with self.db.transaction(p, domain) as conn:
            self.k._domain(conn, p, domain, lock=True)
            return self._create(conn, p, domain, episode_id, data)

    def _create(self, conn, p, domain, episode_id, data):
        """Append a receipt in the caller's transaction, with its domain lock held.

        The caller owns commit/rollback. Episode and reference checks are retained
        here so an orchestrator cannot bypass personal ownership or evidence ACLs.
        """
        payload = data.model_dump(mode="json")
        fingerprint = digest({"episode_id": episode_id, **payload})
        episode = self.k._episode(conn, p, domain, episode_id)
        old = one(
            conn,
            "SELECT * FROM cf_companion_responses WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject AND idempotency_key=:key",
            **self.k.keys(p, domain),
            subject=p.subject,
            key=data.idempotency_key,
        )
        if old:
            if old["request_hash"] != fingerprint:
                raise CoreError("IDEMPOTENCY_CONFLICT", "Companion response key reused")
            return self._view(conn, p, domain, old)
        self._references(episode, payload)
        row = one(
            conn,
            """INSERT INTO cf_companion_responses(tenant_id,domain_id,id,subject,episode_id,payload,idempotency_key,request_hash)
            VALUES(:tenant,:domain,:id,:subject,:episode,CAST(:payload AS jsonb),:key,:hash) RETURNING *""",
            **self.k.keys(p, domain),
            id=str(uuid4()),
            subject=p.subject,
            episode=episode_id,
            payload=encoded(payload),
            key=data.idempotency_key,
            hash=fingerprint,
        )
        return self._view(conn, p, domain, row)

    def detail(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._view(conn, p, domain, self._response(conn, p, domain, ident))

    def listing(self, p, domain, limit, after, episode_id=None):
        with self.db.transaction(p, domain) as conn:
            if episode_id:
                self.k._episode(conn, p, domain, episode_id)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_companion_responses",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["episode_id"]),
                lambda row: self._view(conn, p, domain, row),
                "AND subject=:subject AND (:episode='' OR episode_id=:episode)",
                {"subject": p.subject, "episode": episode_id or ""},
            )
