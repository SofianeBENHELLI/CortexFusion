import type { BrainProjection, BrainRelation } from "./model";
export interface MacroLink {
  id: string;
  from: string;
  to: string;
  relations: BrainRelation[];
}
/** A macro line counts original directed links in both directions; it is not a new semantic link. */
export function macroLinks(
  projection: BrainProjection,
  level: "domain" | "groups",
  relations = projection.relations,
  visibleGroups?: Set<string>,
): MacroLink[] {
  const groups = new Map(
    projection.nodes.map((n) => [
      n.id,
      visibleGroups && level === "groups"
        ? n.groups.find((id) => visibleGroups.has(id))
        : n.groups[0],
    ]),
  );
  const territories = new Map(
    projection.groups.map((g) => [g.id, g.territoryId]),
  );
  const pair = new Map<string, MacroLink>(),
    seen = new Set<string>();
  for (const relation of relations) {
    if (seen.has(relation.id)) continue;
    seen.add(relation.id);
    let from = groups.get(relation.from),
      to = groups.get(relation.to);
    if (level === "domain") {
      from = territories.get(from ?? "");
      to = territories.get(to ?? "");
    }
    if (!from || !to || from === to) continue;
    if (from > to) [from, to] = [to, from];
    const id = JSON.stringify(["macro", level, from, to]),
      existing = pair.get(id) ?? { id, from, to, relations: [] };
    existing.relations.push(relation);
    pair.set(id, existing);
  }
  return [...pair.values()].sort(
    (a, b) =>
      b.relations.length - a.relations.length || a.id.localeCompare(b.id),
  );
}
