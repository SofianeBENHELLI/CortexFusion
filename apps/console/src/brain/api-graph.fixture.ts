import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import type { GraphWindow } from "../../../../packages/contracts/src/GraphWindow";
import { ApiError } from "../api/client";
import { createHash } from "node:crypto";
import type { ProposalDifference } from "../../../../packages/contracts/src/ProposalDifference";
import type { ProposalDifferenceSummary } from "../../../../packages/contracts/src/ProposalDifferenceSummary";

export function summaryFixture(
  diff: ProposalDifference,
): ProposalDifferenceSummary {
  const compact = (c: Concept | null) => {
    if (!c) return null;
    const { body, ...metadata } = c;
    return {
      ...metadata,
      body_sha256: createHash("sha256").update(body).digest("hex"),
    };
  };
  return {
    ...diff,
    items: diff.items.map((item) => ({
      ...item,
      before: compact(item.before),
      after: compact(item.after),
    })),
  };
}

/** Synthetic transport fixture; body/evidence are intentionally absent from summaries. */
export function graphFixture(
  domain: string,
  concepts: Concept[],
  query: Record<string, unknown> = {},
  version = 1,
): GraphWindow {
  const focus = concepts.find((c) => c.concept_id === query.focus);
  if (query.focus && !focus) throw new ApiError(404, "not_found");
  const scope = focus
    ? concepts.filter(
        (c) =>
          c === focus || focus.links?.some((l) => l.target_id === c.concept_id),
      )
    : concepts.filter(
        (c) =>
          !query.search ||
          `${c.title} ${c.body}`
            .toLowerCase()
            .includes(String(query.search).toLowerCase()),
      );
  if (query.locate && !scope.some((c) => c.concept_id === query.locate))
    throw new ApiError(404, "not_found");
  const stream = scope
    .filter((c) => c !== focus)
    .sort((a, b) => a.concept_id.localeCompare(b.concept_id));
  const limit = Number(query.limit ?? 24),
    size = limit - (focus ? 1 : 0);
  let start = 0;
  if (query.after)
    start = stream.filter((c) => c.concept_id <= String(query.after)).length;
  if (query.before)
    start = Math.max(
      0,
      stream.filter((c) => c.concept_id < String(query.before)).length - size,
    );
  if (query.locate && query.locate !== focus?.concept_id)
    start =
      Math.floor(
        stream.findIndex((c) => c.concept_id === query.locate) / size,
      ) * size;
  const selected = [
    ...(focus ? [focus] : []),
    ...stream.slice(start, start + size),
  ].sort((a, b) => a.concept_id.localeCompare(b.concept_id));
  const ids = new Set(selected.map((c) => c.concept_id));
  const allEdges = concepts.flatMap((c) =>
    (c.links ?? []).map((l) => ({
      from: c.concept_id,
      to: l.target_id,
      kind: l.kind,
      weight: l.weight ?? 1,
      primary: l.primary ?? false,
    })),
  );
  const edges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const summary = (c: Concept) => ({
    concept_id: c.concept_id,
    title: c.title,
    maturity: c.maturity ?? "emerging",
    source_count: new Set(c.sources.map((s) => s.source_id)).size,
    outgoing_relations: (c.links ?? []).length,
    incoming_relations: allEdges.filter((e) => e.to === c.concept_id).length,
  });
  return {
    domain_id: domain,
    at_version: version,
    visibility: "a".repeat(64),
    after: (query.after as string) ?? null,
    before: (query.before as string) ?? null,
    locate: (query.locate as string) ?? null,
    search: (query.search as string) ?? null,
    direction: "outgoing",
    focus: focus ? summary(focus) : null,
    scope_ids: focus ? scope.map((c) => c.concept_id) : null,
    limit,
    domain_totals: { concepts: concepts.length, relations: allEdges.length },
    scope_totals: {
      concepts: scope.length,
      relations: scope.reduce((sum, c) => sum + (c.links ?? []).length, 0),
    },
    nodes: selected.map(summary),
    edges: edges.slice(0, 120),
    internal_relations: edges.length,
    boundary_outgoing_relations: allEdges.filter(
      (e) => ids.has(e.from) && !ids.has(e.to),
    ).length,
    edges_truncated: edges.length > 120,
    next_after:
      start + size < stream.length ? stream[start + size - 1].concept_id : null,
    previous_before: start > 0 ? stream[start].concept_id : null,
  };
}
