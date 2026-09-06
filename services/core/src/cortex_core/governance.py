from uuid import uuid4

from .auth import CoreError
from .service import digest, one, run
from .workspace import WorkspaceService


class GovernanceService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def members(self, p, domain, limit, after):
        with self.db.transaction(p, domain, owner=True) as conn:
            rows = (
                run(
                    conn,
                    """SELECT subject,role,revision FROM cf_memberships
                WHERE tenant_id=:tenant AND domain_id=:domain AND subject>:after ORDER BY subject LIMIT :limit""",
                    **self.k.keys(p, domain),
                    after=after or "",
                    limit=limit + 1,
                )
                .mappings()
                .all()
            )
            return {
                "items": [dict(r) for r in rows[:limit]],
                "next_after": rows[limit - 1]["subject"] if len(rows) > limit else None,
            }

    @staticmethod
    def _receipt(row):
        return {
            k: row[k]
            for k in (
                "id",
                "author",
                "subject",
                "previous_role",
                "new_role",
                "resulting_revision",
                "reason",
                "created_at",
            )
        }

    def membership(self, p, domain, data):
        with self.db.transaction(p, domain, owner=True) as conn:
            self.k._domain(conn, p, domain, lock=True)
            h = digest(data.model_dump(mode="json"))
            existing = one(
                conn,
                """SELECT * FROM cf_membership_events WHERE tenant_id=:tenant
                AND domain_id=:domain AND author=:author AND idempotency_key=:key""",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["request_hash"] != h:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Membership key reused")
                return self._receipt(existing)
            old = one(
                conn,
                "SELECT role,revision FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.k.keys(p, domain),
                subject=data.subject,
            )
            if (old["revision"] if old else None) != data.expected_revision:
                raise CoreError("STALE_MEMBERSHIP", "Refresh domain membership")
            if not old and not data.role:
                raise CoreError("NOT_FOUND", "Member not found", 404)
            if old and old["role"] == "owner" and data.role != "owner":
                owners = one(
                    conn,
                    "SELECT count(*) AS count FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND role='owner'",
                    **self.k.keys(p, domain),
                )["count"]
                if owners <= 1:
                    raise CoreError(
                        "LAST_OWNER", "Assign another owner before removing the last owner"
                    )
            previous = one(
                conn,
                "SELECT max(resulting_revision) AS revision FROM cf_membership_events WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.k.keys(p, domain),
                subject=data.subject,
            )["revision"]
            revision = (
                max(old["revision"] if old else -1, previous if previous is not None else -1) + 1
            )
            if data.role is None:
                run(
                    conn,
                    "DELETE FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                    **self.k.keys(p, domain),
                    subject=data.subject,
                )
            elif old:
                run(
                    conn,
                    "UPDATE cf_memberships SET role=:role,revision=:revision WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                    **self.k.keys(p, domain),
                    subject=data.subject,
                    role=data.role,
                    revision=revision,
                )
            else:
                run(
                    conn,
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role,revision) VALUES(:tenant,:domain,:subject,:role,:revision)",
                    **self.k.keys(p, domain),
                    subject=data.subject,
                    role=data.role,
                    revision=revision,
                )
            run(
                conn,
                "UPDATE cf_domains SET published_version=published_version WHERE tenant_id=:tenant AND id=:domain",
                **self.k.keys(p, domain),
            )
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_membership_events(tenant_id,domain_id,id,author,subject,previous_role,new_role,resulting_revision,reason,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:author,:subject,:old,:new,:revision,:reason,:key,:hash)""",
                **self.k.keys(p, domain),
                id=ident,
                author=p.subject,
                subject=data.subject,
                old=old["role"] if old else None,
                new=data.role,
                revision=revision,
                reason=data.reason,
                key=data.idempotency_key,
                hash=h,
            )
            return self._receipt(
                one(
                    conn,
                    "SELECT * FROM cf_membership_events WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                    **self.k.keys(p, domain),
                    id=ident,
                )
            )

    def events(self, p, domain, limit, after):
        with self.db.transaction(p, domain, owner=True) as conn:
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_membership_events",
                limit,
                after,
                lambda row: None,
                self._receipt,
            )

    def commits(self, p, domain, limit, after):
        with self.db.transaction(p, domain, owner=True) as conn:
            visible, cursor = [], after
            while len(visible) <= limit:
                rows = (
                    run(
                        conn,
                        """SELECT * FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain
                    AND sequence>:after ORDER BY sequence LIMIT 100""",
                        **self.k.keys(p, domain),
                        after=cursor,
                    )
                    .mappings()
                    .all()
                )
                if not rows:
                    break
                for row in rows:
                    cursor = row["sequence"]
                    try:
                        WorkspaceService(self.k)._proposal(conn, p, domain, row["proposal_id"])
                    except CoreError as exc:
                        if exc.status == 404:
                            continue
                        raise
                    visible.append(
                        {
                            k: row[k]
                            for k in (
                                "sequence",
                                "proposal_id",
                                "author",
                                "reason",
                                "digest",
                                "created_at",
                            )
                        }
                    )
                    if len(visible) > limit:
                        break
                if len(rows) < 100:
                    break
            return {
                "items": visible[:limit],
                "next_after": visible[limit - 1]["sequence"] if len(visible) > limit else None,
            }

    def diff(self, p, domain, ident):
        with self.db.transaction(p, domain, write=True) as conn:
            proposal = WorkspaceService(self.k)._proposal(conn, p, domain, ident)
            d = self.k._domain(conn, p, domain)
            commit = one(
                conn,
                "SELECT before_state FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND proposal_id=:id",
                **self.k.keys(p, domain),
                id=ident,
            )
            state = self.k._state(conn, p, domain)
            before = commit["before_state"] if commit else state
            items = []
            for change in proposal["payload"]:
                concept_id = (
                    change["concept"]["concept_id"]
                    if change["kind"] == "put_concept"
                    else change["concept_id"]
                )
                old = before.get(concept_id)
                if old:
                    if not self.k._visible(conn, p, domain, old):
                        raise CoreError("NOT_FOUND", "Comparison not available", 404)
                    for link in old["links"]:
                        target = state.get(link["target_id"])
                        if target and not self.k._visible(conn, p, domain, target):
                            raise CoreError("NOT_FOUND", "Comparison not available", 404)
                items.append(
                    {"concept_id": concept_id, "before": old, "after": change.get("concept")}
                )
            return {
                "proposal_id": ident,
                "base_version": proposal["base_version"],
                "published_version": d["published_version"],
                "comparison": "accepted_before_state" if commit else "current_published_state",
                "stale_base": not commit and proposal["base_version"] != d["published_version"],
                "items": items,
            }
