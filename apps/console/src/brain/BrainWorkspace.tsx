import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Layers,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { ThemeControl } from "../theme";
import {
  changeLabels,
  changeSymbol,
  countChanges,
  defaultSelection,
  readSelection,
  selectEvents,
  writeSelection,
  type BrainChange,
  type BrainGroup,
  type BrainNode,
  type BrainProjection,
  type BrainRelation,
  type BrainSelection,
} from "./model";
import "./brain.css";
import { macroLinks } from "./macro-links";
import { indexProjection, indexChanges } from "./projection-index";
import { BrainTimeline } from "./BrainTimeline";
import { measureBrainRead, useBrainReadPaint } from "./read-measurement";

interface Props {
  projection: BrainProjection;
  onSource?: (id: string, trigger: HTMLButtonElement) => void;
  onConcept?: (id: string) => void;
  onSearch?: (term: string, signal: AbortSignal) => Promise<BrainNode[]>;
  mapControls?: ReactNode;
}
const clearFocus = { event: null, node: null, relation: null };
const JOURNAL_PAGE_SIZE = 40;
const number = (value: number) => value.toLocaleString("fr-FR");
const date = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
const kindLabel = (r: BrainRelation) =>
  r.kind === "structural"
    ? "Structurelle"
    : r.kind === "associative"
      ? "Associative"
      : "Type non renseigné";

function DetailText({ text }: { text: string }) {
  const characters = Array.from(text);
  if (characters.length <= 600) return <p>{text}</p>;
  return (
    <div className="brain-detail-text">
      <p>{characters.slice(0, 600).join("")}…</p>
      <details>
        <summary>
          Contenu complet · {number(characters.length)} caractères
        </summary>
        <div
          className="brain-detail-reading"
          role="region"
          aria-label="Contenu complet du détail"
          tabIndex={0}
        >
          <p>{text}</p>
        </div>
      </details>
    </div>
  );
}
type MapItem = {
  id: string;
  title: string;
  subtitle: string;
  node?: BrainNode;
  events: BrainChange[];
  historical?: boolean;
};

export function BrainWorkspace({
  projection: p,
  onSource,
  onConcept,
  onSearch,
  mapControls,
}: Props) {
  const [params, setParams] = useSearchParams();
  const raw = readSelection(params);
  const isCatalog = p.mode === "catalog";
  const graphIndex = useMemo(() => indexProjection(p), [p]);
  const territory = p.territories?.find(
    (t) =>
      t.id ===
      (graphIndex.groups.get(raw.group ?? "")?.territoryId ?? raw.territory),
  );
  const [search, setSearch] = useState("");
  const validGroup =
    p.window && raw.level === "concepts"
      ? p.window.focus === raw.group
      : p.groups.some((g) => g.id === raw.group);
  let selection =
    (raw.level === "concepts" && !validGroup) ||
    (raw.level === "groups" && raw.group && !validGroup)
      ? {
          ...raw,
          level: "groups" as const,
          group: null,
          ...clearFocus,
          // A vanished current neighborhood does not invalidate independently
          // authorized publication evidence selected in the journal.
          event:
            p.window && p.events.some((e) => e.id === raw.event)
              ? raw.event
              : null,
          relation:
            p.window && p.events.some((e) => e.relation?.id === raw.relation)
              ? raw.relation
              : null,
        }
      : raw;
  if (
    selection.level === "concepts" &&
    (graphIndex.children.get(selection.group) ?? []).length
  ) {
    const leaf = raw.node ? graphIndex.nodes.get(raw.node)?.groups[0] : null;
    selection = leaf
      ? { ...selection, group: leaf }
      : { ...selection, level: "groups" };
  }
  if (!p.coverage.publicationChanges) selection.mode = "overview";
  if (selection.level !== "domain" && territory)
    selection.territory = territory.id;
  const [expanded, setExpanded] = useState(false);
  const [journalPage, setJournalPage] = useState(0);
  const [width, setWidth] = useState(600);
  const stage = useRef<HTMLDivElement>(null),
    details = useRef<HTMLElement>(null);
  const mapPanel = useRef<HTMLElement>(null);
  const journalPanel = useRef<HTMLElement>(null);
  const goToPanel = (element: HTMLElement | null) => {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  };
  const now = useMemo(
    () => (p.coverage.to ? Date.parse(p.coverage.to) : Date.now()),
    [p],
  );
  const periodEvents = useMemo(
    () => selectEvents(p, { ...selection, interval: null }, now),
    [
      p,
      selection.level,
      selection.group,
      selection.territory,
      selection.period,
      now,
    ],
  );
  const events = useMemo(
    () => selectEvents(p, selection, now),
    [
      p,
      selection.level,
      selection.group,
      selection.territory,
      selection.period,
      selection.interval?.from,
      selection.interval?.to,
      now,
    ],
  );
  useEffect(() => setJournalPage(0), [events]);
  const totals = countChanges(events);
  const changeScope = p.coverage.partial
    ? "dans l’historique chargé"
    : selection.interval
      ? "dans l’intervalle sélectionné"
      : "sur la période";
  const eventIndex = useMemo(() => indexChanges(events), [events]);
  const group = graphIndex.groups.get(selection.group ?? "");
  const ancestry: BrainGroup[] = [];
  for (
    let current = group;
    current && !ancestry.some((g) => g.id === current!.id);
    current = graphIndex.groups.get(current.parentId ?? "")
  )
    ancestry.unshift(current);
  const enterGroup = (id: string) =>
    update({
      level: graphIndex.children.has(id) ? "groups" : "concepts",
      group: id,
      ...clearFocus,
      page: 0,
    });
  const zoomIn = () =>
    selection.level === "domain"
      ? update({
          level: "groups",
          group: null,
          territory: p.territories ? shown[0]?.id : null,
          ...clearFocus,
          page: 0,
        })
      : enterGroup(shown[0].id);
  const zoomOut = () =>
    update({
      level: selection.level === "concepts" || group ? "groups" : "domain",
      group: group?.parentId ?? null,
      territory:
        selection.level === "concepts" || group ? selection.territory : null,
      ...clearFocus,
      page: 0,
    });
  const update = (patch: Partial<BrainSelection>) => {
    if (
      (patch.node && patch.node === selection.node) ||
      (patch.event && patch.event === selection.event) ||
      (patch.relation && patch.relation === selection.relation)
    )
      details.current?.focus();
    const next = writeSelection({ ...selection, ...patch });
    const newScope =
      selection.group !== raw.group ||
      selection.level !== raw.level ||
      (patch.level !== undefined && patch.level !== selection.level) ||
      (patch.group !== undefined && patch.group !== selection.group);
    if (!newScope && !patch.node && !patch.event)
      for (const [key, value] of params)
        if (key.startsWith("map_")) next.set(key, value);
    if (patch.interval !== undefined || patch.period !== undefined)
      next.delete("map_locate");
    if (p.window && patch.node) next.set("map_locate", patch.node);
    if (p.window && patch.event) {
      const target = p.events.find((e) => e.id === patch.event);
      if (target)
        next.set("map_locate", target.relation?.to ?? target.nodeIds[0]);
    }
    if (params.get("corpus") === "local") next.set("corpus", "local");
    if (p.mode === "api")
      for (const key of [
        "api_domain",
        "api_view",
        "domains_page",
        "history_pages",
      ]) {
        const value = params.get(key);
        if (value) next.set(key, value);
      }
    setParams(next);
    setExpanded(false);
    setJournalPage(0);
    setSearch("");
  };
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selection.event || selection.node || selection.relation)
      details.current?.focus();
  }, [selection.event, selection.node, selection.relation]);
  const event = events.find((e) => e.id === selection.event);
  const selectedNode = graphIndex.nodes.get(selection.node ?? "");
  const selectedRelation =
    p.relations.find((r) => r.id === selection.relation) ??
    events.find((e) => e.relation?.id === selection.relation)?.relation;
  const selectedSources =
    event?.sourceIds ??
    selectedRelation?.sourceIds ??
    selectedNode?.sourceIds ??
    [];
  const showEvent = (e: BrainChange, includeHistory = false) =>
    update({
      level:
        p.window || p.groups.some((g) => g.id === e.groupIds[0])
          ? "concepts"
          : "groups",
      group:
        p.window || p.groups.some((g) => g.id === e.groupIds[0])
          ? e.groupIds[0]
          : null,
      ...clearFocus,
      event: e.id,
      territory:
        p.groups.find((g) => g.id === e.groupIds[0])?.territoryId ?? null,
      period: includeHistory ? "all" : selection.period,
      interval: includeHistory ? null : selection.interval,
      page: 0,
    });
  const eligibleGroups = (
    graphIndex.children.get(selection.group ?? null) ?? []
  ).filter(
    (g) =>
      !territory ||
      g.territoryId === territory.id ||
      territory.groupIds.includes(g.id),
  );
  const currentNodes =
    selection.level !== "domain" && selection.group
      ? (graphIndex.members.get(selection.group) ?? [])
      : territory && selection.level === "groups"
        ? p.nodes.filter((n) =>
            n.groups.some((id) => territory.groupIds.includes(id)),
          )
        : p.nodes;
  const items: MapItem[] =
    selection.level === "domain"
      ? (p.territories?.map((t) => ({
          id: t.id,
          title: t.title,
          subtitle: `${number(p.nodes.filter((n) => n.groups.some((id) => t.groupIds.includes(id))).length)} fiches`,
          events: events.filter((e) =>
            e.groupIds.some((id) => t.groupIds.includes(id)),
          ),
        })) ?? [
          {
            id: p.domainId,
            title: p.domainName,
            subtitle: `${number(p.window?.domainTotals.concepts ?? p.nodes.filter((n) => n.kind === "concept").length)} concepts publiés`,
            events,
          },
        ])
      : selection.level === "groups"
        ? eligibleGroups.map((g) => ({
            id: g.id,
            title: g.title,
            subtitle:
              g.subtitle ??
              `${(graphIndex.members.get(g.id) ?? []).length} ${isCatalog ? "fiches" : "éléments dans le voisinage"}${g.grouping === "alphabetical" ? " · A–Z" : ""}`,
            events: eventIndex.byGroup.get(g.id) ?? [],
          }))
        : currentNodes.map((node) => ({
            id: node.id,
            title: node.title,
            subtitle:
              node.kind === "reference"
                ? "Référence nommée"
                : isCatalog
                  ? (node.classification ?? "Fiche du corpus")
                  : "Concept publié",
            node,
            events: eventIndex.byNode.get(node.id) ?? [],
          }));
  if (selection.level === "concepts") {
    const itemIds = new Set(items.map((i) => i.id));
    // Include historical endpoints from the entire observed history so time filtering keeps the layout stable.
    for (const e of p.events.filter((e) =>
      e.groupIds.includes(selection.group!),
    )) {
      if (!e.relation || itemIds.has(e.relation.to)) continue;
      // A concept outside a server page is not a historical disappearance.
      // Only the selected historical trace may extend a bounded server page.
      if (
        p.window &&
        ((e.id !== selection.event && e.relation.id !== selection.relation) ||
          p.window.scopeIds?.includes(e.relation.to))
      )
        continue;
      itemIds.add(e.relation.to);
      items.push({
        id: e.relation.to,
        title: e.relation.toTitle ?? "Ancienne cible",
        subtitle: "Trace historique",
        events: eventIndex.byNode.get(e.relation.to) ?? [],
        historical: true,
      });
    }
  }
  items.sort((a, b) =>
    isCatalog
      ? a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id)
      : a.id.localeCompare(b.id),
  );
  const pageSize = width < 480 ? 6 : 12;
  const pinned =
    p.window?.focus && selection.level === "concepts"
      ? items.find((i) => i.id === p.window!.focus)
      : undefined;
  const pageItems = pinned ? items.filter((i) => i.id !== pinned.id) : items;
  const slots = pageSize - (pinned ? 1 : 0);
  const pages = Math.max(1, Math.ceil(pageItems.length / slots));
  const anchorId = selection.node ?? event?.relation?.to ?? event?.nodeIds[0];
  const anchorIndex = anchorId
    ? pageItems.findIndex((i) => i.id === anchorId)
    : -1;
  const page =
    anchorIndex >= 0
      ? Math.floor(anchorIndex / slots)
      : Math.min(selection.page, pages - 1);
  const shown = [
    ...(pinned ? [pinned] : []),
    ...pageItems.slice(page * slots, (page + 1) * slots),
  ];
  const columns =
    shown.length <= 1
      ? 1
      : width >= 580
        ? Math.min(3, shown.length)
        : Math.min(2, shown.length);
  const rows = Math.ceil(shown.length / columns),
    height = Math.max(340, rows * 184 + 64);
  const positions = new Map(
    shown.map((item, index) => [
      item.id,
      {
        x: width * (((index % columns) + 0.5) / columns),
        y:
          (height - 42) *
          ((Math.floor(index / columns) + 0.5) / Math.max(1, rows)),
      },
    ]),
  );
  const visibleIds = new Set(shown.map((i) => i.id));
  const eventByRelation = new Map(
    [...events]
      .reverse()
      .filter((e) => e.relation)
      .map((e) => [e.relation!.id, e]),
  );
  const links = new Map(p.relations.map((r) => [r.id, r]));
  for (const e of events)
    if (e.relation && !links.has(e.relation.id))
      links.set(e.relation.id, e.relation);
  const visibleLinks =
    selection.level === "concepts"
      ? [...links.values()].filter(
          (r) =>
            visibleIds.has(r.from) &&
            visibleIds.has(r.to) &&
            (selection.mode === "overview" || eventByRelation.has(r.id)),
        )
      : [];
  const paths = visibleLinks.slice(0, 60).map((relation) => {
    const a = positions.get(relation.from)!,
      b = positions.get(relation.to)!;
    const curve = Math.abs(a.y - b.y) < 1 ? -Math.min(75, height * 0.2) : 18;
    return {
      relation,
      event: eventByRelation.get(relation.id),
      d: `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + curve} ${b.x} ${b.y}`,
    };
  });
  const aggregateLinks = useMemo(
    () =>
      selection.level === "concepts" || p.window
        ? []
        : macroLinks(
            p,
            selection.level,
            selection.mode === "changes"
              ? [...links.values()].filter((r) => eventByRelation.has(r.id))
              : p.relations,
            new Set(eligibleGroups.map((g) => g.id)),
          ),
    [
      p,
      selection.level,
      selection.group,
      selection.territory,
      selection.mode,
      events,
    ],
  );
  const availableAggregates = aggregateLinks.filter(
    (a) => visibleIds.has(a.from) && visibleIds.has(a.to),
  );
  const visibleAggregates = availableAggregates.slice(0, 24);
  const selectedAggregate = aggregateLinks.find(
    (a) => a.id === selection.relation,
  );
  const itemTitles = new Map(items.map((i) => [i.id, i.title]));
  const showNode = (node: BrainNode) =>
    update({
      level: "concepts",
      group:
        !graphIndex.children.has(selection.group ?? "") &&
        node.groups.includes(selection.group ?? "")
          ? selection.group
          : node.groups[0],
      territory:
        p.groups.find((g) => g.id === node.groups[0])?.territoryId ?? null,
      ...clearFocus,
      node: node.id,
      page: 0,
    });
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const searchIndex = useMemo(
    () =>
      p.nodes.map((node) => ({
        node,
        title: normalize(node.title),
        description: normalize(node.description),
      })),
    [p],
  );
  const searchResults = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return [];
    return searchIndex
      .map((item) => ({
        ...item,
        score:
          item.title === term
            ? 0
            : item.title.startsWith(term)
              ? 1
              : item.title.includes(term)
                ? 2
                : item.description.includes(term)
                  ? 3
                  : 4,
      }))
      .filter((item) => item.score < 4)
      .sort(
        (a, b) => a.score - b.score || a.node.title.localeCompare(b.node.title),
      )
      .slice(0, 8)
      .map((item) => item.node);
  }, [searchIndex, search]);
  const [remoteSearch, setRemoteSearch] = useState<{
    term: string;
    nodes: BrainNode[];
    loading: boolean;
    error: boolean;
  }>({ term: "", nodes: [], loading: false, error: false });
  useEffect(() => {
    if (!onSearch || !search.trim()) return;
    const controller = new AbortController();
    setRemoteSearch({ term: search, nodes: [], loading: true, error: false });
    const timer = setTimeout(() => {
      measureBrainRead("search", () =>
        onSearch(search.trim(), controller.signal),
      )
        .then((nodes) => {
          if (!controller.signal.aborted)
            setRemoteSearch({
              term: search,
              nodes,
              loading: false,
              error: false,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setRemoteSearch({
              term: search,
              nodes: [],
              loading: false,
              error: true,
            });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, onSearch]);
  const results = onSearch
    ? remoteSearch.term === search
      ? remoteSearch.nodes
      : []
    : searchResults;
  useBrainReadPaint(
    results,
    !!onSearch &&
      remoteSearch.term === search &&
      !remoteSearch.loading &&
      !remoteSearch.error,
  );
  const focused = !!(
    event ||
    selectedNode ||
    selectedRelation ||
    selectedAggregate
  );
  const journalPages = Math.max(
    1,
    Math.ceil(events.length / JOURNAL_PAGE_SIZE),
  );
  const currentJournalPage = Math.min(journalPage, journalPages - 1);
  const journalStart = currentJournalPage * JOURNAL_PAGE_SIZE;
  const list = expanded
    ? events.slice(journalStart, journalStart + JOURNAL_PAGE_SIZE)
    : events.slice(0, 5);
  const pageJournal = (next: number) => {
    setJournalPage(next);
    goToPanel(journalPanel.current);
  };
  const scopeConcepts =
    p.window?.totals.concepts ??
    currentNodes.filter((n) => n.kind === "concept").length;
  const scopeIds = new Set(currentNodes.map((n) => n.id));
  const scopeRelations =
    p.window?.totals.relations ??
    p.relations.filter((r) => scopeIds.has(r.from)).length;
  const [relationPage, setRelationPage] = useState(0);
  useEffect(() => setRelationPage(0), [selection.node]);
  const related = selectedNode
    ? p.relations.filter(
        (r) => r.from === selectedNode.id || r.to === selectedNode.id,
      )
    : [];
  return (
    <section
      className="brain-workspace"
      aria-label="BrainMap et Chronique"
      data-colors={selection.colors}
    >
      <header className="brain-header">
        <div>
          <h1>{isCatalog ? "Explorer le corpus." : "BrainMap & Chronique"}</h1>
          <p>
            {p.domainName}
            {isCatalog
              ? " · aperçu du corpus"
              : ` · savoir publié v${p.publishedVersion}`}
          </p>
        </div>
        <div className="brain-header-actions">
          <nav aria-label="Accès aux vues du cerveau">
            <button onClick={() => goToPanel(mapPanel.current)}>
              Aller à la carte
            </button>
            <button onClick={() => goToPanel(journalPanel.current)}>
              Aller à la Chronique
            </button>
          </nav>
          {p.mode !== "api" && <ThemeControl />}
        </div>
      </header>
      <div className="brain-context">
        <span className="brain-origin">
          {p.mode === "mock"
            ? "Démonstration locale"
            : isCatalog
              ? "Corpus local · publication à préparer"
              : "Données du serveur"}
        </span>
        {!isCatalog && (
          <label>
            Période des événements
            <select
              aria-label="Période des événements"
              value={selection.period}
              onChange={(e) =>
                update({
                  period: e.target.value as BrainSelection["period"],
                  interval: null,
                  ...clearFocus,
                })
              }
            >
              <option value="all">Tout l’historique disponible</option>
              <option value="1">Dernières 24 heures</option>
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
            </select>
          </label>
        )}
        <div className="brain-search">
          <label>
            <span className="sr-only">Rechercher dans le cerveau</span>
            <input
              maxLength={onSearch ? 100 : undefined}
              type="search"
              placeholder={
                isCatalog
                  ? "Rechercher une fiche, une marque, un sujet…"
                  : "Rechercher un concept…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {search.trim() && (
            <div
              className="brain-search-results"
              role="region"
              aria-label="Résultats de recherche"
            >
              {results.length ? (
                results.map((n) => (
                  <button key={n.id} onClick={() => showNode(n)}>
                    <strong>{n.title}</strong>
                    <span>{n.classification ?? "Concept"}</span>
                  </button>
                ))
              ) : (
                <p>
                  {onSearch && remoteSearch.loading
                    ? "Recherche dans les concepts autorisés…"
                    : onSearch && remoteSearch.error
                      ? "Recherche indisponible. Réessayez ou actualisez le cerveau."
                      : "Aucun résultat dans ce périmètre."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {p.coverage.partial && (
        <p className="brain-notice" role="status">
          Historique partiel — les changements comptés concernent uniquement les
          publications couvertes.
        </p>
      )}
      <div
        className="brain-metrics"
        role="group"
        aria-label="Indicateurs du périmètre"
      >
        <div>
          <span>{isCatalog ? "Fiches du corpus" : "Concepts publiés"}</span>
          <strong>{number(scopeConcepts)}</strong>
          <small>
            {p.coverage.publicationChanges
              ? `+${totals.concepts} créés ${changeScope}`
              : isCatalog
                ? "Identifiants uniques"
                : "Historique des créations indisponible"}
          </small>
        </div>
        <div>
          <span>
            {isCatalog ? "Références entre fiches" : "Relations publiées"}
          </span>
          <strong>{number(scopeRelations)}</strong>
          <small>
            {p.coverage.publicationChanges
              ? `+${totals.created} nouvelles · ${totals.removed} retirées`
              : isCatalog
                ? "Références sortantes du périmètre"
                : "Historique des relations indisponible"}
          </small>
        </div>
        <div>
          <span>{isCatalog ? "Brouillons" : "Renforcements"}</span>
          <strong>
            {isCatalog
              ? currentNodes.filter((n) => n.declaredStatus === "draft").length
              : p.capabilities.dynamics
                ? totals.strengthened
                : "—"}
          </strong>
          <small>
            {isCatalog
              ? "Statut déclaré dans le corpus"
              : p.capabilities.dynamics
                ? changeScope
                : "Dynamique non instrumentée"}
          </small>
        </div>
        <div>
          <span>{isCatalog ? "Dépréciées" : "Archivages"}</span>
          <strong>
            {isCatalog
              ? currentNodes.filter((n) => n.declaredStatus === "deprecated")
                  .length
              : p.capabilities.archives
                ? totals.archived
                : "—"}
          </strong>
          <small>
            {isCatalog
              ? "Statut déclaré dans le corpus"
              : p.capabilities.archives
                ? changeScope
                : "Cycle de vie non instrumenté"}
          </small>
        </div>
      </div>
      {!isCatalog && (
        <BrainTimeline
          projection={p}
          events={periodEvents}
          selectedEvents={events}
          selection={selection}
          now={now}
          onSelect={(interval) => update({ interval, ...clearFocus })}
        />
      )}
      <div className="brain-layout">
        <section
          className="brain-map-panel"
          aria-label="Carte du cerveau"
          ref={mapPanel}
          tabIndex={-1}
        >
          <div className="brain-map-toolbar">
            <div className="brain-segment" aria-label="Lecture de la carte">
              <button
                disabled={!p.coverage.publicationChanges}
                aria-pressed={selection.mode === "changes"}
                onClick={() => update({ mode: "changes" })}
              >
                Changements
              </button>
              <button
                aria-pressed={selection.mode === "overview"}
                onClick={() => update({ mode: "overview" })}
              >
                Synthèse
              </button>
            </div>
            <span>
              {isCatalog
                ? `Niveau ${selection.level === "domain" ? 1 : 2 + ancestry.length} · ${selection.level === "domain" ? "Territoires" : selection.level === "concepts" ? "Fiches" : group ? "Regroupements" : "Familles"}`
                : selection.level === "domain"
                  ? "1 / 3 · Domaine"
                  : selection.level === "groups"
                    ? "2 / 3 · Voisinages"
                    : "3 / 3 · Concepts"}
            </span>
          </div>
          <nav
            className="brain-breadcrumbs"
            aria-label="Position dans le cerveau"
          >
            <button
              onClick={() =>
                update({
                  ...defaultSelection,
                  period: selection.period,
                  mode: selection.mode,
                  colors: selection.colors,
                })
              }
            >
              Cerveau
            </button>
            {selection.level !== "domain" && (
              <>
                <ChevronRight size={12} />
                <button
                  onClick={() =>
                    update({
                      level: "groups",
                      group: null,
                      ...clearFocus,
                      page: 0,
                    })
                  }
                >
                  {territory?.title ?? p.domainName}
                </button>
              </>
            )}
            {ancestry.map((g) => (
              <span className="brain-breadcrumb-part" key={g.id}>
                <ChevronRight size={12} />
                {g.id === group?.id ? (
                  <span>{g.title}</span>
                ) : (
                  <button onClick={() => enterGroup(g.id)}>{g.title}</button>
                )}
              </span>
            ))}
          </nav>
          {raw.level === "concepts" && !validGroup && (
            <p role="status" className="brain-notice">
              Ce voisinage n’est plus accessible. Les territoires disponibles
              sont affichés.
            </p>
          )}
          <div className="brain-map" ref={stage} style={{ height }}>
            <svg
              className="brain-graph"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${shown.length} éléments affichés ; ${selection.level === "concepts" ? Math.min(visibleLinks.length, 60) : visibleAggregates.length} connexions affichées`}
            >
              {visibleAggregates.map((a) => {
                const from = positions.get(a.from)!,
                  to = positions.get(a.to)!;
                return (
                  <path
                    key={a.id}
                    d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 36} ${to.x} ${to.y}`}
                    className="brain-edge brain-macro-edge"
                    style={{
                      strokeWidth: Math.min(
                        4,
                        1 + Math.log1p(a.relations.length) / 2,
                      ),
                    }}
                  />
                );
              })}
              {paths.map((path) => (
                <path
                  key={path.relation.id}
                  d={path.d}
                  className={`brain-edge ${path.event?.kind ?? ""} ${selectedRelation?.id === path.relation.id || event?.relation?.id === path.relation.id ? "selected" : ""}`}
                />
              ))}
              {selection.level !== "concepts" &&
                shown.map((item) => {
                  const pos = positions.get(item.id)!;
                  return (
                    <ellipse
                      key={item.id}
                      cx={pos.x}
                      cy={pos.y}
                      rx={Math.min((width / columns) * 0.43, 116)}
                      ry={68}
                      className="brain-territory"
                    />
                  );
                })}
            </svg>
            {shown.map((item) => {
              const pos = positions.get(item.id)!,
                counts = countChanges(item.events);
              return (
                <button
                  key={item.id}
                  title={item.title}
                  className={`brain-map-node ${selection.level !== "concepts" ? "territory" : ""} ${item.historical ? "historical" : ""} ${selection.node === item.id || event?.nodeIds.includes(item.id) ? "selected" : ""}`}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: Math.min(158, width / columns - 20),
                  }}
                  aria-label={`${selection.level === "concepts" ? "Consulter" : "Explorer"} ${item.title}`}
                  onClick={() =>
                    selection.level === "domain"
                      ? update({
                          level: "groups",
                          group: null,
                          territory: p.territories ? item.id : null,
                          ...clearFocus,
                          page: 0,
                        })
                      : selection.level === "groups"
                        ? enterGroup(item.id)
                        : item.historical
                          ? showEvent(
                              item.events[0] ??
                                p.events.find((e) =>
                                  e.nodeIds.includes(item.id),
                                )!,
                              !item.events.length,
                            )
                          : update({ ...clearFocus, node: item.id })
                  }
                >
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                  <span className="brain-node-marks">
                    {counts.concepts > 0 && (
                      <span className="relation_created">
                        + {counts.concepts} concept
                        {counts.concepts > 1 ? "s" : ""}
                      </span>
                    )}
                    {counts.created > 0 && (
                      <span className="relation_created">
                        + {counts.created} lien{counts.created > 1 ? "s" : ""}
                      </span>
                    )}
                    {counts.removed > 0 && (
                      <span>
                        − {counts.removed} retrait
                        {counts.removed > 1 ? "s" : ""}
                      </span>
                    )}
                    {counts.strengthened > 0 && (
                      <span className="relation_strengthened">
                        ↑ {counts.strengthened}
                      </span>
                    )}
                    {counts.weakened > 0 && (
                      <span className="relation_weakened">
                        ↓ {counts.weakened}
                      </span>
                    )}
                    {counts.archived > 0 && (
                      <span className="relation_archived">
                        ▱ {counts.archived}
                      </span>
                    )}
                    {counts.primaryChanged > 0 && (
                      <span>
                        · {counts.primaryChanged} changement
                        {counts.primaryChanged > 1 ? "s" : ""} de lien principal
                      </span>
                    )}
                    {!item.events.length && (
                      <span>
                        {selection.level === "concepts"
                          ? "Sélectionner"
                          : "Ouvrir le détail"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {!shown.length && (
              <p className="brain-map-empty">
                Aucun concept publié dans ce périmètre.
              </p>
            )}
            <div className="brain-map-caption">
              <span>
                {selection.level === "concepts"
                  ? p.window
                    ? "Voisinage sortant · page chargée"
                    : "Voisinage partiel"
                  : "Territoires regroupés"}
              </span>
              <span>
                {shown.length} / {items.length} éléments
              </span>
            </div>
          </div>
          <div className="brain-map-controls">
            <div className="brain-zoom">
              <button
                aria-label="Reculer d’un niveau"
                disabled={selection.level === "domain"}
                onClick={zoomOut}
              >
                <Minus size={16} />
              </button>
              <button
                aria-label="Approfondir le premier territoire"
                disabled={selection.level === "concepts" || !shown.length}
                onClick={zoomIn}
              >
                <Plus size={16} />
              </button>
              {pages > 1 && (
                <>
                  <button
                    aria-label="Page précédente de la carte"
                    disabled={!page}
                    onClick={() => update({ page: page - 1, ...clearFocus })}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    {page + 1}/{pages}
                  </span>
                  <button
                    aria-label="Page suivante de la carte"
                    disabled={page >= pages - 1}
                    onClick={() => update({ page: page + 1, ...clearFocus })}
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
            {!isCatalog && (
              <label className="brain-colors">
                <input
                  type="checkbox"
                  checked={selection.colors}
                  onChange={(e) => update({ colors: e.target.checked })}
                />
                Couleurs des changements
              </label>
            )}
          </div>
          {visibleAggregates.length > 0 && (
            <details className="brain-aggregate-list">
              <summary>
                {availableAggregates.length} connexions entre{" "}
                {selection.level === "domain" ? "territoires" : "regroupements"}
              </summary>
              <p>
                Chaque ligne regroupe les références entre deux ensembles, dans
                les deux sens.{" "}
                {visibleAggregates.length < availableAggregates.length &&
                  `${visibleAggregates.length} connexions principales sont tracées sur la carte.`}
              </p>
              {availableAggregates.map((a) => (
                <button
                  key={a.id}
                  onClick={() => update({ ...clearFocus, relation: a.id })}
                >
                  <span>
                    {itemTitles.get(a.from)} ↔ {itemTitles.get(a.to)}
                  </span>
                  <strong>{number(a.relations.length)}</strong>
                </button>
              ))}
            </details>
          )}
          {p.window && selection.level !== "domain" && (
            <div className="brain-window-controls">
              <p>
                {p.window.loaded} concepts chargés sur{" "}
                {number(p.window.totals.concepts)} dans ce périmètre.{" "}
                {p.window.boundaryRelations > 0 &&
                  `${number(p.window.boundaryRelations)} relations sortent de cette page.`}{" "}
                {p.window.edgesTruncated &&
                  `120 relations chargées sur ${number(p.window.internalRelations)} entre ces concepts.`}
              </p>
              {mapControls}
            </div>
          )}
          {visibleLinks.length > 0 && (
            <details className="brain-aggregate-list">
              <summary>
                {Math.min(visibleLinks.length, 60)} relations de cette page
              </summary>
              {visibleLinks.slice(0, 60).map((r) => (
                <button
                  key={r.id}
                  onClick={() => update({ ...clearFocus, relation: r.id })}
                >
                  <span>
                    {graphIndex.nodes.get(r.from)?.title ?? "Concept"} →{" "}
                    {r.toTitle ??
                      graphIndex.nodes.get(r.to)?.title ??
                      "Cible historique"}
                  </span>
                </button>
              ))}
            </details>
          )}
          {!isCatalog && (
            <div className="brain-legend">
              <span>+ Création</span>
              <span>↑ Renforcement</span>
              <span>↓ Baisse de poids</span>
              <span>▱ Archive</span>
              <span>− Retrait</span>
            </div>
          )}
          {visibleLinks.length > 60 && (
            <p className="brain-notice">
              60 relations affichées sur {visibleLinks.length}. Le journal
              conserve les changements du périmètre.
            </p>
          )}
          <details className="brain-coverage">
            <summary>Couverture et mécanismes disponibles</summary>
            <p>{p.coverage.detail}</p>
            {p.mode === "api" && p.coverage.to ? (
              <p>
                Fenêtre des événements :{" "}
                {p.coverage.from
                  ? `depuis le ${date(p.coverage.from)}`
                  : "historique disponible"}
                , jusqu’au {date(p.coverage.to)}. La version publiée est fixe
                pendant la pagination ; les droits restent ceux de la lecture
                courante.
              </p>
            ) : (
              p.coverage.from && (
                <p>
                  Suivi activé le {date(p.coverage.from)}. Les périodes
                  antérieures ne sont pas couvertes.
                </p>
              )
            )}
            {!isCatalog && (
              <p>
                Les références nommées ne comptent pas comme concepts publiés.
                Le court terme, la dynamique des poids et l’archivage ne sont
                affichés que lorsqu’ils sont instrumentés.
              </p>
            )}
            {!isCatalog && (
              <p>
                La carte décrit l’état publié courant ; la période filtre les
                événements enregistrés. Elle ne reconstitue pas un ancien état
                non disponible.
              </p>
            )}
          </details>
        </section>
        <aside
          className="brain-journal"
          aria-label="Journal synchronisé"
          ref={journalPanel}
          tabIndex={-1}
        >
          <div className="brain-journal-title">
            <h2>{isCatalog ? "Dans ce corpus" : "Ce qui s’est passé"}</h2>
            <span>
              {isCatalog
                ? `${number(scopeConcepts)} fiches`
                : p.coverage.publicationChanges
                  ? `${events.length} événement${events.length === 1 ? "" : "s"}`
                  : "Indisponible"}
            </span>
          </div>
          <p className="brain-journal-scope">
            {group && selection.level !== "domain"
              ? group.title
              : (territory?.title ?? p.domainName)}{" "}
            · {isCatalog ? "même périmètre" : "même période · dates UTC"}
          </p>
          {focused && (
            <section
              className="brain-detail"
              aria-label="Détail sélectionné"
              ref={details}
              tabIndex={-1}
            >
              <button
                className="brain-detail-close"
                aria-label="Fermer le détail"
                onClick={() => update(clearFocus)}
              >
                <X size={16} />
              </button>
              <span className="brain-eyebrow">
                {selectedAggregate
                  ? "Connexion regroupée"
                  : event
                    ? changeLabels[event.kind]
                    : selectedRelation
                      ? kindLabel(selectedRelation)
                      : selectedNode?.kind === "reference"
                        ? "Référence nommée"
                        : isCatalog
                          ? "Fiche du corpus"
                          : "Concept publié"}
              </span>
              <h3>
                {selectedAggregate
                  ? `${itemTitles.get(selectedAggregate.from)} ↔ ${itemTitles.get(selectedAggregate.to)}`
                  : (event?.title ??
                    selectedNode?.title ??
                    `${p.nodes.find((n) => n.id === selectedRelation?.from)?.title} → ${selectedRelation?.toTitle ?? p.nodes.find((n) => n.id === selectedRelation?.to)?.title}`)}
              </h3>
              <DetailText
                key={
                  event?.id ??
                  selectedNode?.id ??
                  selectedRelation?.id ??
                  selectedAggregate?.id
                }
                text={
                  selectedAggregate
                    ? `${number(selectedAggregate.relations.length)} références regroupées. Sélectionnez une fiche pour suivre une relation précise.`
                    : (event?.detail ??
                      selectedNode?.description ??
                      (selectedRelation?.weight === null
                        ? "Le modèle ne renseigne pas le poids de cette relation."
                        : `Poids : ${selectedRelation?.weight}`))
                }
              />
              {event && (
                <small>
                  Publication v{event.version} · {date(event.time)}
                </small>
              )}
              {(event?.relation ?? selectedRelation)?.primary !== undefined && (
                <p>
                  Relation principale :{" "}
                  {(event?.relation ?? selectedRelation)?.primary
                    ? "oui"
                    : "non"}
                </p>
              )}
              {selectedNode?.declaredStatus && (
                <p>Statut du corpus : {selectedNode.declaredStatus}</p>
              )}
              {selectedNode?.classification && (
                <p>Type : {selectedNode.classification}</p>
              )}
              {selectedNode && related.length > 0 && (
                <details className="brain-related-list">
                  <summary>
                    {number(related.length)}{" "}
                    {isCatalog
                      ? "références entrantes et sortantes"
                      : p.window
                        ? "relations chargées dans cette page"
                        : "relations entrantes et sortantes"}
                  </summary>
                  {related
                    .slice(relationPage * 12, (relationPage + 1) * 12)
                    .map((r) => {
                      const other = graphIndex.nodes.get(
                        r.from === selectedNode.id ? r.to : r.from,
                      );
                      return (
                        other && (
                          <button key={r.id} onClick={() => showNode(other)}>
                            <span>
                              {r.from === selectedNode.id ? "→" : "←"}{" "}
                              {other.title}
                            </span>
                          </button>
                        )
                      );
                    })}
                  {related.length > 12 && (
                    <div className="brain-related-pages">
                      <button
                        disabled={relationPage === 0}
                        onClick={() => setRelationPage((p) => p - 1)}
                      >
                        Précédentes
                      </button>
                      <span>
                        {relationPage + 1}/{Math.ceil(related.length / 12)}
                      </span>
                      <button
                        disabled={(relationPage + 1) * 12 >= related.length}
                        onClick={() => setRelationPage((p) => p + 1)}
                      >
                        Suivantes
                      </button>
                    </div>
                  )}
                </details>
              )}
              {selectedAggregate && (
                <div className="brain-related-list">
                  {selectedAggregate.relations.slice(0, 12).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => showNode(graphIndex.nodes.get(r.from)!)}
                    >
                      {graphIndex.nodes.get(r.from)?.title} →{" "}
                      {r.toTitle ?? graphIndex.nodes.get(r.to)?.title}
                    </button>
                  ))}
                  {selectedAggregate.relations.length > 12 && (
                    <p>
                      12 références présentées sur{" "}
                      {selectedAggregate.relations.length}.
                    </p>
                  )}
                </div>
              )}
              {selectedNode?.maturity && (
                <p>Maturité : {selectedNode.maturity}</p>
              )}
              {onConcept && selectedNode?.kind === "concept" && (
                <button
                  className="brain-detail-action"
                  onClick={() =>
                    onConcept(selectedNode.id.replace(/^concept:/, ""))
                  }
                >
                  Ouvrir le concept <ArrowUpRight size={14} />
                </button>
              )}
              {selectedSources.map((id) => {
                const source = p.sources.find((s) => s.id === id);
                return (
                  <div className="brain-source" key={id}>
                    <strong>{source?.title ?? "Source référencée"}</strong>
                    {source?.text && <blockquote>{source.text}</blockquote>}
                    {onSource && (
                      <button onClick={(e) => onSource(id, e.currentTarget)}>
                        Consulter la source <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {!events.length ? (
            <div className="brain-empty">
              <Layers size={23} />
              <h3>
                {isCatalog
                  ? "Un corpus à explorer"
                  : p.coverage.publicationChanges
                    ? "Aucun changement enregistré"
                    : "Historique indisponible"}
              </h3>
              <p>
                {isCatalog
                  ? "Explorez un territoire, puis une famille. Chaque fiche conserve son texte d’origine et ses références. L’apprentissage, les changements et l’archivage seront observables après leur mise en place dans Open BrAIn."
                  : p.coverage.publicationChanges
                    ? selection.interval
                      ? "Aucun événement chargé dans cet intervalle. Revenez à toute la période pour retrouver les autres changements."
                      : "Les prochaines publications alimenteront ce journal. La synthèse permet de consulter le savoir actuel."
                    : "Le serveur fournit le savoir actuel. Aucun historique de changements n’est déduit de ses compteurs."}
              </p>
              <button onClick={() => update({ mode: "overview" })}>
                Voir la synthèse
              </button>
            </div>
          ) : (
            <div className="brain-events">
              {expanded && events.length > JOURNAL_PAGE_SIZE && (
                <nav
                  className="brain-event-pages"
                  aria-label="Pages des événements chargés"
                >
                  <p role="status">
                    {number(journalStart + 1)}–
                    {number(journalStart + list.length)} sur{" "}
                    {number(events.length)} événements chargés
                  </p>
                  {journalPages > 2 && (
                    <label className="brain-event-page-select">
                      Page
                      <select
                        aria-label="Page des événements"
                        value={currentJournalPage}
                        onChange={(e) => pageJournal(Number(e.target.value))}
                      >
                        {Array.from({ length: journalPages }, (_, index) => (
                          <option key={index} value={index}>
                            {index + 1} / {journalPages}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div>
                    <button
                      disabled={currentJournalPage === 0}
                      onClick={() => pageJournal(currentJournalPage - 1)}
                    >
                      Événements précédents
                    </button>
                    <button
                      disabled={currentJournalPage + 1 >= journalPages}
                      onClick={() => pageJournal(currentJournalPage + 1)}
                    >
                      Événements suivants
                    </button>
                  </div>
                </nav>
              )}
              {list.map((e, i) => (
                <div key={e.id}>
                  {(!i || date(list[i - 1].time) !== date(e.time)) && (
                    <h3 className="brain-day">{date(e.time)}</h3>
                  )}
                  <button
                    className="brain-event"
                    aria-pressed={event?.id === e.id}
                    onClick={() => showEvent(e)}
                  >
                    <span className={`brain-event-sign ${e.kind}`}>
                      {changeSymbol(e.kind)}
                    </span>
                    <span>
                      <strong>{e.title}</strong>
                      <small>
                        {changeLabels[e.kind]} · v{e.version}
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {events.length > 5 && (
            <button
              className="brain-more"
              onClick={() => {
                setExpanded(!expanded);
                setJournalPage(0);
                goToPanel(journalPanel.current);
              }}
            >
              {expanded
                ? "Réduire le journal"
                : events.length > JOURNAL_PAGE_SIZE
                  ? `Parcourir les ${number(events.length)} événements`
                  : `Voir les ${events.length - 5} autres événements`}
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
