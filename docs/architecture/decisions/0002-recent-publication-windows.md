# 0002 — recent publication windows for BrainMap

Date: 2026-10-02
Status: accepted for the first connected observation slice

## Context

BrainMap originally derived events from the first 20 accepted commits, extending that prefix to 100. A long-lived domain could therefore display no recent activity while recent publications existed. Scanning until an arbitrary number of accessible rows had been found could also hold a governance transaction for an unbounded number of inaccessible commits.

## Decision

Add the native read operation `publications.list` at `GET /v1/domains/{domain}/publications`. Keep `commits.list` and the Python reference contract unchanged. The maintained native extension generates the HTTP/MCP inventory, schemas and TypeScript declarations.

- Read only successful published sequences, newest first. The sequence is the deterministic tie-breaker even when publication timestamps match. Accepted but unpublished changes are excluded by the published-version fence.
- Fix `at_version`, `since` and `until` across a traversal. `before` is an exclusive sequence cursor and requires `at_version`. A later publication does not change an anchored server page. The console additionally requires its current graph to remain at the same version; otherwise it hides the old view and requires refresh.
- Return at most 50 summaries (20 requested by the console). Inspect at most 100 candidate commits for evidence access, with one extra metadata row to determine continuation. A page may be empty and still have `next_before`. Callers must not interpret an empty page as end-of-history. `scan_limited` explains a scan bound without reporting the number or contents of inaccessible publications.
- Keep owner and evidence authorization current on every page. Reuse the existing proposal evidence rules under the same governance transaction. Load source identifiers, not every source body. Read commit metadata without its `before_state`; diffs remain separate authorized requests.
- Include historical published commits without publication audits as `publication: null`, even in a date-filtered request. Their date is unknown; neither acceptance time nor a guessed date substitutes for publication time. They make frontend temporal counts partial.
- The console renders one page at a time, preserving bounded event/diff processing rather than accumulating the entire journal. Map change markers, journal and change counts all refer to that page and the selected period. Current graph totals remain graph totals. Older/newer navigation is session state; changing period or refreshing returns to the newest page. No period trend is claimed from a partial page.

## Alternatives

Extending the ascending commit-prefix limit would still miss recent history and grow work with the domain's age. Changing the existing commit route's ordering would break its clients. A persistent event projection could eliminate repeated diff requests and provide period totals, but needs its own durable publication integration, permissions and completeness tests; it remains a BRN-04 follow-up.

## Evidence

`verify_publication_journal.py` exercises PostgreSQL through the Rust HTTP/MCP service with a separate synthetic domain: 100 inaccessible rows, empty continuation, equal timestamps, repeated pages, accepted/published separation, new publication during an anchored traversal, legacy audit absence, date boundaries, revoked evidence, tenant isolation and owner-only access. These SQL fixtures test reading and do not prove the publication engine. The browser fixture independently creates 25 publications through governed APIs. Actual outcomes and frontend tests are recorded in the [delivery log](../../product/brain-delivery-status.fr.md).

## Consequences and limits

No new migration or external dependency is needed. The existing commit key orders sequences within tenant/domain. The date predicate may still require PostgreSQL to inspect older rows, and accessible source identifiers are currently loaded for the domain. The limits above bound returned summaries and application ACL work, not total SQL cost or production capacity. The graph remains fully downloaded, diffs remain separate calls, and aggregate metrics over complete periods, multidomain scopes and version-stable server graph groups remain open.

Reference: [BRN-01–04 contracts and scale plan](../../product/roadmap.md#brain-experience-delivery-plan), [native extensions](../../rust-extensions.fr.md).
