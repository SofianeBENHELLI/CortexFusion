# Contributing to Cortex Fusion

Start with the [prototype scope](docs/product/prototype-scope.md) and [architecture](docs/architecture/README.md). Work in focused branches and explain the user-visible result, affected contracts, and validation in each pull request.

## Working conventions

- Use Cortex Fusion in new product documentation; retain original source documents unchanged for traceability.
- Keep Python knowledge and workflow logic separate from the TypeScript harness and interface.
- Define shared wire contracts before coupling components.
- Record significant architectural changes and their evidence in `docs/architecture/decisions/`.
- Verify upstream identity, compatibility, and licenses before introducing dependencies; pin versions with the first runnable implementation.
- Keep secrets, customer corpora, production traces, and generated model assets out of Git.
- Do not select an open-source license for this project without an explicit product decision.

## Validation

There is no runnable application or application test suite yet. For documentation changes, check relative links, source preservation, and `git diff --check`. With implementation, add meaningful checks for approval authorization, tenant isolation, provenance, journal replay, consistent publication, and rollback. Include commands and results in the PR.

See [cross-component tests](tests/README.md) and [evaluations](evals/README.md) for their separate responsibilities.
