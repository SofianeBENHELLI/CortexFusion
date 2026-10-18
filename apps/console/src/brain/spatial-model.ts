import type { GraphMap } from "../../../../packages/contracts/src/GraphMap";
import { ApiError } from "../api/client";
import { isUuid } from "./api-graph";
export type MapNode = GraphMap["nodes"][number];
export type MapEdge = [
  number,
  number,
  "structural" | "associative" | "reference",
  number | null,
];
export type Topology = Omit<GraphMap, "edges"> & { edges: MapEdge[] };
export type Point = { x: number; y: number };
export type Camera = Point & { k: number };
export type Layout = "territories" | "fireworks" | "circle" | "lines";
export function validateTopology(raw: GraphMap, domain: string): Topology {
  const fail = () => {
    throw new ApiError(200, "invalid_response");
  };
  if (
    !raw ||
    raw.domain_id !== domain ||
    !Number.isSafeInteger(raw.at_version) ||
    raw.at_version < 0 ||
    !Array.isArray(raw.nodes) ||
    raw.nodes.length > 10000 ||
    !Array.isArray(raw.edges) ||
    raw.edges.length > 400000
  )
    fail();
  if (
    raw.nodes.some(
      (n) =>
        !n ||
        !isUuid(n.id) ||
        ["title", "group", "territory", "maturity"].some(
          (k) => typeof n[k as keyof MapNode] !== "string",
        ) ||
        !n.title ||
        n.title.length > 400 ||
        n.group.length > 400 ||
        n.territory.length > 400,
    ) ||
    new Set(raw.nodes.map((n) => n.id)).size !== raw.nodes.length
  )
    fail();
  let refs = 0;
  const seen = new Set<string>();
  for (const e of raw.edges) {
    if (
      !Array.isArray(e) ||
      e.length !== 4 ||
      !Number.isInteger(e[0]) ||
      !Number.isInteger(e[1]) ||
      Number(e[0]) < 0 ||
      Number(e[1]) < 0 ||
      Number(e[0]) >= raw.nodes.length ||
      Number(e[1]) >= raw.nodes.length ||
      !["reference", "structural", "associative"].includes(String(e[2])) ||
      (e[2] === "reference"
        ? e[3] !== null
        : typeof e[3] !== "number" ||
          !Number.isFinite(e[3]) ||
          e[3] < 0 ||
          e[3] > 1)
    )
      fail();
    const id = JSON.stringify(e.slice(0, 3));
    if (seen.has(id)) fail();
    seen.add(id);
    if (e[2] === "reference") refs++;
  }
  if (
    refs !== raw.documentary_references ||
    raw.edges.length - refs !== raw.published_relations
  )
    fail();
  return raw as Topology;
}
export function zoomAt(c: Camera, factor: number, p: Point): Camera {
  const k = Math.max(0.001, Math.min(12, c.k * factor));
  return {
    k,
    x: p.x - ((p.x - c.x) * k) / c.k,
    y: p.y - ((p.y - c.y) * k) / c.k,
  };
}
export function frame(points: Point[], w: number, h: number, pad = 65): Camera {
  if (!points.length) return { x: w / 2, y: h / 2, k: 0.5 };
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  points.forEach((p) => {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  });
  const k = Math.max(
    0.001,
    Math.min(
      3,
      Math.max(40, w - 2 * pad) / Math.max(120, x2 - x1),
      Math.max(40, h - 2 * pad) / Math.max(120, y2 - y1),
    ),
  );
  return { k, x: w / 2 - ((x1 + x2) * k) / 2, y: h / 2 - ((y1 + y2) * k) / 2 };
}

export function expandCluster(
  camera: Camera,
  points: Point[],
  w: number,
  h: number,
  anchor: Point,
): Camera {
  const next = frame(points, w, h, 100);
  // A single large family may fill the entire map. Reframing it must still
  // advance the zoom instead of trapping the user at the same abstraction.
  return next.k > camera.k * 1.15 ? next : zoomAt(camera, 1.8, anchor);
}
// Above this family count, use deterministic non-overlapping packing. A force
// relaxation over every pair would grow quadratically with user metadata.
export const MAX_RELAXED_GROUPS = 128;
export function arrange(data: Topology, layout: Layout) {
  const byGroup = new Map<string, number[]>();
  data.nodes.forEach((n, i) => {
    const key = JSON.stringify([n.territory, n.group]);
    const a = byGroup.get(key) ?? [];
    a.push(i);
    byGroup.set(key, a);
  });
  const groups = [...byGroup]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, members], i) => ({
      id,
      members,
      title: data.nodes[members[0]].group,
      territory: data.nodes[members[0]].territory,
      x: 0,
      y: 0,
      r: Math.max(90, Math.sqrt(members.length) * 20),
      i,
    }));
  const groupOf = new Int32Array(data.nodes.length),
    degree = new Uint32Array(data.nodes.length);
  const incident: number[][] = data.nodes.map(() => []);
  const points: Point[] = data.nodes.map(() => ({ x: 0, y: 0 }));
  const radius = Math.max(500, groups.length * 24);
  groups.forEach((g, i) => {
    const a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
    if (layout === "lines") {
      g.x = (i % 5) * 460;
      g.y = Math.floor(i / 5) * 460;
    } else {
      g.x = Math.cos(a) * radius;
      g.y = Math.sin(a) * radius;
    }
    g.members.sort((a, b) => data.nodes[a].id.localeCompare(data.nodes[b].id));
    g.members.forEach((n) => (groupOf[n] = i));
  });
  const macro = new Map<string, { from: number; to: number; count: number }>();
  const roads = new Map<string, { from: string; to: string; count: number }>();
  data.edges.forEach(([a, b], edge) => {
    degree[a]++;
    degree[b]++;
    incident[a].push(edge);
    if (a !== b) incident[b].push(edge);
    const ta = data.nodes[a].territory,
      tb = data.nodes[b].territory;
    if (ta !== tb) {
      const from = ta < tb ? ta : tb,
        to = ta < tb ? tb : ta;
      const key = JSON.stringify([from, to]);
      const road = roads.get(key) ?? { from, to, count: 0 };
      road.count++;
      roads.set(key, road);
    }
    const from = Math.min(groupOf[a], groupOf[b]),
      to = Math.max(groupOf[a], groupOf[b]);
    if (from !== to) {
      const k = `${from}:${to}`;
      const m = macro.get(k) ?? { from, to, count: 0 };
      m.count++;
      macro.set(k, m);
    }
  });
  const packed = groups.length > MAX_RELAXED_GROUPS;
  if (packed || layout === "lines") {
    // Shelf packing also handles very uneven families without overlapping them.
    const side = (g: (typeof groups)[number]) => g.r * 2 + 120;
    const width = Math.max(
      1,
      Math.sqrt(groups.reduce((s, g) => s + side(g) ** 2, 0)) * 1.2,
    );
    let x = 0,
      y = 0,
      rowHeight = 0;
    for (const g of groups) {
      const size = side(g);
      if (x && x + size > width) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      g.x = x + size / 2;
      g.y = y + size / 2;
      x += size;
      rowHeight = Math.max(rowHeight, size);
    }
  }
  if (layout === "territories" && !packed) {
    // Only group centres are relaxed. Concepts retain stable local coordinates.
    for (let step = 0; step < 180; step++) {
      const force = groups.map(() => ({ x: 0, y: 0 }));
      groups.forEach((a, i) => {
        for (let j = i + 1; j < groups.length; j++) {
          const b = groups[j],
            dx = a.x - b.x,
            dy = a.y - b.y,
            d = Math.max(1, Math.hypot(dx, dy)),
            ideal = a.r + b.r + 110,
            f = Math.min(
              120,
              (12 * (ideal * ideal)) / (d * d) + Math.max(0, ideal - d) * 0.2,
            );
          force[i].x += (dx / d) * f;
          force[i].y += (dy / d) * f;
          force[j].x -= (dx / d) * f;
          force[j].y -= (dy / d) * f;
        }
      });
      for (const e of macro.values()) {
        const a = groups[e.from],
          b = groups[e.to],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.max(1, Math.hypot(dx, dy)),
          f = Math.max(0, d - a.r - b.r - 140) * 0.001;
        force[e.from].x += (dx / d) * f;
        force[e.from].y += (dy / d) * f;
        force[e.to].x -= (dx / d) * f;
        force[e.to].y -= (dy / d) * f;
      }
      groups.forEach((g, i) => {
        g.x += (force[i].x - g.x * 0.002) * 0.7;
        g.y += (force[i].y - g.y * 0.002) * 0.7;
      });
    }
  }
  groups.forEach((g) =>
    g.members.forEach((n, i) => {
      const a = i * 2.399963229728653,
        r = Math.sqrt((i + 0.5) / g.members.length) * g.r;
      if (layout === "circle") {
        const theta = (i / g.members.length) * Math.PI * 2;
        points[n] = {
          x: g.x + Math.cos(theta) * g.r,
          y: g.y + Math.sin(theta) * g.r,
        };
      } else if (layout === "lines") {
        const cols = Math.ceil(Math.sqrt(g.members.length));
        points[n] = {
          x: g.x + ((i % cols) - cols / 2) * 30,
          y: g.y + (Math.floor(i / cols) - cols / 2) * 30,
        };
      } else points[n] = { x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r };
    }),
  );
  const nodeOrder = data.nodes
    .map((_, i) => i)
    .sort((a, b) => degree[b] - degree[a] || a - b);
  const majorRoads = (landmarkCount: number) => {
    const landmarks = new Set(nodeOrder.slice(0, landmarkCount));
    const found = new Set<number>();
    for (const node of landmarks) {
      for (const index of incident[node]) {
        const [a, b] = data.edges[index];
        if (landmarks.has(a) && landmarks.has(b)) found.add(index);
        if (found.size >= 80) break;
      }
      if (found.size >= 80) break;
    }
    return [...found];
  };
  return {
    points,
    groups,
    groupOf,
    degree,
    incident,
    nodeOrder,
    majorRoads: { regional: majorRoads(8), families: majorRoads(32) },
    roads: [...roads.values()].sort((a, b) => b.count - a.count),
    placement:
      packed || layout === "lines"
        ? "packed"
        : layout === "territories"
          ? "relaxed"
          : "radial",
    macro: [...macro.values()].sort((a, b) => b.count - a.count),
  };
}

export function aggregateMap(
  data: Topology,
  graph: ReturnType<typeof arrange>,
  level: "regions" | "families" | "cells" | "concepts",
  changes: Set<string> | null,
  adjacent: Set<number>,
) {
  const clusters = new Map<
    string,
    { p: Point; members: number[]; title: string }
  >();
  if (level === "concepts") return clusters;
  data.nodes.forEach((node, i) => {
    if (changes && !changes.has(node.id) && !adjacent.has(i)) return;
    const g = graph.groups[graph.groupOf[i]],
      p = graph.points[i];
    const key =
      level === "regions"
        ? node.territory
        : level === "families"
          ? g.id
          : `${g.id}:${Math.floor(p.x / 180)}:${Math.floor(p.y / 180)}`;
    const c = clusters.get(key) ?? {
      p: { x: 0, y: 0 },
      members: [],
      title: level === "regions" ? node.territory : g.title,
    };
    c.p.x += p.x;
    c.p.y += p.y;
    c.members.push(i);
    clusters.set(key, c);
  });
  clusters.forEach((c) => {
    c.p.x /= c.members.length;
    c.p.y /= c.members.length;
  });
  return clusters;
}
