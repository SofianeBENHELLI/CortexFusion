# 0051 — Bounded reference source selection

Accepted locally, 2026-10-17. Private preparations only; no migration or new authority.

ReferenceWorkspace uses the shared source passage validator and fetches one page at a time. Page navigation preserves unsaved question fields. Selecting a visible occurrence converts UTF-16 browser positions into global Unicode code-point positions. An explicit starting position supports repeated text and a proof crossing page boundaries. The existing10000-character proof limit remains; exact verification needs at most two8192-character reads with pinned hash and total. A saved proof is restored only after matching both its declared range and source text.

Without an explicit position, uniqueness is checked within the displayed page, explicitly described to the user. This is not whole-source discovery. The next increment should provide bounded-result location for direct commands rather than fetching all source text. Existing contribution selection still uses the full source until migrated.

Current rights are checked before each read; refusal clears dependent fields, transient page failure masks the old page while preserving draft input. Commands and buttons use the same operations. Save confirmation, CAS, immutable receipts and recovery behavior remain unchanged. Source validation in Rust now locks metadata and reads only the exact substring≤10000 for both private save and named review submission. PostgreSQL work is not asserted constant.

Validation:783full console tests followed by35targeted (including two additional restoration tests),5native long-source groups,6private-save and9named-review regressions;3Chrome groups detailed in the journal. No official reference bank, campaign or approval is implied.
