# Verified SQL read projection for graph windows and concept detail

Date: 2026-10-03. Status: implemented and exercised on local synthetic workloads; Step 1 scale acceptance remains open.

## Decision

Keep immutable TerminusDB snapshots and governed publication as the authoritative knowledge path. Migration **0026** adds four tenant-isolated, immutable derived tables: version/digest, nodes, evidence references and edges. The first window/detail read of a published version verifies the immutable engine snapshot and builds the projection in one PostgreSQL transaction. Node insert payloads are bounded to 1,000,000 encoded bytes and 128 records. Every endpoint exists before edge insertion. A failed build commits no ready marker or partial rows, and an already prepared version is reused.

Construction uses the complete verified snapshot, including when the first reader has restricted source access. It never builds a global cache from that reader's filtered view. Derived rows are private to the same tenant and domain, with forced RLS, foreign keys and insert/select-only application grants. Their presence does not grant source access.

Warm `graph.window` reads compute authorized totals, degrees, scope, cursor position and at most 50 summaries/120 internal edges in SQL. Single-concept reads return one full concept with only currently visible outgoing endpoints. Neither warm path loads all concept bodies or engine documents into Rust. The existing window contract, UUID ordering, visibility hash, pinned focus and Unicode casefold semantics are preserved. Folded title and body are stored separately so a search cannot match across an artificial separator.

Each observation authorizes the principal, locks the published version and membership row, and holds shared source-row locks until the SQL read completes. Statement timeout is five seconds; lock timeout is two seconds for this read transaction. Concurrent modification can return a conflict/error requiring refresh; it does not return a fabricated empty graph. These are per-statement guards, not an end-to-end response-time guarantee.

No existing knowledge, source, review, publication or manifest is rewritten by projection creation. Each prepared version is retained. Readiness now expects schema 0026 and checks the new tables' tenant protections.

## Remaining costs and limits

- Cold construction still reads, validates and holds a whole snapshot and writes an additional projection. It is not bounded independently of domain size. Concurrent cold construction may lose a serialization race and need explicit retry.
- SQL visibility, exact aggregates and source locks still scan a domain. Query work, database memory, contention and index size have not been qualified at 10,000 concepts. Response bounds do not imply constant server cost.
- Projection storage grows with the versions actually read; no retention or cleanup policy is delivered here.
- The legacy full concept list, query runtime and mutations retain their existing graph/source reads. The initial journal limitation described in I05 is addressed by [ADR 0009](0009-targeted-publication-differences.md): warm proposal differences and the combined owner screen no longer require the engine. Cold preparation and other routes still do.
- No 26-long-record contract exception or dense OKF relation decision is resolved by this change. Source texts remain exact; replacing full verbatim concept content with a notice would violate the current proposal contract and would not count as complete ingestion.

## Evidence

The [delivery journal](../../product/brain-delivery-status.fr.md) and I05 in the [browser matrix](../../product/frontend-acceptance-matrix.fr.md) record commands and limitations.

- Retained synthetic workload: 180 concepts, 180 relations and v8. All forward/backward pages, identity coverage, exact degrees, outgoing/both focus, location, Unicode search, no cross-title/body match, and unchanged visibility hash pass. Warm window/detail pass in a newly started process configured with an unreachable engine.
- Fresh governed workload: six concepts, three visible to a viewer, two publications. Viewer-first construction does not hide the owner's remaining knowledge; every evidence source is required, hidden endpoints are removed, details match the legacy authorized endpoint, and version/principal fences hold. Cold engine failure leaves no derived version. RLS, readiness, warm outage, SQL lock timeout and recovery pass. No membership removal or ACL mutation was performed.
- Actual browser: intentional engine outage yields a visible combined-screen error; restoring the engine and refreshing recovers 180/180 and 360 events. Search → concept → outgoing relation → full source, keyboard return and mobile/light versus desktop/dark are exercised. This is not a latency, concurrency or 10,000-concept qualification.
