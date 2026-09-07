"""Bounded personal conversation read model with explicit child-page cursors."""

from .auth import CoreError
from .companion_responses import CompanionResponseService
from .contracts import ConversationTimeline, ConversationTurn, IssueView
from .conversations import ConversationService
from .service import one, run

SCAN_LIMIT = 100
PAYLOAD_LIMIT = 500000


class ConversationTimelineService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def _related(self, conn, p, domain, episode, table, limit, render, *, personal=True):
        # Table names are internal constants below, never request parameters.
        rows = (
            run(
                conn,
                f"SELECT * FROM {table} WHERE tenant_id=:tenant AND domain_id=:domain AND episode_id=:episode "
                + ("AND subject=:subject " if personal else "")
                + "ORDER BY id LIMIT :limit",
                **self.k.keys(p, domain),
                subject=p.subject,
                episode=episode["id"],
                limit=limit + 1,
            )
            .mappings()
            .all()
        )
        return {
            "items": [render(row) for row in rows[:limit]],
            "next_after": rows[limit - 1]["id"] if len(rows) > limit else None,
        }

    def read(
        self,
        p,
        domain,
        ident,
        limit,
        after,
        responses_limit,
        signals_limit,
        issues_limit,
        direction="forward",
    ):
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            # Access/membership writers acquire the conflicting domain FOR UPDATE lock.
            run(
                conn,
                "SELECT id FROM cf_domains WHERE tenant_id=:tenant AND id=:domain FOR KEY SHARE",
                **self.k.keys(p, domain),
            )
            if not one(
                conn,
                "SELECT subject FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.k.keys(p, domain),
                subject=p.subject,
            ):
                raise CoreError("NOT_FOUND", "Domain not found", 404)
            conversation = ConversationService.view(self.k._conversation(conn, p, domain, ident))
            rows = (
                run(
                    conn,
                    """SELECT m.sequence,m.episode_id FROM cf_conversation_episodes m
                JOIN cf_episodes e ON e.tenant_id=m.tenant_id AND e.domain_id=m.domain_id AND e.id=m.episode_id
                WHERE m.tenant_id=:tenant AND m.domain_id=:domain AND m.conversation_id=:ident
                AND e.subject=:subject """
                    + (
                        "AND (:after=0 OR m.sequence<:after) ORDER BY m.sequence DESC "
                        if direction == "backward"
                        else "AND m.sequence>:after ORDER BY m.sequence "
                    )
                    + "LIMIT :count",
                    **self.k.keys(p, domain),
                    ident=ident,
                    subject=p.subject,
                    after=after,
                    count=SCAN_LIMIT + 1,
                )
                .mappings()
                .all()
            )
            items, used, cursor, next_after, scan_limited = [], 8192, after, None, False
            for row in rows[:SCAN_LIMIT]:
                cursor = row["sequence"]
                try:
                    episode = self.k._episode(conn, p, domain, row["episode_id"])
                except CoreError as exc:
                    if exc.status == 404:
                        continue
                    raise
                if len(items) == limit:
                    next_after = items[-1].sequence
                    break

                def response_view(response, episode=episode):
                    refs = CompanionResponseService._references(episode, response["payload"])
                    return {
                        "id": response["id"],
                        "response": response["payload"],
                        "created_at": response["created_at"],
                        "reference_validation": "episode_references_checked"
                        if refs
                        else "no_references",
                    }

                def signal_view(signal, episode=episode):
                    return {
                        "id": signal["id"],
                        "episode_id": episode["id"],
                        "served_version": episode["served_version"],
                        "source_ids": episode["source_ids"],
                        "signal": signal["payload"],
                        "created_at": signal["created_at"],
                    }

                turn = ConversationTurn(
                    sequence=row["sequence"],
                    question=episode["question"],
                    result=episode["result"],
                    created_at=episode["created_at"],
                    responses=self._related(
                        conn,
                        p,
                        domain,
                        episode,
                        "cf_companion_responses",
                        responses_limit,
                        response_view,
                    ),
                    signals=self._related(
                        conn, p, domain, episode, "cf_feedback_signals", signals_limit, signal_view
                    ),
                    issues=self._related(
                        conn,
                        p,
                        domain,
                        episode,
                        "cf_issues",
                        issues_limit,
                        lambda issue: {key: issue[key] for key in IssueView.model_fields},
                        personal=False,
                    ),
                )
                size = len(turn.model_dump_json().encode())
                if used + size > PAYLOAD_LIMIT:
                    if not items:
                        raise CoreError(
                            "TIMELINE_ITEM_TOO_LARGE",
                            "Reduce child limits or read the episode and related pages separately",
                            422,
                        )
                    next_after = items[-1].sequence
                    break
                items.append(turn)
                used += size
            else:
                if len(rows) > SCAN_LIMIT:
                    next_after, scan_limited = cursor, True
            result = ConversationTimeline(
                conversation=conversation,
                items=items,
                next_after=next_after,
                scan_limited=scan_limited,
                direction=direction,
            )
            if len(result.model_dump_json().encode()) > PAYLOAD_LIMIT:
                raise CoreError(
                    "TIMELINE_ITEM_TOO_LARGE", "Use the separate episode and related pages", 422
                )
            return result
