# ADR 0014 — Bounded spatial scene transport

Status: implemented as an opt-in connected frontend recipe; not a complete scale qualification.
Date: 2026-10-04.

## Problem

The continuous BrainMap camera initially downloads the entire authorized compact topology. S20 is 2,027,262 decoded bytes, above the frozen 64 KiB viewport budget. Client-side rendering limits alone do not solve transport size.

## Decision

Two native member-read operations extend the existing projection without publishing new knowledge:

- `graph.scene`, GET `/v1/domains/{domain}/graph/scene`: world bounding box, one of four deterministic layouts, optional focused concept, publication version and principal-specific visibility fence. At most 16 grid glyphs plus eight landmark concepts (24 objects total) and 120 drawn links; maximum 65,536 decoded JSON bytes. Oversize fails explicitly, with no truncated source or invented aggregate.
- `graph.map_nodes`, GET `/v1/domains/{domain}/graph/map/nodes`: complete accessible catalogue search or incoming/outgoing/typed neighborhood, eight records per nonempty normalized search page, sixteen for catalogue/neighborhood pages. The response declares `page_size`; clients use it rather than guessing search normalization. Offsets after zero require version and visibility fences. Search shares the native Unicode case-folding semantics. Selected metadata and neighborhood bounds allow camera navigation without a global client index.

Both use `graph.map` authorization: all cited sources must be readable; each relation/reference requires both visible endpoints. The documentary index is checked against published body/source hashes and tenant/domain. References never acquire structural types or weights. Bodies and proofs still load on demand through their existing authorized contracts. No content or token belongs in the public build.

Grid membership includes all authorized points in a world cell, rather than only points currently inside the viewport. Counts and centroids therefore remain stable while panning at the same cell size. Landmarks are an overlay of individual concepts already counted in their cells: glyph counts must not be summed as separate concepts. Links distinguish aggregates from actual edges. The bounded drawing is not a complete edge list; paging is the complete navigation path. Positions are deterministic within a publication, not a learned semantic distance or a promise of stability after a changed publication.

The connected frontend variant is selected with `map_transport=viewport`. Its camera transforms locally and requests a new scene after a short debounce; catalogue and neighbor pages are independent. Version/access conflicts and failures mask the prior scene. Existing default `SpatialBrainWorkspace` remains while temporal controls, private-reference navigation and scale acceptance are completed. This flag is a recipe mechanism, not a second product mode presented to users.

## Bounded preparation cache — 4 October, 22:00 UTC

The graph service retains authorized metadata and derived placement/search/adjacency indexes in a process-local LRU: eight entries, 128 MiB of conservatively estimated retained allocations, five-minute idle expiry. Oversized preparations bypass admission. These are cache limits, not measured RSS promises. Bodies, source text and tokens are never stored there. Cold preparations and scene assembly are serialized to avoid concurrent global copies; contention is measured separately.

Every request authenticates again, checks membership and the current published projection, then holds the existing domain/member/source read locks through assembly. The cache key includes tenant, domain, subject, layout, a digest of current per-source visibility/content hashes and projection row incarnation, and the hash of the actual documentary-index bytes. It never uses a cached authorization decision or file timestamp as the security boundary. An invalid index fails explicitly. Source rights and version fences are still rechecked on a cache hit.

Native recipes cover static owner/reader separation, same-timestamp overlay replacement/restoration, a real subsequent publication and stale-fence refusal. Membership removal is not claimed as tested. Selected landmarks now prioritize real neighboring concepts and their actual links. Client pagination keeps the reading region only for the same selected UUID/version/visibility while disabling stale link actions; an error masks the old detail. Screen-space label placement gives the selection priority and avoids other labels/markers, without changing graph coordinates.

## Deliberate limits

A cache miss still reads the complete authorized bounded topology and recomputes placement. Hits still inspect all current source rights and assemble scenes from the cached topology. SQL work, computation and cold preparation are **not bounded by viewport**. This is not a tile cache or persistent spatial index. Existing total topology limits and qualification budgets remain unchanged. Cached variants must still qualify dense/multidomain workloads and browser memory; no production scale or full 10,000 qualification is claimed.

On 5 October, the rendering discrepancies were corrected: 16 grid glyphs plus eight landmarks fit the frozen 24-object bound, with at most eight search results. Cells can themselves be individual concepts. Catalogue/neighborhood pages remain sixteen and declare their own bound. Native tests cover all four layouts at four zoom extents; Chrome traverses 120 search matches in fifteen pages and compares them with the independent S100 manifest. This does not qualify cold preparation or memory.

Camera geometry survives a scene unmount during a version/access error without retaining previously authorized content. A real four-publication synthetic browser recipe verifies stale-fence masking, recovery with the same selection/zoom, revised content, and published weights. Coordinates of thirty identities stay identical across edits with unchanged topology in all layouts. Adding/removing concepts or families can still change placement: no persistent coordinate ledger is implemented. Aggregate temporal signals, complete profile qualification, real touch and screen-reader acceptance remain open. See P01–P11 and the delivery journal for dated evidence and exclusions.

## Event-to-pair navigation — 5 October, 01:25 UTC

Both read operations accept an optional `target` UUID with required `focus`. The currently authorized preparation must contain both endpoints; otherwise the response is404 (a stale visibility fence remains409). In a scene, the pair takes precedence among the eight landmark slots; actual pair edges precede other actual edges within the existing budget. In a node page, results and focus bounds are restricted to the pair. A removed relation returns an empty page with current endpoint metadata/bounds; it is never recreated from journal data. Direction/kind filters still apply. This does not create a new historical graph or bypass source checks.

The event inspector uses at most two bounded pair metadata reads and separately retains the published historical state, exact before/after evidence ranges and current relation state. Only the current edge matching the event direction/type is emphasized. A missing historical target name may be supplied from the current endpoint with explicit attribution. Bodies and proof texts remain on-demand. `map_event` supports restoration and browser Back; changing the interval clears the event selection. A fresh metadata/proof401/403/409 masks the previous map. These dynamic refusals are component evidence; no membership-removal browser test is implied.

Camera focus sequences are monotone across layout changes. Active event bounds survive delayed element sizing and responsive reflow; a previous geometry-only camera still restores on an error remount. Parent panel scrolling no longer overrides focus when returning to an event. Chrome P12/P13 exercise current versus removed links, retired endpoints, concurrent publication, restoration, mobile themes and S100/private navigation. Labels prioritize both endpoints without moving graph coordinates. The default workspace remains unchanged; aggregate temporal parity, stable placement across added/removed identities and full scale qualification remain open.

## Current-edge observations and reauthentication — 5 October, 02:23 UTC

The progressive client indexes only the already loaded, version-checked publication events. Relation keys include origin, target and type; observations are deduplicated and ordered by publication sequence. A current nonaggregate edge may be accented only when that exact directed tuple is observed. The HTML list retains all observed change kinds and opens the latest loaded event; it does not compute a net trend or reconstruct historical geometry. Documentary references, opposite directions/types, aggregates and missing current links are not inferred. The list cannot exceed the scene's120 links and performs no extra global topology read.

Cell bounding boxes are not sufficient membership evidence for temporal aggregation. The UI explicitly reports the remaining observed relations not detailed in this scene, without claiming they are absent or unchanged. Future temporal aggregates require authoritative authorized membership and historical coverage, including how to account for retired endpoints. This work is still open.

Reauthentication keeps URL navigation while dropping session and API cache, then repeats identity/domain checks. Deliberate logout still clears navigation. A fresh401/403/409 from a concept-proof read masks the previous progressive scene and content;401 offers direct reauthentication and404 remains local to the proof. Recovery cannot expose placeholder scene data before a fresh authorized response succeeds. Chrome verifies real expiry with unchanged permissions and restoration of a200,000-code-point synthetic proof; this is not a membership-removal recipe. Native contracts, data, bounds and previous performance evidence remain unchanged.
