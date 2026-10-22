import { relationId, type BrainProjection } from "./model";
import { catalogHierarchy } from "./catalog-hierarchy";

export interface CatalogConcept {
  id: string;
  title: string;
  type: string;
  description?: string;
  section?: string;
  brand?: string[] | null;
  layer: string;
  source_path: string;
  source_sha256: string;
  text: string;
  body_start: number;
  body_end: number;
  declared_status: string | null;
  linked_concept_ids: string[];
}
export interface Catalog {
  schema_version: 1;
  bundle: string;
  report: { archive_sha256: string };
  concepts: CatalogConcept[];
}
const hash = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const text = (s: unknown, max: number): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= max;
const safeId = (s: unknown): s is string =>
  text(s, 1000) &&
  /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(s) &&
  !s.split("/").includes("..");
export function validateCatalog(value: unknown): Catalog {
  const c = value as Catalog;
  if (
    !c ||
    c.schema_version !== 1 ||
    !text(c.bundle, 500) ||
    !c.report ||
    !hash(c.report.archive_sha256) ||
    !Array.isArray(c.concepts) ||
    c.concepts.length > 10000
  )
    throw new Error("Le fichier ne correspond pas à un catalogue OKF préparé.");
  let links = 0,
    characters = 0;
  const ids = new Set<string>();
  for (const n of c.concepts) {
    if (
      !n ||
      !safeId(n.id) ||
      ids.has(n.id) ||
      !text(n.title, 1000) ||
      !text(n.type, 100) ||
      !text(n.layer, 100) ||
      n.source_path !== `okf/${n.id}.md` ||
      !hash(n.source_sha256) ||
      !text(n.text, 2 * 1024 * 1024) ||
      !Number.isSafeInteger(n.body_start) ||
      !Number.isSafeInteger(n.body_end) ||
      n.body_start < 0 ||
      n.body_end < n.body_start ||
      n.body_end > Array.from(n.text).length ||
      (n.description !== undefined &&
        (typeof n.description !== "string" || n.description.length > 20000)) ||
      (n.section !== undefined && !text(n.section, 1000)) ||
      (n.brand !== undefined &&
        n.brand !== null &&
        (!Array.isArray(n.brand) ||
          n.brand.length > 20 ||
          n.brand.some((b) => !text(b, 100)))) ||
      (n.declared_status !== null && !text(n.declared_status, 100)) ||
      !Array.isArray(n.linked_concept_ids) ||
      n.linked_concept_ids.some((id) => !safeId(id))
    )
      throw new Error("Une fiche du catalogue est invalide ou dupliquée.");
    ids.add(n.id);
    links += n.linked_concept_ids.length;
    characters += n.text.length;
  }
  if (links > 200000 || characters > 25 * 1024 * 1024)
    throw new Error("Ce catalogue dépasse les limites de l’aperçu local.");
  if (c.concepts.some((n) => n.linked_concept_ids.some((id) => !ids.has(id))))
    throw new Error("Un lien du catalogue pointe vers une fiche absente.");
  return c;
}
const layerLabels: Record<string, string> = {
  offer: "Offres & produits",
  market: "Marchés & usages",
  messages: "Messages & valeur",
  gtm: "Approche commerciale",
  plays: "Scénarios & argumentaires",
  method: "Méthodes",
  platform: "Plateforme",
  reference: "Références",
  internal: "Organisation",
};
export const catalogGroup = (n: CatalogConcept) =>
  JSON.stringify([n.layer, n.section ?? n.type]);
export function catalogProjection(catalog: Catalog): BrainProjection {
  const domain = `okf:${catalog.report.archive_sha256}`;
  const hierarchy = catalogHierarchy(catalog.concepts);
  const territories = new Map<
    string,
    { id: string; title: string; groupIds: string[] }
  >();
  for (const n of catalog.concepts) {
    const group = catalogGroup(n);
    const territory = territories.get(n.layer) ?? {
      id: n.layer,
      title: layerLabels[n.layer] ?? n.layer,
      groupIds: [],
    };
    if (!territory.groupIds.includes(group)) territory.groupIds.push(group);
    territories.set(n.layer, territory);
  }
  const titles = new Map(catalog.concepts.map((n) => [n.id, n.title]));
  return {
    mode: "catalog",
    domainId: domain,
    domainName: catalog.bundle,
    publishedVersion: 0,
    nodes: catalog.concepts.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description ?? n.type,
      kind: "concept",
      groups: hierarchy.memberships.get(n.id)!,
      sourceIds: [n.source_path],
      declaredStatus: n.declared_status ?? undefined,
      classification: n.type,
    })),
    relations: catalog.concepts.flatMap((n) =>
      [...new Set(n.linked_concept_ids)].map((target) => ({
        id: relationId(domain, n.id, target, "unspecified"),
        from: n.id,
        to: target,
        toTitle: titles.get(target),
        kind: "unspecified" as const,
        weight: null,
        sourceIds: [n.source_path],
      })),
    ),
    groups: hierarchy.groups,
    territories: [...territories.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    events: [],
    sources: catalog.concepts.map((n) => ({
      id: n.source_path,
      title: n.source_path,
      text: Array.from(n.text)
        .slice(n.body_start, Math.min(n.body_end, n.body_start + 600))
        .join(""),
      fullText: n.text,
      hash: n.source_sha256,
    })),
    coverage: {
      from: null,
      publicationChanges: false,
      detail:
        "Aperçu local du catalogue fourni. Les fiches, statuts et références Markdown sont conservés. Les liens ne sont pas typés structurels ou associatifs, et aucun poids n’est déduit. Le chargement n’approuve ni ne publie ce corpus dans Open BrAIn. Aucun historique d’apprentissage n’est présent dans ce catalogue.",
    },
    capabilities: { dynamics: false, memory: false, archives: false },
  };
}
