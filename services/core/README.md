# Knowledge core

Independent Python service with PostgreSQL persistence, signed identity validation, tenant/source access checks, verbatim proposals, owner approval, journal/outbox, atomic JSONB publication, replay, compensation, local excerpt retrieval, feedback, HTTP and MCP.

Run from the repository root using the [development guide](../../docs/development.md). The application role must not own tables or bypass row security. Migrations and tenant/domain bootstrap use a separate administrative identity.

The current implementation makes no model calls. See [status](../../docs/implementation-status.md) for the exact delivered subset and remaining work.
