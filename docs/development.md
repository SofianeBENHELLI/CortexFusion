# Run the executable development core

The backend is an authenticated PostgreSQL-backed API with exhaustive MCP access. It supports private corpus ingestion, governed verbatim knowledge, cited extractive answers, personal conversations, companion response receipts, provenance-aware feedback and reversible publication. Optional OpenRouter/local passage extraction is configured separately. No enterprise corpus or model credentials are bundled.

## Prerequisites

- Python 3.12 or 3.13 and `uv` 0.12.10.
- Node 24 and pnpm 10.15.1.
- PostgreSQL 17.11, supplied by Docker Compose or an existing local installation.

Run commands from the repository root. Source and evaluation data must stay outside the public checkout. The source specification documents remain local and are not needed to run the synthetic demonstration.

## Standard local setup

1. Copy `.env.example` to `.env`. Replace both password placeholders with distinct local passwords and use their URL-encoded values in the corresponding database URLs.
2. Export the configured environment in your terminal. With shell-safe values in `.env`, use `set -a; . ./.env; set +a`. Do not put shell commands in the environment file.
3. Run `make setup`, then `make dev-up`.
4. Wait for the database health check, then run `make migrate`.
5. Run `make test` and `make demo-core`.

The Compose profile binds only to loopback and uses an application role distinct from the migration user. Changing passwords in `.env` does not rotate existing database roles after a volume has already initialized. Keep the existing credentials or rotate them deliberately; do not delete a data volume as a routine troubleshooting step.

The Docker definition is provided for reproducibility; this development session exercised the same migration and API against a locally compiled PostgreSQL server because Docker was unavailable. CI provides a separate clean Linux/PostgreSQL check.

## Existing PostgreSQL

Provision a dedicated database ending in `_test` and a login named `cortex_app` with `NOSUPERUSER NOBYPASSRLS`. Run migrations with a separate administrator/migration identity; the API must not own the tables. Set:

```text
CORTEX_MIGRATION_DATABASE_URL=postgresql+pg8000://MIGRATION_USER:PASSWORD@127.0.0.1:5432/cortex_test
CORTEX_TEST_ADMIN_URL=<the same isolated test database, administrative identity>
CORTEX_TEST_DATABASE_URL=postgresql+pg8000://cortex_app:PASSWORD@127.0.0.1:5432/cortex_test
```

`make migrate`, `make test`, and `make demo-core` then work without Docker. On macOS, a private Unix socket can be configured with the `unix_sock` URL parameter pointing at the full `.s.PGSQL.PORT` file.

The demo generates ephemeral signing keys and synthetic tenants. It sends actual HTTP requests through the application's ASGI boundary against the real database. It verifies the agent receives 403 for approval, an approved but unpublished concept is absent from answers, publication makes its exact passage available, replay is stable, and compensation advances history without deleting the journal. It does not start a persistent web server.

## Run the API

Set `CORTEX_DATABASE_URL` to the restricted application URL, `CORTEX_JWT_ISSUER` and `CORTEX_JWT_AUDIENCE`, plus exactly one of `CORTEX_JWKS_URL` or `CORTEX_JWT_PUBLIC_KEY_FILE`. Public-key mode accepts RS256 only; the private key is held outside the service. The JWKS URL must use HTTPS. Missing identity configuration prevents startup.

Sensitive HTTP commands require a trusted-host confirmation by default. Configure `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE`; the signing key stays in the confirming host. Missing confirmation returns 428. `CORTEX_HTTP_CONFIRMATION_MODE=trusted_host` is an explicit compatibility mode for a controlled backend host and never relaxes MCP. The bundled synthetic demos select this mode explicitly; production browser integrations should retain `required`. See the [French integration guide](frontend-guide.fr.md).

Use `uv run cortex bootstrap --tenant <UUID> --domain <UUID> --owner <issuer-subject> --member <subject>:agent --member <subject>:viewer` with migration credentials to establish a domain. The command only inserts missing records; it does not silently replace an existing owner or membership role.

Run `make serve`. The loopback API is at `http://127.0.0.1:8000`, with interactive API documentation at `/docs` and an OpenAPI schema at `/openapi.json`.

Send `Authorization: Bearer <valid token>` and `X-Tenant-ID: <tenant UUID>` on protected requests. Do not put tokens in URLs. An identity subject must also have membership in the requested domain. The JWT's role field is ignored for application authorization.

## Browser origins

Set `CORTEX_CORS_ORIGINS` to an exact JSON array, such as `["http://localhost:5173"]`. No trailing slash, wildcard, embedded credentials or remote cleartext origins are accepted. Empty disables CORS. When configured, requests with other Origin values are rejected before business execution; server clients without Origin still authenticate normally. Allowed preflights need no token; actual requests retain bearer, tenant and confirmation checks. Cookie credentials are not enabled. Download and MCP session headers are exposed. This does not expand the MCP server host allowlist; configure the public resource separately. See the [French guide](frontend-guide.fr.md).

## Knowledge flow

1. Owner: `POST /v1/domains/{domain}/sources` with a title, original location, text content, and allowed subjects. The uploader must have access, and all readers must be domain members.
2. Agent/contributor/owner: `POST /sources/{source}/propose` with an `Idempotency-Key` header, or submit an explicit typed change batch to `/proposals`.
3. Owner: inspect `/proposals/{id}` and its source evidence, then `POST /proposals/{id}/approve` with the exact digest, base version, reason, and a new idempotency key.
4. Owner: `POST /publish`. This applies accepted changes only; it does not approve new ones. A production worker for this step is not implemented yet.
5. Domain member: `POST /query` with a question. The result is exact excerpt retrieval, explicitly `mode: extractive` and `processing: local_no_model`.
6. Caller: optionally retain the delivered companion response, then submit provenance-aware feedback to `/episodes/{id}/signals`, with `companion_response_id` when applicable. Automatic observations/estimates require personal opt-in. The legacy `/episodes/{id}/feedback` remains compatible. Owner: inspect `/brief` for authorized pending proposals and issues from their own episodes.
7. Owner: create a compensation proposal at `/commits/{sequence}/compensate`, review/approve it, and publish. Conflicting later changes require a revised proposal.

Use `/version` to distinguish accepted and published positions. `POST /replay` rebuilds the current published projection transactionally from the journal. Repeated model execution is not involved. Source access updates at `/sources/{id}/access` immediately affect subsequent authorized reads, including historical episodes.

## MCP and the harness seam

MCP Streamable HTTP is mounted at `/mcp/`. Clients send the same bearer and tenant headers. Every OpenAPI operation has a generated `api_*` tool, alongside 16 compatibility tools. Sensitive actions, including approval/publication, require both service permissions and a signed single-use trusted-host confirmation. See [the exhaustive contract](mcp-exhaustive.md).

Authenticated resources/prompts guide companion onboarding. Optional HTTPS protected-resource metadata advertises the configured external issuer, with JWT audience bound to the resource URL and explicit transport host protection. Actual issuer login/client registration, an external companion product and public deployment remain unvalidated. See [MCP onboarding](mcp-onboarding.md); do not disable host protection to bypass configuration.

The TypeScript `CoreClient` and Cordis plugin live under `apps/harness/src/`. Instantiate a per-identity/domain client with a token callback. It supports cancellation and rejects remote cleartext origins and credential-bearing URLs. The real Cordis package is exercised in Node tests. Registration into the complete DeepSeek tools/model loop and AG-UI remains a later integration step.

## Reference companion without a frontend

The [reference companion guide](reference-companion.md) documents CLI questions, conversations, feedback and optional comment assessment using the MCP SDK. It adds one bounded external synthesis after lexical retrieval, validates exact references and records a personal response receipt. Live synthetic OpenRouter demonstrations have succeeded; normal tests use mock providers. `--allow-openrouter` and an explicitly configured private key are required for the model commands.

## Conversation query streaming

The existing conversation query POST negotiates `Accept: text/event-stream` for a real started event followed by a sourced result or safe error. Default JSON and generated MCP stay unchanged. This is extractive-query progress, not model-token generation. Authentication and source access are rechecked before final delivery; disconnects do not imply rollback. Retry the same request/key to reuse the durable episode. Last-Event-ID replay is not implemented. See the [French SSE contract](frontend-guide.fr.md).

## Personal conversation timeline

The timeline GET joins questions, extractive episodes, compact delivered responses, personal signals and issues. It supports forward/backward sequence cursors and separate bounded child pages, with a 500,000-byte response ceiling and a 100-position scan limit. The issues list now accepts an episode_id filter for child-page continuation. Current evidence access and personal ownership remain authoritative; no model call or write occurs. See the [French integration guide](frontend-guide.fr.md).

## Validation and limitations

`make test` checks formatting, schemas, generated TypeScript, database/API invariants, Node client/Cordis behavior, and installed dependency license metadata. Integration tests intentionally fail if the explicit test database variables are absent. They create unique synthetic tenants and never truncate the database; test data accumulates until the dedicated test database is deliberately reset.

Two upstream deprecation warnings currently arise from Starlette/httpx and AnyIO integration; they do not fail the tests. No warnings are suppressed by the test configuration.

The core includes bounded PDF/DOCX/text parsing, a recoverable file worker, optional model passage selection, durable call attempts and a shared daily attempt allowance. Answer retrieval remains lexical/extractive; companion output is stored as personal history without semantic certification. Semantic embeddings, enterprise synthesis evaluation, full risk policies, managed workflow deployment, real enterprise identity/companion validation and the product interface remain open. A local [restore rehearsal](restore-rehearsal.md) and [synthetic feedback evaluation](../evals/README.md) provide bounded evidence, not production readiness.

## Issue correction references

Migration 0014 adds nullable correction references to immutable personal issue decisions. start/resolve may explicitly bind a currently readable proposal; resolution with a reference requires published status and records its historical commit sequence. This does not certify semantic effectiveness or change knowledge. Personal issue visibility and current proposal visibility both apply; linked history entries are filtered after evidence or role revocation. Omitted/null input preserves pre-migration idempotency hashes. Domain locks and membership rechecks serialize decisions with access changes. Run migrations before starting the updated service.

## Source-to-proposal navigation

proposals.list accepts optional source_id, matched against the proposal validation evidence-source set with a JSONB containment predicate. Migration 0015 adds its GIN expression index. The requested source and every candidate proposal retain their evidence ACL checks and writer-role requirement. This includes historical/link evidence, not only direct extraction origin. Pagination keeps the existing visible-item cursor; the number of candidate ACL checks is not a fixed work limit.

## Durable backend synthesis

Migration 0016 creates forced-RLS immutable personal attempts/outcomes. Explicit CORTEX_SYNTHESIS_ENABLED plus configured OpenRouter credentials enables synthesis; the default remains disabled. Calls share the extraction domain daily reservation limit, reserve before networking, never replay uncertain keys and store the response/outcome atomically. No-evidence episodes receive deterministic abstention without a paid reservation. HTTP/MCP sensitive-command confirmation applies; GET remains private and read-only. Use a fresh synthesis adapter per attempt and consult the French frontend guide for terminal/unresolved states. No token streaming or production semantic quality certification is included.

## Liveness and database readiness

GET /health remains process liveness. GET /ready checks the exact expected Alembic revision (currently 0017), required table inventory, role restrictions, table SELECT access and enabled/forced RLS flags; it returns only ready/schema_revision or a safe NOT_READY 503. It uses a dedicated NullPool connection with a two-second driver socket timeout and 1.5-second statement timeout, with no provider calls. Update the revision and inventory in readiness.py when introducing a migration; the ready-path database test must pass on a fresh CI migration. This is not a policy-body audit or a production recovery proof.

## Backend synthesis SDK demo

Run `uv run python scripts/demo_backend_synthesis.py --output /tmp/cortex-backend-synthesis.json` against the dedicated `_test` database URLs after migration. The demo bootstraps synthetic published evidence, uses strict signed confirmations over real loopback HTTP with the official MCP SDK, and checks response recovery, targeted feedback, timeline and revocation. It has no live-provider switch; one simulated request and zero paid calls are required. The same workflow is tested with ASGI transport and runs over real loopback HTTP in CI. Synthetic fixture rows remain in the test database.

## Personal issue query scope

Migration 0017 indexes personal episodes and episode-to-issue lookup. Issue listing selects only episodes owned by the authenticated subject in SQL before checking current evidence access. It keeps the existing visible-item UUID cursor and status/episode filters. This reduces application checks across other users’ activity; it does not impose a fixed scan budget for the caller’s own revoked-evidence history.
