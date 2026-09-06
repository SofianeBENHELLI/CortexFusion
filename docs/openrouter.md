# OpenRouter extraction

OpenRouter is the default model provider. Extraction remains disabled until both a server-side key and an explicit model ID are configured. The frontend must never receive the provider key. `.env.example` is a template, not automatically loaded by the application: export values through your server's environment or secret manager before starting Cortex Core.

```sh
export CORTEX_MODEL_PROVIDER=openrouter
export CORTEX_OPENROUTER_API_KEY='your-private-key'
export CORTEX_OPENROUTER_MODEL='deepseek/deepseek-v4-flash'
```

`OPENROUTER_API_KEY` is also accepted; the Cortex-prefixed key takes precedence. Do not commit `.env` or paste real keys into issues, prompts or frontend configuration. The selected model is [DeepSeek V4 Flash](https://openrouter.ai/deepseek/deepseek-v4-flash), using the exact ID `deepseek/deepseek-v4-flash` (currently labeled 0423 in the catalog). The public endpoint catalog advertises structured outputs on several providers; eligibility under the configured routing restrictions and actual extraction behavior still require a live check. A server-side key is required before extraction is enabled.

An owner with access to the source invokes:

```http
POST /v1/domains/{domain}/sources/{source}/extract
Content-Type: application/json
```

```json
{"processing_destination":"openrouter","idempotency_key":"extraction-example-001"}
```

This sends the source text to OpenRouter. The destination must match the server configuration; the legacy `/extract-local` route refuses OpenRouter. `GET /v1/me` reports the configured extraction provider and owner capability for frontend integration.

The model selects one exact contiguous quote. Cortex independently verifies that quote, checks permissions again, and creates a proposal requiring ordinary owner approval. It does not publish automatically or change query answers into generated synthesis. Input is limited to 6,000 UTF-8 bytes, selected quotes to 2,000 characters, completion tokens to 256, response size to 64 KiB and request timeout to 45 seconds. There are no automatic provider retries.

The fixed HTTPS endpoint refuses redirects and environment proxies. Requests require supported parameters, providers that deny data collection, and ZDR routing. These requirements can leave no eligible endpoint. They are routing controls, not a universal guarantee about every provider's policies: verify the selected model/provider and enterprise processing authorization before using a real corpus.

Receipts include the returned model ID, OpenRouter request ID, prompt version, and reported token counts/cost in USD. Missing usage is `null`; no model-weight digest is asserted. Read a successful receipt through `GET /v1/domains/{domain}/extractions/{id}` with the originating owner's current permissions. Successful idempotent retries reuse the receipt. Failed calls and concurrent calls across application processes can still incur charges; organization budgets, durable extraction jobs and failed-call accounting remain unfinished. One active extraction per application process is a concurrency limit, not a spending cap.

Provider authentication, balance and rate-limit errors return sanitized error codes without forwarding response bodies or credentials. Automated tests use synthetic responses and make no paid calls. A live OpenRouter check still requires a configured key and chosen model.

Protocol references: [authentication](https://openrouter.ai/docs/quickstart), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Synthetic connectivity check

Run `uv run cortex model-check --model deepseek/deepseek-v4-flash` to inspect configuration without a network call. A configured key is not proof of a successful generation. Exit code 2 means configuration is missing; no database or identity-provider setup is needed for this diagnostic.

For a real, potentially paid check, enter a newly generated key privately in your terminal:

```sh
uv run cortex model-check --model deepseek/deepseek-v4-flash --live --prompt-key
```

The key prompt is masked and requires an interactive terminal. Alternatively omit `--prompt-key` to use the existing server environment. The key is neither persisted nor printed by the command. It sends exactly one built-in French synthetic procedure through the same adapter and routing restrictions as extraction. It does not read files, process enterprise documents, create proposals or change the database. The adapter validates the selected quote exactly. No automatic retry occurs.

The JSON report includes status, whether a network attempt occurred, elapsed time, resolved model/request IDs and reported usage/cost. Exit code 0 in live mode means the passage contract passed; exit code 1 indicates a provider or output error. A successful check is not an enterprise accuracy evaluation or a complete publication workflow test. `MODEL_ROUTE_UNAVAILABLE` can mean no endpoint meets the routing requirements; `MODEL_REQUEST_REJECTED` means OpenRouter rejected request parameters. Neither is silently worked around by weakening the routing policy.
