# Open decisions

The original dossier is preserved without silently resolving these points. Record an evidence-backed decision before implementing the affected boundary.

| Topic | Question to resolve | Implementation impact |
|---|---|---|
| Harness identity and maturity | Which exact upstream repository and version correspond to DeepSeek Harness / Cordis, and are the required plugin contracts available? | Adapter implementation and fallback choice |
| Domain source of truth | PostgreSQL journal is the baseline, but the TerminusDB experiment could replace domain truth; how does that affect journal and replay guarantees? | Persistence schema and migration boundary |
| Prototype versus P0 | Note 13 says all P0 while note 12 describes a bounded increment; which items are necessary for the first demonstration? | Use the working prototype scope and record additions explicitly |
| Consolidation safety | What atomic publication mechanism supports simple prototype consolidation without the pilot candidate-release machinery? | Consistent reads during consolidation |
| Confidentiality sequencing | Fine-grained rights are deferred in parts of the dossier; which minimum source permissions and provenance filters are mandatory in the prototype? | Define an enforceable access model before real-corpus ingestion |
| Owner identity | How is an owner decision authenticated, scoped, expiry-bound, and protected against replay? | Approval endpoint and audit contract |
| Stack verification | Are the named models and upstream components available and compatible under the intended distribution terms? | Pin versions and validate license claims before installation |
| Product license | What license, if any, will govern Cortex Fusion itself? | Do not infer a repository license from the dependency policy |
| Partner and corpus | Which domain, owner, dataset, evaluation questions, and baseline define prototype success? | Representative quality and latency measurements |

No decision in this file is a completed technology experiment or a verified legal assessment.
