# Companion feedback loop

Feedback is personal evidence about an answer, not a command to change trusted knowledge. A companion can report it over HTTP or the generated MCP facade. The existing `feedback` compatibility tool and `/episodes/{episode}/feedback` remain available for their original feedback contract; new integrations should use the signal contract below and avoid sending the same vote through both interfaces.

## Origins and consent

| Origin | Accepted kinds | Meaning |
|---|---|---|
| `explicit` | `thumbs_up`, `thumbs_down`, `comment`, `resolved` | A deliberate user statement or gesture, reported by the companion |
| `observed` | `reformulation`, `correction`, `abandon`, `resolved` | Interaction events observed by the companion; collection requires opt-in |
| `inferred` | `satisfaction` | An estimate by the companion, with sentiment, confidence and explanation; separate opt-in required |

Both automatic origins default to disabled, independently for each user and domain. Read `api_feedback_preferences`, then let the user choose through a trusted host. `api_feedback_configure` requires a signed, single-use confirmation bound to the exact preference update, including `expected_revision`. Every member can configure their own preferences; owner status grants no access to another person's preferences. Direct HTTP clients must likewise send a preference change only on user intent. A stale revision returns `409 STALE_PREFERENCES`.

The backend validates the declared origin and field combinations. It cannot prove that a companion actually observed a human gesture, so the host must not label model guesses as explicit feedback. A confidence value is a declaration, not a calibrated probability. Silence is not positive feedback. Observed resolution is distinct from explicit resolution; neither certifies that the corpus is correct.

## Record and inspect

1. Discover identity/domains with `api_identity_read` and use an authorized domain.
2. Query through `api_knowledge_query` or `api_conversations_query`. Retain the returned `episode_id`, cited sources and served version.
3. Check preferences before emitting automatic signals; do not repeatedly request consent after a refusal.
4. Invoke `api_feedback_record_signal` with that episode and a stable idempotency key for the event.
5. Read `api_feedback_signals`, optionally filtered by `episode_id`, to inspect accepted receipts. Follow `next_after` for pagination.

Example MCP arguments for a deliberate negative vote:

```json
{
  "path": {"domain": "<authorized-domain-uuid>", "episode_id": "<returned-episode-uuid>"},
  "body": {
    "origin": "explicit",
    "kind": "thumbs_down",
    "comment": "This did not answer my question",
    "companion": "example-companion",
    "idempotency_key": "<unique-event-key>"
  }
}
```

An observed reformulation uses `origin: "observed"`, `kind: "reformulation"` and may include `iteration_index: 3`. This index is supplied by the companion, not a server-measured number of attempts needed to solve the task. An inferred signal uses `origin: "inferred"`, `kind: "satisfaction"`, a `sentiment` (`positive`, `negative`, `neutral`), finite `confidence` in `[0,1]` and a nonblank `comment` explaining the estimate. Confidence/sentiment are rejected for other origins. Comments are limited to 2,000 characters and companion names to 100.

Each immutable receipt identifies the episode, served version and source IDs. The episode remains the link to the response and any conversation message. Only the episode's author can record or read these signals, and current source permissions are rechecked. Even an owner cannot inspect another user's personal feedback. A source revocation hides the affected receipts and blocks new writes/retries against that episode.

Reusing the same key and payload returns the existing receipt. Reusing it for another payload or episode returns `409 IDEMPOTENCY_CONFLICT`. New automatic collection after opt-out returns `403 COLLECTION_DISABLED`. Opt-out does not erase history; an exact retry can still retrieve a prior receipt without collecting a new event. This increment does not implement retention or deletion workflows.

## From dissatisfaction to correction

An explicit `thumbs_down` appends one `disputed_answer` issue in the same transaction as the new signal. An exact retry creates no additional issue. Several genuinely separate votes can create separate issues. Other kinds, including negative model estimates, do not create issues automatically.

Use the personal issue lifecycle to investigate, resolve or dismiss the problem. Any resulting knowledge change follows the existing source → proposal → owner review → publication path. Resolution alone never edits or publishes knowledge. Shared team triage, automatic diagnosis, calibrated satisfaction scoring and evaluation of whether a correction improved future answers remain separate work.

## Verification

PostgreSQL/API tests cover opt-in, opt-out, invalid provenance, confidence requirements, immutable storage, idempotency, source revocation, personal scope, and no automatic publication. MCP tests cover confirmed preference changes by a viewer and rejection of identity-mismatched confirmations. These tests use synthetic inputs and no model provider.
