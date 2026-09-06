# 0001 — executable trusted-knowledge core

Date: 2026-09-06
Status: accepted for the first development slice

The repository needs an executable approval and publication boundary before introducing model-generated knowledge. This slice uses an independent Python service, a PostgreSQL journal and transactionally maintained JSON projections, HTTP/MCP adapters, and an isolated TypeScript/Cordis client.

## Decisions

- PostgreSQL is the accepted-change source of truth. The initial projection stores concepts and their typed relationships in JSONB. It is rebuilt from accepted changes; AGE and vector search remain later adapters.
- Prepared proposals contain verbatim source excerpts. Deterministic checks validate source positions and exact body fidelity, structural acyclicity, scope, and supported maturity. This does not implement the complete semantic risk engine or LLM fidelity evaluator.
- A domain admits one accepted but unpublished batch. Approval binds a content digest, expected version, authenticated owner, reason, and idempotency key. Publication advances all currently implemented projection state and its version in one transaction.
- Retrieval assembles context under Repeatable Read, then closes that snapshot. A separate short transaction validates current source permissions and records the immutable episode. This avoids foreign-key serialization failures caused by a publication changing the domain during retrieval. Access writers take a conflicting domain lock.
- Current answers are local, extractive, and explicitly labeled. There is no model, token-savings claim, semantic search, or automatic consolidation in this slice.
- RS256 identity validation supports a configured public key or HTTPS JWKS endpoint. Core membership records determine roles; client role claims do not. A real Keycloak login/deployment still needs integration verification.
- JSON Schema is the published wire artifact; Pydantic is its maintained source. CI rejects schema drift and regenerates TypeScript types. Domain invariants remain backend checks, not claims that structural schemas encode every rule.
- Use pg8000 (BSD) instead of psycopg (LGPL) to align the driver with the intended permissive dependency policy. Recognize MIT-0 and Python ecosystem permissive license metadata, and the existing intact-MPL exception for certifi. Repository licensing is still undecided.
- Cordis receives a per-session tenant/domain client with a token callback, request cancellation, and no approval/publication methods. This proves the service seam and lifecycle, not the full DeepSeek model loop or AG-UI profile.

## Evidence

The integration suite uses a real PostgreSQL instance and a non-owner, non-superuser application role. It checks unauthorized identities, tenant/source scope, stale decisions, concurrent approvals, failed publication rollback, source revocation during a query, deterministic replay, dependent rollback, and immutable history.

Python and Node validate the same wire examples. The Cordis lifecycle test uses the actual published framework package, including disposal-driven cancellation. A synthetic HTTP demonstration exercises import, agent rejection, owner approval, publication, cited retrieval, replay, and compensation.

## Limits

This is a development core, not the complete enterprise prototype. PDF/DOCX parsing, durable Temporal workers, model extraction/evaluation, full review policies, real enterprise corpus evaluation, full harness tooling, user-facing chat/review screens, and production operational readiness remain open. See the implementation status and development guide.
