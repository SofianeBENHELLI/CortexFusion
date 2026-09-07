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

## Conversations and feedback

`cortex companion-conversation --endpoint … --tenant … --domain … --request-id UUID --title "Incident"` creates a personal conversation through MCP. Reuse its returned ID with `companion-ask --conversation-id UUID`. The server stores the retrieval episode in that conversation and applies its normal idempotency rules. The journal fingerprint also includes the conversation, preventing reuse of an existing command key in another conversation. This groups questions and responses; it does not yet rewrite pronouns using conversation history or send prior turns to the model.

`cortex companion-feedback` needs only the Cortex identity token, not an OpenRouter key:

```sh
uv run cortex companion-feedback \
  --endpoint https://your-cortex.example/mcp/ \
  --tenant YOUR_TENANT_UUID --domain YOUR_DOMAIN_UUID \
  --response-id YOUR_RESPONSE_UUID --request-id YOUR_NEW_SIGNAL_UUID \
  --origin explicit --kind thumbs_down --comment "La réponse manque de précision"
```

Use an explicit origin only for a user action actually captured by the host. Observed events (`reformulation`, `correction`, `abandon`, `resolved`) may include `--iteration-index`; this is a host declaration, not automatically measured effort. Inferred satisfaction requires `--origin inferred --kind satisfaction --confidence … --sentiment … --comment …`. This client accepts the host's inference and provenance; it does not run a classifier or manufacture a thumbs-up/down.

Before observed/inferred feedback, the client reads the caller's current preferences. If collection is disabled, it returns `status: not_collected, reason: consent_disabled`; the server rechecks consent when appending a signal. A concurrent opt-out producing `COLLECTION_DISABLED` is also reported as not collected. Other server failures remain errors. The client does not turn collection on or sign a consent confirmation. Explicit feedback remains available independently of automatic collection preferences.

The response is reread before recording a signal, binding feedback to its actual episode with current access checks. Repeat the same signal request ID to reuse the server receipt rather than count a new signal. These commands and their Python helpers use the same MCP tools that another companion can call. Existing personal feedback summaries can filter by conversation or exact response.

## Rejection diagnostics

The private journal now records a fixed diagnostic stage for failed synthesis (`input`, `provider_request`, `usage`, `choice`, `finish_reason`, `json` or `references`). Reference diagnostics contain boolean checks only. Valid provider attribution and usage are preserved even when the generated answer is rejected, so a charged failure is not mistaken for a free request. Invalid/missing usage remains unknown. Diagnostics never retain internal reasoning or an invalid model answer; ordinary saved evidence remains in the private journal as documented above. Known failures stay non-replayable, and a crash or failed journal write can still leave an unresolved attempt.

The evaluator includes these diagnostics when present. A targeted follow-up on conflicting retention rules passed without relaxing validation or changing the synthesis prompt. This does not identify the original rejection's cause or replace the first 4/6 evaluation baseline.

## Optional interpretation of a comment

`cortex companion-assess` can classify a host-provided comment on one response. It needs an explicit `--allow-openrouter`, a configured key/model, a private journal/budget and the caller's existing `allow_inferred` preference. It never enables that preference or signs a confirmation.

```sh
uv run cortex companion-assess \
  --endpoint https://your-cortex.example/mcp/ \
  --tenant YOUR_TENANT_UUID --domain YOUR_DOMAIN_UUID \
  --response-id YOUR_RESPONSE_UUID --request-id YOUR_NEW_ASSESSMENT_UUID \
  --comment "La réponse ne m'aide pas malgré plusieurs reformulations" \
  --journal /private/operator-directory/companion.sqlite --budget-usd 0.50 \
  --allow-openrouter
```

The client checks inferred-feedback consent and current response access before processing. Only the bounded comment is sent to OpenRouter, not the corpus, answer text or conversation history. The model returns a sentiment, non-calibrated confidence and short explanation. The resulting MCP signal is always `origin: inferred, kind: satisfaction`; it never creates an explicit vote or an observed iteration count. The raw comment is not added to the local journal payload; its fingerprint binds retries. The inferred explanation may paraphrase that comment and is retained under the documented personal-feedback scope.

The request has at most 2,000 comment characters, 15,000 serialized UTF-8 bytes and 256 completion tokens, with optional reasoning disabled and the same routing/price restrictions as synthesis. Each attempted assessment reserves five cents in the shared local journal. Failures and uncertain outcomes are not transparently replayed. A saved assessment can be resubmitted through MCP with the same signal idempotency key without a second provider call. This client-side provider call does not enter the backend's extraction-attempt ledger; keep the provider-side key spending limit.

Consent is checked again after generation and by the server on append. If withdrawn during the model call, the inference is discarded and only usage accounting remains in that journal run. Re-enabling consent does not automatically resurrect that discarded assessment. A provider request already sent while authorized cannot be recalled. Existing historical signals are not deleted by opt-out. Access is reread again before the signal is sent; a revoked source or response blocks collection.

New synthesis drafts record `cited-synthesis-v2`; comment assessments record `comment-satisfaction-v1`. Old saved drafts may lack prompt-version metadata. Request IDs retain their original idempotency meaning across upgrades: use a deliberate new request for a new generation. Do not relabel an old saved result as a newly generated answer.

For the real-loopback synthetic demo, use `scripts/demo_companion.py --live-assessment --journal … --output …`. This simulates the answer model, explicitly enables inferred feedback for the ephemeral demo viewer, makes at most one real comment-assessment call, checks signal reuse and verifies opt-out. `--live` and `--live-assessment` are mutually exclusive. Normal automated tests use no paid provider.

Live synthetic assessment on 2026-09-07 passed over the real loopback MCP server. DeepSeek returned negative sentiment with declared confidence 0.9 (not calibrated), recorded one inferred signal and no explicit votes or observed iteration count. Repetition reused the signal and subsequent opt-out blocked processing. The call reported 141 input tokens, 70 output tokens and $0.0000213339. This single fixture does not validate a general satisfaction classifier.

## Prompt v2 and acknowledgement-loss audit

Synthesis v2 explicitly distinguishes factual sentences from unrelated instructions within the same excerpt. It asks the model to use relevant facts while ignoring the instructions, instead of abstaining merely because an attack is present. The response schema, evidence checks and routing restrictions are unchanged. This remains a prompt-level instruction, not a proof of resistance to all injected content.

SDK tests now simulate losing the local acknowledgement after the backend has already recorded a response or inferred signal. Repeating the command reuses the server-side idempotency key and the saved model result: one response/signal and one model generation remain. The assessment CLI also has a no-consent test proving that neither comment nor key is sent to the provider.
