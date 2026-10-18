import type { Concept, State } from "../mock";
import {
  relationId,
  type BrainChange,
  type BrainNode,
  type BrainProjection,
  type BrainRelation,
  type PublicationObservation,
} from "./model";

export const MOCK_DOMAIN = "mock-portfolio";
export const referenceId = (title: string) =>
  `reference:${JSON.stringify(title.trim())}`;
const conceptId = (id: string) => `concept:${id}`;

/** A legacy string target is a reference, not a newly published concept. */
function targetId(title: string, concepts: Concept[]) {
  const matches = concepts.filter((c) => c.name === title);
  return matches.length === 1 ? conceptId(matches[0].id) : referenceId(title);
}
function relations(concept: Concept, concepts: Concept[]): BrainRelation[] {
  const from = conceptId(concept.id);
  return [
    ...new Set(concept.relations.map((x) => x.trim()).filter(Boolean)),
  ].map((title) => {
    const to = targetId(title, concepts);
    return {
      id: relationId(MOCK_DOMAIN, from, to, "unspecified"),
      from,
      to,
      toTitle: title,
      kind: "unspecified",
      weight: null,
      sourceIds: [concept.source],
    };
  });
}
export function observePublication(input: {
  id: string;
  time: string;
  version: number;
  proposalId: string;
  before: Concept | undefined;
  after: Concept;
  beforeConcepts: Concept[];
  afterConcepts: Concept[];
}): PublicationObservation {
  const { id, time, version, proposalId, before, after } = input;
  const previous = before ? relations(before, input.beforeConcepts) : [];
  const next = relations(after, input.afterConcepts);
  const changes: BrainChange[] = [];
  const base = {
    publicationId: id,
    time,
    version,
    groupIds: [after.id],
    sourceIds: [after.source],
  };
  if (
    !before ||
    before.description !== after.description ||
    before.name !== after.name
  ) {
    changes.push({
      ...base,
      id: `${id}:concept`,
      kind: before ? "concept_updated" : "concept_created",
      title: after.name,
      detail: before
        ? "Le contenu du concept a été publié dans une nouvelle version."
        : "Première publication de ce concept sourcé.",
      nodeIds: [conceptId(after.id)],
    });
  }
  for (const [items, compared, kind] of [
    [next, previous, "relation_created"],
    [previous, next, "relation_removed"],
  ] as const) {
    for (const relation of items) {
      if (compared.some((r) => r.id === relation.id)) continue;
      const target = (
        kind === "relation_created" ? after : before
      )!.relations.find(
        (t) =>
          targetId(
            t,
            kind === "relation_created"
              ? input.afterConcepts
              : input.beforeConcepts,
          ) === relation.to,
      );
      changes.push({
        ...base,
        id: `${id}:${kind}:${relation.id}`,
        kind,
        relation,
        title: `${after.name} → ${target ?? relation.to}`,
        detail:
          kind === "relation_created"
            ? "Relation ajoutée par une publication validée."
            : "Relation retirée par cette publication. Un retrait ne constitue pas une décision d’archivage.",
        nodeIds: [relation.from, relation.to],
        sourceIds: [...new Set([...relation.sourceIds, after.source])],
      });
    }
  }
  return { id, time, version, proposalId, changes };
}

export function mockProjection(state: State): BrainProjection {
  const nodes = new Map<string, BrainNode>();
  for (const c of state.concepts)
    nodes.set(conceptId(c.id), {
      id: conceptId(c.id),
      title: c.name,
      description: c.description,
      kind: "concept",
      groups: [c.id],
      sourceIds: [c.source],
    });
  const links = new Map<string, BrainRelation>();
  for (const c of state.concepts) {
    for (const relation of relations(c, state.concepts)) {
      links.set(relation.id, relation);
      let target = nodes.get(relation.to);
      if (!target) {
        const name =
          c.relations.find(
            (t) => targetId(t, state.concepts) === relation.to,
          ) ?? relation.to;
        target = {
          id: relation.to,
          title: name,
          description:
            "Cible nommée d’une relation. Aucun concept autonome n’est publié pour cette référence dans le mock.",
          kind: "reference",
          groups: [],
          sourceIds: [c.source],
        };
        nodes.set(target.id, target);
      }
      if (!target.groups.includes(c.id)) target.groups.push(c.id);
    }
  }
  const events = (state.brainObservations ?? []).flatMap((p) => p.changes);
  // Retained endpoints support comparison traces without inflating current inventory.
  return {
    mode: "mock",
    domainId: MOCK_DOMAIN,
    domainName: "Marques & portefeuille",
    publishedVersion: state.version,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...links.values()],
    groups: state.concepts
      .map((c) => ({ id: c.id, title: c.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events,
    sources: state.sources.map((s) => ({
      id: s.id,
      title: s.name,
      text: s.text,
    })),
    coverage: {
      from: state.brainObservedSince ?? null,
      publicationChanges: !!state.brainObservedSince,
      detail:
        "Changements enregistrés depuis l’activation du suivi. Les anciennes publications ne sont pas reconstruites. Les cibles nommées sans concept publié sont indiquées comme références.",
    },
    capabilities: { dynamics: false, memory: false, archives: false },
  };
}
