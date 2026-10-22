import { describe, expect, it } from "vitest";
import { timelineBuckets } from "./timeline";
import {
  defaultSelection,
  readSelection,
  selectEvents,
  writeSelection,
  type BrainChange,
  type BrainProjection,
} from "./model";
const now = Date.parse("2026-10-02T12:00:00.000Z");
const projection: BrainProjection = {
  mode: "api",
  domainId: "d",
  domainName: "Domain",
  publishedVersion: 3,
  nodes: [
    {
      id: "n",
      title: "N",
      description: "",
      kind: "concept",
      groups: ["g"],
      sourceIds: [],
    },
  ],
  groups: [{ id: "g", title: "G" }],
  relations: [],
  sources: [],
  events: [],
  coverage: {
    from: null,
    to: new Date(now).toISOString(),
    publicationChanges: true,
    detail: "",
  },
  capabilities: { archives: false, dynamics: true, memory: false },
};
function event(id: string, time: number, publicationId = id): BrainChange {
  return {
    id,
    time: new Date(time).toISOString(),
    publicationId,
    version: 1,
    kind: "concept_created",
    title: id,
    detail: "",
    nodeIds: ["n"],
    groupIds: ["g"],
    sourceIds: [],
  };
}
describe("temporal projection", () => {
  it("assigns exact boundaries once, deduplicates retries and keeps event/publication units distinct", () => {
    const bins = timelineBuckets(projection, [], "7", now);
    const boundary = Date.parse(bins[1].from);
    const events = [
      event("start", Date.parse(bins[0].from)),
      event("before", boundary - 1),
      event("edge", boundary, "shared"),
      event("edge2", boundary, "shared"),
      event("now", now),
      event("future", now + 1),
      event("too-old", Date.parse(bins[0].from) - 1),
    ];
    const result = timelineBuckets(
      projection,
      [...events, events[2]],
      "7",
      now,
    );
    expect(result.map((b) => b.count)).toEqual([2, 2, 0, 0, 0, 0, 1]);
    expect(result[1].publications).toBe(1);
    const selection = {
      ...defaultSelection,
      period: "7" as const,
      interval: result[1],
    };
    expect(
      selectEvents({ ...projection, events }, selection, now).map((e) => e.id),
    ).toEqual(["edge", "edge2"]);
  });
  it("marks all unloaded pages unknown and respects instrumentation start inside a bin", () => {
    const partial = {
      ...projection,
      coverage: { ...projection.coverage, partial: true },
    };
    expect(
      timelineBuckets(partial, [], "30", now).every(
        (b) => !b.complete && b.count === 0,
      ),
    ).toBe(true);
    const bins = timelineBuckets(projection, [], "7", now);
    const mock = {
      ...projection,
      mode: "mock" as const,
      coverage: {
        ...projection.coverage,
        from: new Date(Date.parse(bins[2].from) + 1).toISOString(),
      },
    };
    expect(timelineBuckets(mock, [], "7", now).map((b) => b.complete)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(
      timelineBuckets(
        {
          ...projection,
          coverage: { ...projection.coverage, publicationChanges: false },
        },
        [],
        "all",
        now,
      ),
    ).toEqual([]);
  });
  it("bounds long histories to 24 bins and uses elapsed time through daylight-saving transitions", () => {
    const old = event("old", Date.parse("2000-01-01T00:00:00Z"));
    const withHistory = { ...projection, events: [old, event("recent", now)] };
    const full = timelineBuckets(withHistory, withHistory.events, "all", now);
    const neighborhood = timelineBuckets(
      withHistory,
      [event("recent", now)],
      "all",
      now,
    );
    expect(full.map((b) => b.from)).toEqual(neighborhood.map((b) => b.from));
    expect(full[0].count).toBe(1);
    expect(neighborhood[0].count).toBe(0);
    expect(full).toHaveLength(24);
    const dst = Date.parse("2026-10-25T12:00:00Z");
    const bins = timelineBuckets(
      {
        ...projection,
        coverage: { ...projection.coverage, to: new Date(dst).toISOString() },
      },
      [],
      "1",
      dst,
    );
    expect(bins).toHaveLength(24);
    expect(Date.parse(bins.at(-1)!.to) - Date.parse(bins[0].from)).toBe(
      86400001,
    );
    expect(new Set(bins.map((b) => b.from)).size).toBe(24);
  });
  it("combines spatial, period and interval selection, without modifying stock", () => {
    const events = [
      event("a", now - 1),
      { ...event("b", now - 1), nodeIds: ["outside"], groupIds: ["other"] },
    ];
    const input = { ...projection, events };
    const interval = {
      from: new Date(now - 10).toISOString(),
      to: new Date(now + 1).toISOString(),
    };
    expect(
      selectEvents(
        input,
        { ...defaultSelection, level: "concepts", group: "g", interval },
        now,
      ).map((e) => e.id),
    ).toEqual(["a"]);
    expect(input.nodes).toHaveLength(1);
    expect(
      selectEvents(
        input,
        {
          ...defaultSelection,
          interval: {
            from: new Date(now + 10).toISOString(),
            to: new Date(now + 20).toISOString(),
          },
        },
        now,
      ),
    ).toEqual([]);
  });
  it("round-trips exact UTC intervals and rejects invalid, incomplete or reversed links", () => {
    const selection = {
      ...defaultSelection,
      interval: {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-02T00:00:00.000Z",
      },
    };
    expect(readSelection(writeSelection(selection))).toEqual(selection);
    for (const [from, to] of [
      [selection.interval.to, selection.interval.from],
      [selection.interval.from, selection.interval.from],
      ["2026-02-30T00:00:00.000Z", selection.interval.to],
      ["bad", selection.interval.to],
      [selection.interval.from, ""],
      ["2026-10-01T00:00:00+02:00", selection.interval.to],
    ])
      expect(
        readSelection(new URLSearchParams({ time_from: from, time_to: to }))
          .interval,
      ).toBeNull();
  });
});
