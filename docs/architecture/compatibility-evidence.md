# Compatibility evidence — 2026-09-06

These are bounded local checks, not production readiness or model-quality results.

| Component | Tested version / revision | Result |
|---|---|---|
| PostgreSQL | 17.11, compiled on macOS arm64 | Source archive SHA-256 checked; isolated private Unix-socket database used for integration tests |
| pgvector | 0.8.6 / `8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c` | Compiled/installed against the same PostgreSQL; vector distance query passed |
| Apache AGE | `PG17/v1.7.0-rc0` / `e1467f12e0b1d15dd35d3ab93f057a7112d425b8` | Compiled/installed; node create/read succeeded; extension reports 1.7.0, but tested tag is a release candidate |
| Combined graph/vector transaction | AGE and pgvector in one database | A graph node and vector table were created in a transaction; rollback removed both |
| DeepSeek Harness source | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | Inspected plugin/service interfaces and runtime requirements; complete harness not installed or run |
| Cordis | `@deepseek-ai/cordis` 4.0.2 | Actual service mount, dependency availability, client call, and disposal/cancellation test passed |
| Python/Node dependencies | `uv.lock`, `pnpm-lock.yaml` | Installed and checked through tests, type generation, and metadata license gate |

The application currently uses PostgreSQL JSONB projections and lexical retrieval. It does not require AGE or pgvector to run. Their experiment demonstrates a storage option; tenant filtering and an actual production projection adapter still need their own checks. The initial Docker/CI profile intentionally runs plain PostgreSQL.

The metadata license gate checks installed Python/Node distributions, with explicit aliases and exceptions. It is not a full inventory of the license texts of every native component bundled in a wheel, model, or container.
