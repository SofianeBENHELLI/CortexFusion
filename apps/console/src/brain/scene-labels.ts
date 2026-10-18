import type { Camera } from "./spatial-model";
import type { GraphScene } from "./scene";

type Box = { x: number; y: number; w: number; h: number };
export type SceneLabel = Box & { text: string };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const glyphRadius = (
  g: GraphScene["glyphs"][number],
  selected: string | null,
) =>
  g.concept_id
    ? g.concept_id === selected
      ? 7
      : 4
    : Math.min(22, 7 + Math.sqrt(g.count));

/** Labels are screen-space decoration; no node or relationship is moved/removed. */
export function sceneLabels(
  data: GraphScene,
  camera: Camera,
  width: number,
  height: number,
  selected: string | null,
  priority: readonly string[] = [],
) {
  const emphasized = new Set([selected, ...priority].filter(Boolean));
  const markers = data.glyphs.map((g) => {
    const x = g.x * camera.k + camera.x,
      y = g.y * camera.k + camera.y;
    const r = glyphRadius(g, selected) + 3;
    return { g, x, y, r, box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r } };
  });
  const obstacles: Box[] = [
    { x: 0, y: 0, w: Math.min(240, width), h: 70 },
    { x: 0, y: height - 35, w: width, h: 35 },
    { x: width - 62, y: height - 155, w: 62, h: 155 },
    ...markers.map((m) => m.box),
  ];
  const labels = new Map<string, SceneLabel>();
  markers.sort(
    (a, b) =>
      Number(!!b.g.concept_id && emphasized.has(b.g.concept_id)) -
        Number(!!a.g.concept_id && emphasized.has(a.g.concept_id)) ||
      b.g.degree - a.g.degree ||
      a.g.id.localeCompare(b.g.id),
  );
  for (const m of markers) {
    if (
      m.x < 0 ||
      m.x > width ||
      m.y < 0 ||
      m.y > height ||
      labels.size >= (width < 500 ? 8 : 22)
    )
      continue;
    // Generic aggregation names add no information beyond their visible count.
    if (!m.g.concept_id && m.g.title === "Concepts") continue;
    const maxWidth = Math.min(240, width - 32);
    const chars = Array.from(m.g.title);
    let text = "",
      w = 0;
    for (const char of chars) {
      const advance = char.codePointAt(0)! >= 0x2e80 ? 12 : 7.2;
      if (w + advance > maxWidth - 12 || Array.from(text).length >= 32) {
        text += "…";
        w += 12;
        break;
      }
      text += char;
      w += advance;
    }
    w = Math.ceil(w) + 6;
    const candidates = [
      { x: m.x + m.r + 3, y: m.y - 9, w, h: 18 },
      { x: m.x - m.r - 3 - w, y: m.y - 9, w, h: 18 },
      {
        x: Math.max(6, Math.min(width - w - 6, m.x - w / 2)),
        y: m.y + m.r + 3,
        w,
        h: 18,
      },
      {
        x: Math.max(6, Math.min(width - w - 6, m.x - w / 2)),
        y: m.y - m.r - 21,
        w,
        h: 18,
      },
    ].filter(
      (b) =>
        b.x >= 6 &&
        b.x + b.w <= width - 6 &&
        b.y >= 6 &&
        b.y + b.h <= height - 6,
    );
    let box = candidates.find((b) => !obstacles.some((o) => overlap(b, o)));
    if (!box && m.g.concept_id && emphasized.has(m.g.concept_id)) {
      // Keep the selected name legible even in a dense hub; other names yield.
      box = candidates
        .filter((b) => ![...labels.values()].some((o) => overlap(b, o)))
        .sort(
          (a, b) =>
            obstacles.filter((o) => overlap(a, o)).length -
            obstacles.filter((o) => overlap(b, o)).length,
        )[0];
    }
    if (box) {
      labels.set(m.g.id, { ...box, text });
      obstacles.push(box);
    }
  }
  return labels;
}
