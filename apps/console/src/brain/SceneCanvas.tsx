import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { zoomAt, type Camera, type Layout } from "./spatial-model";
import { fitBounds, type MapBounds, type GraphScene } from "./scene";
import { sceneLabels, glyphRadius } from "./scene-labels";
import { sceneLinkKey, type RelationObservation } from "./scene-changes";
export type SceneCameraMemory = {
  camera: Camera;
  layout: Layout;
  size: { w: number; h: number };
  focusSequence: number | null;
};
export function SceneCanvas({
  data,
  layout,
  selected,
  changes,
  relationChanges,
  emphasizedPair,
  focus,
  loading,
  cameraMemory,
  onView,
  onSelect,
  onLink,
}: {
  data: GraphScene;
  layout: Layout;
  selected: string | null;
  changes?: ReadonlyMap<string, string>;
  relationChanges?: ReadonlyMap<string, RelationObservation>;
  emphasizedPair?: { from: string; to: string; kind?: string } | null;
  focus: { bounds: MapBounds; sequence: number } | null;
  loading: boolean;
  cameraMemory: MutableRefObject<SceneCameraMemory | null>;
  onView: (view: MapBounds) => void;
  onSelect: (id: string | null) => void;
  onLink: (
    from: string,
    to: string,
    kind: string,
    weight: number | null,
  ) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const saved = cameraMemory.current;
  const [size, setSize] = useState(saved?.size ?? { w: 800, h: 600 }),
    [camera, setCamera] = useState<Camera>(
      saved?.camera ?? { x: 0, y: 0, k: 0.1 },
    );
  const seenFocus = useRef(saved?.focusSequence ?? null);
  const ready = useRef(false),
    callback = useRef(onView);
  callback.current = onView;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, moved: false, x: 0, y: 0 });
  const fit = () => setCamera(fitBounds(data.bounds, size.w, size.h));
  useEffect(() => {
    const ob = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ob.observe(host.current!);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    const previous = cameraMemory.current;
    const restore =
      !ready.current &&
      previous?.layout === layout &&
      previous.size.w === size.w &&
      previous.size.h === size.h;
    ready.current = true;
    if (restore) setCamera(previous.camera);
    else if (focus) {
      // A delayed initial measurement or responsive reflow must not erase the
      // active event/neighbor framing. Explicit new layouts clear the focus.
      setCamera(fitBounds(focus.bounds, size.w, size.h));
      seenFocus.current = focus.sequence;
    } else fit();
  }, [layout, size.w, size.h]);
  useEffect(() => {
    if (focus && focus.sequence !== seenFocus.current) {
      setCamera(fitBounds(focus.bounds, size.w, size.h));
      seenFocus.current = focus.sequence;
    }
  }, [focus]);
  useEffect(() => {
    // Geometry only: no previously authorized content survives an error here.
    cameraMemory.current = {
      camera,
      layout,
      size,
      focusSequence: seenFocus.current,
    };
  }, [camera, layout, size]);
  useEffect(() => {
    if (!ready.current) return;
    const timer = setTimeout(
      () =>
        callback.current({
          x: -camera.x / camera.k,
          y: -camera.y / camera.k,
          w: size.w / camera.k,
          h: size.h / camera.k,
        }),
      160,
    );
    return () => clearTimeout(timer);
  }, [camera, size]);
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  useEffect(() => {
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((c) =>
        zoomAt(
          c,
          Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.003),
          pos(e),
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const screen = (p: { x: number; y: number }) => ({
    x: p.x * camera.k + camera.x,
    y: p.y * camera.k + camera.y,
  });
  const clusters = data.glyphs.filter((g) => !g.concept_id).length;
  const labels = sceneLabels(
    data,
    camera,
    size.w,
    size.h,
    selected,
    emphasizedPair ? [emphasizedPair.to] : [],
  );
  return (
    <div className="spatial-stage" ref={host}>
      <svg
        ref={svg}
        className="scene-svg"
        role="img"
        aria-label="BrainMap progressive. Glisser pour déplacer, molette pour zoomer. Clavier : plus, moins, flèches, Origine."
        tabIndex={0}
        onKeyDown={(e) => {
          if (
            ![
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
          )
            return;
          e.preventDefault();
          if (e.key === "Home") fit();
          else if (e.key === "Escape") onSelect(null);
          else if (["+", "=", "-"].includes(e.key))
            setCamera((c) =>
              zoomAt(c, e.key === "-" ? 1 / 1.5 : 1.5, {
                x: size.w / 2,
                y: size.h / 2,
              }),
            );
          else
            setCamera((c) => ({
              ...c,
              x:
                c.x +
                (e.key === "ArrowLeft" ? 70 : e.key === "ArrowRight" ? -70 : 0),
              y:
                c.y +
                (e.key === "ArrowUp" ? 70 : e.key === "ArrowDown" ? -70 : 0),
            }));
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[role=button]")) return;
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pos(e);
          pointers.current.set(e.pointerId, p);
          gesture.current = { ...p, distance: 0, moved: false };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          const p = pos(e),
            old = pointers.current.get(e.pointerId)!;
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
          const down = pointers.current.has(e.pointerId);
          pointers.current.delete(e.pointerId);
          gesture.current.distance = 0;
          if (down && !gesture.current.moved) onSelect(null);
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("[role=button]")) return;
          setCamera((c) => zoomAt(c, 1.8, pos(e)));
        }}
      >
        {data.links.map((e, i) => {
          const a = data.glyphs[e.from],
            b = data.glyphs[e.to],
            pa = screen(a),
            pb = screen(b);
          const pairActive =
            !e.aggregate &&
            emphasizedPair &&
            a.concept_id === emphasizedPair.from &&
            b.concept_id === emphasizedPair.to &&
            (!emphasizedPair.kind || e.kind === emphasizedPair.kind);
          const active = emphasizedPair
            ? pairActive
            : selected !== null &&
              (a.concept_id === selected || b.concept_id === selected);
          const observation =
            !e.aggregate && a.concept_id && b.concept_id
              ? relationChanges?.get(
                  sceneLinkKey(a.concept_id, b.concept_id, e.kind),
                )
              : undefined;
          const select = () => {
            if (!e.aggregate && a.concept_id && b.concept_id)
              onLink(a.concept_id, b.concept_id, e.kind, e.weight);
          };
          return (
            <g key={i}>
              <line
                className={observation ? "scene-changed-link" : undefined}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="currentColor"
                opacity={
                  active ? 0.9 : observation ? 0.65 : e.aggregate ? 0.12 : 0.25
                }
                strokeWidth={
                  active
                    ? 2.6
                    : observation
                      ? 1.8
                      : e.aggregate
                        ? Math.min(3, 0.5 + Math.log1p(e.count) / 3)
                        : 0.8
                }
                strokeDasharray={e.kind === "reference" ? "3 4" : undefined}
              />
              {!e.aggregate && (
                <line
                  role="button"
                  aria-label={`Lien de ${a.title} vers ${b.title}${observation ? ` · Historique : ${observation.label}` : ""}`}
                  tabIndex={-1}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke="transparent"
                  strokeWidth={9}
                  onClick={select}
                >
                  <title>
                    {e.kind} · {e.count}
                    {observation
                      ? ` · Lien actuel · Historique chargé : ${observation.label}`
                      : ""}
                  </title>
                </line>
              )}
            </g>
          );
        })}
        {data.glyphs.map((g) => {
          const p = screen(g);
          const selectedNode =
            (selected !== null && g.concept_id === selected) ||
            (!!g.concept_id &&
              !!emphasizedPair &&
              [emphasizedPair.from, emphasizedPair.to].includes(g.concept_id));
          const r = glyphRadius(g, selected);
          const open = () => {
            if (g.concept_id) onSelect(g.concept_id);
            else {
              const next = fitBounds(g.bounds, size.w, size.h);
              setCamera((c) =>
                next.k > c.k * 1.15 ? next : zoomAt(c, 1.8, p),
              );
            }
          };
          const label = labels.get(g.id);
          const change = g.concept_id ? changes?.get(g.concept_id) : undefined;
          return (
            <g
              key={g.id}
              role="button"
              aria-label={
                g.concept_id
                  ? `${g.title}${change ? ` · Changement observé : ${change}` : ""}`
                  : `Explorer ${g.title}, ${g.count} concepts`
              }
              tabIndex={0}
              onClick={open}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  open();
                }
              }}
            >
              {change && (
                <circle
                  className="scene-change-ring"
                  cx={p.x}
                  cy={p.y}
                  r={r + 9}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                />
              )}
              <circle
                className="scene-halo"
                cx={p.x}
                cy={p.y}
                r={r + 6}
                fill="currentColor"
                opacity={0.04}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={g.concept_id ? "currentColor" : "var(--surface)"}
                stroke="currentColor"
                opacity={selectedNode ? 1 : 0.65}
              />
              {!g.concept_id && (
                <text
                  x={p.x}
                  y={p.y + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill="currentColor"
                >
                  {g.count}
                </text>
              )}
              {label && (
                <text
                  className="scene-label"
                  x={label.x + 3}
                  y={label.y + 13}
                  fontSize={11}
                  fill="currentColor"
                  stroke="var(--surface)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  opacity={selectedNode ? 1 : 0.75}
                >
                  {label.text}
                </text>
              )}
              <title>
                {g.title}
                {change ? ` · ${change}` : ""}
                {!g.concept_id ? ` · ${g.count} concepts` : ""}
              </title>
            </g>
          );
        })}
      </svg>
      <div className="spatial-map-heading">
        <span>CARTE DU SAVOIR</span>
        <strong>
          {camera.k < 0.24
            ? "Vue d’ensemble"
            : camera.k < 0.55
              ? "Quartiers de concepts"
              : "Concepts & connexions"}
        </strong>
        {loading && <small role="status">Lecture de la zone…</small>}
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
        <span>Glisser pour déplacer · zoomer pour explorer</span>
        <span>
          {clusters} regroupements · {data.glyphs.length - clusters} points ·{" "}
          {data.links.length} tracés
          {data.routes_total > data.links.length ? " · routes principales" : ""}
        </span>
      </div>
    </div>
  );
}
