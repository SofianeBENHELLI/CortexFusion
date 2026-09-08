# Verification

The Python suite requires explicit `CORTEX_TEST_ADMIN_URL` and `CORTEX_TEST_DATABASE_URL` values pointing to a PostgreSQL database ending in `_test`. Run migrations first. Tests create independent synthetic tenants, use a real restricted application role, and do not truncate the database.

Coverage includes identity/roles, tenant/source access, provenance, structural constraints, idempotency, stale and concurrent approval, failed publication/retry, consistent reads, in-flight access revocation, replay, compensation, append-only history, feedback, MCP, and schema drift.

Node tests validate shared wire examples, the TypeScript client boundary, and the actual Cordis service lifecycle. `make test` runs all checks, including dependency license metadata; `make demo-core` exercises the synthetic HTTP round trip. See the [development guide](../docs/development.md).
