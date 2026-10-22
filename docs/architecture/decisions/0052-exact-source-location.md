# 0052 — Exact source location with bounded output

Accepted locally, 2026-10-17. Read-only operation; no migration or authority expansion.

POST source/locate accepts an exact excerpt≤200000 Unicode code points, optional expected hash and explicit start. POST keeps the pasted text out of URLs. It authenticates and locks current membership/source, checks freshness, then returns only source metadata, hash, total and exact Unicode range. Without a start it rejects missing or repeated excerpts, including overlaps. With a start it checks that precise occurrence. PostgreSQL scans/decompression are not constant-cost; only response transport is bounded.

Reference preparation locates across the entire source, verifies its existing≤10000 proof using at most two passage reads, and shows positions before private confirmation. No automatic publication or approval. Sources list selects only metadata instead of transporting complete bodies. Legacy read remains compatible until consumers migrate.

AMBIGUOUS_EXCERPT is an allowlisted422 code in the gateway/client; arbitrary upstream text is never displayed. Browser testing found both missing allowlist and ignored422 responses, now covered by tests. Validation and limits are recorded in lot45 of the window journal. Contribution migration remains the next increment.
