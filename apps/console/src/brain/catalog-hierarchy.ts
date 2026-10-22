import type { CatalogConcept } from "./catalog";
import type { BrainGroup } from "./model";

export const MAX_CATALOG_LEAF = 24;
export const MAX_CATALOG_BRANCHES = 12;

/** Local catalogue navigation, never semantic knowledge or publication events.
 * Large declared families split by declared brand, then by alphabetical ranges.
 * Memberships are leaf-first; ancestor memberships let every level count once.
 */
export function catalogHierarchy(concepts: CatalogConcept[]) {
  const groups: BrainGroup[] = [],
    memberships = new Map<string, string[]>();
  const families = new Map<string, CatalogConcept[]>();
  for (const node of concepts) {
    const id = JSON.stringify([node.layer, node.section ?? node.type]);
    const members = families.get(id) ?? [];
    members.push(node);
    families.set(id, members);
  }
  const ordered = (nodes: CatalogConcept[]) =>
    [...nodes].sort(
      (a, b) =>
        a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id),
    );
  function add(
    nodes: CatalogConcept[],
    group: BrainGroup,
    ancestors: string[],
    tryBrands: boolean,
  ) {
    groups.push(group);
    const chain = [group.id, ...ancestors];
    if (nodes.length <= MAX_CATALOG_LEAF) {
      for (const n of nodes) memberships.set(n.id, chain);
      return;
    }
    if (tryBrands) {
      const brands = new Map<string, CatalogConcept[]>();
      for (const n of nodes) {
        const brand =
          [...new Set(n.brand ?? [])].sort().join(" / ") ||
          "Sans marque renseignée";
        const list = brands.get(brand) ?? [];
        list.push(n);
        brands.set(brand, list);
      }
      if (brands.size > 1 && brands.size <= MAX_CATALOG_BRANCHES) {
        for (const [brand, list] of [...brands].sort(([a], [b]) =>
          a.localeCompare(b),
        ))
          add(
            list,
            {
              id: JSON.stringify(["catalog-brand", group.id, brand]),
              title:
                brand === "Sans marque renseignée"
                  ? brand
                  : brand.toUpperCase(),
              parentId: group.id,
              territoryId: group.territoryId,
              grouping: "brand",
            },
            chain,
            false,
          );
        return;
      }
    }
    const sorted = ordered(nodes),
      chunk = Math.max(
        MAX_CATALOG_LEAF,
        Math.ceil(nodes.length / MAX_CATALOG_BRANCHES),
      );
    for (let i = 0; i < sorted.length; i += chunk) {
      const list = sorted.slice(i, i + chunk),
        first = list[0],
        last = list[list.length - 1];
      const label = (title: string) =>
        title.length > 22 ? title.slice(0, 22) + "…" : title;
      add(
        list,
        {
          id: JSON.stringify(["catalog-range", first.id, last.id]),
          title: `${label(first.title)} → ${label(last.title)}`,
          parentId: group.id,
          territoryId: group.territoryId,
          grouping: "alphabetical",
        },
        chain,
        false,
      );
    }
  }
  for (const [id, nodes] of [...families].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    add(
      nodes,
      {
        id,
        title: nodes[0].section ?? nodes[0].type,
        territoryId: nodes[0].layer,
        grouping: "family",
      },
      [],
      true,
    );
  return { groups, memberships };
}
