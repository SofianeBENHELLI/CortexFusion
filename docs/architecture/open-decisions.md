# Open decisions

## Current decisions to resolve — 5 October 2026

The [code/specification audit](../product/code-audit-2026-10-05.fr.md) compares the working tree to v0.5 and the subsequent BrainMap/Step 1 decisions. These recommendations are **not accepted migration ADRs** unless a later ADR is explicitly linked in the table. They supersede the initial uncertainty list where implementation has already established a boundary.

| Decision | Current evidence and recommendation | Acceptance gate |
|---|---|---|
| Product runtime | Rust serves the native BrainMap candidate; Python remains the compatibility reference. Select one evolving business implementation, with an explicit compatibility/retirement plan for the other. No rewrite merely to match the original language shortlist | Same governance, retrieval, permissions, failure/recovery and client contracts; maintenance and operating cost documented |
| Persistence and authority | Rust uses PostgreSQL journal/manifests and private immutable Terminus snapshots; SQL read projections are derived. Preserve atomic activation. Decide Terminus retention/replacement after cold/memory/publication/restore evidence | Fixed S20/S100/M20/M100 workloads, original budgets and consistent restore; no bypass of human publication |
| Incremental reads and rights | Payloads are bounded but global preparation, permission scans and a shared cache mutex remain. Use spatial/versioned projections and bounded per-scope preparation, preserving fresh permissions | Viewport cost, concurrency across domains, ACL/version fence correctness, cold behavior and memory measured |
| Browser identity and confirmation | Local boundary selected in [ADR 0016](decisions/0016-browser-session-and-human-confirmation.md): OIDC code/PKCE, ASGI sessions, reviewed API proxy and explicit local launcher tested in isolation; independent human-confirmation signer preserved. Optional console session adapter and local relay coded/tested separately. Full integration/Chrome, real provider, renewal and production topology remain open; manual JWT remains the default | Login/refresh/logout/recovery and owner publication without exposing signing credentials to agents or the browser |
| One frontend experience | Default spatial and opt-in progressive readers diverge. Converge navigation state, then promote one reader after parity | Existing URLs, historical/current evidence, private references, keyboard/mobile, recovery and performance pass |
| Knowledge/retrieval unit | [ADR 0015](decisions/0015-bounded-literal-context-passages.md) implements literal sourced passages and distinguishes context limits. Faithful summaries, semantic retrieval and runtime parity remain open | Long-body literal evidence verified; require evaluated semantic answers before claiming general knowledge quality |
| Workflow runtime | Durable file workers exist; consolidation is not implemented. Evaluate original Temporal choice against a bounded simpler executor | Checkpoints, cancellation, budgets, replay, candidate evaluation and publication recovery |
| Pilot gate | Recommend a first usable read/review/publish milestone, then a separately qualified biomimetic pilot | No declaration of memory/archive/sleep based on publication counters; named owner/domain and evaluated questions |

Existing decisions remain binding: BrainMap name and continuous camera, monochrome themes, 10,000-concept qualification, private OKF with no content in Git, and deferred Représentations. This audit does not reopen these choices.

## Initial dossier questions — historical baseline

The original dossier remains local. The [first implementation decision](decisions/0001-executable-core.md) and [compatibility evidence](compatibility-evidence.md) resolve the initial PostgreSQL baseline, verify harness identity, and establish the first access/approval boundary. The broader questions below remain tracked for subsequent stages.

| Topic | Question to resolve | Implementation impact |
|---|---|---|
| Harness identity and maturity | Which exact upstream repository and version correspond to DeepSeek Harness / Cordis, and are the required plugin contracts available? | Adapter implementation and fallback choice |
| Domain source of truth | PostgreSQL journal is the baseline, but the TerminusDB experiment could replace domain truth; how does that affect journal and replay guarantees? | Persistence schema and migration boundary |
| Prototype versus P0 | Note 13 says all P0 while note 12 describes a bounded increment; which items are necessary for the first demonstration? | Use the working prototype scope and record additions explicitly |
| Consolidation safety | What atomic publication mechanism supports simple prototype consolidation without the pilot candidate-release machinery? | Consistent reads during consolidation |
| Confidentiality sequencing | Fine-grained rights are deferred in parts of the dossier; which minimum source permissions and provenance filters are mandatory in the prototype? | Define an enforceable access model before real-corpus ingestion |
| Owner identity | How is an owner decision authenticated, scoped, expiry-bound, and protected against replay? | Approval endpoint and audit contract |
| Stack verification | Are the named models and upstream components available and compatible under the intended distribution terms? | Pin versions and validate license claims before installation |
| Product license | What license, if any, will govern Open Br**AI**n itself? | Do not infer a repository license from the dependency policy |
| Partner and corpus | Which domain, owner, dataset, evaluation questions, and baseline define prototype success? | Representative quality and latency measurements |

No decision in this file is a completed technology experiment or a verified legal assessment.
