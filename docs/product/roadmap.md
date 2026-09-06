# Development roadmap

Status: planned. Timing in the original dossier is a hypothesis; the milestones below track outcomes rather than promise dates.

| Milestone | Deliverable | Completion evidence |
|---|---|---|
| Repository foundation | Source dossier, architecture boundaries, prototype scope | Scaffold published; original source import pending approval |
| Core round trip | Tenant, domain, source, concept, proposal, owner approval, journal, materialization | Sourced retrieval, replay, isolation, rejected agent approval, compensating rollback |
| Ingestion and learning | File parsing, extraction, relations, faithful summaries, embeddings | A representative corpus produces reviewable, sourced proposals |
| Answer runtime | Budgeted retrieval, answers, episodes, feedback, gaps | Question-bank results with sources and domain version |
| Owner experience | Batch review, fast publication, reference chat | Measured approval-to-visibility delay and usable review flow |
| Consolidation and reporting | Simple consolidation, morning brief, cost instrumentation | Repeatable end-to-end demonstration and measurement report |
| Pilot | Candidate releases, broader rollback, observation, additional domains | Evidence from two or three design partners |
| Launch | Production operations, permissions, selected later capabilities | Readiness established by measured pilot results |

## Before installing the stack

- Identify exact upstream repositories, versions, licenses, and supported integration paths.
- Resolve the [open decisions](../architecture/open-decisions.md), especially persistence and harness compatibility.
- Establish a small representative question bank and an authorized or synthetic corpus.
- Keep bounded technology experiments separate from the prototype delivery path.

For the full historical workstreams and backlog, see the original plan (source import pending) and feature backlog (source import pending). A P0 label alone does not expand the bounded prototype scope when documents conflict; record the scope decision explicitly.
