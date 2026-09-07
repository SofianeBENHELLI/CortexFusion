# Cortex Fusion

**Your company’s collective brain.**

Cortex Fusion is building a governed memory for people and AI companions. Its executable backend makes knowledge changes reviewable, keeps answers tied to their evidence, and exposes application functions through interchangeable HTTP/MCP contracts.

## What works now

- Python/FastAPI and PostgreSQL, with RS256 identity, domain roles and forced tenant RLS.
- Private collections, text imports, bounded PDF/DOCX/text parsing and a recoverable file worker.
- Verbatim proposals, owner review/approval, atomic publication, immutable journal, replay and compensation.
- Lexical extractive answers with citations, served versions, personal conversations and issue resolution.
- Exhaustive generated MCP tools, authenticated resources/prompts and signed confirmations for sensitive actions.
- Personal companion response receipts and explicit/observed/inferred feedback, opt-in collection and bounded effort summaries.
- Optional OpenRouter or local passage selection, durable model attempt outcomes and a shared daily call allowance.
- Generated JSON Schema/TypeScript/OpenAPI/MCP artifacts, PostgreSQL tests and a tested Cordis service adapter.

**This is a development backend.** Semantic retrieval/synthesis, enterprise evaluation, real external identity/companion validation and production orchestration remain open. No product frontend is included. Original confidential specifications and enterprise corpora remain local; no live OpenRouter validation is claimed.

## Run and verify

Follow the [development guide](docs/development.md) to configure Python, Node and an isolated PostgreSQL database. Then:

```sh
make setup
make migrate
make test
make demo-core
```

The synthetic demo registers a source, rejects agent approval, records owner approval, publishes a cited passage, rebuilds the state and compensates the change without erasing history. See also the [feedback evaluation](evals/README.md) and [local restore rehearsal](docs/restore-rehearsal.md).

For a persistent API, configure identity verification and run `make serve`. Interactive developer API documentation is available at `/docs` on the loopback server.

## Project navigation

| Guide | Purpose |
|---|---|
| [Implementation status](docs/implementation-status.md) | Delivered scope, evidence and remaining increments |
| [AI-native protocol](docs/ai-native.md) and [action reference](docs/interaction-reference.md) | Stable operation IDs, effects, schemas and host behavior |
| [Exhaustive MCP](docs/mcp-exhaustive.md) and [onboarding](docs/mcp-onboarding.md) | Tools, resources, prompts, identity discovery and confirmations |
| [Corpus API](docs/corpus-api.md) and [workspace backend](docs/backend-workspace.md) | Corpus manager, review, files, conversations and membership |
| [Companion responses](docs/companion-responses.md) and [feedback](docs/feedback-loop.md) | Delivered-answer receipts, provenance, opt-in collection and metrics |
| [OpenRouter](docs/openrouter.md), [local extraction](docs/local-extraction.md), [model attempts](docs/model-attempts.md) | Provider configuration, evidence bounds, attempts and limits |
| [Documentation index](docs/README.md) and [contributing](CONTRIBUTING.md) | Architecture, product scope and development conventions |

## Repository layout

```text
services/core/       Python knowledge core, HTTP/MCP, migrations and worker
packages/contracts/ Generated wire schemas, OpenAPI, interaction/MCP inventories
apps/harness/        TypeScript client and Cordis service adapter
scripts/             Contract generation, checks, synthetic demos/evaluation
infra/               Local PostgreSQL profile
tests/               PostgreSQL/API/MCP invariants and contract checks
apps/web/            Planned product interface
services/workflows/  Planned managed ingestion and consolidation
packages/agents/     Planned full model orchestration
evals/              Synthetic feedback scenarios and evaluation methodology
```

## Licensing

The repository license has not been selected. The dependency policy does not grant a license to Cortex Fusion. Installed dependency metadata is checked separately; see the [executable-core decision](docs/architecture/decisions/0001-executable-core.md).

A Python [reference MCP companion](docs/reference-companion.md) provides a bounded question → cited synthesis → personal receipt workflow without a frontend. Its optional live synthetic demo uses OpenRouter; semantic correctness and external identity-provider integration remain separate validation work.
