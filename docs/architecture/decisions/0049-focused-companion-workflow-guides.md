# 0049 — Focused companion workflow guides

Accepted locally, 2026-10-17. Scope: public documentation, authenticated discovery and preparation; no new business authority.

The companion needs short procedures for consultation, feedback, follow-up, assigned work, correction and coordination. A single literal catalog in `companion_guides.py` generates the Rust onboarding artifact and is rendered in the console. MCP exposes a catalog resource, a fixed-id resource template and a user-selected workflow prompt. An authenticated HTTP read and MCP tool offer the same catalog to clients without resource support.

Documentation is readable without granting its described capability. Preparing a domain-specific prompt requires the current identity and that workflow’s announced capability. Preparation runs no query, feedback or mutation. All subsequent business tools independently enforce their contracts and human confirmations. Unknown ids, arbitrary resource paths and extra prompt arguments are rejected. The compatibility server cannot prepare native-only workflows without their advertised capabilities.

The console separates decision, procedure, effect, recovery, limits and synthetic example. The guide selector collapses after selection; tool identifiers remain in expandable integration references. Chat commands select the same read operation; they are a bounded parser, not an LLM agent. Re-reading clears stale selection and checks identity. The payload is bounded and validated, contains no personal objects or credentials and makes no universal-client compatibility claim.

Validation: 770 console tests,94 Python tests,5 native groups and2 Chrome groups in the window journal. No schema migration, external publication, client notification or provider call. Client/version/transport qualification and optional skill adaptation remain separate work.
