"""Permission-aware browser discovery, review and personal history."""

from uuid import uuid4

from .auth import CoreError
from .service import digest, encoded, one, run


class WorkspaceService:
    def __init__(self, knowledge):
        self.k = knowledge
        self.db = knowledge.db

    def identity(self, p):
        # Tenant selection is not authority: only this subject's memberships are returned.
        with self.db.engine.begin() as conn:
            run(conn, "SELECT set_config('cortex.tenant',:tenant,true)", tenant=p.tenant_id)
            domains = (
                run(
                    conn,
                    """SELECT d.id,d.name,m.role FROM cf_domains d JOIN cf_memberships m
                ON m.tenant_id=d.tenant_id AND m.domain_id=d.id
                WHERE d.tenant_id=:tenant AND m.subject=:subject ORDER BY d.id""",
                    tenant=p.tenant_id,
                    subject=p.subject,
                )
                .mappings()
                .all()
            )
            result = []
            for d in domains:
                capabilities = ["query", "inspect", "personal_history", "feedback"]
                if d["role"] in ("owner", "corpus_manager", "agent", "contributor"):
                    capabilities += ["propose", "read_proposals"]
                if d["role"] in ("owner", "corpus_manager"):
                    capabilities += ["manage_corpus"]
                if d["role"] == "owner":
                    capabilities += [
                        "review",
                        "approve",
                        "publish",
                        "compensate",
                        "source_acl",
                        "manage_members",
                        "manage_members",
                    ]
                result.append({**dict(d), "capabilities": capabilities})
            return {"subject": p.subject, "tenant_id": p.tenant_id, "domains": result}

    def _proposal(self, conn, p, domain, ident):
        row = one(
            conn,
            "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
            **self.k.keys(p, domain),
            id=ident,
        )
        if not row:
            raise CoreError("NOT_FOUND", "Proposal not found", 404)
        self.k._check_proposal_access(conn, p, domain, row)
        return row

    def _page(self, conn, p, domain, table, limit, after, check, view, extra="", params=None):
        # Scan in bounded chunks, filtering before choosing the returned cursor.
        # Tables/extra fragments are internal constants, never request SQL.
        cursor, visible = after or "", []
        while len(visible) <= limit:
            rows = (
                run(
                    conn,
                    f"""SELECT * FROM {table} WHERE tenant_id=:tenant AND domain_id=:domain
                AND id>:after {extra} ORDER BY id LIMIT 100""",
                    **self.k.keys(p, domain),
                    after=cursor,
                    **(params or {}),
                )
                .mappings()
                .all()
            )
            if not rows:
                break
            for row in rows:
                cursor = row["id"]
                try:
                    check(row)
                except CoreError as exc:
                    if exc.status == 404:
                        continue
                    raise
                visible.append(view(row))
                if len(visible) > limit:
                    break
            if len(rows) < 100:
                break
        return {
            "items": visible[:limit],
            "next_after": visible[limit - 1]["id"] if len(visible) > limit else None,
        }

    def proposals(self, p, domain, limit, after, status):
        with self.db.transaction(p, domain, write=True) as conn:
            return self._page(
                conn,
                p,
                domain,
                "cf_proposals",
                limit,
                after,
                lambda row: self.k._check_proposal_access(conn, p, domain, row),
                self.k._proposal_view,
                "AND (:status='' OR status=:status)",
                {"status": status or ""},
            )

    def episodes(self, p, domain, limit, after):
        with self.db.transaction(p, domain) as conn:
            return self._page(
                conn,
                p,
                domain,
                "cf_episodes",
                limit,
                after,
                lambda row: self.k._episode(conn, p, domain, row["id"]),
                lambda row: {
                    k: row[k] for k in ("id", "question", "result", "served_version", "created_at")
                },
                "AND subject=:subject",
                {"subject": p.subject},
            )

    def review(self, p, domain, ident, data):
        with self.db.transaction(p, domain, owner=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            proposal = self._proposal(conn, p, domain, ident)
            fingerprint = digest({"proposal": ident, **data.model_dump(mode="json")})
            existing = one(
                conn,
                """SELECT * FROM cf_reviews WHERE tenant_id=:tenant AND domain_id=:domain
                AND author=:author AND idempotency_key=:key""",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["request_hash"] != fingerprint:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Review key reused")
                return self._review_view(existing)
            if (
                proposal["digest"] != data.digest
                or proposal["review_revision"] != data.expected_review_revision
            ):
                raise CoreError("STALE_REVIEW", "Refresh the proposal before deciding")
            transitions = {
                "reject": ({"ready", "deferred", "changes_requested"}, "rejected"),
                "defer": ({"ready"}, "deferred"),
                "request_changes": ({"ready", "deferred"}, "changes_requested"),
                "reopen": ({"deferred"}, "ready"),
            }
            allowed, target = transitions[data.action]
            if proposal["status"] not in allowed:
                raise CoreError("INVALID_TRANSITION", "Review action is not allowed in this state")
            revision = proposal["review_revision"] + 1
            run(
                conn,
                "UPDATE cf_proposals SET status=:status,review_revision=:revision WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=ident,
                status=target,
                revision=revision,
            )
            receipt = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_reviews(tenant_id,domain_id,id,proposal_id,author,action,reason,
                proposal_digest,review_revision,resulting_status,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:proposal,:author,:action,:reason,:digest,:revision,:status,:key,:hash)""",
                **self.k.keys(p, domain),
                id=receipt,
                proposal=ident,
                author=p.subject,
                action=data.action,
                reason=data.reason,
                digest=data.digest,
                revision=revision,
                status=target,
                key=data.idempotency_key,
                hash=fingerprint,
            )
            return self._review_view(
                one(
                    conn,
                    "SELECT * FROM cf_reviews WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                    **self.k.keys(p, domain),
                    id=receipt,
                )
            )

    @staticmethod
    def _review_view(row):
        return {
            k: row[k]
            for k in (
                "id",
                "proposal_id",
                "author",
                "action",
                "reason",
                "proposal_digest",
                "review_revision",
                "resulting_status",
                "created_at",
            )
        }

    def reviews(self, p, domain, ident, limit, after):
        with self.db.transaction(p, domain, write=True) as conn:
            self._proposal(conn, p, domain, ident)
            return self._page(
                conn,
                p,
                domain,
                "cf_reviews",
                limit,
                after,
                lambda row: None,
                self._review_view,
                "AND proposal_id=:proposal",
                {"proposal": ident},
            )

    def revise(self, p, domain, ident, data):
        with self.db.transaction(p, domain, write=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            old = self._proposal(conn, p, domain, ident)
            role = one(
                conn,
                "SELECT role FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.k.keys(p, domain),
                subject=p.subject,
            )["role"]
            if old["author"] != p.subject and role != "owner":
                raise CoreError("NOT_AUTHORIZED", "Only author or owner can revise", 403)
            existing = one(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["replaces_id"] != ident:
                    raise CoreError(
                        "IDEMPOTENCY_CONFLICT", "Proposal key belongs to another operation"
                    )
                return self.k._propose(conn, p, domain, data)
            if old["status"] not in ("ready", "deferred", "changes_requested"):
                raise CoreError("INVALID_TRANSITION", "This proposal cannot be revised")
            new = self.k._propose(conn, p, domain, data)
            validation = dict(new["validation"])
            validation["source_ids"] = sorted(
                set(validation.get("source_ids", [])) | set(old["validation"].get("source_ids", []))
            )
            run(
                conn,
                "UPDATE cf_proposals SET validation=CAST(:validation AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=new["id"],
                validation=encoded(validation),
            )
            run(
                conn,
                "UPDATE cf_proposals SET replaces_id=:old WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=new["id"],
                old=ident,
            )
            run(
                conn,
                "UPDATE cf_proposals SET status='superseded',review_revision=review_revision+1 WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=ident,
            )
            return self.k._proposal_view(self._proposal(conn, p, domain, new["id"]))
