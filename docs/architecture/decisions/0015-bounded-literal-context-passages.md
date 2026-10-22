# Bounded literal passages from intact published concepts

Date: 2026-10-05. Status: implemented locally for AUD-02; semantic retrieval remains open.

## Problem

ADR 0010 allows intact published bodies of 200,000 Unicode characters. Retrieval previously discarded a whole concept when its body exceeded the remaining response budget (8,000 by default, 20,000 maximum). A relevant long document could therefore produce `knowledge_gap` and an incorrect knowledge-gap ticket.

## Decision

Keep the published Concept intact. Add `ContextPassage` to `QueryResult.context_passages`, with concept identity/title/maturity, literal text, Unicode body start/end/total length and exact source references. A partial passage is **never** serialized as a replacement Concept. `QueryResult.concepts` contains only the complete concepts selected within the budget. Old persisted episodes without passage metadata remain readable through the default empty list.

Keep the existing lexical candidate ranking. When a whole body fits, preserve its complete content. Otherwise choose a contiguous sequence of complete lines/sentences within one original source span, covering query terms absent from the title. Narrow the selected window and retain at most one adjacent non-empty unit on each side when it fits. Do not fill the budget with unrelated preceding paragraphs. Count Unicode characters, including separators between selected passages. Source offsets are derived from the published verbatim-span mapping, without casefold offset substitution.

Return `context_limited` when candidates exist but no such passage fits. Do not create a knowledge-gap issue in this case. `knowledge_gap` still denotes no lexical candidate; `evidence_found` denotes at least one literal passage. This enum extension requires clients with exhaustive status handling to update. HTTP/OpenAPI, MCP, Python and generated TypeScript contracts are regenerated together.

Retain **all source dependencies** of each selected concept in the episode, even when quoting only one source: the title and concept context derive from the full concept. A context-limited episode also retains its matching candidates' dependencies, since the existence of matching evidence is itself source-derived. Existing fresh authorization checks and episode read checks remain authoritative. No permission mutation is introduced.

The console distinguishes the three outcomes, identifies partial passages, exposes their exact citations and links to the **current** full concept in BrainMap through client-side navigation. The link does not pretend to open a historical concept version. A context limit offers a route to BrainMap. No source body is overwritten or expanded into a larger response budget.

## Verification and limits

- Python helper/service tests and Rust library tests cover beginning/middle/end evidence, large bodies, later source spans, Unicode/casefold, budgets, separated terms and intact concepts. The service checks distinguish tickets and persisted authorization dependencies.
- An isolated native API fixture publishes five synthetic concepts through governed review/publication. Three have 200,000 characters, one is an indivisible long block and one has static owner-only access. Exact citations, episode replay, conversation idempotency and denied hidden evidence pass. Follow-up requests reuse the same fixture at budgets 100 and 8,000 and verify the final episode dependencies.
- Chrome checks response/citation/full concept navigation, keyboard submission, light mobile 390 px, dark desktop, and the difference between a real gap and a context limit. Evidence and exclusions are in the delivery journal and acceptance matrix.
- This is a literal extractive fix, not a faithful canonical summary, embedding search, model answer or token-budgeted graph expansion. Distant terms or an indivisible oversized unit can still cause `context_limited`; users can inspect the full concept. A title-only match does not establish that the first passage answers a question. Markdown units are literal and may not be independently well-formed blocks.
- Python's pre-existing partial lexical ranking and Rust's stricter term coverage remain different. Full semantic/runtime parity, retrieval computation bounds and 10,000-concept performance are not established here. No private corpus query, model call or dynamic ACL removal was performed.
- Returning from BrainMap reset the selected conversation in the initial recipe. A subsequent AUD-04 correction binds it to the URL and passes component regressions; its new Chrome round trip is still pending after browser control was blocked by an open extension UI. Browser identity still requires the existing manual session flow (AUD-01).
