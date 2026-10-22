import { describe, it, expect } from "vitest";
import {
  arrange,
  aggregateMap,
  frame,
  expandCluster,
  zoomAt,
  validateTopology,
  type Topology,
} from "./spatial-model";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = (): Topology => ({
  domain_id: id(0),
  at_version: 1,
  nodes: Array.from({ length: 100 }, (_, i) => ({
    id: id(i + 1),
    title: `Concept ${i}`,
    group: `Group ${i % 5}`,
    territory: "One",
    maturity: "observed",
  })),
  edges: Array.from({ length: 99 }, (_, i) => [i, i + 1, "reference", null]),
  published_relations: 0,
  documentary_references: 99,
});
describe("spatial navigation invariants", () => {
  it("keeps complete family membership and world centres independent of viewport clipping", () => {
    const data = fixture(),
      graph = arrange(data, "territories");
    const clusters = aggregateMap(data, graph, "families", null, new Set());
    expect([...clusters.values()].map((c) => c.members.length)).toEqual([
      20, 20, 20, 20, 20,
    ]);
    for (const c of clusters.values()) {
      expect(c.p.x).toBeCloseTo(
        c.members.reduce((s, i) => s + graph.points[i].x, 0) / c.members.length,
      );
    }
    const filtered = aggregateMap(
      data,
      graph,
      "families",
      new Set([data.nodes[0].id]),
      new Set([1]),
    );
    expect([...filtered.values()].flatMap((c) => c.members).sort()).toEqual([
      0, 1,
    ]);
  });
  it("advances the zoom when a single family already fills the map", () => {
    const points = [
      { x: -2000, y: -2000 },
      { x: 2000, y: 2000 },
    ];
    const c = frame(points, 1000, 680);
    const next = expandCluster(c, points, 1000, 680, { x: 500, y: 340 });
    expect(next.k).toBeGreaterThan(c.k * 1.5);
    expect(next.x).toBe(500);
    expect(next.y).toBe(340);
  });
  it("zooms around the pointer without moving its world anchor and clamps scale", () => {
    const c = { x: 50, y: -20, k: 0.5 },
      p = { x: 250, y: 180 };
    const next = zoomAt(c, 2, p);
    expect((p.x - c.x) / c.k).toBe((p.x - next.x) / next.k);
    expect((p.y - c.y) / c.k).toBe((p.y - next.y) / next.k);
    expect(zoomAt(c, 1e8, p).k).toBe(12);
    expect(zoomAt(c, 0, p).k).toBe(0.001);
  });
  it("keeps every identity finite and stable across repeated layouts", () => {
    const d = fixture();
    for (const mode of [
      "territories",
      "fireworks",
      "circle",
      "lines",
    ] as const) {
      const a = arrange(d, mode);
      expect(a).toEqual(arrange(d, mode));
      expect(a.points).toHaveLength(100);
      expect(new Set(a.points.map((p) => JSON.stringify(p))).size).toBe(100);
      expect(
        a.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ).toBe(true);
      expect(a.groups.flatMap((g) => g.members).sort((a, b) => a - b)).toEqual(
        d.nodes.map((_, i) => i),
      );
      expect(a.macro.reduce((s, e) => s + e.count, 0)).toBe(99);
    }
  });
  it("frames a neighborhood inside its viewport", () => {
    const pts = [
      { x: 100, y: -200 },
      { x: -500, y: 700 },
    ];
    const c = frame(pts, 900, 600);
    for (const p of pts) {
      expect(p.x * c.k + c.x).toBeGreaterThanOrEqual(65 - 1e-9);
      expect(p.x * c.k + c.x).toBeLessThanOrEqual(835 + 1e-9);
      expect(p.y * c.k + c.y).toBeGreaterThanOrEqual(65 - 1e-9);
      expect(p.y * c.k + c.y).toBeLessThanOrEqual(535 + 1e-9);
    }
  });
  it("indexes each directed edge once per endpoint and counts regional roads exactly", () => {
    const d = fixture();
    d.nodes.forEach((n, i) => {
      n.territory = i < 50 ? "West" : "East";
    });
    d.edges.push([0, 0, "structural", 1]);
    const g = arrange(d, "territories");
    expect(g.incident[0]).toEqual([0, 99]);
    expect(g.incident[50]).toEqual([49, 50]);
    expect(g.roads).toEqual([{ from: "East", to: "West", count: 1 }]);
    expect(new Set(g.nodeOrder).size).toBe(100);
    expect(g.nodeOrder[0]).toBe(0);
    expect(g.majorRoads.families.length).toBeGreaterThan(0);
    expect(g.majorRoads.families.length).toBeLessThanOrEqual(80);
    const landmarks = new Set(g.nodeOrder.slice(0, 32));
    expect(
      g.majorRoads.families.every(
        (i) => landmarks.has(d.edges[i][0]) && landmarks.has(d.edges[i][1]),
      ),
    ).toBe(true);
  });
  it("packs 10,000 distinct families without all-pairs relaxation or losing identities", () => {
    const d = fixture();
    d.nodes = Array.from({ length: 10000 }, (_, i) => ({
      ...d.nodes[0],
      id: id(i + 1),
      group: `Family ${i}`,
    }));
    d.edges = [];
    d.documentary_references = 0;
    const g = arrange(d, "territories");
    expect(g.placement).toBe("packed");
    expect(g.groups).toHaveLength(10000);
    expect(new Set(g.points.map((p) => `${p.x}:${p.y}`)).size).toBe(10000);
    const c = frame(g.points, 390, 680);
    expect(
      g.points.every(
        (p) =>
          p.x * c.k + c.x >= 64.99 &&
          p.x * c.k + c.x <= 325.01 &&
          p.y * c.k + c.y >= 64.99 &&
          p.y * c.k + c.y <= 615.01,
      ),
    ).toBe(true);
  });
  it("rejects hidden endpoints, duplicate links and invented relation weights", () => {
    const d = fixture();
    expect(validateTopology(d, id(0))).toBe(d);
    expect(() =>
      validateTopology({ ...d, documentary_references: 100 }, id(0)),
    ).toThrow();
    expect(() =>
      validateTopology(
        {
          ...d,
          edges: [[0, 999, "reference", null]],
          documentary_references: 1,
        },
        id(0),
      ),
    ).toThrow();
    expect(() =>
      validateTopology(
        { ...d, edges: [[0, 1, "reference", 0.8]], documentary_references: 1 },
        id(0),
      ),
    ).toThrow();
    expect(() =>
      validateTopology(
        { ...d, edges: [...d.edges, d.edges[0]], documentary_references: 100 },
        id(0),
      ),
    ).toThrow();
    expect(() => validateTopology(d, id(4))).toThrow();
  });
});
