# ADR 0005 — Bounded, independent domain stock observations

Status: accepted for the first connected overview, 2 October 2026.

BrainMap needs an entry point above individual domains. The current runtime exposes authorized domain identities and graph windows, but no cross-domain snapshot, links or event aggregate.

The console reads a page of six accessible domains, ordered by domain UUID. At most two domain requests run concurrently. Each domain observation reads its published version, then a one-summary graph window and a second window fenced by version and visibility. It uses the server's authorized domain stock totals, never the number of summaries returned. Domain identities, roles and capabilities are validated and reread after the page. A change to that directory invalidates the observation. Authentication failure masks the whole page; another domain failure leaves its stock unavailable and suppresses page totals. Successful zero counts remain distinct from unavailable data.

Concept identities remain scoped to domains. Page totals sum those domain stocks and internal relations; identical concept UUIDs in different domains are different domain objects. Every card shows its own publication version and read time. The result is a set of independent observations, **not an atomic global snapshot**. No global version, inter-domain connection, combined journal or inferred learning event is introduced.

The URL stores the selected API domain, workspace and overview page. Entering another domain clears the former spatial/object selection. BrainMap navigation preserves this API context. Browser Back and reload after authentication restore it. A domain absent from the current identity is rejected before requesting its version. A smaller refreshed directory normalizes an out-of-range page.

This reuses existing contracts and introduces no endpoint, storage or persistent credential. It bounds client fan-out and card rendering, not server snapshot cost: each graph read still loads the full authorized snapshot as described in [ADR 0003](0003-bounded-graph-windows.md). The identity directory itself is not paginated. Stable server groups, indexed aggregation, cross-domain semantics, combined event coverage and production-scale measurements remain future work.

Validation: adapter tests cover scoped counts, independent versions, concurrency, paging, invalid identity, cancellation and partial/error reads. Component tests cover navigation, disappearance of old cards and page normalization. A real eight-domain fixture exercises owner/viewer stock differences, v0/v1/v2 domains, drill-down, sources, restored links, desktop and mobile. Live membership removal is a separate pending approval; it is not counted as completed acceptance. See the [delivery log](../../product/brain-delivery-status.fr.md).
