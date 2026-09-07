# Implementation status

Updated: 2026-09-08

## Delivered backend

The PostgreSQL backend supports private sources and collections, persistent text-import batches, bounded text/PDF/DOCX file parsing and a recoverable file worker. corpus_manager can import and propose, while owner approval and publication remain separate. Sources can be followed through accessible proposals with a source filter; an imported source is not automatically served knowledge. See [corpus API](corpus-api.md) and [workspace backend](backend-workspace.md).

Source-backed concepts and relations support proposals, review/revision/diff, owner acceptance, atomic publication, replay and compensation. Targeted publication safely reuses an already-published target without advancing another accepted change. Successful publication has a separate immutable publisher/time record from migration 0018; historical gaps stay explicit in the commit journal. The published projection is JSONB and retrieval is lexical/extractive. RS256/JWKS identity, domain roles, tenant RLS and current evidence permissions apply. Personal conversations, companion responses, feedback, issue decisions and membership history retain their own visibility boundaries. A personal issue decision can explicitly reference a correction proposal; linked resolution requires its publication and records the historical version.

All HTTP operations have generated MCP equivalents plus 16 compatibility tools. Authenticated resources and workflow prompts support discovery and preparation. Sensitive commands require single-use signed trusted-host confirmations in MCP and by default in direct HTTP; trusted_host HTTP compatibility must be explicit. Optional HTTPS protected-resource metadata advertises the configured external issuer. External companion login has not yet been validated. See [AI-native contract](ai-native.md) and [MCP onboarding](mcp-onboarding.md).

The [French frontend guide](frontend-guide.fr.md) and [exhaustive endpoint reference](frontend-api.fr.md) describe user/admin/corpus functions, inputs, permissions, effects, errors and recovery. Exact browser origins can be configured for CORS. Conversation queries offer started/result/error SSE progress while preserving JSON/MCP and idempotency. A bounded personal timeline joins episodes, response receipts, signals and issues with forward/backward and child pagination. These events do not stream LLM tokens.

Optional owner-scoped OpenRouter or local passage selection creates unapproved proposals with exact-span validation and durable model attempt outcomes. Explicitly enabled [backend synthesis](backend-synthesis-design.fr.md) instead serves an existing personal episode through a fresh OpenRouter adapter per attempt. It reserves before calling, shares the domain daily attempt allowance with extraction, never replays an uncertain key and records response/outcome atomically. No-evidence episodes receive deterministic abstention without a paid call. Private lookup supports recovery after lost delivery; stored success does not prove display, reading or satisfaction. Provider usage is not an invoice and citations do not certify semantic truth.

The [reference MCP companion](reference-companion.md) remains a separate client with a durable private journal, bounded synthesis and feedback support. Explicit, observed and inferred [feedback](feedback-loop.md) preserve provenance; observed/inferred collection requires opt-in. Negative votes can open personal issues; feedback never publishes knowledge. Summary windows can target conversations and precise response receipts. Shared team triage and calibrated satisfaction inference remain open.

`/health` is process liveness. `/ready` checks the database revision, required tables, role restrictions and RLS flags through a dedicated time-bounded connection. It does not test a model provider or certify the content of RLS policies. Run migrations before serving traffic.

The Python/TypeScript contracts and French descriptions are checked for drift. A per-session Cordis service adapter was exercised with the real framework; the full DeepSeek tool profile and autonomous harness loop are not integrated. Enterprise IdP onboarding, semantic/vector retrieval, separate short/long-term memory tiers, daily scheduled consolidation and production operations remain unfinished.

Live synthetic DeepSeek V4 Flash passage selection, cited synthesis and inferred feedback succeeded in earlier bounded demonstrations. The [synthesis evaluation](../evals/README.md) first met 4/6 lexical scenarios; a versioned v2 prompt met 2/2 separate targeted cases. An ambiguous-comment assessment exceeded its predeclared confidence threshold. These observations do not establish production semantic quality or calibrated satisfaction. New backend transport/workflow tests use simulated providers.

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
| CF-017–022 — ingestion and learning | Collections, paginated source listing and persistent text import receipts implemented; bounded PDF/DOCX parsing and a file worker added; optional OpenRouter/local quote selection added; Docling, Temporal and canonical summaries remain open |
| CF-023–027 — retrieval/protocol/harness | Lexical retrieval, episodes, feedback, exhaustive MCP, Cordis seam, durable backend synthesis and a cited-synthesis reference companion implemented; semantic retrieval and full autonomous harness execution remain open |
| CF-028–030 — product interface | Frontend developed separately by the user; French functional contracts, CORS, SSE query progress and timeline are delivered here |
| CF-031–036 — consolidation/evaluation | Owner brief, synthetic feedback/synthesis evaluation and local restore rehearsal implemented; scheduled consolidation, production recovery and enterprise benchmark remain open |

A [local restore rehearsal](restore-rehearsal.md) matched 29 tables and RLS policies in an isolated database and passed the synthetic governed-knowledge demonstration afterward. This does not establish production disaster recovery.

## Evidence

Run `make test` and `make demo-core` in the environment described in the development guide. Database/API tests use actual PostgreSQL. The companion also has local SQLite journal tests and mocked-provider tests. They include publication failure/retry, concurrent approvals, consistent reads during publication, in-flight permission revocation, immutable records, replay, compensation conflicts, wire examples and authenticated MCP calls.

The local storage compatibility probe is documented separately. The Compose definition has not been run on the original development machine because Docker was unavailable; the migration path was tested against fresh native PostgreSQL databases. GitHub CI is the independent Linux check when this branch is pushed.

## Next increment

1. Extend baseline binary parsing with logical document versions, semantic segmentation, layout fidelity and production worker orchestration.
2. Extend extraction fidelity and synthesis evaluation with annotated cases and held-out inputs; preserve recorded failures and calibrate inferred satisfaction before using confidence thresholds operationally.
3. Introduce versioned embedding/graph projection adapters with the same publication tests.
4. Validate an external identity provider and companion against the existing MCP contracts. The product frontend is being developed separately.
5. Evaluate on a bounded set of enterprise documents and questions once supplied.

Do not mark these later stages complete based on the current extractive demo. Enterprise source files, expected answers, and processing destinations must be explicitly selected before real-corpus model processing.
