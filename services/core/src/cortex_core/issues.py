"""Issue decisions retain the originating episode's personal visibility boundary."""

from uuid import uuid4

from .auth import CoreError
from .contracts import IssueEvent, IssueView
from .service import digest, one, run
from .workspace import WorkspaceService


class IssueService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def _issue(self, conn, p, domain, ident):
        row = one(
            conn,
            "SELECT * FROM cf_issues WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
            **self.k.keys(p, domain),
            id=ident,
        )
        if not row:
            raise CoreError("NOT_FOUND", "Issue not found", 404)
        self.k._episode(conn, p, domain, row["episode_id"])
        return row

    @staticmethod
    def _view(row, contract):
        return {key: row[key] for key in contract.model_fields}

    def get(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._view(self._issue(conn, p, domain, ident), IssueView)

    def list(self, p, domain, limit, after, status):
        with self.db.transaction(p, domain) as conn:
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_issues",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["episode_id"]),
                lambda row: self._view(row, IssueView),
                "AND (:status='' OR status=:status)",
                {"status": status or ""},
            )

    def events(self, p, domain, ident, limit, after):
        with self.db.transaction(p, domain) as conn:
            self._issue(conn, p, domain, ident)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_issue_events",
                limit,
                after,
                lambda row: None,
                lambda row: self._view(row, IssueEvent),
                "AND issue_id=:issue",
                {"issue": ident},
            )

    def decide(self, p, domain, ident, data):
        with self.db.transaction(p, domain) as conn:
            self.k._domain(conn, p, domain, lock=True)
            issue = self._issue(conn, p, domain, ident)
            fingerprint = digest({"issue": ident, **data.model_dump(mode="json")})
            existing = one(
                conn,
                "SELECT * FROM cf_issue_events WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Issue decision key reused")
                return self._view(existing, IssueEvent)
            if issue["revision"] != data.expected_revision:
                raise CoreError("STALE_ISSUE", "Refresh the issue before deciding")
            allowed, target = {
                "start": ({"open"}, "in_progress"),
                "resolve": ({"open", "in_progress"}, "resolved"),
                "dismiss": ({"open", "in_progress"}, "dismissed"),
                "reopen": ({"resolved", "dismissed"}, "open"),
            }[data.action]
            if issue["status"] not in allowed:
                raise CoreError("INVALID_TRANSITION", "Issue action is not available in this state")
            revision = issue["revision"] + 1
            run(
                conn,
                "UPDATE cf_issues SET status=:status,revision=:revision WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=ident,
                status=target,
                revision=revision,
            )
            event = one(
                conn,
                """INSERT INTO cf_issue_events(tenant_id,domain_id,id,issue_id,author,previous_status,status,revision,reason,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:issue,:author,:previous,:status,:revision,:reason,:key,:hash) RETURNING *""",
                **self.k.keys(p, domain),
                id=str(uuid4()),
                issue=ident,
                author=p.subject,
                previous=issue["status"],
                status=target,
                revision=revision,
                reason=data.reason,
                key=data.idempotency_key,
                hash=fingerprint,
            )
            return self._view(event, IssueEvent)
