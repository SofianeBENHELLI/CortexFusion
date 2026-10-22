import { afterEach, expect, it, vi } from "vitest";
import { ApiError, type CortexApi } from "../api/client";
import { readApiBrain } from "./api-projection";
import { graphFixture, summaryFixture } from "./api-graph.fixture";
import type { PublicationWindow } from "../../../../packages/contracts/src/PublicationWindow";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const domain = id(1);
const concept: Concept = {
  concept_id: id(2),
  title: "Savoir",
  body: "Preuve",
  sources: [{ source_id: id(3), start: 0, end: 6 }],
  links: [],
};
const time = "2026-10-02T12:00:00Z";
function history(total: number) {
  let active = 0,
    peak = 0;
  const call = vi.fn(
    async (
      op: string,
      params: Record<string, string>,
      _body: unknown,
      options: { signal: AbortSignal; query?: Record<string, unknown> },
    ): Promise<unknown> => {
      const query = options.query ?? {};
      if (op === "domain.version")
        return {
          domain_id: domain,
          accepted_version: total,
          published_version: total,
        };
      if (op === "graph.window")
        return graphFixture(domain, [concept], query, total);
      if (op === "publications.list") {
        const upper = Number(query.before ?? total + 1);
        const sequences = Array.from(
          { length: Math.max(0, upper - 1) },
          (_, i) => upper - 1 - i,
        );
        const page = sequences.slice(0, 20);
        return {
          domain_id: domain,
          at_version: total,
          since: query.since ?? null,
          until: query.until ?? null,
          scan_limited: false,
          next_before: sequences.length > 20 ? page.at(-1)! : null,
          items: page.map((sequence) => ({
            sequence,
            proposal_id: id(sequence + 100),
            reason: "Synthétique",
            digest: "a".repeat(64),
            author: "owner",
            created_at: time,
            published: true,
            publication: { publisher: "owner", recorded_at: time },
          })),
        };
      }
      if (op === "proposals.diff_summary") {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        const sequence = Number(params.proposal_id.slice(-12)) - 100;
        return summaryFixture({
          proposal_id: params.proposal_id,
          comparison: "accepted_before_state",
          base_version: sequence - 1,
          published_version: total,
          stale_base: false,
          items: [
            {
              concept_id: concept.concept_id,
              before:
                sequence === 1
                  ? null
                  : { ...concept, title: `Version ${sequence - 1}` },
              after: { ...concept, title: `Version ${sequence}` },
            },
          ],
        });
      }
      throw new Error(op);
    },
  );
  return { api: { call } as unknown as CortexApi, call, peak: () => peak };
}
afterEach(() => vi.useRealTimers());

it.each([true, false])(
  "resolves off-page relation names only from loaded authorized evidence (older publication loaded: %s)",
  async (includeOlder) => {
    const { api, call } = history(2);
    const original = call.getMockImplementation()!;
    const target = { ...concept, concept_id: id(4), title: "Cible distante" };
    call.mockImplementation(async (op, p, b, options) => {
      if (op === "publications.list") {
        const page = (await original(op, p, b, options)) as PublicationWindow;
        return includeOlder
          ? page
          : { ...page, items: page.items.slice(0, 1), next_before: 2 };
      }
      if (op !== "proposals.diff_summary") return original(op, p, b, options);
      const sequence = Number(p.proposal_id.slice(-12)) - 100;
      const after =
        sequence === 1
          ? target
          : {
              ...concept,
              links: [
                {
                  target_id: target.concept_id,
                  kind: "associative" as const,
                  weight: 0.5,
                },
              ],
            };
      return summaryFixture({
        proposal_id: p.proposal_id,
        base_version: sequence - 1,
        published_version: 2,
        comparison: "accepted_before_state",
        stale_base: false,
        items: [{ concept_id: after.concept_id, before: null, after }],
      });
    });
    const result = await readApiBrain(api, domain, "Test", true);
    const relation = result.projection.events.find(
      (e) => e.kind === "relation_created",
    )!;
    expect(relation.title).toBe(
      `Savoir → ${includeOlder ? "Cible distante" : target.concept_id}`,
    );
    expect(relation.relation?.toTitle).toBe(
      includeOlder ? "Cible distante" : target.concept_id,
    );
    expect(
      result.projection.nodes.some((n) => n.id === target.concept_id),
    ).toBe(false);
    expect(
      call.mock.calls.filter((c) => c[0] === "concepts.read"),
    ).toHaveLength(0);
  },
);

function denseHistory() {
  const { api, call } = history(2);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    if (op !== "proposals.diff_summary") return original(op, p, b, options);
    const sequence = Number(p.proposal_id.slice(-12)) - 100;
    return summaryFixture({
      proposal_id: p.proposal_id,
      base_version: sequence - 1,
      published_version: 2,
      comparison: "accepted_before_state",
      stale_base: false,
      items: Array.from({ length: 50 }, (_, i) => ({
        concept_id: id(i + sequence * 1000),
        before: null,
        after: {
          ...concept,
          concept_id: id(i + sequence * 1000),
          sources: [{ source_id: id(sequence + 10), start: 0, end: 6 }],
          links: Array.from({ length: 100 }, (_, j) => ({
            target_id: id(j + 5000),
            kind: "associative" as const,
            weight: 0.5,
          })),
        },
      })),
    });
  });
  return { api, call };
}

it("paginates whole dense publications below 10,000 events without gaps or extra evidence", async () => {
  const { api, call } = denseHistory();
  const first = await readApiBrain(api, domain, "Test", true, { maxPages: 5 });
  expect(first.projection.events).toHaveLength(5050);
  expect(first.observedPublications).toBe(1);
  expect(first.eventLimited).toBe(true);
  expect(first.nextBefore).toBe(2);
  expect(first.partialHistory).toBe(true);
  expect(Object.keys(first.evidence)).toEqual([id(12)]);
  const last = await readApiBrain(api, domain, "Test", true, {
    maxPages: 5,
    before: first.nextBefore!,
    atVersion: 2,
  });
  expect(last.projection.events).toHaveLength(5050);
  expect(last.nextBefore).toBeNull();
  expect(last.eventLimited).toBe(false);
  expect(Object.keys(last.evidence)).toEqual([id(11)]);
  expect(
    new Set(
      [...first.projection.events, ...last.projection.events].map((e) => e.id),
    ).size,
  ).toBe(10100);
  // Each observed server page still gets its complete authorization recheck.
  expect(
    call.mock.calls.filter((c) => c[0] === "publications.list"),
  ).toHaveLength(4);
});

it("still withholds a dense page when its final historical authorization check changes", async () => {
  const { api, call } = denseHistory();
  const original = call.getMockImplementation()!;
  let pages = 0;
  call.mockImplementation(async (op, p, b, options) => {
    const value = await original(op, p, b, options);
    if (op === "publications.list" && ++pages === 2)
      return { ...(value as PublicationWindow), items: [] };
    return value;
  });
  await expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 5 }),
  ).rejects.toMatchObject({ code: "projection_changed" });
});

it("rejects a single publication over the event budget without splitting or skipping it", async () => {
  const { api, call } = history(1);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    if (op !== "proposals.diff_summary") return original(op, p, b, options);
    return summaryFixture({
      proposal_id: p.proposal_id,
      base_version: 0,
      published_version: 1,
      comparison: "accepted_before_state",
      stale_base: false,
      items: Array.from({ length: 50 }, (_, i) => {
        const value = { ...concept, concept_id: id(i + 1000) };
        const links = (offset: number) =>
          Array.from({ length: 100 }, (_, j) => ({
            target_id: id(j + offset),
            kind: "associative" as const,
            weight: 0.5,
          }));
        return {
          concept_id: value.concept_id,
          before: { ...value, links: links(5000) },
          after: { ...value, title: "Titre revu", links: links(6000) },
        };
      }),
    });
  });
  await expect(readApiBrain(api, domain, "Test", true)).rejects.toMatchObject({
    code: "read_limit",
  });
});

it("extends to all 25 publications under one version/time window and revalidates both pages", async () => {
  const { api, call, peak } = history(25);
  const window = {
    maxPages: 5 as const,
    since: "2026-10-01T00:00:00Z",
    until: "2026-10-03T00:00:00Z",
  };
  const result = await readApiBrain(api, domain, "Test", true, window);
  expect(result.observedPublications).toBe(25);
  expect(result.projection.events).toHaveLength(25);
  expect(new Set(result.projection.events.map((e) => e.id)).size).toBe(25);
  expect(result.projection.coverage.partial).toBe(false);
  expect(result.nextBefore).toBeNull();
  expect(peak()).toBeLessThanOrEqual(4);
  const queries = call.mock.calls
    .filter((c) => c[0] === "publications.list")
    .map((c) => c[3].query);
  expect(queries.map((q) => q?.before)).toEqual([undefined, 6, undefined, 6]);
  expect(
    queries.every(
      (q) =>
        q?.at_version === 25 &&
        q.since === window.since &&
        q.until === window.until,
    ),
  ).toBe(true);
});
it("keeps history above 100 publications partial and continues without overlap", async () => {
  const { api, call } = history(121);
  const first = await readApiBrain(api, domain, "Test", true, { maxPages: 5 });
  expect(first.observedPublications).toBe(100);
  expect(first.nextBefore).toBe(22);
  expect(first.projection.coverage.partial).toBe(true);
  expect(
    call.mock.calls.filter((c) => c[0] === "publications.list"),
  ).toHaveLength(10);
  const rest = await readApiBrain(api, domain, "Test", true, {
    maxPages: 5,
    before: first.nextBefore!,
    atVersion: 121,
  });
  expect(rest.observedPublications).toBe(21);
  expect(rest.projection.coverage.partial).toBe(true);
  expect(rest.nextBefore).toBeNull();
  expect(
    new Set(
      [...first.projection.events, ...rest.projection.events].map((e) => e.id),
    ).size,
  ).toBe(121);
});
it("bounds repeated empty authorization scans to five pages, with a usable continuation", async () => {
  const { api, call } = history(800);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    if (op !== "publications.list") return original(op, p, b, options);
    return {
      domain_id: domain,
      at_version: 800,
      since: null,
      until: null,
      items: [],
      scan_limited: true,
      next_before: Number(options.query?.before ?? 801) - 100,
    };
  });
  const result = await readApiBrain(api, domain, "Test", true, { maxPages: 5 });
  expect(result).toMatchObject({
    nextBefore: 301,
    scanLimited: true,
    observedPublications: 0,
    partialHistory: true,
  });
  expect(
    call.mock.calls.filter((c) => c[0] === "publications.list"),
  ).toHaveLength(10);
});
it("withholds the entire observation when historical rights change after loading differences", async () => {
  const { api, call } = history(25);
  const original = call.getMockImplementation()!;
  let pages = 0;
  call.mockImplementation(async (op, p, b, options) => {
    const result = await original(op, p, b, options);
    if (op === "publications.list" && ++pages === 3)
      return { ...(result as PublicationWindow), items: [] };
    return result;
  });
  await expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 5 }),
  ).rejects.toMatchObject({ status: 409 });
});
it("does not mark undated legacy publications as fully covered even at the end of the scan", async () => {
  const { api, call } = history(25);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    const result = await original(op, p, b, options);
    if (op === "publications.list") {
      const page = result as PublicationWindow;
      return {
        ...page,
        items: page.items.map((c) => ({ ...c, publication: null })),
      };
    }
    return result;
  });
  const result = await readApiBrain(api, domain, "Test", true, { maxPages: 5 });
  expect(result.observedPublications).toBe(0);
  expect(result.projection.coverage.partial).toBe(true);
  expect(result.nextBefore).toBeNull();
});
it("rejects a nondecreasing continuation and never requests arbitrary depth", async () => {
  const { api, call } = history(25);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    const result = await original(op, p, b, options);
    if (op === "publications.list")
      return {
        ...(result as PublicationWindow),
        next_before: Number(options.query?.before ?? 26),
      };
    return result;
  });
  await expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 5 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 6 as 5 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
it("aborts remaining requests after any difference failure instead of publishing partial counts", async () => {
  const { api, call } = history(25);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, options) => {
    if (op === "proposals.diff_summary" && p.proposal_id === id(123))
      throw new ApiError(403, "denied");
    return original(op, p, b, options);
  });
  await expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 5 }),
  ).rejects.toMatchObject({ status: 403 });
  expect(call.mock.calls.every((c) => c[3].signal.aborted)).toBe(true);
});
it("enforces the whole-observation deadline and honors cancellation before starting", async () => {
  vi.useFakeTimers();
  const api = {
    call: vi.fn(
      (_op, _p, _b, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    ),
  } as unknown as CortexApi;
  const pending = expect(
    readApiBrain(api, domain, "Test", true, { maxPages: 5 }),
  ).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(45000);
  await pending;
  const controller = new AbortController();
  controller.abort();
  await expect(
    readApiBrain(api, domain, "Test", true, {}, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
