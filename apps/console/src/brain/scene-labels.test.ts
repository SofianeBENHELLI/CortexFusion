import { expect, it } from "vitest";
import { sceneLabels } from "./scene-labels";
import { scene, id } from "./scene.fixture";

it("keeps selected labels ahead of dense neighbors without hiding their markers", () => {
  const data = {
    ...scene,
    glyphs: Array.from({ length: 40 }, (_, i) => ({
      ...scene.glyphs[0],
      id: id(i + 1),
      concept_id: id(i + 1),
      title: `Concept distant ${i}`,
      x: 60 + i * 6,
      y: 100 + i * 5,
      degree: 40 - i,
    })),
  };
  const before = structuredClone(data);
  const labels = sceneLabels(data, { x: 0, y: 0, k: 1 }, 390, 460, id(40));
  expect(labels.has(id(40))).toBe(true);
  expect(labels.size).toBeLessThanOrEqual(8);
  expect(data).toEqual(before);
  const boxes = [...labels.values()];
  for (const [i, a] of boxes.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(6);
    expect(a.x + a.w).toBeLessThanOrEqual(384);
    for (const b of boxes.slice(i + 1))
      expect(
        a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y,
      ).toBe(false);
  }
});
it("omits redundant generic labels and fits Unicode labels near an edge", () => {
  const data = {
    ...scene,
    glyphs: [
      {
        ...scene.glyphs[0],
        id: "cell",
        concept_id: null,
        title: "Concepts",
        count: 100,
        x: 50,
        y: 150,
      },
      { ...scene.glyphs[0], title: "🧠".repeat(100), x: 70, y: 260 },
    ],
  };
  const labels = sceneLabels(data, { x: 0, y: 0, k: 1 }, 320, 460, null);
  expect(labels.has("cell")).toBe(false);
  const text = labels.get(id(1))!.text;
  expect(text).toMatch(/^🧠+…$/u);
  expect(labels.get(id(1))!.x + labels.get(id(1))!.w).toBeLessThanOrEqual(314);
});

it("prioritizes both event endpoints without overlapping their labels", () => {
  const data = {
    ...scene,
    glyphs: Array.from({ length: 24 }, (_, i) => ({
      ...scene.glyphs[0],
      id: id(i + 1),
      concept_id: id(i + 1),
      title: `Concept ${i}`,
      x: 80 + (i % 6) * 45,
      y: 110 + Math.floor(i / 6) * 75,
      degree: 100 - i,
    })),
  };
  const labels = sceneLabels(data, { x: 0, y: 0, k: 1 }, 390, 460, id(24), [
    id(23),
  ]);
  expect(labels.has(id(24))).toBe(true);
  expect(labels.has(id(23))).toBe(true);
  const a = labels.get(id(24))!,
    b = labels.get(id(23))!;
  expect(
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
  ).toBe(false);
});
