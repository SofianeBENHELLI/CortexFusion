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

    def _access(self, conn, p, domain, *, write=False):
        run(
            conn,
            "SELECT id FROM cf_domains WHERE tenant_id=:tenant AND id=:domain "
            + ("FOR UPDATE" if write else "FOR KEY SHARE"),
            **self.k.keys(p, domain),
        )
        membership = one(
            conn,
            "SELECT role FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
            **self.k.keys(p, domain),
            subject=p.subject,
        )
        if not membership:
            raise CoreError("NOT_FOUND", "Domain not found", 404)
        return membership["role"]

    def _correction(self, conn, p, domain, ident, role):
        # Proposal access does not follow from ownership of a personal issue.
        if role == "viewer":
            raise CoreError("NOT_FOUND", "Correction not found", 404)
        return WorkspaceService(self.k)._proposal(conn, p, domain, str(ident))

    def _event_access(self, conn, p, domain, event, role):
        if event["correction_proposal_id"]:
            self._correction(conn, p, domain, event["correction_proposal_id"], role)

    @staticmethod
    def _view(row, contract):
        return {key: row[key] for key in contract.model_fields}

    def get(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._view(self._issue(conn, p, domain, ident), IssueView)

    def list(self, p, domain, limit, after, status, episode_id=None):
        with self.db.transaction(p, domain) as conn:
            if episode_id:
                self.k._episode(conn, p, domain, episode_id)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_issues",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["episode_id"]),
                lambda row: self._view(row, IssueView),
                """AND (:status='' OR status=:status) AND (:episode='' OR episode_id=:episode)
                AND EXISTS (SELECT 1 FROM cf_episodes e
                    WHERE e.tenant_id=cf_issues.tenant_id AND e.domain_id=cf_issues.domain_id
                    AND e.id=cf_issues.episode_id AND e.subject=:subject)""",
                {"status": status or "", "episode": episode_id or "", "subject": p.subject},
            )

    def events(self, p, domain, ident, limit, after):
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            role = self._access(conn, p, domain)
            self._issue(conn, p, domain, ident)
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_issue_events",
                limit,
                after,
                lambda row: self._event_access(conn, p, domain, row, role),
                lambda row: self._view(row, IssueEvent),
                "AND issue_id=:issue",
                {"issue": ident},
            )

    def decide(self, p, domain, ident, data):
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            role = self._access(conn, p, domain, write=True)
            issue = self._issue(conn, p, domain, ident)
            payload = data.model_dump(mode="json")
            if data.correction_proposal_id is None:
                # Preserve pre-migration idempotency fingerprints when omitted/null.
                payload.pop("correction_proposal_id")
            fingerprint = digest({"issue": ident, **payload})
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
                self._event_access(conn, p, domain, existing, role)
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
            proposal, published = None, None
            if data.correction_proposal_id:
                proposal = self._correction(conn, p, domain, data.correction_proposal_id, role)
                if proposal["status"] in {
                    "rejected",
                    "superseded",
                    "changes_requested",
                    "deferred",
                }:
                    raise CoreError(
                        "CORRECTION_NOT_ACTIVE", "Choose a ready, approved or published correction"
                    )
                if proposal["status"] == "published":
                    commit = one(
                        conn,
                        "SELECT sequence FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND proposal_id=:proposal",
                        **self.k.keys(p, domain),
                        proposal=proposal["id"],
                    )
                    published = commit["sequence"]
                if data.action == "resolve" and published is None:
                    raise CoreError(
                        "CORRECTION_NOT_PUBLISHED",
                        "Publish the correction before resolving with it",
                    )
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
                """INSERT INTO cf_issue_events(tenant_id,domain_id,id,issue_id,author,previous_status,status,revision,reason,idempotency_key,request_hash,correction_proposal_id,correction_digest,correction_published_version)
                VALUES(:tenant,:domain,:id,:issue,:author,:previous,:status,:revision,:reason,:key,:hash,:proposal,:digest,:published) RETURNING *""",
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
                proposal=proposal["id"] if proposal else None,
                digest=proposal["digest"] if proposal else None,
                published=published,
            )
            return self._view(event, IssueEvent)
