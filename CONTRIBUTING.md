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

Follow `docs/development.md`, then run `make test` and `make demo-core` against an isolated PostgreSQL test database. Add meaningful checks for changed approval, isolation, provenance, replay, publication, or rollback behavior. For documentation-only edits, check links and `git diff --check`. Include actual commands, results, and unverified areas in the PR.

See [cross-component tests](tests/README.md) and [evaluations](evals/README.md) for their separate responsibilities.
