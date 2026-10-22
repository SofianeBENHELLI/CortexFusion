import { expect, it } from "vitest";
import {
  validateScene,
  validateNodePage,
  fitBounds,
  type GraphScene,
  type MapNodePage,
} from "./scene";
import { id, node, scene, page } from "./scene.fixture";
it("rejects geometry, endpoints and cross-domain responses before drawing", () => {
  expect(validateScene(scene, id(0))).toBe(scene);
  for (const v of [
    { ...scene, domain_id: id(2) },
    { ...scene, glyphs: [{ ...scene.glyphs[0], x: Infinity }] },
    {
      ...scene,
      links: [
        {
          from: 0,
          to: 3,
          kind: "associative",
          weight: 0.5,
          count: 1,
          aggregate: false,
        },
      ],
    },
  ])
    expect(() => validateScene(v as GraphScene, id(0))).toThrow();
});
it("accepts honest page totals but rejects partial records and oversized page payloads", () => {
  expect(validateNodePage(page, id(0))).toBe(page);
  expect(() => validateNodePage({ ...page, total: 0 }, id(0))).toThrow();
  expect(() =>
    validateNodePage(
      {
        ...page,
        items: Array.from({ length: 17 }, () => page.items[0]),
      } as MapNodePage,
      id(0),
    ),
  ).toThrow();
  expect(() =>
    validateNodePage(
      { ...page, selected: { ...node, id: "hidden" } } as MapNodePage,
      id(0),
    ),
  ).toThrow();
});
it("fits the same world bounds within mobile and desktop camera limits", () => {
  for (const width of [320, 1280]) {
    const c = fitBounds(scene.bounds, width, 600);
    expect(c.k).toBeGreaterThan(0);
    expect(c.k * scene.bounds.w).toBeLessThanOrEqual(width - 90);
  }
});
it("rejects oversized scenes and search pages even when their totals are valid", () => {
  const glyphs = Array.from({ length: 25 }, (_, i) => ({
    ...scene.glyphs[0],
    id: id(i + 1),
  }));
  expect(() =>
    validateScene({ ...scene, glyphs } as GraphScene, id(0)),
  ).toThrow();
  expect(
    validateScene(
      { ...scene, glyphs: glyphs.slice(0, 24) } as GraphScene,
      id(0),
    ),
  ).toBeTruthy();
  const search = {
    ...page,
    page_size: 8,
    total: 30,
    items: Array(8).fill(page.items[0]),
  } as MapNodePage;
  expect(validateNodePage(search, id(0))).toBe(search);
  expect(() =>
    validateNodePage(
      { ...search, items: Array(9).fill(page.items[0]) } as MapNodePage,
      id(0),
    ),
  ).toThrow();
  expect(() =>
    validateNodePage(
      { ...search, page_size: 9 } as unknown as MapNodePage,
      id(0),
    ),
  ).toThrow();
});
