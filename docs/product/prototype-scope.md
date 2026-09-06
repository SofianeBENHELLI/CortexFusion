# Prototype scope

Status: proposed implementation baseline, derived from v0.5 notes 12, 13, and 16. This is a plan, not a claim of implemented functionality.

## Outcome

Demonstrate one real knowledge domain for one tenant: ingest an authorized corpus, propose knowledge, review it, answer with sources, and report gaps and cost. Establish the governance boundary before connecting a model or harness.

## Included

- Tenant and domain identity, one accountable domain owner.
- Concepts, relations, source documents, episodes, issues, proposals, and an append-only change journal.
- Provenance, a materialized domain state, version identifiers, and replay.
- File ingestion, extraction, summaries, fidelity checks, and embeddings.
- Owner review of batches and incremental publication after approval.
- Sourced answers with maturity, missing-information markers, and served domain version.
- MCP query and feedback contracts; minimal inspection, proposal, and owner approval boundaries needed for the flow.
- A reference chat, owner review, simple consolidation, and a morning brief.
- Commit rollback through a compensating change, evaluation fixtures, token and latency measurements.

## Deferred

Voice, avatars, interview campaigns, continuous observation, 3D maps, federation, A2A, general time travel, automatic approval, dedicated deployment, and production multi-tenant operations. Candidate release switching and broader rollback mechanisms belong to the pilot.

Tenant isolation and the distinction between reading, proposing, and approving must exist from the first slice even with one tenant. Fine-grained authorization may expand later; unauthorized source content must never become generally visible through a summary or retrieval result.

## Acceptance criteria

| Scenario | Evidence required |
|---|---|
| Knowledge enters the system | Source identity and provenance survive extraction and publication |
| A proposal becomes trusted | Only the authenticated owner approval path produces an accepted change |
| An agent tries to approve | The request is rejected and trusted state is unchanged |
| An answer is generated | It includes sources, maturity, and the domain version used |
| Knowledge is missing | The system signals uncertainty and records an actionable gap |
| The journal is replayed | The same trusted state is reconstructed |
| An approved change is reverted | A compensating change restores intended behavior without deleting history |
| A different tenant requests data | The request cannot expose the original tenant’s content |
| Summaries are served | Fidelity checks have passed before publication |
| Freshness and cost are measured | Report approval-to-visibility latency, answer latency, and tokens per episode |

The source design targets visibility within 60 seconds of approval and an answer within 5 seconds. Treat these as targets to measure on a documented corpus and environment, not existing guarantees. Compare answer quality and token use with the design partner’s baseline when available.

## First slice: approved knowledge round trip

1. Define wire contracts and a minimal domain schema.
2. Implement the journal, materialization, and replay in the independent core.
3. Add proposal and owner approval paths with identity enforcement.
4. Retrieve an approved concept with provenance and version.
5. Verify rejection, isolation, replay, and rollback before adding ingestion or model calls.

Use synthetic fixtures until a corpus is authorized. Do not commit customer documents, credentials, or production traces.
