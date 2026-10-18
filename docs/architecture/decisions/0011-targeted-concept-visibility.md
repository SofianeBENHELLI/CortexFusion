# Targeted visibility for individual concept reads

Date: 2026-10-04. Status: implemented and exercised locally.

## Problem and decision

Full private reconciliation exposed a slow warm detail query. `graph_concept.sql` materialized visibility for every concept before returning one record. In a domain of 1,538 published concepts, five sequential local HTTP reads of the same short record took 3,602–3,677 ms each, despite a 687-byte response.

The visibility query now considers only the requested concept and the targets of its outgoing links, from the verified immutable read projection. The current concept contract permits at most 100 links, so this candidate set has at most 101 distinct IDs. Every candidate still requires all its source references to be accessible. Unauthorized targets remain removed from returned links without reordering the remaining links; an inaccessible selected concept remains unavailable.

Membership, current source checks, version fencing, domain/source locks and immutable projection preparation are unchanged. This decision optimizes candidate selection; it does not introduce an authorization cache or remove revocation checks.

## Evidence and limits

- All 55 Rust tests pass; two optional standalone engine tests remain skipped by that suite. Separate real-engine recipes below execute the affected behavior.
- A fresh six-concept/two-version fixture verifies owner versus contributor scope (six versus three), multiple-source requirements, hidden endpoints, exact parity with the legacy detail, tenant RLS, version fences, cold failure without partial index, warm engine outage and lock timeout/recovery. Rights are static; no membership removal is performed.
- The retained 180-concept/180-relation fixture passes its full read/projection/difference parity recipe with the engine unavailable after preparation.
- After a controlled private runtime restart, five reads of the **same** short record, same domain/version/687-byte response, took 26.413, 8.482, 8.207, 7.830 and 7.579 ms. Token creation occurs before timing. These are five local sequential observations, not a statistical capacity qualification, browser timing or a 10,000-concept benchmark.

The initial read-only complete reconciliation was interrupted to apply this correction and is rerun from the beginning; no partial result is classified as success. Cold projection creation, whole-domain window queries, source-row locks and mutation/publication costs remain separate performance work. See the delivery log for final corpus reconciliation and browser evidence.
