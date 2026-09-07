# Cortex Fusion

**Your company’s collective brain.**

Cortex Fusion is building a shared, governed memory for people and AI agents. The first executable slice establishes how knowledge becomes trusted, how answers retain their sources, and how changes can be reversed.

## What works now

- Independent Python/FastAPI service backed by PostgreSQL.
- Signed RS256 identity validation and tenant/domain membership checks.
- Versioned text sources with explicit reader permissions.
- Verbatim knowledge proposals, owner-only approval, immutable journal, and atomic publication.
- Structural relationship validation, deterministic replay, and compensating changes with conflict checks.
- Local lexical retrieval with exact excerpts, citations, served versions, episodes, and feedback.
- MCP query/inspection/proposal/feedback tools without approval authority.
- Generated JSON Schema/TypeScript contracts and a tested Cordis service adapter.

**This is a development core.** Answering is extractive. Private file parsing, a recoverable parser worker, review, conversations and membership APIs are implemented. An opt-in OpenRouter or local model can select an exact source passage for owner review. Semantic retrieval/synthesis, production orchestration, enterprise evaluation and the product interface remain unfinished. Original confidential specifications and enterprise corpora remain local.

## Run and verify

Follow the [development guide](docs/development.md) to configure Python, Node, and an isolated PostgreSQL database. Then:

```sh
make setup
make migrate
make test
make demo-core
```

The synthetic demo imports a source, demonstrates that an agent cannot approve it, records owner approval, publishes it, returns its cited passage, rebuilds the state, and compensates the change without erasing history.

For a persistent API, configure your identity provider/public key and run `make serve`. Interactive API documentation is available at `/docs` on the loopback server.

## Project navigation

- [Implementation status and next increment](docs/implementation-status.md)
- [Architecture decision for the executable core](docs/architecture/decisions/0001-executable-core.md)
- [Compatibility evidence](docs/architecture/compatibility-evidence.md)
- [Prototype scope](docs/product/prototype-scope.md) and [roadmap](docs/product/roadmap.md)
- [Documentation index](docs/README.md) and [contributing](CONTRIBUTING.md)

## Repository layout

```text
services/core/       Executable Python knowledge core, API, MCP, migrations
packages/contracts/ Wire schemas, shared examples, generated TypeScript
apps/harness/        TypeScript client and Cordis service adapter
scripts/             Contract generation, license metadata gate, synthetic demo
infra/               Local PostgreSQL profile
tests/               PostgreSQL/API invariants and contract checks
apps/web/            Planned product interface
services/workflows/  Planned durable ingestion and consolidation
packages/agents/     Planned model-driven behavior
evals/               Evaluation methodology; enterprise data stays private
```

## Licensing

The repository license has not been selected. The dependency policy does not grant a license to Cortex Fusion. Installed dependency metadata is checked separately; see the [architecture decision](docs/architecture/decisions/0001-executable-core.md).

The [corpus API](docs/corpus-api.md) now provides private collections, source listing and resumable text import receipts, with a dedicated corpus-manager role.

The [workspace backend](docs/backend-workspace.md) adds review decisions, private file parsing, recoverable workers, personal conversations and scoped membership administration.

See [OpenRouter configuration](docs/openrouter.md) for the preferred provider. See [optional local extraction](docs/local-extraction.md) for configuration, source boundaries and the synthetic live-model demonstration.

## Interface and agent contracts

See [AI-native interaction protocol](docs/ai-native.md) and the [generated action reference](docs/interaction-reference.md). OpenAPI, the interaction inventory and MCP tool schemas are exported under `packages/contracts/` and checked by CI. The backend exposes all 61 HTTP operations as generated MCP tools, plus 16 compatibility tools (77 total). Privileged commands require a single-use trusted-host signed confirmation as well as the same service permissions as HTTP. See [exhaustive MCP](docs/mcp-exhaustive.md) for setup and the transport contract. No product frontend or complete model orchestration loop is included.
