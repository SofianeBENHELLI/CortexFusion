# Evaluation

The first executable evaluation covers **companion feedback accounting and authorization**. It uses PostgreSQL and synthetic identities/corpus passages, with no model calls or enterprise data. `feedback-scenarios.json` describes six cases: a declared useful first answer, several iterations, observed abandonment, a negative vote followed by declared resolution, an inference that disagrees with an explicit vote, and silence.

Run after the normal development setup and migrations, with `CORTEX_TEST_ADMIN_URL` and `CORTEX_TEST_DATABASE_URL` pointing to a dedicated database ending in `_test`:

```sh
uv run python scripts/evaluate_feedback.py
# Optional location:
uv run python scripts/evaluate_feedback.py --output artifacts/my-feedback-evaluation.json
```

The script runs the PostgreSQL feedback signal/summary tests and saves a JSON report containing per-case outcomes, actual summary receipts for the six scenarios, timings, checkout commit and whether local changes were present. The default `artifacts/` directory is ignored by Git. A failing test produces a nonzero exit code and remains marked failed in the report. Test timing includes local setup effects; it is not a production latency benchmark.

The same scenario assertions run in the ordinary `make test` CI suite. Additional checks cover idempotent retries, opt-in and opt-out, source revocation, personal/conversation scope, bounded time windows, no silent truncation and HTTP/MCP parity. Summary counts preserve origin and never convert an inferred estimate into an explicit opinion.

## Next quality evaluations

A future enterprise evaluation needs an explicitly selected corpus, processing destination, versioned gold questions/answers and a held-out baseline. Measure source fidelity, relevant retrieval, abstention, freshness, latency and model usage by served corpus version. Do not conclude that resolving an issue caused better answers until the same bounded question set is rerun against a published correction. Model versions and prompt/retrieval configurations must accompany results. No semantic quality, calibrated satisfaction or real OpenRouter performance result is claimed by the current fixtures.

## Cited synthesis scenarios

`synthesis-scenarios.json` contains six synthetic cases: supported incident procedure, no evidence, irrelevant evidence, conflicting retention rules, an instruction injected into an excerpt and an unsupported personal fact. These fixtures isolate model synthesis from retrieval: their MCP evidence is explicitly simulated, not a real authorized corpus.

```sh
uv run python scripts/evaluate_synthesis.py
uv run python scripts/evaluate_synthesis.py --live \
  --journal artifacts/synthesis-evaluation.sqlite \
  --output artifacts/synthesis-evaluation.json
```

The first command is a preflight with no network. The second explicitly authorizes up to five OpenRouter generations, requires the configured server-side key/model and uses a fixed 0.50 USD conservative journal allowance. It reuses the reference companion's bounded request and citation validation. The empty-evidence case abstains locally. There are no automatic retries, including after provider errors or failed assertions. Reusing the same journal and unchanged fixture inputs/model rescans saved results without generating again; changing only lexical expected assertions also avoids a new model call.

The report records responses, assertion results, failures, reported usage, fixture hash and local Git state. Assertions check response kind, citation count, required term groups and forbidden terms. Synonyms or acceptable alternative answers can fail lexical criteria, and passing criteria cannot prove general semantic correctness, resistance to every injection, enterprise relevance, retrieval quality or identity enforcement. Review the actual answers alongside the checks. The separate loopback HTTP demo and SDK tests exercise the real MCP boundary.

The journal contains only these synthetic excerpts and responses when used with the bundled evaluator. Do not repurpose it for private corpus data without appropriate local retention controls. Keep a provider-side spending limit in addition to the conservative local allowance.

### First live pass, 2026-09-07

DeepSeek V4 Flash passed 4 of 6 cases. The supported procedure, zero-evidence abstention, irrelevant-evidence abstention and unsupported-person abstention met the checks. The conflicting-retention output was rejected by the synthesis contract. The injected-document case abstained: the injected sentinel/action was not emitted, but the useful-answer criteria failed. Both failures remain in the report; they are not hidden by retries or relaxed assertions. This small sample is a baseline for improvement, not a production quality score.
