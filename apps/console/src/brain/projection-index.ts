import type {
  BrainChange,
  BrainNode,
  BrainProjection,
  BrainGroup,
} from "./model";

/** Index memberships once, instead of scanning the entire graph for every territory. */
export function indexProjection(projection: BrainProjection) {
  const nodes = new Map(projection.nodes.map((n) => [n.id, n]));
  const members = new Map<string, BrainNode[]>();
  for (const node of projection.nodes)
    for (const group of new Set(node.groups)) {
      const list = members.get(group) ?? [];
      list.push(node);
      members.set(group, list);
    }
  const groups = new Map(projection.groups.map((g) => [g.id, g]));
  const children = new Map<string | null, BrainGroup[]>();
  for (const group of projection.groups) {
    const parent = group.parentId ?? null,
      list = children.get(parent) ?? [];
    list.push(group);
    children.set(parent, list);
  }
  return { nodes, members, groups, children };
}
export function indexChanges(events: BrainChange[]) {
  const byNode = new Map<string, BrainChange[]>(),
    byGroup = new Map<string, BrainChange[]>();
  for (const event of events) {
    for (const [ids, index] of [
      [event.nodeIds, byNode],
      [event.groupIds, byGroup],
    ] as const)
      for (const id of new Set(ids)) {
        const list = index.get(id) ?? [];
        list.push(event);
        index.set(id, list);
      }
  }
  return { byNode, byGroup };
}
