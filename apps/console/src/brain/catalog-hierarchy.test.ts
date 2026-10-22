import { describe, it, expect } from "vitest";
import { catalogFixture } from "./catalog.fixture";
import {
  catalogHierarchy,
  MAX_CATALOG_LEAF,
  MAX_CATALOG_BRANCHES,
} from "./catalog-hierarchy";
import { catalogProjection } from "./catalog";
import { macroLinks } from "./macro-links";
import { indexProjection } from "./projection-index";

describe("Density grouping for a local catalogue", () => {
  it("keeps small declared families intact and partitions dense ones without losing or duplicating members", () => {
    const base = catalogFixture().concepts[0];
    const nodes = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: `n-${i}`,
      title: `Fiche ${i.toString().padStart(4, "0")}`,
      brand: [i < 600 ? "catia" : "simulia"],
    }));
    const hierarchy = catalogHierarchy(nodes),
      groups = new Map(hierarchy.groups.map((g) => [g.id, g]));
    const children = new Map<string, number>(),
      leaves = new Map<string, number>();
    for (const g of hierarchy.groups)
      if (g.parentId)
        children.set(g.parentId, (children.get(g.parentId) ?? 0) + 1);
    for (const chain of hierarchy.memberships.values()) {
      expect(new Set(chain).size).toBe(chain.length);
      chain.forEach((id, i) =>
        expect(groups.get(id)?.parentId).toBe(chain[i + 1]),
      );
      leaves.set(chain[0], (leaves.get(chain[0]) ?? 0) + 1);
    }
    expect(hierarchy.memberships.size).toBe(1000);
    expect(Math.max(...children.values())).toBeLessThanOrEqual(
      MAX_CATALOG_BRANCHES,
    );
    expect(Math.max(...leaves.values())).toBeLessThanOrEqual(MAX_CATALOG_LEAF);
    expect([...leaves.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    expect(
      hierarchy.groups
        .filter((g) => g.grouping === "brand")
        .map((g) => g.title),
    ).toEqual(["CATIA", "SIMULIA"]);
  });
  it("preserves group identities and memberships when input order changes, including duplicate titles", () => {
    const base = catalogFixture().concepts[0];
    const nodes = Array.from({ length: 101 }, (_, i) => ({
      ...base,
      id: `n-${i}`,
      title: "Même titre",
      brand: null,
    }));
    const first = catalogHierarchy(nodes),
      second = catalogHierarchy(nodes.reverse());
    expect(second.groups).toEqual(first.groups);
    expect([...second.memberships]).toEqual([...first.memberships]);
  });
  it("aggregates references at the displayed level without counting ancestor memberships twice", () => {
    const c = catalogFixture(),
      base = c.concepts[0];
    c.concepts = Array.from({ length: 60 }, (_, i) => ({
      ...base,
      id: `n-${i}`,
      title: `Fiche ${i}`,
      source_path: `okf/n-${i}.md`,
      brand: [i < 30 ? "catia" : "simulia"],
      linked_concept_ids: [`n-${(i + 30) % 60}`],
    }));
    const p = catalogProjection(c),
      index = indexProjection(p),
      family = p.groups.find((g) => !g.parentId)!;
    const brands = new Set(index.children.get(family.id)!.map((g) => g.id));
    const macro = macroLinks(p, "groups", p.relations, brands);
    expect(macro).toHaveLength(1);
    expect(macro[0].relations).toHaveLength(60);
    expect(macroLinks(p, "groups", p.relations, new Set([family.id]))).toEqual(
      [],
    );
    expect(p.events).toEqual([]);
  });
});
