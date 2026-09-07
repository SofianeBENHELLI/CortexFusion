# Durable model attempts and call limits

Model extraction now reserves a durable attempt before calling the configured provider. A successful outcome is appended atomically with the extraction receipt and its unapproved proposal. A failure appends only a sanitized error code; it never publishes knowledge. A process interruption or unavailable outcome storage can leave the attempt `unresolved`, which means there is no durable terminal result, not that the provider is necessarily still running.

## Inspect before retrying

Owner-only HTTP operations and their generated MCP equivalents:

| HTTP | MCP | Scope |
|---|---|---|
| `GET /v1/domains/{domain}/model-attempts` | `api_models_attempts` | Paginated personal attempt history, filtered by current source access |
| `GET /v1/domains/{domain}/model-attempts/{attempt_id}` | `api_models_attempt` | One personal attempt and its terminal outcome, if any |
| `GET /v1/domains/{domain}/model-usage` | `api_models_usage` | Domain-wide daily attempt allowance; no source text or personal history |

Attempts contain provider, requested model, selected source span/hash, event key and timestamps. They do not contain the prompt, source text, response text or credentials. Successful attempts link to the existing extraction receipt, which contains available provider attribution, usage and cost. The outcome table and attempt table are append-only. Another owner can inspect the shared domain allowance but cannot inspect the author's personal attempt history. Revoking a source hides the associated attempt details; its reservation still counts toward the shared allowance.

An exact retry of a successful extraction returns the original receipt without another model call. After a failed or unresolved attempt, the same key returns `409 MODEL_ATTEMPT_RECORDED`; a changed command with that key returns `409 IDEMPOTENCY_CONFLICT`. Inspect the attempt and any successful receipt before deciding whether to issue a new command with a new key. In MCP, that new sensitive extraction also needs a new trusted-host confirmation. A new key can incur an additional provider charge, including when an earlier outcome is unresolved. There is no automatic provider retry, cancellation or reconciliation endpoint in this increment.

## Shared daily limit

`CORTEX_MODEL_DAILY_ATTEMPT_LIMIT` defaults to **100 reservations per domain per UTC day**, shared across owners, providers and application processes using the same database. Set it consistently on all instances; supported values are 1–100,000. PostgreSQL serializes quota reservation, and a concurrent stale snapshot must retry before any provider call is made.

A limit rejection returns `429 MODEL_DAILY_LIMIT` before reserving or calling. Disabled models, invalid spans, authorization failures before reservation and a busy local execution slot do not consume a reservation. Once reserved, failures and interruptions consume an attempt because the backend cannot reliably prove that the provider did not process or bill it. Successful idempotent retries do not consume another reservation. Allowance renews at UTC midnight; historical extraction receipts created before this ledger are not backfilled as attempts.

This is an attempt-count limit, not a monetary budget, provider invoice or global account cap. The existing per-process semaphore bounds local concurrency; this increment does not limit aggregate concurrent calls across all processes. Existing per-call input/output limits remain enforced. An unresolved attempt is retained for inspection indefinitely; cleanup, retention and provider-side billing reconciliation remain operational work.

The operator-only `cortex model-check` diagnostic calls the adapter directly with its built-in synthetic text; it does not use the application database or this reservation ledger. It is a one-call configuration test, not an application extraction workflow.

## Evidence

Synthetic PostgreSQL tests cover same-key races across two service instances, shared quota contention, UTC-day boundaries, immutable outcomes, failed/unsupported provider output, simulated process termination, exact retry, personal scope, source revocation and atomic rollback when the success outcome cannot be stored. These checks exercise fake adapters and do not validate a real OpenRouter credential, model route or invoice.
