# 0050 — Progressive source passage reading

Accepted locally, 2026-10-17. E16/B06/B08; additive endpoint, no migration.

Whole-source transport prevented bounded evidence reading. A new authenticated source passage endpoint returns at most8192Unicode code points, explicit start/end/total, source identity/hash and next offset. Optional expected hash pins successive reads; changed source, lost access and malformed ranges fail explicitly. Metadata and substring are read under a shared source lock, with principal freshness checked before return. PostgreSQL scan/decompression cost is not bounded by the response size.

The shared console evidence reader replaces its current page and clears it before every new read. It validates identity, hash, exact Unicode length, total and next position; no cache or whole-document accumulation. A cited passage opens at its exact offset, supports progression when necessary, and can return after browsing the rest of the source. Closure aborts and invalidates late responses; access denial masks dependent context. Keyboard focus and mobile Conversation/Dossier remain explicit.

Bounded chat commands invoke the same reader for numbered citations of the inspected conversation. This is not arbitrary-source navigation or an LLM agent. MCP exposes the additive operation, and the consultation guide recommends it. Legacy full reads/chunks and contribution/reference selection are not silently changed by this decision.

Validation:778console,94Python,6native groups including concurrent ACL revocation and18-page Unicode reconstruction;3Chrome groups including real ACL loss, mobile light/dark, keyboard and existing conversation commands. Journal contains denominators, failures corrected and remaining limits. No private corpus, provider call or publication.
