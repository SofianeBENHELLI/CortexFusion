"""Bounded personal event counts, preserving provenance and current evidence visibility."""

from datetime import UTC, datetime, timedelta

from .auth import CoreError
from .service import encoded, run

MAX_SIGNALS = 10000
INTERPRETATION = (
    "Counts describe accepted signal events, not unique opinions or calibrated satisfaction. "
    "Iteration indices are companion declarations, not measured attempts to solve a task. "
    "No signal does not imply satisfaction. Legacy feedback is excluded."
)


class FeedbackMetricsService:
    def __init__(self, knowledge):
        self.k, self.db = knowledge, knowledge.db

    def summary(self, p, domain, since=None, until=None, conversation_id=None):
        end = until or datetime.now(UTC)
        start = since or end - timedelta(days=30)
        if (
            start.tzinfo is None
            or end.tzinfo is None
            or not timedelta(0) < end - start <= timedelta(days=31)
        ):
            raise CoreError(
                "INVALID_WINDOW", "Use an aware, increasing time window of at most 31 days", 422
            )
        with self.db.transaction(p, domain) as conn:
            if conversation_id:
                self.k._conversation(conn, p, domain, conversation_id)
            # Filter before limiting so inaccessible evidence cannot affect the result or cap.
            # This is the same source reader predicate as KnowledgeService._source.
            rows = (
                run(
                    conn,
                    """SELECT s.episode_id,s.origin,s.kind,s.payload
                FROM cf_feedback_signals s JOIN cf_episodes e
                ON e.tenant_id=s.tenant_id AND e.domain_id=s.domain_id AND e.id=s.episode_id
                WHERE s.tenant_id=:tenant AND s.domain_id=:domain
                AND s.subject=:subject AND e.subject=:subject
                AND s.created_at>=:start AND s.created_at<:end
                AND (:conversation='' OR EXISTS (
                    SELECT 1 FROM cf_conversation_episodes m
                    WHERE m.tenant_id=s.tenant_id AND m.domain_id=s.domain_id
                    AND m.episode_id=s.episode_id AND m.conversation_id=:conversation))
                AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(e.source_ids) refs(id)
                    LEFT JOIN cf_sources src ON src.tenant_id=s.tenant_id
                    AND src.domain_id=s.domain_id AND src.id=refs.id
                    WHERE src.id IS NULL OR NOT (src.allowed_subjects @> CAST(:readers AS jsonb)))
                ORDER BY s.created_at,s.id LIMIT :cap""",
                    **self.k.keys(p, domain),
                    subject=p.subject,
                    start=start,
                    end=end,
                    conversation=conversation_id or "",
                    readers=encoded([p.subject]),
                    cap=MAX_SIGNALS + 1,
                )
                .mappings()
                .all()
            )
            if len(rows) > MAX_SIGNALS:
                raise CoreError(
                    "SUMMARY_TOO_LARGE",
                    "Narrow the time window or select a conversation; no partial summary was returned",
                    413,
                )
            explicit = dict.fromkeys(("thumbs_up", "thumbs_down", "comment", "resolved"), 0)
            observed = dict.fromkeys(("reformulation", "correction", "abandon", "resolved"), 0)
            inferred = dict.fromkeys(("positive", "negative", "neutral"), 0)
            iterations, episodes, up, down = [], set(), set(), set()
            for row in rows:
                episodes.add(row["episode_id"])
                if row["origin"] == "explicit":
                    explicit[row["kind"]] += 1
                    if row["kind"] == "thumbs_up":
                        up.add(row["episode_id"])
                    elif row["kind"] == "thumbs_down":
                        down.add(row["episode_id"])
                elif row["origin"] == "observed":
                    observed[row["kind"]] += 1
                    if row["payload"]["iteration_index"] is not None:
                        iterations.append(row["payload"]["iteration_index"])
                else:
                    inferred[row["payload"]["sentiment"]] += 1
            return {
                "window_start": start,
                "window_end": end,
                "conversation_id": conversation_id,
                "signal_count": len(rows),
                "episode_count": len(episodes),
                "conflicting_explicit_episodes": len(up & down),
                "explicit": explicit,
                "observed": {
                    **observed,
                    "iteration_index_samples": len(iterations),
                    "maximum_declared_iteration": max(iterations) if iterations else None,
                },
                "inferred": inferred,
                "legacy_feedback_included": False,
                "interpretation": INTERPRETATION,
            }
