# Cortex Fusion

**Your company’s collective brain.**

Cortex Fusion is a planned enterprise knowledge platform that turns documents and expertise into a shared, governed memory for people and AI agents. It learns from qualified sources, preserves the history of knowledge, and makes gaps and uncertainty visible.

## Project status

**Specification and repository setup.** The v0.5 design is imported; application code, dependency installation, deployment, and performance validation have not started. “Enterprise Brain” is the former working name used in the preserved source documents.

## The brain analogy

- **Observe:** identify useful sources and gaps in company knowledge.
- **Learn:** propose sourced knowledge and submit it for appropriate review.
- **Remember:** preserve approved changes and their provenance.
- **Serve:** provide compact, current context to people and AI agents.
- **Consolidate:** improve the organization of knowledge over time.
- **Reflect:** surface uncertainty, contradictions, costs, and review needs.

Conversations produce proposals, not silent changes to trusted knowledge. An authenticated domain owner approves changes; agents do not hold approval credentials.

## Start here

1. [Documentation index](docs/README.md)
2. [Prototype scope and acceptance criteria](docs/product/prototype-scope.md)
3. [Architecture and component boundaries](docs/architecture/README.md)
4. [Development roadmap](docs/product/roadmap.md)
5. [Open decisions](docs/architecture/open-decisions.md)
6. [Contributing](CONTRIBUTING.md)

## Repository layout

```text
apps/web/             TypeScript interface: chat, review, knowledge map
apps/harness/         TypeScript agent runtime adapter
services/core/        Independent Python knowledge service and MCP boundary
services/workflows/   Python ingestion, evaluation, and consolidation jobs
packages/agents/      Python agent behavior behind project-owned contracts
packages/contracts/   Shared wire schemas and protocol examples
infra/                Local infrastructure and deployment configuration
tests/               Cross-component integration and isolation tests
evals/               Question banks, evaluation scenarios, benchmark reports
docs/                Product, architecture, decisions, and source specifications
```

Each component currently contains a responsibility guide only. Runtime and package configuration will be added with the first implementation slice.

## First implementation slice

Create one tenant and one domain, submit a sourced knowledge proposal, approve it as the owner, append the resulting change, materialize it, and retrieve the approved concept with its source and version. Demonstrate that an agent cannot approve its own proposal and that replay reconstructs the same state.

## Licensing

The project license has not been selected. The dependency license policy in the design does not grant a license to this repository. See [open decisions](docs/architecture/open-decisions.md).
