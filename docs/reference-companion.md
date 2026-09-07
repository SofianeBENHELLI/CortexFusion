# Reference MCP companion

`cortex companion-ask` is a Python reference client without a graphical interface. It connects to Cortex over MCP, retrieves approved evidence, asks OpenRouter for one structured synthesis, validates the citation references and records the final text as a personal companion response. It is a fixed workflow, not an autonomous agent that can choose arbitrary administrative tools.

## Configuration and invocation

Provide `CORTEX_COMPANION_TOKEN` from your configured identity provider and `CORTEX_OPENROUTER_API_KEY` (or `OPENROUTER_API_KEY`) through a private server environment. Set `CORTEX_OPENROUTER_MODEL=deepseek/deepseek-v4-flash`. The client does not mint identities, implement OAuth login or read an implicit .env file. Never put tokens or keys in command-line arguments.

```sh
uv run cortex companion-ask \
  --endpoint https://your-cortex.example/mcp/ \
  --tenant YOUR_TENANT_UUID \
  --domain YOUR_DOMAIN_UUID \
  --question "Que faire en cas d'incident critique ?" \
  --request-id YOUR_NEW_REQUEST_UUID \
  --journal /private/operator-directory/companion.sqlite \
  --budget-usd 0.50 \
  --allow-openrouter
```

`--allow-openrouter` authorizes sending this question and the retrieved excerpts to that provider. The tenant and domain come from the host command, never from model output. Remote endpoints must use HTTPS; HTTP is accepted only for explicit loopback hosts. Credentials in URLs, redirects and environment proxies are refused. The reference client currently supports POSIX hosts (Linux/macOS).

The output is the server's personal response receipt, including the episode, served version, exact references and `semantic_validation: not_performed`. A checked reference does not prove that every generated claim follows from it.

## Model and action boundaries

The client discovers and checks the required MCP tools, then executes `api_identity_read`, `api_knowledge_query` and `api_responses_create`. A retry may use `api_episodes_read` or `api_responses_read`. Server permissions apply to every call. No publication, owner approval or confirmation signer is exposed to the model. Source text cannot create an executable tool call through this client.

The model receives only the question and numbered excerpts. The entire serialized request is limited to 25,000 UTF-8 bytes, and completion output to 1,024 tokens. Optional model reasoning is disabled for this short structured synthesis; models that require reasoning need a separately validated configuration. No internal reasoning text is stored or returned by the client. It returns JSON with `answer_text`, `answer_kind` and `citation_indices`; indices are mapped locally to exact episode references. Unknown, duplicate or mismatched citation markers, incomplete output and missing usage attribution are rejected. The prompt asks for abstention or clarification when evidence is missing or contradictory. These instructions and structural checks do not constitute a general semantic correctness or prompt-injection guarantee.

If retrieval returns no citation, the client records a local abstention without calling OpenRouter. The existing retrieval remains lexical/extractive; this client adds synthesis, not embeddings or a vector index.

## Costs, interruptions and retries

There is at most one generation per new request ID. A private SQLite journal saves the question fingerprint, episode evidence, provider-attempt state, generated text, usage and response ID. It does not save provider keys or authentication tokens. Keep it in a private local directory; it contains corpus excerpts and personal response text. File permissions are restricted to the current user. It is not encrypted storage or an enterprise retention policy.

The journal serializes companion commands on one host with a separate advisory lock. Its budget is fixed on first use and accepts 0.05–5 USD. Each attempted generation reserves five cents conservatively, including failures; reservations are not refunded. Provider routing keeps ZDR and refusal of data collection, with price filters of at most $1/million input tokens, $2/million completion tokens and no per-request charge. Use an OpenRouter key with a provider-side spending limit as well: this journal is not an organization-wide budget, invoice ledger or cross-machine quota. Deleting or copying it removes its local protection.

Reuse the **same request ID, command and journal** after an interrupted receipt write. A saved synthesis is submitted again with the same server idempotency key, without another provider call. If an attempt was started but its outcome was not saved, the command refuses an automatic replay; inspect the journal before explicitly choosing a new request ID, which may incur another charge. A completed command rereads the server receipt so current access and revocations are enforced. Revocation cannot erase copies already received by a client or provider.

## Reproducible synthetic demonstration

With the ordinary test database variables configured and migrations applied:

```sh
uv run python scripts/demo_companion.py \
  --journal artifacts/companion-demo.sqlite \
  --output artifacts/companion-demo.json
```

This starts a real loopback HTTP server, seeds a new synthetic tenant, reviews and publishes one fixture as an ephemeral owner, then connects the companion as a viewer and verifies receipt reuse. By default the model is simulated and no external request occurs. Add `--live` only with an authorized OpenRouter key and model: it permits at most one real synthetic generation. Every demo creates a new tenant and request; repeating the demo is a new test, not a recovery of the previous run. Keep its journal for diagnosis. An external identity provider and third-party companion product are not exercised by this demo.

Unit tests additionally cover rejected references, incomplete outputs, input limits, local budget/locking, uncertain attempts, resuming receipts, zero-cost abstention and current server access via the actual MCP SDK.

## Live result — 2026-09-07

The loopback HTTP demonstration passed with `deepseek/deepseek-v4-flash`: the generated French response cited the synthetic incident procedure, a personal receipt was saved, and repeating the command returned that receipt. One generation reported 175 input tokens, 62 output tokens and $0.00004186; the complete first-and-replay workflow took about 4.4 seconds in this local run. Earlier synthesis trials were rejected by the output contract. After explicitly disabling optional reasoning, the bounded structured synthesis passed; this does not establish that reasoning was the sole cause of the earlier rejections or guarantee all future outputs.

References: [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) and [provider price/routing controls](https://openrouter.ai/docs/guides/routing/provider-selection).
