# Targeted publication differences and journal authorization

Date: 2026-10-03. Status: implemented and exercised locally; Step 1 volume qualification remains open.

## Decision

Full and compact proposal differences use the verified SQL projection from [ADR 0008](0008-verified-graph-read-projection.md). A warm difference no longer reads the complete engine snapshot or every source body. After checking proposal permission and referenced evidence, it prepares the current published projection when needed, reopens the locked permission transaction and verifies that the published version has not changed.

Accepted proposals use the exact immutable `cf_commits.before_state`, including acceptance pending publication. Unaccepted proposals compare against only their changed concept IDs in the current published projection, retaining the existing stale-base flag. Version zero needs no configured graph engine. Compact responses hash the exact UTF-8 body; sources, links, order, maturity and other metadata are unchanged.

Targeted authorization checks validation source IDs, proposed evidence and current accepted rows for retirements. Historical before-state evidence must remain accessible. If a historical link's endpoint still exists in the published graph but cites inaccessible evidence, the entire difference is withheld. A retired endpoint does not erase the historical link. These are the previous difference semantics, not a new authorization policy.

The recent-publications window reuses targeted proposal authorization instead of loading all accessible source IDs in the domain. Its owner-only access, fixed version fence, maximum 100 scanned commits, maximum 50 returned publications and continuation semantics remain unchanged. This path may still deserialize each scanned proposal's payload; it is not a precomputed metadata-only event service.

Current membership, source-access and publication writers hold the same domain lock used by these reads. Source IDs used directly in the observation are also share-locked. Permissions are not cached in the projection. This increment retains existing domain-lock serialization; concurrency and end-to-end deadlines are not qualified here.

## Evidence and limits

- Fresh synthetic history: five governed publications, four initial concepts, a stale draft, pending publication, changed evidence on a link target, then separate target/origin retirements. Full and compact differences match independently specified before/after values. A contributor with static restricted source rights gets the expected access or 404; owner-only journal, authentication and tenant boundaries hold. Twenty-four response/status pairs remain identical with the engine unreachable. No membership removal or source ACL mutation is performed.
- Retained 180-concept/180-relation/v8 fixture: all eight full differences match persisted commit changes and before states; compact results match independently calculated body hashes. Full payloads range from 1,208,499 to 4,029,009 bytes; compact payloads from 11,019 to 37,409 bytes. This is payload-size evidence, not a latency or throughput benchmark.
- Browser I06: with the synthetic runtime configured to an unreachable engine and its projection already prepared, BrainMap/Chronique display 180 concepts, 180 relations and 360 events. Relation-event selection locates its two endpoints, source reading returns the exact 30,000-character Unicode excerpt, and Escape restores source-button focus. Mobile light and desktop dark are exercised. Cold projection preparation still needs the engine.
- Private schema 0026 migration preserves fingerprints of all 37 existing business tables, exact nine concepts and credentials after a private SQL backup. Browser reconnection confirms v1, nine concepts and one publication. No additional knowledge is published.

The full-list endpoint, retrieval, proposal creation and publication retain their existing graph/source work. Cold projection construction, SQL scans, source locks, per-version storage and the journal's per-proposal payload work still need measurement. This change does not qualify 10,000 concepts, ingest the remaining OKF records, implement lifecycle mechanisms or close UI/UX work.
