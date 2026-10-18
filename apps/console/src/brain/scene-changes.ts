import { changeLabels, type BrainChange } from "./model";
import type { GraphScene } from "./scene";

export const sceneLinkKey = (from: string, to: string, kind: string) =>
  JSON.stringify([from, to, kind]);
export type RelationObservation = {
  latest: BrainChange;
  events: BrainChange[];
  label: string;
};

/** Observations in the loaded journal, never a reconstruction of past topology. */
export function indexSceneChanges(events: readonly BrainChange[]) {
  const relations = new Map<string, RelationObservation>();
  const nodes = new Map<string, Set<string>>();
  const seen = new Set<string>();
  // Publication order is authoritative; timestamps and IDs break ties only.
  const ordered = [...events].sort(
    (a, b) =>
      b.version - a.version ||
      Date.parse(b.time) - Date.parse(a.time) ||
      a.id.localeCompare(b.id),
  );
  for (const event of ordered) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    for (const id of event.nodeIds) {
      const labels = nodes.get(id) ?? new Set<string>();
      labels.add(changeLabels[event.kind]);
      nodes.set(id, labels);
    }
    const r = event.relation;
    if (!r || !event.kind.startsWith("relation_")) continue;
    const key = sceneLinkKey(r.from, r.to, r.kind);
    const observation = relations.get(key) ?? {
      latest: event,
      events: [],
      label: "",
    };
    observation.events.push(event);
    relations.set(key, observation);
  }
  for (const observation of relations.values())
    observation.label = [
      ...new Set(observation.events.map((e) => changeLabels[e.kind])),
    ].join(" · ");
  return {
    nodes: new Map(
      [...nodes].map(([id, labels]) => [id, [...labels].join(" · ")]),
    ),
    relations,
  };
}

/** Exact current endpoints, direction and type only. No inference from cells. */
export function observedSceneLinks(
  scene: GraphScene,
  observations: ReadonlyMap<string, RelationObservation>,
) {
  const result = new Map<
    string,
    {
      key: string;
      fromTitle: string;
      toTitle: string;
      observation: RelationObservation;
    }
  >();
  for (const link of scene.links) {
    const a = scene.glyphs[link.from],
      b = scene.glyphs[link.to];
    if (link.aggregate || !a.concept_id || !b.concept_id) continue;
    const key = sceneLinkKey(a.concept_id, b.concept_id, link.kind);
    const observation = observations.get(key);
    if (observation)
      result.set(key, {
        key,
        fromTitle: a.title,
        toTitle: b.title,
        observation,
      });
  }
  return [...result.values()].sort(
    (a, b) =>
      b.observation.latest.version - a.observation.latest.version ||
      a.key.localeCompare(b.key),
  );
}
