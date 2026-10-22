import type { GraphScene } from "../../../../packages/contracts/src/GraphScene";
import type { MapNodePage } from "../../../../packages/contracts/src/MapNodePage";
import type { MapBounds } from "../../../../packages/contracts/src/MapBounds";
import { ApiError } from "../api/client";
import { isUuid } from "./api-graph";
export type { GraphScene, MapNodePage, MapBounds };
const invalid = () => {
  throw new ApiError(200, "invalid_response");
};
const finite = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e10;
const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
export function bounds(b: MapBounds) {
  return b && [b.x, b.y, b.w, b.h].every(finite) && b.w > 0 && b.h > 0;
}
function base(v: GraphScene | MapNodePage, domain: string) {
  if (
    !v ||
    v.domain_id !== domain ||
    !count(v.at_version) ||
    !/^[a-f0-9]{64}$/.test(v.visibility) ||
    !bounds(v.bounds) ||
    !v.totals ||
    !Object.values(v.totals).every(count)
  )
    invalid();
}
export function validateScene(v: GraphScene, domain: string): GraphScene {
  base(v, domain);
  if (
    !Array.isArray(v.glyphs) ||
    v.glyphs.length > 24 ||
    !Array.isArray(v.links) ||
    v.links.length > 120 ||
    !bounds(v.view) ||
    !finite(v.cell_size) ||
    v.cell_size <= 0 ||
    v.coverage !== "viewport"
  )
    invalid();
  if (
    v.glyphs.some(
      (n) =>
        !n ||
        typeof n.id !== "string" ||
        !n.id ||
        typeof n.title !== "string" ||
        n.title.length > 400 ||
        !count(n.count) ||
        !finite(n.x) ||
        !finite(n.y) ||
        !bounds(n.bounds) ||
        (n.concept_id !== null && !isUuid(n.concept_id)),
    )
  )
    invalid();
  if (new Set(v.glyphs.map((n) => n.id)).size !== v.glyphs.length) invalid();
  if (
    v.links.some(
      (e) =>
        !e ||
        !count(e.from) ||
        !count(e.to) ||
        e.from >= v.glyphs.length ||
        e.to >= v.glyphs.length ||
        !count(e.count) ||
        !["associative", "structural", "reference"].includes(e.kind) ||
        typeof e.aggregate !== "boolean" ||
        (e.weight !== null &&
          (!finite(e.weight) || e.weight < 0 || e.weight > 1)),
    )
  )
    invalid();
  return v;
}
export function validateNodePage(v: MapNodePage, domain: string): MapNodePage {
  base(v, domain);
  const node = (n: MapNodePage["selected"]) =>
    n &&
    isUuid(n.id) &&
    ["title", "group", "territory", "maturity"].every(
      (k) => typeof n[k as keyof typeof n] === "string",
    ) &&
    finite(n.x) &&
    finite(n.y);
  if (
    !Array.isArray(v.items) ||
    ![8, 16].includes(v.page_size) ||
    v.items.length > v.page_size ||
    !count(v.total) ||
    !count(v.offset) ||
    v.offset + v.items.length > v.total ||
    v.items.some(
      (i) =>
        !node(i.node) ||
        (i.link &&
          (!isUuid(i.link.from) ||
            !isUuid(i.link.to) ||
            !["associative", "structural", "reference"].includes(i.link.kind) ||
            (i.link.weight !== null &&
              (!finite(i.link.weight) ||
                i.link.weight < 0 ||
                i.link.weight > 1)))),
    ) ||
    (v.selected !== null && !node(v.selected)) ||
    (v.focus_bounds !== null && !bounds(v.focus_bounds))
  )
    invalid();
  return v;
}
export function fitBounds(b: MapBounds, w: number, h: number) {
  const k = Math.max(
    0.001,
    Math.min(12, Math.max(60, w - 100) / b.w, Math.max(60, h - 120) / b.h),
  );
  return {
    k,
    x: w / 2 - (b.x + b.w / 2) * k,
    y: (h - 35) / 2 - (b.y + b.h / 2) * k,
  };
}
