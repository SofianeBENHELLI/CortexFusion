import type { GraphScene, MapNodePage } from "./scene";
export const id = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
export const node = {
  id: id(1),
  title: "Alpha",
  group: "Group",
  territory: "Region",
  maturity: "emerging",
  x: 0,
  y: 0,
  degree: 1,
};
export const scene = {
  domain_id: id(0),
  at_version: 2,
  visibility: "a".repeat(64),
  totals: { concepts: 10000, relations: 20000, references: 0 },
  bounds: { x: -100, y: -100, w: 200, h: 200 },
  view: { x: -100, y: -100, w: 200, h: 200 },
  glyphs: [
    {
      id: id(1),
      concept_id: id(1),
      title: "Alpha",
      x: 0,
      y: 0,
      count: 1,
      bounds: { x: -30, y: -30, w: 120, h: 120 },
      degree: 1,
    },
  ],
  links: [],
  cell_size: 64,
  routes_total: 0,
  coverage: "viewport",
} as GraphScene;
export const page = {
  domain_id: id(0),
  at_version: 2,
  visibility: "a".repeat(64),
  totals: scene.totals,
  bounds: scene.bounds,
  total: 1,
  offset: 0,
  page_size: 16,
  items: [{ node, link: null }],
  selected: null,
  focus_bounds: null,
} as MapNodePage;
