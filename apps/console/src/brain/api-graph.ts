import type {
  GraphWindow,
  GraphNodeSummary,
} from "../../../../packages/contracts/src/GraphWindow";
import { ApiError, CortexApi } from "../api/client";
import type { BrainNode } from "./model";
import { isUuid } from "../api/uuid";

export interface GraphRequest {
  after?: string;
  before?: string;
  atVersion?: number;
  visibility?: string;
  focus?: string;
  locate?: string;
  detail?: string;
  historical?: boolean;
}
export { isUuid };
const count = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
const invalid = () => new ApiError(200, "invalid_response");
export const summaryNode = (n: GraphNodeSummary): BrainNode => ({
  id: n.concept_id,
  title: n.title,
  description: "Sélectionnez ce concept pour lire son contenu et ses preuves.",
  kind: "concept",
  groups: [n.concept_id],
  sourceIds: [],
  maturity: n.maturity,
});

export function validateGraphWindow(
  page: GraphWindow,
  domain: string,
  version: number,
  request: GraphRequest,
  limit = 24,
  search?: string,
) {
  const validNode = (n: GraphNodeSummary) =>
    n &&
    isUuid(n.concept_id) &&
    typeof n.title === "string" &&
    n.title.trim().length > 0 &&
    [...n.title].length <= 200 &&
    ["emerging", "observed", "established", "reference"].includes(n.maturity) &&
    count(n.source_count) &&
    n.source_count > 0 &&
    count(n.outgoing_relations) &&
    count(n.incoming_relations);
  if (
    !page ||
    page.domain_id !== domain ||
    page.at_version !== version ||
    page.limit !== limit ||
    page.direction !== "outgoing" ||
    !/^[0-9a-f]{64}$/.test(page.visibility) ||
    (request.visibility && page.visibility !== request.visibility) ||
    page.after !== (request.after ?? null) ||
    page.before !== (request.before ?? null) ||
    page.locate !== (request.locate ?? null) ||
    page.search !== (search ?? null) ||
    (request.focus
      ? !validNode(page.focus!) || page.focus?.concept_id !== request.focus
      : page.focus !== null) ||
    !Array.isArray(page.nodes) ||
    page.nodes.length > limit ||
    page.nodes.some((n) => !validNode(n)) ||
    !Array.isArray(page.edges) ||
    page.edges.length > 120 ||
    typeof page.edges_truncated !== "boolean" ||
    !count(page.internal_relations) ||
    !count(page.boundary_outgoing_relations)
  )
    throw invalid();
  for (const totals of [page.domain_totals, page.scope_totals])
    if (!totals || !count(totals.concepts) || !count(totals.relations))
      throw invalid();
  const ids = new Set(page.nodes.map((n) => n.concept_id));
  const neighbors = page.nodes.filter((n) => n.concept_id !== request.focus);
  // Search uses server relevance order with UUID ties; ordinary windows use UUID order.
  // Cursor endpoints and unique identities remain checked in both modes.
  const stream = neighbors.map((n) => n.concept_id);
  const edgeIds = new Set<string>();
  if (
    ids.size !== page.nodes.length ||
    (!search &&
      page.nodes.some(
        (n, i) => i > 0 && n.concept_id <= page.nodes[i - 1].concept_id,
      )) ||
    (request.focus && !ids.has(request.focus)) ||
    (request.locate && !ids.has(request.locate)) ||
    (!search &&
      stream.some(
        (id) =>
          (request.after && id <= request.after) ||
          (request.before && id >= request.before),
      ))
  )
    throw invalid();
  if (
    (page.next_after !== null &&
      (!isUuid(page.next_after) || page.next_after !== stream.at(-1))) ||
    (page.previous_before !== null &&
      (!isUuid(page.previous_before) || page.previous_before !== stream[0]))
  )
    throw invalid();
  if (
    page.domain_totals.concepts < page.scope_totals.concepts ||
    page.scope_totals.concepts < ids.size ||
    page.domain_totals.relations < page.scope_totals.relations ||
    page.internal_relations + page.boundary_outgoing_relations >
      page.scope_totals.relations ||
    page.nodes.reduce((sum, n) => sum + n.outgoing_relations, 0) !==
      page.internal_relations + page.boundary_outgoing_relations ||
    page.edges.length !== Math.min(120, page.internal_relations) ||
    page.edges_truncated !== page.internal_relations > 120
  )
    throw invalid();
  if (
    !request.focus &&
    !search &&
    (page.domain_totals.concepts !== page.scope_totals.concepts ||
      page.domain_totals.relations !== page.scope_totals.relations)
  )
    throw invalid();
  if (
    page.nodes.length === page.domain_totals.concepts &&
    page.boundary_outgoing_relations !== 0
  )
    throw invalid();
  if (request.focus) {
    if (
      !Array.isArray(page.scope_ids) ||
      page.scope_ids.length > 101 ||
      page.scope_ids.some((id) => !isUuid(id)) ||
      new Set(page.scope_ids).size !== page.scope_totals.concepts ||
      page.scope_ids.length !== page.scope_totals.concepts ||
      [...ids].some((id) => !page.scope_ids!.includes(id))
    )
      throw invalid();
  } else if (page.scope_ids !== null) throw invalid();
  for (const edge of page.edges) {
    if (
      !edge ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      !["structural", "associative"].includes(edge.kind) ||
      !Number.isFinite(edge.weight) ||
      edge.weight < 0 ||
      edge.weight > 1 ||
      typeof edge.primary !== "boolean" ||
      (edge.primary && edge.kind !== "structural")
    )
      throw invalid();
    edgeIds.add(JSON.stringify([edge.from, edge.to, edge.kind]));
  }
  if (edgeIds.size !== page.edges.length) throw invalid();
  return page;
}
export async function readGraphWindow(
  api: CortexApi,
  domain: string,
  version: number,
  request: GraphRequest = {},
  signal?: AbortSignal,
  limit = 24,
  search?: string,
) {
  if (request.atVersion !== undefined && request.atVersion !== version)
    throw new ApiError(409, "projection_changed");
  const page = await api.call("graph.window", { domain }, undefined, {
    signal,
    query: {
      limit,
      at_version: version,
      direction: "outgoing",
      ...(request.visibility ? { visibility: request.visibility } : {}),
      ...(request.after ? { after: request.after } : {}),
      ...(request.before ? { before: request.before } : {}),
      ...(request.focus ? { focus: request.focus } : {}),
      ...(request.locate ? { locate: request.locate } : {}),
      ...(search ? { search } : {}),
    },
  });
  return validateGraphWindow(page, domain, version, request, limit, search);
}
