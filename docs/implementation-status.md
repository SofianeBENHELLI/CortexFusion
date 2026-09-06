# Implementation status

Updated: 2026-09-06

## Delivered development slice

The trusted-knowledge round trip is executable against PostgreSQL: register a source, submit a verbatim proposal, reject agent approval, approve as the owner, publish, retrieve a cited excerpt, replay, and compensate. Source permissions are rechecked before recording/returning answers, including when an access change occurs during retrieval.

The Python and TypeScript contract artifacts are generated and checked for drift. A per-session Cordis service adapter loads/disposes against the real framework package. It does not expose owner commands. The complete DeepSeek model/tool profile has not been integrated.

## Relationship to the coding plan

| Planned work | Current state |
|---|---|
| CF-001 — enterprise corpus/questions | Synthetic templates/examples only; actual corpus/domain and gold questions still needed |
| CF-002 — decisions | First slice decisions recorded, including explicit scope limitations |
| CF-003 — compatibility | PostgreSQL/AGE/vector transaction probe passed; Cordis lifecycle passed; complete harness profile untested |
| CF-004–007 — foundation/contracts/core boundaries | Locked workspaces, schemas, type generation, CI definition, configuration, and core service implemented |
| CF-008–009 — identity and tenancy | Actual database role/RLS and RS256/JWKS adapter implemented; real Keycloak login not yet exercised |
| CF-010–013 — objects/proposals/approval/journal | Verbatim-source subset implemented; full semantic risk engine and reviewer policies deferred |
| CF-014 — publication | JSONB concept/relationship projection is atomic; AGE/vector projection integration is not implemented |
| CF-015–016 — replay/compensation/demo | Implemented and demonstrated on synthetic PostgreSQL data |
| CF-017–022 — ingestion and learning | Minimal text-content import/proposal only; Docling, Temporal, model adapters, summaries and enterprise batch review remain open |
| CF-023–027 — retrieval/protocol/harness | Lexical extractive baseline, episodes, feedback, MCP, and Cordis service seam implemented; semantic answering and full harness execution remain open |
| CF-028–030 — product interface | Not started; interactive API documentation is a developer surface, not the product UI |
| CF-031–036 — consolidation/evaluation | Basic owner brief exists; scheduled consolidation, model evaluation, recovery packaging and enterprise benchmark remain open |

## Evidence

Run `make test` and `make demo-core` in the environment described in the development guide. Tests use actual PostgreSQL, not SQLite or an in-memory substitute. They include publication failure/retry, concurrent approvals, consistent reads during publication, in-flight permission revocation, immutable records, replay, compensation conflicts, wire examples and authenticated MCP calls.

The local storage compatibility probe is documented separately. The Compose definition has not been run on the original development machine because Docker was unavailable; the migration path was tested against fresh native PostgreSQL databases. GitHub CI is the independent Linux check when this branch is pushed.

## Next increment

1. Add durable file ingestion and document parsing behind the existing source/proposal boundary.
2. Connect a configured local or approved model endpoint to structured extraction and fidelity evaluation, using synthetic inputs first.
3. Introduce versioned embedding/graph projection adapters with the same publication tests.
4. Build the owner review and chat interface on the existing contracts.
5. Evaluate on a bounded set of enterprise documents and questions once supplied.

Do not mark these later stages complete based on the current extractive demo. Enterprise source files, expected answers, and processing destinations must be explicitly selected before real-corpus model processing.
