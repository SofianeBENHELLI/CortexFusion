# Intact long concept bodies and bounded review batches

Date: 2026-10-04. Status: implemented and exercised locally; volume qualification remains open.

## Decision

Align the Concept body limit with the existing direct-source contract: at most **200,000 Unicode characters**, instead of 30,000. Preserve one concept per reviewed semantic record, its identity, exact body, provenance and evidence offsets. Do not split or pad knowledge solely to satisfy an artificial record count. Python contracts, generated JSON schemas, native validation and direct source ingestion agree on this boundary.

Evidence validation is unchanged: the body must equal its cited source spans joined with two newlines. The generic OKF preparer now fails closed when multipart evidence cannot preserve that exact join. Documents larger than 200,000 characters still require an explicit resolution. File parsing/upload keeps its separate 30,000-character parsed-document limit; this change does not claim long-file upload support.

Review plans hold at most 50 concepts and conservatively budget 1.5 MB of UTF-8 serialized proposal JSON, including a bounded envelope. They account for Unicode bytes and JSON escaping rather than character count alone. A reviewed concept is never divided across proposals. Candidate Markdown references can remain pending under an explicit verbatim/emerging/no-relations decision; that decision neither validates relations nor maps source status to Cortex maturity or archival.

Normal engine batches remain at 1 MB. An individually isolated document may reach 1.3 MB to accommodate the worst allowed escaped body. SQL projection batches allow an isolated record up to 3 MB because they include the original and casefolded search text. Both paths flush other records before that record. The engine exchange guard stays at 4 MB and canonical snapshot preparation stays at 64 MB. These are transport/validation guards, not memory or throughput guarantees.

## Evidence

- Native synthetic fixture: three intact 200,000-character concepts, Unicode text, JSON control-character escaping and expanding Unicode casefold. Governed publication, exact detail/full-list readback, compact body hashes and static source permissions pass. A 200,001-character body and a forged source span fail with 422.
- Browser: a synthetic 200,000-character document has a 600-character preview, keyboard-operated full text in a 350 px scrolling region, and an exact source proof. Mobile light and desktop dark were exercised; proof closure restores its trigger.
- Private import: the 26 records above the former 30,000-character boundary are published intact. Manifest v2 preserves all 1,538 identities, body hashes and sources and all 16,217 candidate references. The longest private body is 173,226 characters; rendered text and native proof match its manifest hash. The workspace now has 35 concepts, 35 sources and two publications; repeating the reviewed batch adds none.
- This browser recipe exposed a search defect: eight UUID-ordered body matches could hide an exact title. Search now ranks exact title, title prefix, title substring, then body match, with deterministic UUID ties and cursor positions in that order. Native qualification uses 17 synthetic records and static source permissions; forward/backward pages preserve every authorized identity. See [ADR 0003](0003-bounded-graph-windows.md).

The remaining 1,503 records, semantic reconciliation of candidate references, connected import management and 10,000-concept qualification remain open. No OKF text, review payload, receipt or credential belongs in Git; only aggregate results and generic/synthetic implementation are recorded here.
