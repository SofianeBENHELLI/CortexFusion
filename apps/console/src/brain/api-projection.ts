import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import type { CommitSummary } from "../../../../packages/contracts/src/CommitPage";
import type { PublicationWindow } from "../../../../packages/contracts/src/PublicationWindow";
import type { ProposalDifference } from "../../../../packages/contracts/src/ProposalDifference";
import type {
  ProposalDifferenceSummary,
  DifferenceSummaryConcept,
} from "../../../../packages/contracts/src/ProposalDifferenceSummary";
import type { VersionView } from "../../../../packages/contracts/src/VersionView";
import { ApiError, CortexApi } from "../api/client";
import { readGraphWindow, summaryNode, type GraphRequest } from "./api-graph";
import type { GraphWindow } from "../../../../packages/contracts/src/GraphWindow";
import {
  relationId,
  type BrainProjection,
  type BrainRelation,
  type BrainChange,
  type ChangeKind,
} from "./model";
import { isUuid } from "../api/uuid";

const invalid = () => new ApiError(200, "invalid_response");
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
type EvidenceConcept = Concept | DifferenceSummaryConcept;
function validateEvidenceConcept(c: EvidenceConcept) {
  if (
    !c ||
    !isUuid(c.concept_id) ||
    typeof c.title !== "string" ||
    !c.title.trim() ||
    !Array.isArray(c.sources) ||
    !c.sources.length ||
    c.sources.some(
      (s) =>
        !s ||
        !isUuid(s.source_id) ||
        !integer(s.start) ||
        !integer(s.end) ||
        s.end <= s.start,
    ) ||
    (c.maturity !== undefined &&
      !["emerging", "observed", "established", "reference"].includes(
        c.maturity,
      )) ||
    (c.links !== undefined &&
      (!Array.isArray(c.links) ||
        c.links.some(
          (l) =>
            !l ||
            !isUuid(l.target_id) ||
            !["structural", "associative"].includes(l.kind) ||
            (l.weight !== undefined &&
              (!Number.isFinite(l.weight) || l.weight < 0 || l.weight > 1)) ||
            (l.primary !== undefined && typeof l.primary !== "boolean") ||
            (l.primary === true && l.kind !== "structural"),
        )))
  )
    throw invalid();
  const ids = (c.links ?? []).map((l) => `${l.target_id}:${l.kind}`);
  if (new Set(ids).size !== ids.length) throw invalid();
  return c;
}
export function validateConcept(c: Concept): Concept {
  if (!c || typeof c.body !== "string") throw invalid();
  validateEvidenceConcept(c);
  return c;
}
function version(v: VersionView, domain: string) {
  if (
    !v ||
    v.domain_id !== domain ||
    !integer(v.accepted_version) ||
    !integer(v.published_version) ||
    v.accepted_version < v.published_version
  )
    throw invalid();
  return v;
}
function publicationPage(
  page: PublicationWindow,
  domain: string,
  anchor: number,
  window: HistoryWindow,
) {
  const upper = window.before ?? anchor + 1;
  const sameTime = (actual: string | null, expected?: string) =>
    expected
      ? Date.parse(actual ?? "") === Date.parse(expected)
      : actual === null;
  if (
    !page ||
    page.domain_id !== domain ||
    page.at_version !== anchor ||
    !sameTime(page.since, window.since) ||
    !sameTime(page.until, window.until) ||
    typeof page.scan_limited !== "boolean" ||
    !Array.isArray(page.items) ||
    page.items.length > 20 ||
    (page.next_before !== null &&
      (!integer(page.next_before) ||
        page.next_before < 1 ||
        page.next_before >= upper)) ||
    page.items.some(
      (c) =>
        !c ||
        !integer(c.sequence) ||
        c.sequence < 1 ||
        c.sequence >= upper ||
        c.sequence > anchor ||
        !isUuid(c.proposal_id) ||
        c.published !== true ||
        typeof c.reason !== "string" ||
        (c.publication !== null &&
          (!c.publication ||
            !Number.isFinite(Date.parse(c.publication.recorded_at)))),
    )
  )
    throw invalid();
  if (
    page.items.some(
      (c, i) =>
        (i > 0 && c.sequence >= page.items[i - 1].sequence) ||
        (page.next_before !== null && c.sequence < page.next_before),
    )
  )
    throw invalid();
  if (
    page.items.some(
      (c) =>
        c.publication &&
        ((window.since &&
          Date.parse(c.publication.recorded_at) < Date.parse(window.since)) ||
          (window.until &&
            Date.parse(c.publication.recorded_at) > Date.parse(window.until))),
    )
  )
    throw invalid();
  return page;
}
function difference(
  diff: ProposalDifferenceSummary,
  commit: CommitSummary,
  published: number,
) {
  if (
    !diff ||
    diff.proposal_id !== commit.proposal_id ||
    diff.comparison !== "accepted_before_state" ||
    diff.stale_base !== false ||
    !integer(diff.base_version) ||
    diff.base_version + 1 !== commit.sequence ||
    diff.published_version !== published ||
    !Array.isArray(diff.items) ||
    diff.items.length > 50 ||
    new Set(diff.items.map((i) => i?.concept_id)).size !== diff.items.length
  )
    throw invalid();
  for (const item of diff.items) {
    if (!item || !isUuid(item.concept_id) || (!item.before && !item.after))
      throw invalid();
    for (const c of [item.before, item.after])
      if (c) {
        validateEvidenceConcept(c);
        if ("body" in c || !/^[0-9a-f]{64}$/.test(c.body_sha256))
          throw invalid();
        if (c.concept_id !== item.concept_id) throw invalid();
      }
  }
  return diff;
}
const refs = (c: EvidenceConcept) => [
  ...new Set(c.sources.map((s) => s.source_id)),
];
const contentIdentity = (c: EvidenceConcept) =>
  "body_sha256" in c ? c.body_sha256 : c.body;
function relations(
  c: EvidenceConcept,
  domain: string,
  titles: Map<string, string>,
): BrainRelation[] {
  return (c.links ?? []).map((l) => ({
    id: relationId(domain, c.concept_id, l.target_id, l.kind),
    from: c.concept_id,
    to: l.target_id,
    toTitle: titles.get(l.target_id) ?? l.target_id,
    kind: l.kind,
    weight: l.weight ?? 1,
    primary: l.primary ?? false,
    sourceIds: refs(c),
  }));
}
/** Derive effects only from an audited published commit and its accepted before/after. */
export function publicationChanges(
  domain: string,
  commit: CommitSummary,
  diff: ProposalDifference | ProposalDifferenceSummary,
  titles: Map<string, string>,
): BrainChange[] {
  if (!commit.published || !commit.publication) return [];
  const output: BrainChange[] = [];
  for (const item of diff.items) {
    const c = item.after ?? item.before!;
    const sources = [
      ...new Set([
        ...(item.before ? refs(item.before) : []),
        ...(item.after ? refs(item.after) : []),
      ]),
    ];
    const emit = (
      kind: ChangeKind,
      title: string,
      detail: string,
      relation?: BrainRelation,
    ) =>
      output.push({
        id: JSON.stringify([
          domain,
          commit.sequence,
          item.concept_id,
          kind,
          relation?.id ?? "",
        ]),
        publicationId: `${domain}:${commit.sequence}`,
        time: commit.publication!.recorded_at,
        version: commit.sequence,
        kind,
        title,
        detail,
        nodeIds: relation ? [relation.from, relation.to] : [c.concept_id],
        groupIds: [c.concept_id],
        sourceIds: sources,
        evidence: [
          ...new Map(
            [
              ...(item.before?.sources ?? []),
              ...(item.after?.sources ?? []),
            ].map((s) => [JSON.stringify([s.source_id, s.start, s.end]), s]),
          ).values(),
        ],
        relation,
      });
    if (!item.before)
      emit(
        "concept_created",
        c.title,
        "Ce concept a rejoint le savoir publié. " + commit.reason,
      );
    else if (!item.after)
      emit(
        "concept_removed",
        c.title,
        "Ce concept a été retiré du savoir publié. Ce retrait ne constitue pas un archivage réversible. " +
          commit.reason,
      );
    else if (
      item.before.title !== item.after.title ||
      contentIdentity(item.before) !== contentIdentity(item.after) ||
      item.before.maturity !== item.after.maturity ||
      JSON.stringify(item.before.sources) !== JSON.stringify(item.after.sources)
    )
      emit(
        "concept_updated",
        c.title,
        "Le contenu, la maturité ou les preuves de ce concept ont changé par publication. " +
          commit.reason,
      );
    const before = new Map(
      (item.before ? relations(item.before, domain, titles) : []).map((r) => [
        r.id,
        r,
      ]),
    );
    const after = new Map(
      (item.after ? relations(item.after, domain, titles) : []).map((r) => [
        r.id,
        r,
      ]),
    );
    for (const [id, r] of after) {
      const old = before.get(id),
        title = `${c.title} → ${r.toTitle}`;
      if (!old)
        emit(
          "relation_created",
          title,
          `Relation ${r.kind === "structural" ? "structurelle" : "associative"} publiée. ${commit.reason}`,
          r,
        );
      else {
        if (old.weight !== r.weight)
          emit(
            r.weight! > old.weight!
              ? "relation_strengthened"
              : "relation_weakened",
            title,
            `Poids publié : ${old.weight} → ${r.weight}. Ce changement provient de la publication ; il ne prouve pas un ajustement automatique par usage. ${commit.reason}`,
            r,
          );
        if (old.primary !== r.primary)
          emit(
            "relation_primary_changed",
            title,
            `Relation principale : ${old.primary ? "oui" : "non"} → ${r.primary ? "oui" : "non"}. Marqueur modifié par publication. ${commit.reason}`,
            r,
          );
      }
    }
    for (const [id, r] of before)
      if (!after.has(id))
        emit(
          "relation_removed",
          `${c.title} → ${r.toTitle}`,
          "Relation retirée par publication. Ce retrait est distinct de l’archivage. " +
            commit.reason,
          r,
        );
  }
  return output;
}
export interface ApiBrainResult {
  unavailableFocus: boolean;
  graph: GraphWindow;
  version: VersionView;
  projection: BrainProjection;
  evidence: Record<string, { source_id: string; start: number; end: number }[]>;
  partialHistory: boolean;
  nextBefore: number | null;
  observedPublications: number;
  scanLimited: boolean;
  eventLimited: boolean;
}
export interface HistoryWindow {
  before?: number;
  atVersion?: number;
  since?: string;
  until?: string;
  maxPages?: 1 | 5;
}
/** Windowed graph and recent journal, with publication and current-visibility fences. */
export async function readApiBrain(
  api: CortexApi,
  domain: string,
  name: string,
  owner: boolean,
  window: HistoryWindow = {},
  signal?: AbortSignal,
  graphRequest: GraphRequest = {},
): Promise<ApiBrainResult> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45000);
  try {
    return await readApiBrainWindow(
      api,
      domain,
      name,
      owner,
      window,
      controller.signal,
      graphRequest,
    );
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new ApiError(0, "timeout");
    throw error;
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
async function readApiBrainWindow(
  api: CortexApi,
  domain: string,
  name: string,
  owner: boolean,
  window: HistoryWindow,
  signal: AbortSignal,
  graphRequest: GraphRequest,
): Promise<ApiBrainResult> {
  if (signal.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (window.maxPages !== undefined && ![1, 5].includes(window.maxPages))
    throw invalid();
  const before = version(
    await api.call("domain.version", { domain }, undefined, { signal }),
    domain,
  );
  if (
    window.atVersion !== undefined &&
    window.atVersion !== before.published_version
  )
    throw new ApiError(409, "projection_changed");
  let graph: GraphWindow;
  let unavailableFocus = false;
  const recoverFocus =
    !!graphRequest.focus &&
    !graphRequest.detail &&
    !graphRequest.locate &&
    !graphRequest.after &&
    !graphRequest.before;
  try {
    graph = await readGraphWindow(
      api,
      domain,
      before.published_version,
      graphRequest,
      signal,
    );
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 404 ||
      (!graphRequest.historical && !recoverFocus)
    )
      throw error;
    unavailableFocus = !graphRequest.historical;
    // A historical target may have disappeared while its origin still exists.
    // Keep that current neighborhood if possible. Only separately authorized
    // publication evidence below may supply a historical trace.
    const fallback = {
      atVersion: graphRequest.atVersion,
      visibility: graphRequest.visibility,
    };
    if (graphRequest.focus && graphRequest.locate) {
      try {
        graph = await readGraphWindow(
          api,
          domain,
          before.published_version,
          { ...fallback, focus: graphRequest.focus },
          signal,
        );
      } catch (focusError) {
        if (!(focusError instanceof ApiError) || focusError.status !== 404)
          throw focusError;
        graph = await readGraphWindow(
          api,
          domain,
          before.published_version,
          fallback,
          signal,
        );
      }
    } else {
      graph = await readGraphWindow(
        api,
        domain,
        before.published_version,
        fallback,
        signal,
      );
    }
  }
  const titles = new Map(graph.nodes.map((c) => [c.concept_id, c.title]));
  const events: BrainChange[] = [],
    evidence: ApiBrainResult["evidence"] = {};
  const details: Concept[] = [];
  const addEvidence = (c: EvidenceConcept) => {
    for (const ref of c.sources) {
      const ranges = (evidence[ref.source_id] ??= []);
      if (!ranges.some((r) => r.start === ref.start && r.end === ref.end))
        ranges.push(ref);
    }
  };
  if (
    graphRequest.detail &&
    graph.nodes.some((n) => n.concept_id === graphRequest.detail)
  ) {
    const detail = validateConcept(
      await api.call(
        "concepts.read",
        { domain, concept_id: graphRequest.detail },
        undefined,
        { signal },
      ),
    );
    if (
      detail.concept_id !== graphRequest.detail ||
      !graph.nodes.some((n) => n.concept_id === detail.concept_id)
    )
      throw invalid();
    details.push(detail);
    addEvidence(detail);
  } else if (graphRequest.detail && !graphRequest.historical) throw invalid();
  let partialHistory = false,
    nextBefore: number | null = null,
    scanLimited = false,
    eventLimited = false,
    missingAudit = false,
    observed = 0;
  if (owner) {
    // Budgets apply across the scan, compact differences and final access checks.
    const responseBudget = { remainingBytes: 8_000_000 };
    const readOptions = { signal, maxResponseBytes: 1_000_000, responseBudget };
    const pages: { before: number | undefined; page: PublicationWindow }[] = [];
    const readPage = async (cursor: number | undefined) =>
      publicationPage(
        await api.call("publications.list", { domain }, undefined, {
          ...readOptions,
          query: {
            limit: 20,
            at_version: before.published_version,
            ...(cursor !== undefined ? { before: cursor } : {}),
            ...(window.since ? { since: window.since } : {}),
            ...(window.until ? { until: window.until } : {}),
          },
        }),
        domain,
        before.published_version,
        { ...window, before: cursor },
      );
    let cursor = window.before;
    historyPages: for (let index = 0; index < (window.maxPages ?? 1); index++) {
      const page = await readPage(cursor);
      pages.push({ before: cursor, page });
      nextBefore = page.next_before;
      scanLimited = page.scan_limited;
      missingAudit ||= page.items.some((c) => !c.publication);
      const audited = page.items.filter((c) => c.publication);
      // Reject the whole observation on failure; never merge cached older rights.
      for (let i = 0; i < audited.length; i += 4) {
        const batch = await Promise.all(
          audited.slice(i, i + 4).map(async (c) => ({
            c,
            d: difference(
              await api.call(
                "proposals.diff_summary",
                { domain, proposal_id: c.proposal_id },
                undefined,
                readOptions,
              ),
              c,
              before.published_version,
            ),
          })),
        );
        for (const { c, d } of batch) {
          const publicationTitles = new Map(titles);
          for (const item of d.items)
            for (const value of [item.after, item.before])
              if (value && !publicationTitles.has(value.concept_id))
                publicationTitles.set(value.concept_id, value.title);
          const changes = publicationChanges(domain, c, d, publicationTitles);
          // Never split a publication or silently skip one that cannot fit alone.
          if (changes.length > 10_000) throw new ApiError(0, "read_limit");
          if (events.length + changes.length > 10_000) {
            eventLimited = true;
            // `before` is exclusive: the omitted publication starts the next page.
            nextBefore = c.sequence + 1;
            break historyPages;
          }
          for (const item of d.items)
            for (const value of [item.after, item.before])
              if (value) {
                addEvidence(value);
                if (!titles.has(value.concept_id))
                  titles.set(value.concept_id, value.title);
              }
          events.push(...changes);
          observed++;
        }
      }
      if (nextBefore === null) break;
      cursor = nextBefore;
    }
    partialHistory = nextBefore !== null || window.before !== undefined;
    // A retired source can change visibility without changing the current graph.
    // Re-authorize every scanned publication page before exposing its evidence.
    const signature = (page: PublicationWindow) =>
      JSON.stringify([
        page.next_before,
        page.scan_limited,
        page.items.map((c) => [
          c.sequence,
          c.proposal_id,
          c.digest,
          c.author,
          c.reason,
          c.created_at,
          c.published,
          c.publication?.publisher ?? null,
          c.publication?.recorded_at ?? null,
        ]),
      ]);
    for (const loaded of pages) {
      const verified = await readPage(loaded.before);
      if (signature(loaded.page) !== signature(verified))
        throw new ApiError(409, "projection_changed");
    }
  }
  const after = version(
    await api.call("domain.version", { domain }, undefined, { signal }),
    domain,
  );
  if (before.published_version !== after.published_version)
    throw new ApiError(409, "projection_changed");
  // Detect changed visible membership after the journal/detail reads as well.
  await readGraphWindow(
    api,
    domain,
    after.published_version,
    { visibility: graph.visibility },
    signal,
    1,
  );
  // Recent publications are read first. An off-page target may become known
  // only in a later (older) authorized difference. Complete unresolved labels
  // after all access checks, without changing already resolved historic names
  // or requesting concepts outside the loaded observation.
  for (const event of events) {
    const relation = event.relation;
    if (!relation || relation.toTitle !== relation.to) continue;
    const title = titles.get(relation.to);
    if (!title) continue;
    if (event.title.endsWith(` → ${relation.to}`))
      event.title = event.title.slice(0, -relation.to.length) + title;
    relation.toTitle = title;
  }
  const nodes = graph.nodes.map((c) => {
    const detail = details.find((d) => d.concept_id === c.concept_id);
    return {
      ...summaryNode(c),
      groups: [
        c.concept_id,
        ...(graph.focus && graph.focus.concept_id !== c.concept_id
          ? [graph.focus.concept_id]
          : []),
      ],
      ...(detail ? { description: detail.body, sourceIds: refs(detail) } : {}),
    };
  });
  const edges: BrainRelation[] = graph.edges.map((r) => ({
    id: relationId(domain, r.from, r.to, r.kind),
    from: r.from,
    to: r.to,
    toTitle: titles.get(r.to),
    kind: r.kind,
    weight: r.weight,
    primary: r.primary,
    sourceIds:
      details
        .find((c) => c.concept_id === r.from)
        ?.sources.map((s) => s.source_id) ?? [],
  }));
  return {
    unavailableFocus,
    version: after,
    graph,
    evidence,
    partialHistory,
    nextBefore,
    observedPublications: observed,
    scanLimited,
    eventLimited,
    projection: {
      mode: "api",
      domainId: domain,
      domainName: name,
      publishedVersion: after.published_version,
      nodes,
      relations: edges,
      groups: graph.nodes.map((c) => ({
        id: c.concept_id,
        title: c.title,
        subtitle: `${c.outgoing_relations} relations sortantes`,
      })),
      window: {
        focus: graph.focus?.concept_id ?? null,
        scopeIds: graph.scope_ids,
        totals: graph.scope_totals,
        domainTotals: graph.domain_totals,
        loaded: graph.nodes.length,
        internalRelations: graph.internal_relations,
        boundaryRelations: graph.boundary_outgoing_relations,
        edgesTruncated: graph.edges_truncated,
      },
      events,
      sources: Object.keys(evidence).map((id) => ({
        id,
        title: "Source " + id,
      })),
      coverage: {
        from: window.since ?? null,
        to: window.until,
        publicationChanges: owner,
        partial: partialHistory || missingAudit,
        detail: owner
          ? `${observed} publications auditées et accessibles examinées. ${partialHistory ? "Lecture bornée de publications, des plus récentes vers les plus anciennes. Les compteurs portent uniquement sur cette lecture ; ils ne sont pas le total de la période." : "Toutes les publications accessibles de la période ont été examinées."} ${scanLimited ? "La limite de parcours des droits a été atteinte : continuez avec la page suivante, même si celle-ci est vide." : ""} ${missingAudit ? "Certaines publications anciennes sont sans date auditée : leurs changements ne sont pas inventés." : ""} Lecture bornée à vingt publications par page serveur, cinq pages au maximum en mode étendu, 8 Mo de JSON reçu pour le journal, 1 Mo par réponse et 10 000 événements ; durée totale limitée à 45 secondes. La limite d’événements produit une continuation entre publications entières. Une publication dépassant seule cette limite, un dépassement de données ou de durée masque la lecture entière. Les changements de poids sont des différences publiées, sans politique automatique déduite. La carte charge des résumés paginés et les détails sélectionnés à la demande. Les lectures préparées utilisent une projection serveur vérifiée ; les différences des publications transmettent leurs métadonnées et les empreintes des corps, sans les textes complets. La préparation initiale, les agrégats et les coûts de concurrence restent à qualifier. La qualification de grande volumétrie reste ouverte.`
          : "Savoir publié accessible à votre identité. Le journal des publications exige actuellement le rôle propriétaire ; il est indisponible pour ce rôle. La carte charge des résumés paginés ; les détails et les preuves sont lus sur demande.",
      },
      capabilities: { dynamics: owner, memory: false, archives: false },
    },
  };
}
