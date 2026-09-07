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
