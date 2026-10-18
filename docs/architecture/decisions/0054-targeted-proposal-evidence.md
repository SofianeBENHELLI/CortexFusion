# 0054 — Exact evidence for proposal validation

Accepted locally, 2026-10-17. This change targets proposal creation and revisions (lot50), then approval and publication (lot51).

The rule engine remains shared. Its existing public `apply_checked` entry point still accepts full sources. An internal evidence interface supplies visibility and exact body validation to the same concept, maturity, endpoint and whole-graph checks. The native creation path collects source identities from changed concepts, their previous versions and relevant link endpoints. It reads current authorized metadata under the domain/source locks, then only the exact Unicode substrings needed by new concepts.

A valid body equals its ordered excerpts separated by two newlines. Before fetching ranges, their total length must equal the submitted body's length. Invalid concatenations never trigger large unnecessary reads. Visibility and range errors are checked in their established order before the verbatim mismatch, preserving status/code/message parity. Duplicate ranges are fetched once; signed SQL indices are used only after checking against the source length. No cap is raised and no span is truncated.

Fetched evidence is bounded by the existing validated batch/body limits (up to50 concepts, each up to200000 Unicode characters), not by corpus source volume. This does not bound the existing whole-graph snapshot, its clone, graph validation, SQL scan/decompression, request concurrency or total process memory. Queries remain per distinct range; no latency/capacity promise follows from the unrelated-row lock experiment.

Unit parity compares full and bounded evidence for valid Unicode/multiple excerpts, mismatches, oversized positions, hidden sources, error precedence, hidden old concepts/endpoints, missing endpoints and cycles. Native tests cover distant/maximal evidence, rights, idempotence, accepted history and source-lock independence. See lot50 in the autonomous journal for commands, denominators and browser results. Independent human confirmation and all publication boundaries remain unchanged.

## Decision and publication extension (lot51)

Review decisions and idempotent approval receipts require only targeted source identities. Approval and publication reuse the same bounded evidence loader and shared rule engine as creation. Publication recipe checks retain current source authorization at initial read, preparation and final activation; they no longer transfer unrelated source bodies. The accepted changes and source content are immutable between checks. Confirmation signatures, owner checks, versions, immutable graph reservations and unknown-outcome reconciliation are unchanged.

Synthetic qualification includes a source lock unrelated to the proposal across seven decision/replay paths, exact Unicode evidence after150000 characters, unsigned/nonowner refusals, ACL withdrawal before approval/publication and after the graph write before SQL activation. Restored access reconciles the existing prepared graph without another engine write. This is a fixture signer test, not qualification of an independent human confirmation host. See lot51 for results and limits. Other legacy consumers of the full-source helper remain outside this increment.
