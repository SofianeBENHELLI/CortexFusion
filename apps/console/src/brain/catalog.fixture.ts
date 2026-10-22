import type { Catalog, CatalogConcept } from "./catalog";
export function catalogFixture(): Catalog {
  const node = (
    id: string,
    layer: string,
    section: string,
    targets: string[] = [],
  ): CatalogConcept => ({
    id,
    title: id,
    type: "product",
    description: "Texte synthétique",
    layer,
    section,
    source_path: `okf/${id}.md`,
    source_sha256: "a".repeat(64),
    text: "Une preuve 🧠 conservée.",
    body_start: 0,
    body_end: 22,
    declared_status: "draft",
    linked_concept_ids: targets,
  });
  return {
    schema_version: 1,
    bundle: "Corpus de recette",
    report: { archive_sha256: "b".repeat(64) },
    concepts: [
      node("a", "offer", "Produits", ["b", "b", "c"]),
      node("b", "offer", "Services", ["a"]),
      node("c", "market", "Secteurs", ["a"]),
    ],
  };
}
