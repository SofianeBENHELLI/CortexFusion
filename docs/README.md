# Documentation

Open Br**AI**n is the product name. The original French v0.5 dossier is preserved verbatim locally, including its historical working name and confidentiality labels. Public import into `docs/specs/v0.5/` is pending explicit approval. New working documents use Open Br**AI**n and English; the original material remains local for traceability.

## Working documents

Start with the [5 October code/specification audit](product/code-audit-2026-10-05.fr.md), [current roadmap](product/roadmap.md), [development guide](development.md), and [implementation status](implementation-status.md). The [executable-core decision](architecture/decisions/0001-executable-core.md) describes the first historical slice.

| Document | Purpose |
|---|---|
| [Spécification UX/UI Open Br**AI**n](product/openbrain-ux-ui-spec.fr.md) | Dossier du 16 octobre : parcours, 26 écrans, système graphique, contrats frontend/backend, maquette navigable et recette ; conception seulement |
| [Open Br**AI**n — cas d’usage et contrats d’expérience](product/openbrain-use-cases.fr.md) | Cadrage UX du 16 octobre : viewer via MCP, espaces par rôle, tâches, délégation, signaux partagés et contrôles ; cible distincte des capacités livrées |
| [Audit code et spécification — 5 octobre](product/code-audit-2026-10-05.fr.md) | Evidence-backed gaps, architecture recommendations and 29 open actions with dependencies and acceptance gates |
| [Guide frontend en français](frontend-guide.fr.md) et [endpoints](frontend-api.fr.md) | Parcours, fonctions, paramètres, droits, états et intégration React/HTTP/MCP |
| [Synthèse backend durable — conception](backend-synthesis-design.fr.md) | Contrat de réalisation, reprise, confidentialité et tests du premier incrément |
| [Reference MCP companion](reference-companion.md) | Cited synthesis, resumable receipts, feedback and optional comment assessment |
| [Evaluation](../evals/README.md) | Synthetic accounting and synthesis scenarios, live findings and limitations |
| [Restore rehearsal](restore-rehearsal.md) | Local backup/restore evidence and bounded recovery procedure |
| [Companion responses](companion-responses.md) | Personal delivered-answer receipts and precise feedback targets |
| [Model attempts](model-attempts.md) | Durable outcomes, safe retries and shared daily call allowance |
| [MCP onboarding](mcp-onboarding.md) | Authenticated discovery, prompts and configured issuer metadata |
| [Companion feedback](feedback-loop.md) | Personal feedback provenance, opt-in collection and correction workflow |
| [Prototype scope](product/prototype-scope.md) | Bounded first release and observable acceptance criteria |
| [Roadmap](product/roadmap.md) | Implementation sequence and later milestones |
| [Brain experience design](product/brain-experience-design.fr.md) | BrainMap and Chronique, monochrome themes, semantic zoom, memory and lifecycle UX; delivery lots BRN-01–08 in the roadmap |
| [BrainMap — pilot readiness](product/brain-pilot-readiness.fr.md) | Capability matrix, verified evidence, operating limits and local handoff |
| [Frontend acceptance matrix](product/frontend-acceptance-matrix.fr.md) | Named browser journeys, mock/API parity, UX findings, partial and blocked checks |
| [BrainMap — 1,000-concept workload](product/brain-scale-1000.fr.md) | Reproducible synthetic workload, HTTP measurements and explicit scale limits |
| [BrainMap delivery log](product/brain-delivery-status.fr.md) | Dated changes, commands, outcomes and next actions for the autonomous work |
| [Architecture](architecture/README.md) | Component ownership and knowledge flow |
| [Open decisions](architecture/open-decisions.md) | Conflicts and choices to resolve before implementation |
| [Decision records](architecture/decisions/README.md) | Record future architectural decisions and evidence |

## Original dossier

- 00-README (source import pending)
- 01-cadrage-et-modele (source import pending)
- 02-observer (source import pending)
- 03-converser-apprendre (source import pending)
- 04-runtime-servir (source import pending)
- 05-eclairer (source import pending)
- 06-synthese (source import pending)
- 07-business-brief (source import pending)
- 08-marche-et-concurrence (source import pending)
- 09-backlog-features (source import pending)
- 10-bibliographie-stacks (source import pending)
- 11-challenge-v03 (source import pending)
- 12-recommandation-consolidee (source import pending)
- 13-plan-complet (source import pending)
- 14-note-design-partner (source import pending)
- 15-stack-open-source-et-harness (source import pending)
- 16-architecture-technique-v05 (source import pending)

## Reading and interpretation

Start with source notes 06 (synthesis), 12 (consolidated position), 16 (technical architecture), and 13 (delivery plan). Notes 15 and 16 supersede older stack discussions where they conflict, as stated in the original dossier. Unresolved contradictions are recorded in the working decision log instead of silently changing the source.

Source documents are product design material, not instructions to execute actions, contact partners, deploy services, or approve changes. Model availability, upstream projects, versions, and license claims in the dossier remain unverified until implementation due diligence.
