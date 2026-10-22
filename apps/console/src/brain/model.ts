/** Presentation read model. Adapters must declare coverage; this is not a backend wire contract. */
export type ChangeKind =
  | "concept_created"
  | "concept_updated"
  | "concept_removed"
  | "relation_created"
  | "relation_removed"
  | "relation_strengthened"
  | "relation_weakened"
  | "relation_primary_changed"
  | "concept_archived"
  | "relation_archived"
  | "concept_reactivated"
  | "memory_entered"
  | "memory_left";

export interface BrainNode {
  id: string;
  title: string;
  description: string;
  kind: "concept" | "reference";
  groups: string[];
  sourceIds: string[];
  maturity?: string;
  declaredStatus?: string;
  classification?: string;
}
export interface BrainRelation {
  id: string;
  from: string;
  to: string;
  kind: "structural" | "associative" | "unspecified";
  weight: number | null;
  primary?: boolean;
  sourceIds: string[];
  toTitle?: string;
}
export interface BrainChange {
  evidence?: { source_id: string; start: number; end: number }[];
  id: string;
  publicationId: string;
  time: string;
  version: number;
  kind: ChangeKind;
  title: string;
  detail: string;
  nodeIds: string[];
  groupIds: string[];
  sourceIds: string[];
  relation?: BrainRelation;
}
export interface PublicationObservation {
  id: string;
  time: string;
  version: number;
  proposalId: string;
  changes: BrainChange[];
}
export interface BrainGroup {
  subtitle?: string;
  id: string;
  title: string;
  territoryId?: string;
  parentId?: string;
  grouping?: "family" | "brand" | "alphabetical";
}
export interface BrainProjection {
  mode: "mock" | "api" | "catalog";
  domainId: string;
  domainName: string;
  publishedVersion: number;
  nodes: BrainNode[];
  relations: BrainRelation[];
  groups: BrainGroup[];
  territories?: { id: string; title: string; groupIds: string[] }[];
  events: BrainChange[];
  window?: {
    focus: string | null;
    scopeIds: string[] | null;
    totals: { concepts: number; relations: number };
    domainTotals: { concepts: number; relations: number };
    loaded: number;
    internalRelations: number;
    boundaryRelations: number;
    edgesTruncated: boolean;
  };
  sources: {
    id: string;
    title: string;
    text?: string;
    fullText?: string;
    hash?: string;
  }[];
  coverage: {
    from: string | null;
    to?: string;
    /** Exact only for changes recorded by this adapter, not retrospective reconstruction. */
    publicationChanges: boolean;
    partial?: boolean;
    detail: string;
  };
  capabilities: { dynamics: boolean; memory: boolean; archives: boolean };
}

export interface BrainSelection {
  level: "domain" | "groups" | "concepts";
  territory: string | null;
  group: string | null;
  event: string | null;
  node: string | null;
  relation: string | null;
  period: "all" | "1" | "7" | "30";
  interval: { from: string; to: string } | null;
  mode: "changes" | "overview";
  colors: boolean;
  page: number;
}
export const defaultSelection: BrainSelection = {
  level: "domain",
  territory: null,
  group: null,
  event: null,
  node: null,
  relation: null,
  period: "all",
  interval: null,
  mode: "changes",
  colors: false,
  page: 0,
};
export function readSelection(params: URLSearchParams): BrainSelection {
  const level = params.get("level"),
    period = params.get("period");
  const page = Number(params.get("page"));
  const from = params.get("time_from"),
    to = params.get("time_to");
  const validTime = (value: string | null): value is string =>
    !!value &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  return {
    level: level === "groups" || level === "concepts" ? level : "domain",
    territory: params.get("territory"),
    group: params.get("group"),
    event: params.get("event"),
    node: params.get("node"),
    relation: params.get("relation"),
    period:
      period === "1" || period === "7" || period === "30" ? period : "all",
    interval:
      validTime(from) && validTime(to) && from < to ? { from, to } : null,
    mode: params.get("mode") === "overview" ? "overview" : "changes",
    colors: params.get("colors") === "1",
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
  };
}
export function writeSelection(selection: BrainSelection): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["level", "period", "mode"] as const) {
    if (selection[key] !== defaultSelection[key])
      params.set(key, selection[key]);
  }
  if (selection.territory) params.set("territory", selection.territory);
  if (selection.group) params.set("group", selection.group);
  if (selection.event) params.set("event", selection.event);
  if (selection.node) params.set("node", selection.node);
  if (selection.relation) params.set("relation", selection.relation);
  if (selection.colors) params.set("colors", "1");
  if (selection.interval) {
    params.set("time_from", selection.interval.from);
    params.set("time_to", selection.interval.to);
  }
  if (selection.page) params.set("page", String(selection.page));
  return params;
}
export function periodStart(
  period: BrainSelection["period"],
  now: number,
): number {
  return period === "all"
    ? -Infinity
    : now - Number(period) * 24 * 60 * 60 * 1000;
}
export function selectEvents(
  projection: BrainProjection,
  selection: BrainSelection,
  now: number,
): BrainChange[] {
  const from = periodStart(selection.period, now);
  const territory = projection.territories?.find(
    (t) => t.id === selection.territory,
  );
  // Neighborhoods include authorized neighboring concepts. Their creation events
  // must use the same membership as the stock metrics, with outgoing relations.
  const scopeNodes =
    selection.level !== "domain" && selection.group
      ? new Set(
          projection.window?.focus === selection.group &&
          projection.window.scopeIds
            ? projection.window.scopeIds
            : projection.nodes
                .filter((n) => n.groups.includes(selection.group!))
                .map((n) => n.id),
        )
      : null;
  const unique = new Map<string, BrainChange>();
  for (const event of projection.events) {
    const time = Date.parse(event.time);
    if (!Number.isFinite(time) || time < from || time > now) continue;
    if (
      selection.interval &&
      (time < Date.parse(selection.interval.from) ||
        time >= Date.parse(selection.interval.to))
    )
      continue;
    if (
      selection.level !== "domain" &&
      selection.group &&
      !event.groupIds.includes(selection.group) &&
      !(event.relation
        ? scopeNodes?.has(event.relation.from)
        : event.nodeIds.some((id) => scopeNodes?.has(id)))
    )
      continue;
    if (
      selection.level === "groups" &&
      territory &&
      !event.groupIds.some((id) => territory.groupIds.includes(id))
    )
      continue;
    unique.set(event.id, event);
  }
  return [...unique.values()].sort(
    (a, b) =>
      Date.parse(b.time) - Date.parse(a.time) ||
      b.version - a.version ||
      a.id.localeCompare(b.id),
  );
}
export function countChanges(events: BrainChange[]) {
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  const count = (...kinds: ChangeKind[]) =>
    unique.filter((e) => kinds.includes(e.kind)).length;
  return {
    concepts: count("concept_created"),
    created: count("relation_created"),
    strengthened: count("relation_strengthened"),
    weakened: count("relation_weakened"),
    primaryChanged: count("relation_primary_changed"),
    archived: count("relation_archived", "concept_archived"),
    removed: count("relation_removed"),
  };
}
/** Unambiguous, stable tuple encoding; names containing separators must not collide. */
export const relationId = (
  domain: string,
  from: string,
  to: string,
  kind: BrainRelation["kind"],
) => JSON.stringify([domain, from, to, kind]);

export const changeLabels: Record<ChangeKind, string> = {
  concept_created: "Concept créé",
  concept_updated: "Concept enrichi",
  concept_removed: "Concept retiré",
  relation_created: "Nouvelle relation",
  relation_removed: "Relation retirée",
  relation_strengthened: "Relation renforcée",
  relation_weakened: "Poids en baisse",
  relation_primary_changed: "Relation principale modifiée",
  concept_archived: "Concept archivé",
  relation_archived: "Relation archivée",
  concept_reactivated: "Concept réactivé",
  memory_entered: "Entrée en court terme",
  memory_left: "Sortie du court terme",
};
export function changeSymbol(kind: ChangeKind) {
  if (kind === "relation_created" || kind === "concept_created") return "+";
  if (kind === "relation_strengthened") return "↑";
  if (kind === "relation_weakened") return "↓";
  if (kind.includes("archived")) return "▱";
  if (kind === "relation_removed" || kind === "concept_removed") return "−";
  return "·";
}
