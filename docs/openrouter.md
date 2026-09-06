# OpenRouter extraction

OpenRouter is the default model provider. Extraction remains disabled until both a server-side key and an explicit model ID are configured. The frontend must never receive the provider key. `.env.example` is a template, not automatically loaded by the application: export values through your server's environment or secret manager before starting Cortex Core.

```sh
export CORTEX_MODEL_PROVIDER=openrouter
export CORTEX_OPENROUTER_API_KEY='your-private-key'
export CORTEX_OPENROUTER_MODEL='provider/model-id'
```

`OPENROUTER_API_KEY` is also accepted; the Cortex-prefixed key takes precedence. Do not commit `.env` or paste real keys into issues, prompts or frontend configuration. Select a model supporting structured outputs; Cortex does not choose a paid model automatically.

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
