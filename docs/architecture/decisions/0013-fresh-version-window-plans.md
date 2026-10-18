# 0013 — Stable aggregation plans for fresh graph versions

Status: accepted locally, 2026-10-04. Extends ADR 0012.

## Problem

A newly built 10,000-concept read projection returned HTTP 503 after 15.25 seconds, including projection construction. Its first SQL window also exceeded a separate 20-second diagnostic timeout. A later plan estimated thousands of rows and the same custom-plan query completed quickly. This is consistent with initially stale statistics after insertion; the original timed-out execution did not yield a completed EXPLAIN plan. Custom plans alone do not guarantee protection against underestimated row counts.

The window materializes authorized nodes and edges and revisits those sets for degrees, paging and totals. A nested-loop plan can scan a visibility set for every edge. A forced generic-plan diagnostic on the completed S20 fixture reproduces the five-second timeout; disabling nested loops and JIT completes that diagnostic in 90.5 ms. This diagnostic deliberately changes planning mode and is not an HTTP benchmark.

## Decision

Only the graph-window transaction sets `enable_nestloop=off` and `jit=off` before executing the aggregation. Set joins remain available. PostgreSQL can still use a necessary cross join for the one-row bounds CTE; disabling JIT avoids spending hundreds of milliseconds compiling a query whose estimated cost is inflated by that cross join.

The settings are transaction-local. Individual concept reads keep their indexed plans. Source/membership/version locks, RLS, all-source visibility checks, visibility tokens, the five-second statement timeout and two-second lock timeout remain unchanged. No extra privileges, global database settings, statistics mutation or client-side graph download are introduced.

## Evidence and limits

- S20: 10,000 exact concepts/sources, 20,000 exact relations, 202 publications and 10,000 birth identities reconciled through native APIs after the change.
- Native static-permission and search regressions pass, including hidden endpoints, multiple proofs, reader-first construction, pagination, Unicode search, version fences, RLS, engine outage and lock recovery. No membership removal was tested.
- Rust: 55 tests pass; two opt-in engine tests remain excluded from this run.
- S100 first request succeeds immediately after constructing a previously absent projection. Its full HTTP duration is **13.08 seconds**, which still fails the two-second first-view budget. This decision fixes the timeout; it does not make cold projection construction fast.

The full Step 1 qualification remains governed by `docs/product/brain-scale-10000.fr.md`. Native warm measurements, browser rendering, memory and concurrent sessions must be reported independently. The four-profile qualification is not implied by this decision.
