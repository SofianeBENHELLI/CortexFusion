import { useEffect, useMemo, useRef, useState } from "react";
import { startSpatialStep } from "./read-measurement";
import {
  arrange,
  aggregateMap,
  frame,
  expandCluster,
  zoomAt,
  type Topology,
  type Layout,
  type Camera,
  type Point,
} from "./spatial-model";
export function SpatialCanvas({
  data,
  layout,
  selected,
  focus,
  colors,
  changes,
  onSelect,
  onEdge,
}: {
  data: Topology;
  layout: Layout;
  selected: number | null;
  focus: { ids: string[]; sequence: number } | null;
  colors: boolean;
  changes: Set<string> | null;
  onSelect: (index: number | null) => void;
  onEdge: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 680 }),
    [camera, setCamera] = useState<Camera>({ x: 400, y: 340, k: 0.3 }),
    [appearance, setAppearance] = useState(0);
  const graph = useMemo(() => {
    const done = startSpatialStep(
      "layout",
      data.nodes.length,
      data.edges.length,
    );
    const result = arrange(data, layout);
    done();
    return result;
  }, [data.nodes, data.edges, layout]);
  const pointById = useMemo(
    () => new Map(data.nodes.map((n, i) => [n.id, graph.points[i]])),
    [data.nodes, graph],
  );
  const [hover, setHover] = useState("");
  const hits = useRef<
      { p: Point; r: number; node?: number; members?: number[] }[]
    >([]),
    edgeHits = useRef<{ a: Point; b: Point; index: number }[]>([]);
  const pointers = useRef(new Map<number, Point>()),
    gesture = useRef({ x: 0, y: 0, distance: 0, moved: false });
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, clusters: 0 });
  const fit = () => setCamera(frame(graph.points, size.w, size.h));
  useEffect(() => {
    const el = host.current!;
    const observer = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    observer.observe(el);
    const mo = new MutationObserver(() => setAppearance((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setAppearance((n) => n + 1);
    media.addEventListener("change", changed);
    return () => {
      observer.disconnect();
      mo.disconnect();
      media.removeEventListener("change", changed);
    };
  }, []);
  useEffect(fit, [graph, size.w, size.h]);
  useEffect(() => {
    if (focus?.ids.length)
      setCamera(
        frame(
          focus.ids.flatMap((id) => {
            const p = pointById.get(id);
            return p ? [p] : [];
          }),
          size.w,
          size.h,
          100,
        ),
      );
  }, [focus, pointById]);
  const adjacent = useMemo(() => {
    const set = new Set<number>();
    if (selected !== null) {
      set.add(selected);
      graph.incident[selected].forEach((index) => {
        const [a, b] = data.edges[index];
        if (a === selected) set.add(b);
        if (b === selected) set.add(a);
      });
    }
    return set;
  }, [data.edges, graph, selected]);
  const nodeOrder = useMemo(() => {
    if (selected === null) return graph.nodeOrder;
    return [
      selected,
      ...graph.nodeOrder.filter((i) => i !== selected && adjacent.has(i)),
      ...graph.nodeOrder.filter((i) => !adjacent.has(i)),
    ];
  }, [graph, selected, adjacent]);
  const level =
    camera.k < 0.06
      ? "regions"
      : camera.k < 0.24
        ? "families"
        : camera.k < 0.55
          ? "cells"
          : "concepts";
  const aggregation = useMemo(
    () => aggregateMap(data, graph, level, changes, adjacent),
    [data, graph, level, changes, adjacent],
  );
  useEffect(() => {
    const el = canvas.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCamera((c) =>
        zoomAt(c, Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.003), {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        }),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext("2d");
    if (!ctx) return;
    const done = startSpatialStep("draw", data.nodes.length, data.edges.length);
    const dpr = Math.min(2, devicePixelRatio || 1);
    el.width = size.w * dpr;
    el.height = size.h * dpr;
    ctx.scale(dpr, dpr);
    const ink = getComputedStyle(el).color;
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    // Quiet map grid is anchored to the world, never to the viewport.
    ctx.globalAlpha = 0.08;
    const grid = 80 * camera.k;
    if (grid > 12)
      for (let x = camera.x % grid; x < size.w; x += grid)
        for (let y = camera.y % grid; y < size.h; y += grid) {
          ctx.beginPath();
          ctx.arc(x, y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
    const screen = (p: Point) => ({
      x: p.x * camera.k + camera.x,
      y: p.y * camera.k + camera.y,
    });
    const within = (p: Point, pad = 20) =>
      p.x >= -pad && p.y >= -pad && p.x <= size.w + pad && p.y <= size.h + pad;
    const nodePoints = graph.points.map(screen);
    const visible = nodeOrder.filter(
      (i) =>
        within(nodePoints[i]) &&
        (!changes || changes.has(data.nodes[i].id) || adjacent.has(i)),
    );
    const distant = camera.k < 0.55;
    const regional = camera.k < 0.06;
    // Aggregate in world coordinates, then clip. Panning must not move a family
    // or change its member count just because some concepts leave the viewport.
    const clusters = new Map(
      [...aggregation]
        .map(([key, c]) => [key, { ...c, p: screen(c.p) }] as const)
        .filter(([, c]) => within(c.p, 60)),
    );
    hits.current = [];
    edgeHits.current = [];
    let drawnEdges = 0,
      drawnNodes = 0;
    const line = (
      a: Point,
      b: Point,
      alpha: number,
      width = 1,
      dashed = false,
    ) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (distant && !regional && !changes)
      for (const m of graph.macro.slice(0, 160)) {
        const a = screen(graph.groups[m.from]),
          b = screen(graph.groups[m.to]);
        if (within(a, 200) || within(b, 200)) {
          line(
            a,
            b,
            selected !== null ? 0.035 : 0.12,
            Math.min(3, 0.5 + Math.log1p(m.count) / 3),
          );
          drawnEdges++;
        }
      }
    if (regional && !changes) {
      for (const road of graph.roads) {
        if (drawnEdges >= 160) break;
        if (!clusters.has(road.from) || !clusters.has(road.to)) continue;
        line(
          clusters.get(road.from)!.p,
          clusters.get(road.to)!.p,
          selected === null ? 0.22 : 0.05,
          Math.min(3, 1 + Math.log1p(road.count) / 4),
        );
        drawnEdges++;
      }
    }
    // Selected incident links have priority over background roads at every zoom.
    function* edgesToDraw() {
      if (selected !== null) yield* graph.incident[selected];
      if (distant) {
        // Major concept-to-concept roads remain visible even when every concept
        // belongs to one family, so a macro graph with no inter-family edge
        // does not turn a connected domain into apparently isolated dots.
        for (const index of regional
          ? graph.majorRoads.regional
          : graph.majorRoads.families) {
          const [a, b] = data.edges[index];
          if (a !== selected && b !== selected) yield index;
        }
      } else
        for (let i = 0; i < data.edges.length; i++) {
          const [a, b] = data.edges[i];
          if (a !== selected && b !== selected) yield i;
        }
    }
    const order = edgesToDraw();
    for (const i of order) {
      if (drawnEdges >= 1200) break;
      const [a, b, kind] = data.edges[i],
        active = a === selected || b === selected;
      if (
        changes &&
        !changes.has(data.nodes[a].id) &&
        !changes.has(data.nodes[b].id) &&
        !active
      )
        continue;
      const pa = nodePoints[a],
        pb = nodePoints[b];
      if (!within(pa, 100) && !within(pb, 100)) continue;
      const alpha = active ? 0.65 : selected !== null ? 0.025 : 0.13;
      line(pa, pb, alpha, active ? 1.3 : 0.7, kind === "reference" && active);
      drawnEdges++;
      if (active) {
        edgeHits.current.push({ a: pa, b: pb, index: i });
        const dx = pb.x - pa.x,
          dy = pb.y - pa.y,
          d = Math.max(1, Math.hypot(dx, dy));
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(pb.x - (dx / d) * 7, pb.y - (dy / d) * 7);
        ctx.lineTo(
          pb.x - (dx / d) * 14 - (dy / d) * 3,
          pb.y - (dy / d) * 14 + (dx / d) * 3,
        );
        ctx.lineTo(
          pb.x - (dx / d) * 14 + (dy / d) * 3,
          pb.y - (dy / d) * 14 - (dx / d) * 3,
        );
        ctx.fill();
      }
    }
    const labels: { x: number; y: number; w: number }[] = [];
    const label = (p: Point, text: string, alpha = 1, force = false) => {
      ctx.font = "11px Manrope, sans-serif";
      const title = text.length > 38 ? text.slice(0, 36) + "…" : text,
        w = ctx.measureText(title).width;
      const box = {
        x: Math.max(8, Math.min(p.x + 10, size.w - w - 8)),
        y: p.y - 4,
        w,
      };
      if (
        !force &&
        (labels.length >= 45 ||
          labels.some(
            (a) =>
              Math.abs(a.y - box.y) < 16 &&
              a.x < box.x + w &&
              a.x + a.w > box.x,
          ))
      )
        return;
      labels.push(box);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ink;
      ctx.fillText(title, box.x, box.y);
    };
    if (distant)
      clusters.forEach((c) => {
        const r = Math.min(22, 7 + Math.sqrt(c.members.length));
        ctx.globalAlpha = 0.09;
        ctx.beginPath();
        ctx.arc(c.p.x, c.p.y, r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(c.p.x, c.p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "10px Manrope,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(c.members.length), c.p.x, c.p.y + 3);
        ctx.textAlign = "left";
        if (camera.k < 0.24)
          label({ x: c.p.x + r, y: c.p.y + 6 }, c.title, 0.8);
        hits.current.push({ p: c.p, r: r + 6, members: c.members });
      });
    const displayed = visible.slice(
      0,
      distant ? (selected !== null ? 400 : regional ? 8 : 32) : 1400,
    );
    for (const i of displayed) {
      if (distant && selected !== i && !adjacent.has(i) && graph.degree[i] < 3)
        continue;
      const p = nodePoints[i],
        active = selected === i,
        near = adjacent.has(i),
        r = active
          ? 6
          : near
            ? 4
            : Math.min(4, 2 + Math.sqrt(graph.degree[i]) * 0.1);
      ctx.fillStyle = colors
        ? data.nodes[i].maturity === "reference"
          ? "#5f9dbd"
          : "#86a598"
        : ink;
      ctx.globalAlpha = selected !== null && !near ? 0.17 : active ? 1 : 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawnNodes++;
      hits.current.push({ p, r: Math.max(8, r), node: i });
      if (
        active ||
        near ||
        camera.k > 0.95 ||
        (!distant && graph.degree[i] > 15)
      )
        label(p, data.nodes[i].title, active ? 1 : 0.8, active);
    }
    ctx.globalAlpha = 1;
    setCounts({
      nodes: drawnNodes,
      edges: drawnEdges,
      clusters: distant ? clusters.size : 0,
    });
    done();
  }, [
    data,
    graph,
    size,
    camera,
    appearance,
    selected,
    adjacent,
    nodeOrder,
    aggregation,
    colors,
    changes,
  ]);
  const position = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (p: Point) =>
    [...hits.current]
      .reverse()
      .find((h) => Math.hypot(h.p.x - p.x, h.p.y - p.y) <= h.r);
  const choose = (p: Point) => {
    const h = hit(p);
    if (h?.node !== undefined) {
      onSelect(h.node);
      return;
    }
    if (h?.members) {
      setCamera(
        expandCluster(
          camera,
          h.members.map((i) => graph.points[i]),
          size.w,
          size.h,
          p,
        ),
      );
      return;
    }
    const e = edgeHits.current.find(({ a, b }) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < 5;
    });
    if (e) onEdge(e.index);
    else onSelect(null);
  };
  return (
    <div className="spatial-stage" ref={host}>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label="BrainMap interactive. Molette pour zoomer, glisser pour déplacer. Clavier : plus, moins, flèches, Origine pour tout voir. Les concepts sont aussi accessibles dans la liste."
        onKeyDown={(e) => {
          if (
            [
              "+",
              "=",
              "-",
              "Home",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Escape",
            ].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "Home") fit();
            else if (e.key === "Escape") onSelect(null);
            else if (["+", "=", "-"].includes(e.key))
              setCamera((c) =>
                zoomAt(c, e.key === "-" ? 1 / 1.4 : 1.4, {
                  x: size.w / 2,
                  y: size.h / 2,
                }),
              );
            else
              setCamera((c) => ({
                ...c,
                x:
                  c.x +
                  (e.key === "ArrowLeft"
                    ? 70
                    : e.key === "ArrowRight"
                      ? -70
                      : 0),
                y:
                  c.y +
                  (e.key === "ArrowUp" ? 70 : e.key === "ArrowDown" ? -70 : 0),
              }));
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = position(e);
          pointers.current.set(e.pointerId, p);
          gesture.current = { ...p, distance: 0, moved: false };
        }}
        onPointerMove={(e) => {
          const p = position(e);
          if (!pointers.current.has(e.pointerId)) {
            const h = hit(p);
            setHover(
              h?.node !== undefined
                ? data.nodes[h.node].title
                : h?.members
                  ? `${h.members.length} concepts · cliquer pour explorer`
                  : "",
            );
            return;
          }
          const old = pointers.current.get(e.pointerId)!;
          pointers.current.set(e.pointerId, p);
          if (Math.hypot(p.x - gesture.current.x, p.y - gesture.current.y) > 4)
            gesture.current.moved = true;
          const a = [...pointers.current.values()];
          if (a.length === 2) {
            const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
            if (gesture.current.distance)
              setCamera((c) =>
                zoomAt(c, d / gesture.current.distance, {
                  x: (a[0].x + a[1].x) / 2,
                  y: (a[0].y + a[1].y) / 2,
                }),
              );
            gesture.current.distance = d;
            gesture.current.moved = true;
          } else
            setCamera((c) => ({
              ...c,
              x: c.x + p.x - old.x,
              y: c.y + p.y - old.y,
            }));
        }}
        onPointerUp={(e) => {
          const moved = gesture.current.moved;
          pointers.current.delete(e.pointerId);
          gesture.current.distance = 0;
          if (!moved) choose(position(e));
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onDoubleClick={(e) => {
          const p = position(e);
          setCamera((c) => zoomAt(c, 1.8, p));
        }}
      />
      <div className="spatial-map-heading">
        <span>CARTE DU SAVOIR</span>
        <strong>
          {camera.k < 0.24
            ? "Vue d’ensemble"
            : camera.k < 0.55
              ? "Quartiers de concepts"
              : "Concepts & connexions"}
        </strong>
      </div>
      <div className="spatial-zoom">
        <button
          aria-label="Zoom avant"
          onClick={() =>
            setCamera((c) => zoomAt(c, 1.5, { x: size.w / 2, y: size.h / 2 }))
          }
        >
          +
        </button>
        <button
          aria-label="Zoom arrière"
          onClick={() =>
            setCamera((c) =>
              zoomAt(c, 1 / 1.5, { x: size.w / 2, y: size.h / 2 }),
            )
          }
        >
          −
        </button>
        <button aria-label="Tout voir" onClick={fit}>
          ⤢
        </button>
        <output aria-label="Niveau de zoom">
          {Math.round(camera.k * 100)} %
        </output>
      </div>
      <div className="spatial-map-footer">
        <span>
          {hover || "Glisser pour déplacer · molette / pincement pour zoomer"}
        </span>
        <span>
          {counts.clusters ? `${counts.clusters} regroupements · ` : ""}
          {counts.nodes} points · {counts.edges} tracés visibles
        </span>
      </div>
    </div>
  );
}
