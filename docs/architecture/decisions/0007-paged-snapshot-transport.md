# Paged transport for immutable graph snapshots

Date: 2026-10-03. Status: implemented; product-scale acceptance remains separate.

## Problem

Snapshot preparation and verification previously serialized the entire graph into a single engine request or response. The transport's 4,000,000-byte bound consequently rejected otherwise valid graphs. The private bundle and the Step 1 workload require larger total snapshots without removing per-request protection.

## Decision

Keep the existing engine transport ceiling unchanged. Write private staging documents in batches bounded by **1,000,000 encoded bytes and 128 documents**. Create all endpoints with their exact content and sources before a second pass installs the reviewed relations. This supports cycles and references across batches. Intermediate commits are private preparation states; they never advance a Cortex publication pointer.

Read a pinned immutable commit with explicit `skip`/`count`, initially **64 documents per page**. If an encoded response exceeds the existing transport limit, retry that same offset with half the requested count, down to one document. Do not retry a mutation this way. Read one extra position when necessary to detect an understated manifest count. Reject missing, additional, duplicate or invalid concepts and any final digest mismatch.

The TerminusDB [document API](https://terminusdb.org/docs/document-insertion/) documents pagination parameters, replacing documents with PUT, and immutable commit addressing. The installed local engine is exercised separately; documentation alone is not treated as interoperability proof.

Preserve the existing canonical digest format. Hash the sorted array incrementally, one canonical concept at a time, including its delimiters. Existing immutable manifests continue to verify unchanged. Bound the full canonical snapshot at **64,000,000 bytes and 100,000 concepts** before mutation; these are rejection guards, not performance/capacity claims. Keep all concept/body/link/source limits unchanged.

Reconciliation reads at most one branch document to obtain HEAD's commit identifier, then verifies the entire immutable commit through the paged path. An incomplete staging attempt still fails reconciliation. Approval, source rights, publication transactions and trusted-host confirmation are unchanged.

## Limits and next dependency

The service still collects the complete typed snapshot, validates all endpoints, and computes its digest. Graph filtering/search and publication application still traverse this full domain. These changes bound an individual network exchange and avoid constructing an extra full canonical JSON string; they do **not** provide bounded database queries, global memory/concurrency limits, aggregate read models or a 10,000-concept frontend qualification. Skip-based pagination may also have growing engine scan cost.

Partial staging databases remain subject to the existing durable attempt/recovery workflow. No silent retry writes into a partially completed staging attempt, and no automatic cleanup deletes its evidence.

## Evidence

- Unit transport tests preserve exact 4 MB acceptance and one-byte-excess refusal; snapshots above the separate 64 MB budget are rejected before any engine mutation.
- Incremental digest equals the legacy whole-array encoding, including Unicode and small floating-point weights.
- Paged reads reject missing/duplicate/additional/tampered data; oversized Unicode pages retry the same offset with a smaller count.
- Real isolated TerminusDB recipe: **180 concepts, 180 cyclic relations, 5,457,671 concept JSON bytes**, immutable readback and reconciliation pass. Cross-batch endpoints are preserved. This is an engine recipe, not a product publication or frontend result.
- Governed publication and browser evidence are recorded in the [delivery journal](../../product/brain-delivery-status.fr.md), separately from this engine recipe.

## Subsequent read-model increment

[ADR 0008](0008-verified-graph-read-projection.md), delivered later on 3 October, removes full-snapshot reads from warm window/detail routes. Cold preparation and the legacy graph/journal/mutation paths retain the limits above; no 10,000-concept qualification follows from either increment alone.
