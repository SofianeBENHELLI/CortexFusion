import { describe, it, expect, vi } from "vitest";
import { CortexApi, ApiError } from "../api/client";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import { publicationChanges, readApiBrain } from "./api-projection";
import { countChanges, selectEvents, defaultSelection } from "./model";
import { graphFixture, summaryFixture } from "./api-graph.fixture";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const domain = id(1),
  source = id(2),
  a = id(3),
  b = id(4),
  proposal = id(5);
const concept = (ident = a): Concept => ({
  concept_id: ident,
  title: ident === a ? "Alpha" : "Beta",
  body: "Published proof",
  sources: [{ source_id: source, start: 0, end: 15 }],
  links: [],
});
const commit = {
  sequence: 1,
  proposal_id: proposal,
  author: "owner",
  reason: "Reviewed publication",
  digest: "a".repeat(64),
  created_at: "2026-10-02T01:00:00Z",
  published: true,
  publication: { publisher: "owner", recorded_at: "2026-10-02T02:00:00Z" },
};
const diff = {
  proposal_id: proposal,
  base_version: 0,
  published_version: 1,
  comparison: "accepted_before_state" as const,
  stale_base: false,
  items: [{ concept_id: a, before: null, after: concept() }],
};
function client(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    "domain.version": {
      domain_id: domain,
      accepted_version: 2,
      published_version: 1,
    },
    "concepts.list": [concept()],
    "publications.list": {
      domain_id: domain,
      at_version: 1,
      since: null,
      until: null,
      scan_limited: false,
      items: [commit],
      next_before: null,
    },
    "proposals.diff": diff,
    ...overrides,
  };
  const call = vi.fn(
    async (
      op: string,
      _params?: unknown,
      _body?: unknown,
      opts?: { query?: Record<string, unknown> },
    ) => {
      if (op === "graph.window")
        return graphFixture(
          domain,
          responses["concepts.list"] as Concept[],
          opts?.query,
        );
      if (op === "concepts.read")
        return (responses["concepts.list"] as Concept[])[0];
      const value =
        responses[
          op === "proposals.diff_summary" && !(op in overrides)
            ? "proposals.diff"
            : op
        ];
      if (value instanceof Error) throw value;
      return op === "proposals.diff_summary" && !(op in overrides)
        ? summaryFixture(value as typeof diff)
        : structuredClone(value);
    },
  );
  return { api: { call } as unknown as CortexApi, call };
}
describe("authorized connected brain projection", () => {
  it("recovers a missing current focus through a verified authorized domain read", async () => {
    const { api, call } = client();
    const result = await readApiBrain(
      api,
      domain,
      "Test",
      false,
      {},
      undefined,
      { focus: b },
    );
    expect(result.unavailableFocus).toBe(true);
    expect(result.graph.focus).toBeNull();
    expect(result.projection.nodes.map((n) => n.id)).toEqual([a]);
    expect(
      call.mock.calls.filter(([op]) => op === "concepts.read"),
    ).toHaveLength(0);
    // Explicit detail/location requests must not silently become a domain read.
    await expect(
      readApiBrain(api, domain, "Test", false, {}, undefined, {
        focus: b,
        detail: b,
        locate: b,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each([401, 403, 409])(
    "does not recover a current focus after status %s",
    async (status) => {
      const { api, call } = client();
      call.mockImplementation(async (op) => {
        if (op === "domain.version")
          return {
            domain_id: domain,
            accepted_version: 1,
            published_version: 1,
          };
        throw new ApiError(status, "denied");
      });
      await expect(
        readApiBrain(api, domain, "Test", false, {}, undefined, { focus: b }),
      ).rejects.toMatchObject({ status });
      expect(
        call.mock.calls.filter(([op]) => op === "graph.window"),
      ).toHaveLength(1);
    },
  );
  it.each([true, false])(
    "explains a primary marker change to %s without inventing reinforcement",
    (primary) => {
      const before = {
        ...concept(),
        links: [
          {
            target_id: b,
            kind: "structural" as const,
            primary: !primary,
            weight: 1,
          },
        ],
      };
      const after = { ...before, links: [{ ...before.links[0], primary }] };
      const input = { ...diff, items: [{ concept_id: a, before, after }] };
      const events = publicationChanges(
        domain,
        commit,
        summaryFixture(input),
        new Map([[b, "Beta"]]),
      );
      expect(events).toEqual(
        publicationChanges(domain, commit, input, new Map([[b, "Beta"]])),
      );
      expect(events.map((e) => e.kind)).toEqual(["relation_primary_changed"]);
      expect(events[0].detail).toContain(primary ? "non → oui" : "oui → non");
      expect(events[0].relation?.primary).toBe(primary);
      expect(events[0].sourceIds).toEqual([source]);
      expect(countChanges([...events, ...events])).toMatchObject({
        primaryChanged: 1,
        created: 0,
        strengthened: 0,
        weakened: 0,
      });
    },
  );
  it("retains simultaneous weight and primary changes as distinct stable events", () => {
    const before = {
      ...concept(),
      links: [{ target_id: b, kind: "structural" as const, weight: 0.5 }],
    };
    const after = {
      ...before,
      links: [{ ...before.links[0], primary: true, weight: 1 }],
    };
    const changes = (after: Concept) =>
      publicationChanges(
        domain,
        commit,
        { ...diff, items: [{ concept_id: a, before, after }] },
        new Map(),
      );
    const events = changes(after);
    expect(events.map((e) => e.kind)).toEqual([
      "relation_strengthened",
      "relation_primary_changed",
    ]);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
    expect(
      changes({ ...before, links: [{ ...before.links[0], primary: false }] }),
    ).toEqual([]);
    expect(
      publicationChanges(
        domain,
        { ...commit, published: false },
        { ...diff, items: [{ concept_id: a, before, after }] },
        new Map(),
      ),
    ).toEqual([]);
  });
  it("keeps event identities, counts and explanations identical when bodies become hashes", () => {
    const before = {
      ...concept(),
      body: "Texte 🧠 initial",
      links: [{ target_id: b, kind: "associative" as const, weight: 0.3 }],
    };
    const after = {
      ...before,
      body: "Texte 🧠 révisé",
      links: [{ target_id: b, kind: "associative" as const, weight: 0.7 }],
    };
    for (const pair of [
      { before: null, after },
      { before, after },
      { before, after: null },
    ]) {
      const input = { ...diff, items: [{ concept_id: a, ...pair }] };
      const titles = new Map([[b, "Beta"]]);
      expect(
        publicationChanges(domain, commit, summaryFixture(input), titles),
      ).toEqual(publicationChanges(domain, commit, input, titles));
    }
    const unchanged = {
      ...diff,
      items: [{ concept_id: a, before, after: { ...before } }],
    };
    expect(
      publicationChanges(domain, commit, summaryFixture(unchanged), new Map()),
    ).toEqual([]);
  });
  it.each([
    "missing_hash",
    "malformed_hash",
    "raw_body",
    "duplicate",
    "invalid_primary",
  ])("rejects a malformed summary: %s", async (fault) => {
    const summary = summaryFixture(diff);
    const value = summary.items[0].after! as unknown as Record<string, unknown>;
    if (fault === "missing_hash") delete value.body_sha256;
    if (fault === "malformed_hash") value.body_sha256 = "untrusted";
    if (fault === "raw_body") value.body = "Unexpected full content";
    if (fault === "duplicate") summary.items.push(summary.items[0]);
    if (fault === "invalid_primary")
      value.links = [
        { target_id: b, kind: "associative", primary: true, weight: 1 },
      ];
    const { api } = client({ "proposals.diff_summary": summary });
    await expect(
      readApiBrain(api, domain, "Test", true),
    ).rejects.toBeInstanceOf(ApiError);
  });
  it.each([false, true])(
    "reads an authorized historical relation when its target is gone (origin removed: %s)",
    async (originRemoved) => {
      const previous = {
        ...concept(a),
        links: [{ target_id: b, kind: "associative" as const, weight: 0.4 }],
      };
      const overrides = {
        "concepts.list": originRemoved ? [] : [concept(a)],
        "proposals.diff": {
          ...diff,
          items: [
            {
              concept_id: a,
              before: previous,
              after: originRemoved ? null : concept(a),
            },
            { concept_id: b, before: concept(b), after: null },
          ],
        },
      };
      const request = { focus: a, locate: b, detail: a, historical: true };
      const { api, call } = client(overrides);
      const result = await readApiBrain(
        api,
        domain,
        "Test",
        true,
        {},
        undefined,
        request,
      );
      expect(result.graph.focus?.concept_id ?? null).toBe(
        originRemoved ? null : a,
      );
      expect(
        result.projection.events.find((e) => e.kind === "relation_removed")
          ?.relation?.toTitle,
      ).toBe("Beta");
      expect(result.evidence[source]).toHaveLength(1);
      expect(
        call.mock.calls.filter(([op]) => op === "concepts.read"),
      ).toHaveLength(originRemoved ? 0 : 1);
      const denied = client({
        ...overrides,
        "proposals.diff": new ApiError(403, "denied"),
      });
      await expect(
        readApiBrain(denied.api, domain, "Test", true, {}, undefined, request),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it("counts neighboring creations in the same scope as the visible concepts", async () => {
    const alpha = {
      ...concept(a),
      links: [{ target_id: b, kind: "associative" as const, weight: 0.4 }],
    };
    const beta = concept(b);
    const { api } = client({
      "concepts.list": [alpha, beta],
      "proposals.diff": {
        ...diff,
        items: [
          { concept_id: a, before: null, after: alpha },
          { concept_id: b, before: null, after: beta },
        ],
      },
    });
    const { projection } = await readApiBrain(
      api,
      domain,
      "Test",
      true,
      {},
      undefined,
      { focus: a },
    );
    const events = selectEvents(
      projection,
      { ...defaultSelection, level: "concepts", group: a },
      Date.parse("2026-10-02T03:00:00Z"),
    );
    expect(countChanges(events)).toMatchObject({ concepts: 2, created: 1 });
    const betaProjection = (
      await readApiBrain(api, domain, "Test", true, {}, undefined, { focus: b })
    ).projection;
    const betaEvents = selectEvents(
      betaProjection,
      { ...defaultSelection, level: "concepts", group: b },
      Date.parse("2026-10-02T03:00:00Z"),
    );
    expect(countChanges(betaEvents)).toMatchObject({ concepts: 1, created: 0 });
  });
  it("uses the publication timestamp and does not count approval or retry as learning", async () => {
    const { api } = client();
    const first = await readApiBrain(api, domain, "Test", true),
      again = await readApiBrain(api, domain, "Test", true);
    expect(first.projection.publishedVersion).toBe(1);
    expect(first.projection.events).toEqual(again.projection.events);
    expect(first.projection.events).toHaveLength(1);
    expect(first.projection.events[0].time).toBe(
      commit.publication.recorded_at,
    );
    expect(countChanges(first.projection.events).concepts).toBe(1);
    expect(first.evidence[source]).toHaveLength(1);
  });
  it("allows current published knowledge for viewers without requesting owner history", async () => {
    const { api, call } = client();
    const result = await readApiBrain(api, domain, "Test", false);
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      "domain.version",
      "graph.window",
      "domain.version",
      "graph.window",
    ]);
    expect(result.projection.nodes).toHaveLength(1);
    expect(result.projection.coverage.publicationChanges).toBe(false);
    expect(result.projection.capabilities.dynamics).toBe(false);
  });
  it("reports bounded and legacy history without guessing missing publication dates", async () => {
    const { api, call } = client({
      "publications.list": {
        domain_id: domain,
        at_version: 1,
        since: null,
        until: null,
        scan_limited: false,
        items: [{ ...commit, publication: null }],
        next_before: 1,
      },
    });
    const result = await readApiBrain(api, domain, "Test", true);
    expect(result.projection.events).toEqual([]);
    expect(result.projection.coverage.partial).toBe(true);
    expect(result.projection.coverage.detail).toContain("sans date auditée");
    expect(call.mock.calls.some((c) => c[0] === "proposals.diff_summary")).toBe(
      false,
    );
  });
  it("passes a fixed time window and cursor and counts only the returned page", async () => {
    const window = {
      atVersion: 1,
      before: 2,
      since: "2026-10-01T00:00:00Z",
      until: "2026-10-03T00:00:00Z",
    };
    const { api, call } = client({
      "publications.list": {
        domain_id: domain,
        at_version: 1,
        since: window.since,
        until: window.until,
        scan_limited: false,
        items: [commit],
        next_before: null,
      },
    });
    const result = await readApiBrain(api, domain, "Test", true, window);
    expect(call).toHaveBeenCalledWith(
      "publications.list",
      { domain },
      undefined,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        query: {
          limit: 20,
          at_version: 1,
          before: 2,
          since: window.since,
          until: window.until,
        },
      }),
    );
    expect(result.projection.coverage).toMatchObject({
      from: window.since,
      to: window.until,
      partial: true,
    });
    expect(result.projection.events).toHaveLength(1);
  });
  it("retains a continuation through an empty ACL-limited page", async () => {
    const { api } = client({
      "publications.list": {
        domain_id: domain,
        at_version: 1,
        since: null,
        until: null,
        scan_limited: true,
        items: [],
        next_before: 1,
      },
    });
    const result = await readApiBrain(api, domain, "Test", true);
    expect(result).toMatchObject({
      nextBefore: 1,
      scanLimited: true,
      partialHistory: true,
    });
    expect(result.projection.coverage.detail).toContain(
      "même si celle-ci est vide",
    );
  });
  it.each([
    { domain_id: id(99) },
    { at_version: 2 },
    { next_before: 2 },
    { next_before: -1 },
    { items: [{ ...commit, published: false }] },
    { items: [commit, commit] },
    { since: "2026-10-01T00:00:00Z" },
    { scan_limited: "false" },
  ])("rejects an inconsistent publication page %j", async (fault) => {
    const { api } = client({
      "publications.list": {
        domain_id: domain,
        at_version: 1,
        since: null,
        until: null,
        scan_limited: false,
        items: [commit],
        next_before: null,
        ...fault,
      },
    });
    await expect(readApiBrain(api, domain, "Test", true)).rejects.toMatchObject(
      { code: "invalid_response" },
    );
  });
  it("requires a refreshed graph if the publication version changed between pages", async () => {
    const { api, call } = client();
    await expect(
      readApiBrain(api, domain, "Test", true, { atVersion: 0, before: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed publication versions and does not publish a partial successful projection", async () => {
    const { api, call } = client();
    let read = 0;
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (op) =>
      op === "domain.version"
        ? {
            domain_id: domain,
            accepted_version: 2,
            published_version: ++read === 1 ? 1 : 2,
          }
        : original(op),
    );
    await expect(readApiBrain(api, domain, "Test", true)).rejects.toMatchObject(
      { status: 409 },
    );
  });
  it("does not retain a successful graph when history authorization is lost", async () => {
    const { api } = client({ "proposals.diff": new ApiError(403, "denied") });
    await expect(readApiBrain(api, domain, "Test", true)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it.each(
    [
      [{ ...concept(), sources: [{ source_id: source, start: 9, end: 3 }] }],
      [concept(), concept()],
      [
        {
          ...concept(),
          links: [{ target_id: b, kind: "associative", weight: 0.5 }],
        },
      ],
      [{ ...concept(), maturity: "fake" }],
    ].map((value) => ({ value })),
  )("rejects malformed or dangling published state", async ({ value }) => {
    const { api } = client({ "concepts.list": value });
    await expect(
      readApiBrain(api, domain, "Test", false, {}, undefined, { detail: a }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("distinguishes weight changes and retirement from automatic decay or archival", () => {
    const before = {
      ...concept(),
      links: [{ target_id: b, kind: "associative" as const, weight: 0.4 }],
    };
    const after = { ...before, links: [{ ...before.links[0], weight: 0.8 }] };
    const changes = publicationChanges(
      domain,
      commit,
      { ...diff, items: [{ concept_id: a, before, after }] },
      new Map([[b, "Beta"]]),
    );
    expect(changes.map((c) => c.kind)).toEqual(["relation_strengthened"]);
    expect(changes[0].detail).toContain("0.4 → 0.8");
    const removed = publicationChanges(
      domain,
      commit,
      { ...diff, items: [{ concept_id: a, before, after: null }] },
      new Map([[b, "Beta"]]),
    );
    expect(removed.map((c) => c.kind)).toEqual([
      "concept_removed",
      "relation_removed",
    ]);
    expect(countChanges(removed).archived).toBe(0);
  });
});

it("retains only deduplicated exact source ranges from this publication difference", () => {
  const before = concept(),
    after: Concept = {
      ...concept(),
      sources: [concept().sources[0], { source_id: source, start: 3, end: 8 }],
      links: [{ target_id: b, kind: "associative" as const, weight: 0.8 }],
    };
  const events = publicationChanges(
    domain,
    commit,
    { ...diff, items: [{ concept_id: a, before, after }] },
    new Map([
      [a, "Alpha"],
      [b, "Beta"],
    ]),
  );
  const relation = events.find((e) => e.kind === "relation_created")!;
  expect(relation.evidence).toEqual([
    { source_id: source, start: 0, end: 15 },
    { source_id: source, start: 3, end: 8 },
  ]);
});
