import { expect, it, vi } from "vitest";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import { CortexApi, ApiError } from "../api/client";
import { graphFixture, summaryFixture } from "./api-graph.fixture";
import { validateGraphWindow } from "./api-graph";
import { readApiBrain } from "./api-projection";
import { defaultSelection, selectEvents, countChanges } from "./model";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const domain = id(999),
  source = id(998);
const concepts: Concept[] = Array.from({ length: 30 }, (_, i) => ({
  concept_id: id(i + 1),
  title: `Node ${i}`,
  body: `Evidence ${i}`,
  maturity: "observed",
  sources: [{ source_id: source, start: 0, end: 8 }],
  links: [],
}));
concepts[0].links = concepts
  .slice(1)
  .map((c) => ({ target_id: c.concept_id, kind: "associative", weight: 0.5 }));
it.each([
  { domain_id: id(666) },
  { at_version: 2 },
  { limit: 999 },
  { visibility: "bad" },
  { nodes: [] },
  { scope_ids: [] },
  { next_after: id(777) },
  { edges_truncated: true },
  { scope_totals: { concepts: 1, relations: 29 } },
  { boundary_outgoing_relations: 0 },
])("rejects an inconsistent graph window %j", (fault) => {
  expect(() =>
    validateGraphWindow(
      { ...graphFixture(domain, concepts), ...fault },
      domain,
      1,
      {},
    ),
  ).toThrow(ApiError);
});
it("counts every observed event in the focused scope even when its node is on another graph page", async () => {
  const commit = {
    sequence: 1,
    proposal_id: id(500),
    author: "owner",
    reason: "Review",
    digest: "a".repeat(64),
    created_at: "2026-10-02T10:00:00Z",
    published: true,
    publication: { publisher: "owner", recorded_at: "2026-10-02T11:00:00Z" },
  };
  const call = vi.fn(
    async (
      op: string,
      _path: unknown,
      _body: unknown,
      options: { query?: Record<string, unknown> },
    ) => {
      if (op === "domain.version")
        return { domain_id: domain, accepted_version: 1, published_version: 1 };
      if (op === "graph.window")
        return graphFixture(domain, concepts, options.query);
      if (op === "publications.list")
        return {
          domain_id: domain,
          at_version: 1,
          since: null,
          until: null,
          items: [commit],
          next_before: null,
          scan_limited: false,
        };
      if (op === "proposals.diff_summary")
        return summaryFixture({
          proposal_id: id(500),
          comparison: "accepted_before_state",
          stale_base: false,
          base_version: 0,
          published_version: 1,
          items: concepts.map((c) => ({
            concept_id: c.concept_id,
            before: null,
            after: c,
          })),
        });
      throw new Error(op);
    },
  );
  const result = await readApiBrain(
    { call } as unknown as CortexApi,
    domain,
    "Test",
    true,
    {},
    undefined,
    { focus: id(1) },
  );
  expect(result.projection.nodes).toHaveLength(24);
  expect(result.projection.window?.totals).toEqual({
    concepts: 30,
    relations: 29,
  });
  const changes = selectEvents(
    result.projection,
    { ...defaultSelection, level: "concepts", group: id(1) },
    Date.parse("2026-10-02T12:00:00Z"),
  );
  expect(countChanges(changes)).toMatchObject({ concepts: 30, created: 29 });
  expect(
    call.mock.calls.some(
      ([op]) => op === "concepts.list" || op === "concepts.read",
    ),
  ).toBe(false);
});
it("loads one selected detail and rejects a visibility change before exposing it", async () => {
  let reads = 0;
  const call = vi.fn(
    async (
      op: string,
      path: { concept_id?: string },
      _body: unknown,
      options: { query?: Record<string, unknown> },
    ) => {
      if (op === "domain.version")
        return { domain_id: domain, accepted_version: 1, published_version: 1 };
      if (op === "concepts.read")
        return concepts.find((c) => c.concept_id === path.concept_id);
      if (op === "graph.window") {
        if (++reads === 2) throw new ApiError(409, "changed");
        return graphFixture(domain, concepts, options.query);
      }
      throw new Error(op);
    },
  );
  await expect(
    readApiBrain(
      { call } as unknown as CortexApi,
      domain,
      "Test",
      false,
      {},
      undefined,
      { focus: id(30), locate: id(30), detail: id(30) },
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(call.mock.calls.filter(([op]) => op === "concepts.read")).toHaveLength(
    1,
  );
  expect(call.mock.calls.some(([op]) => op === "concepts.list")).toBe(false);
});

it("accepts relevance-ordered search cursors without weakening normal graph ordering", () => {
  const data = concepts.slice(1, 4).map((c) => ({ ...c, links: [] }));
  const page = graphFixture(domain, data, { search: "Node", limit: 3 });
  page.nodes.reverse();
  page.next_after = page.nodes.at(-1)!.concept_id;
  page.previous_before = page.nodes[0].concept_id;
  expect(validateGraphWindow(page, domain, 1, {}, 3, "Node")).toBe(page);
  expect(() =>
    validateGraphWindow({ ...page, search: null }, domain, 1, {}, 3),
  ).toThrow(ApiError);
  expect(() =>
    validateGraphWindow(
      { ...page, next_after: page.nodes[0].concept_id },
      domain,
      1,
      {},
      3,
      "Node",
    ),
  ).toThrow(ApiError);
  expect(() =>
    validateGraphWindow(
      { ...page, nodes: [page.nodes[0], page.nodes[0]] },
      domain,
      1,
      {},
      3,
      "Node",
    ),
  ).toThrow(ApiError);
});
