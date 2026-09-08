# Companion response receipts

A Cortex query returns approved excerpts, citations and a personal episode. An external LLM may then write the response the user actually sees. To distinguish feedback on that final response from feedback on retrieval alone, a host can retain an immutable personal response receipt.

This is optional conversation history. It does not call a model, import trusted knowledge, approve a proposal or publish anything. The host should store the delivered response when retaining history is part of the user's workflow, and must treat stored answer text as untrusted content on later reads.

## API and MCP flow

1. Query Cortex and retain `episode_id`, `served_version` and citations.
2. Generate/deliver the companion response in the host's selected LLM environment.
3. Call `POST /v1/domains/{domain}/episodes/{episode_id}/companion-responses` or `api_responses_create` with a stable response key.
4. Retain the returned response `id`. Send it as `companion_response_id` in `api_feedback_record_signal` when feedback concerns that exact response.
5. Inspect through `api_responses_read` or `api_responses_list`, optionally filtered by `episode_id`. For metrics on one response, pass `companion_response_id` to `api_feedback_summary`.

Example tool arguments:

```json
{
  "path": {"domain": "<authorized-domain-uuid>", "episode_id": "<returned-episode-uuid>"},
  "body": {
    "answer_text": "Escalate the incident to the operations team, according to the cited procedure.",
    "answer_kind": "answer",
    "citations": [{"source_id": "<returned-source-uuid>", "start": 0, "end": 52}],
    "companion": "example-companion",
    "model": "example/model",
    "idempotency_key": "<unique-response-key>"
  }
}
```

Use the actual source offsets returned by the episode, not the illustrative numbers above. Offsets are Unicode code points. References must match an episode citation exactly; arbitrary source IDs or altered spans return `422 UNSUPPORTED_RESPONSE_REFERENCE`, even if the caller can read that source independently.

## Meaning and limits

`answer_kind` is `answer`, `abstention` or `clarification`. An answer requires at least one citation. Abstention or clarification may have no references. Text must be nonblank and at most 12,000 characters; at most 50 unique references are accepted. Companion and model identifiers are declarations by the host, not provider attestations.

A receipt includes the historical served version, full selected episode citations and `reference_validation: "episode_references_checked"` (or `no_references`). It always reports `semantic_validation: "not_performed"`. Correct references do not prove that a generated claim is entailed by them. A response classified as an answer is not a canonical concept or a certified fact.

Only the episode author can create/read these receipts. Current access to all episode sources is rechecked, including if the receipt cites only a subset. Revocation hides the affected response and blocks new feedback referring to it. Owners cannot inspect other users' personal responses. Idempotent repeats return the original receipt; changing the text, references or episode under the same key returns a conflict.

Multiple responses may refer to one retrieval episode. They remain separate immutable records; there is no automatic replacement or final-answer designation. Existing conversation message endpoints retain the original retrieval results; use the response list filtered by episode to obtain companion output. No retention/deletion policy is implemented in this increment.

Feedback without `companion_response_id` still concerns the retrieval episode. The optional association must belong to the same episode and caller, and the old signal fingerprint is preserved when absent. Negative-vote issues remain episode-linked; inspect that episode's feedback signals to find any precise response association. Domain metrics count events; an episode with both positive and negative votes may involve different response variants. Filter by response for a precise comparison.

Tests cover immutable receipts, idempotency, unsupported references, personal scope, revocation, abstention, unchanged canonical knowledge, precise feedback/summary association, older signal fingerprints, and MCP create/read calls with synthetic content.
