from uuid import uuid4

from .auth import CoreError
from .service import digest, one, run
from .workspace import WorkspaceService


class ConversationService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    @staticmethod
    def view(row):
        return {k: row[k] for k in ("id", "title", "archived", "revision", "created_at")}

    def create(self, p, domain, data):
        with self.db.transaction(p, domain) as conn:
            self.k._domain(conn, p, domain, lock=True)
            h = digest(data.model_dump(mode="json"))
            old = one(
                conn,
                "SELECT * FROM cf_conversations WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.k.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if old:
                if old["request_hash"] != h:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Conversation key reused")
                return self.view(old)
            ident = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_conversations(tenant_id,domain_id,id,author,title,idempotency_key,request_hash)
                VALUES(:tenant,:domain,:id,:author,:title,:key,:hash)""",
                **self.k.keys(p, domain),
                id=ident,
                author=p.subject,
                title=data.title,
                key=data.idempotency_key,
                hash=h,
            )
            return self.view(self.k._conversation(conn, p, domain, ident))

    def listing(self, p, domain, limit, after, archived):
        with self.db.transaction(p, domain) as conn:
            return WorkspaceService(self.k)._page(
                conn,
                p,
                domain,
                "cf_conversations",
                limit,
                after,
                lambda row: None,
                self.view,
                "AND author=:author AND archived=:archived",
                {"author": p.subject, "archived": archived},
            )

    def update(self, p, domain, ident, data):
        with self.db.transaction(p, domain) as conn:
            row = self.k._conversation(conn, p, domain, ident, lock=True)
            if row["revision"] != data.expected_revision:
                raise CoreError("STALE_CONVERSATION", "Refresh conversation metadata")
            run(
                conn,
                "UPDATE cf_conversations SET title=:title,archived=:archived,revision=revision+1 WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.k.keys(p, domain),
                id=ident,
                title=data.title,
                archived=data.archived,
            )
            return self.view(self.k._conversation(conn, p, domain, ident))

    def detail(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self.view(self.k._conversation(conn, p, domain, ident))

    def messages(self, p, domain, ident, limit, after):
        with self.db.transaction(p, domain) as conn:
            self.k._conversation(conn, p, domain, ident)
            cursor, visible = after, []
            while len(visible) <= limit:
                rows = (
                    run(
                        conn,
                        """SELECT m.sequence,e.* FROM cf_conversation_episodes m JOIN cf_episodes e
                    ON e.tenant_id=m.tenant_id AND e.domain_id=m.domain_id AND e.id=m.episode_id
                    WHERE m.tenant_id=:tenant AND m.domain_id=:domain AND m.conversation_id=:id
                    AND e.subject=:author AND m.sequence>:after ORDER BY m.sequence LIMIT 100""",
                        **self.k.keys(p, domain),
                        id=ident,
                        author=p.subject,
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
                        self.k._episode(conn, p, domain, row["id"])
                    except CoreError as exc:
                        if exc.status == 404:
                            continue
                        raise
                    visible.append(
                        {k: row[k] for k in ("sequence", "question", "result", "created_at")}
                    )
                    if len(visible) > limit:
                        break
                if len(rows) < 100:
                    break
            return {
                "items": visible[:limit],
                "next_after": visible[limit - 1]["sequence"] if len(visible) > limit else None,
            }
