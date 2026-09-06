# Optional local passage selection

Set `CORTEX_MODEL_PROVIDER=ollama` to select this adapter; OpenRouter is the default provider.

The optional extraction adapter uses an already installed Ollama-compatible local model to select one useful, **verbatim** source passage. It does not synthesize a canonical summary, infer new relationships, approve knowledge or change the answer mode. The selected quote must match the source exactly; the ordinary proposal validators then check its source span and graph constraints. An owner still reviews and approves it.

Default: disabled. Configure `CORTEX_LOCAL_MODEL` with the installed model's exact name and optionally `CORTEX_OLLAMA_URL` (default `http://127.0.0.1:11434`). Only an HTTP loopback IP origin is accepted. Environment proxies and HTTP redirects are disabled. There is no remote-provider fallback, model download or external credential forwarding.

After applying migration 0007, an owner with source access calls:

```text
POST /v1/domains/{domain}/sources/{source}/extract-local
```

```json
{"allow_local_processing": true, "idempotency_key": "local-extraction-example-001"}
```

The explicit processing flag and configured endpoint bound this opt-in local operation. Do not enable it on enterprise sources until their processing policy has been established. Corpus managers and agent identities cannot invoke it in this initial policy. The source is checked before the call and again before persisting the result.

The response contains a proposal, immutable extraction receipt ID, model name/digest, prompt version and model-reported token counts. Missing usage is null, not zero. Read a receipt at `GET /v1/domains/{domain}/extractions/{id}` as its originating owner, subject to current source/proposal permissions. Repeating a successfully recorded key returns the existing result without another model call. A changed source request using the same key conflicts.

Each call accepts at most 6,000 UTF-8 source bytes and requests at most 256 generated tokens, with a 45-second HTTP timeout. Output must be complete JSON containing one nonblank quote of at most 2,000 characters. The adapter requests a minimal JSON schema for runtime compatibility and validates stricter constraints independently. The selected first occurrence supplies the exact Unicode span. Unsupported or invented text is refused.

A per-process semaphore allows one active extraction; it is not a distributed quota. Failed/interrupted calls have no success receipt and may consume tokens again on retry. Multiple application processes can issue duplicate calls before one result is committed. Failed-call accounting, durable extraction jobs, organization budgets and provider pricing remain future work. The adapter requests model unloading after generation; actual runtime behavior remains the local server's responsibility.

The API uses [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) and the [chat endpoint](https://docs.ollama.com/api/chat). These transport features do not establish semantic correctness; exact quote validation and owner review serve different purposes.

## Evidence from this development session

A real loopback run with installed `qwen2.5vl:7b` (digest `5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc`) selected a passage from a synthetic incident procedure. The complete source → local selection → proposal → owner approval → publication → cited extractive answer flow passed against PostgreSQL. The successful generation reported 69 input tokens and 23 output tokens. This is a connectivity/contract demonstration on one example, not an enterprise accuracy benchmark.

CI uses deterministic model doubles and tests unsupported quotes, defaults, permissions, revocation, receipt retrieval and idempotence. It does not run or install a real model. No enterprise documents were used and no hosted model service was called.
