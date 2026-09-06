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

**This is a development core.** It currently makes no model calls. Model extraction, semantic retrieval, durable workers, real enterprise evaluation, and the product chat/review interface are still planned. Original confidential specifications and enterprise corpora remain local.

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
