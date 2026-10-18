import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import { CortexApi, ApiError } from "../api/client";
import { SourceEvidence } from "../api/SourceEvidence";
import { SceneEventDetail } from "./SceneEventDetail";
import { ThemeControl } from "../theme";
import { readApiBrain, validateConcept } from "./api-projection";
import { changeLabels, readSelection } from "./model";
import { indexSceneChanges, observedSceneLinks } from "./scene-changes";
import {
  ScenePeriod,
  sceneIntervalLabel,
  type SceneInterval,
} from "./ScenePeriod";
import { measureBrainRead, useBrainReadPaint } from "./read-measurement";
import { SceneCanvas, type SceneCameraMemory } from "./SceneCanvas";
import {
  validateScene,
  validateNodePage,
  type MapBounds,
  type MapNodePage,
} from "./scene";
import type { Layout } from "./spatial-model";
import type { MapLink } from "../../../../packages/contracts/src/MapLink";
import "./spatial.css";
const count = (n: number) => n.toLocaleString("fr-FR");
const linkLabel = (kind: string) =>
  kind === "reference" ? "Référence documentaire" : `Relation ${kind}`;
export function ProgressiveBrainWorkspace({
  api,
  domain,
  name,
  owner,
  onReconnect,
}: {
  api: CortexApi;
  domain: string;
  name: string;
  owner: boolean;
  onReconnect?: () => void;
}) {
  const [params, setParams] = useSearchParams(),
    selectedId = params.get("map_node"),
    eventId = params.get("map_event");
  const [eventError, setEventError] = useState<Error | null>(null);
  const [recoveryError, setRecoveryError] = useState<Error | null>(null);
  const [eventPair, setEventPair] = useState<{
    from: string;
    to: string;
    kind?: string;
  } | null>(null);
  const eventTrigger = useRef<HTMLElement | null>(null);
  const cameraMemory = useRef<SceneCameraMemory | null>(null);
  const focusSequence = useRef(0);
  const interval = readSelection(params).interval;
  const showChanges = params.get("map_changes") === "1";
  const maxPages: 1 | 5 = params.get("history_pages") === "1" ? 1 : 5;
  const [layout, setLayout] = useState<Layout>("territories"),
    [view, setView] = useState<MapBounds | null>(null),
    [epoch, setEpoch] = useState(0);
  const [stamp, setStamp] = useState<{
    at_version: number;
    visibility: string;
  } | null>(null);
  const [panel, setPanel] = useState<"concepts" | "detail" | "chronicle">(
    eventId ? "chronicle" : selectedId ? "detail" : "concepts",
  );
  const [search, setSearch] = useState(""),
    [querySearch, setQuerySearch] = useState(""),
    [offset, setOffset] = useState(0),
    [edgeOffset, setEdgeOffset] = useState(0),
    [kind, setKind] = useState("all"),
    [direction, setDirection] = useState<"both" | "in" | "out">("both");
  const [focus, setFocus] = useState<{
      bounds: MapBounds;
      sequence: number;
    } | null>(null),
    [focusIntent, setFocusIntent] = useState(!!selectedId && !eventId);
  const [link, setLink] = useState<MapLink | null>(null);
  const trigger = useRef<HTMLElement | null>(null),
    linkRegion = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement>(null);
  const [historyEnabled, setHistoryEnabled] = useState(false),
    [journalPage, setJournalPage] = useState(0);
  const observedUntil = useMemo(
    () => new Date().toISOString(),
    [domain, epoch],
  );
  const historyWindow = {
    since: interval?.from,
    // Fetch the inclusive endpoint, then filter it out below. Subtracting a
    // millisecond would lose database timestamps with microsecond precision.
    until: interval?.to ?? observedUntil,
    atVersion: stamp?.at_version,
    maxPages,
  };
  const changePeriod = (value: SceneInterval) => {
    const next = new URLSearchParams(params);
    next.delete("period");
    next.delete("map_event");
    if (value) {
      next.set("time_from", value.from);
      next.set("time_to", value.to);
    } else {
      next.delete("time_from");
      next.delete("time_to");
    }
    setParams(next);
  };
  useEffect(
    () => setJournalPage(0),
    [interval?.from, interval?.to, maxPages, stamp?.at_version],
  );
  useEffect(() => {
    if (selectedId && !eventId) setPanel("detail");
  }, [selectedId]);
  useEffect(() => {
    if (eventId) setPanel("chronicle");
    setEventPair(null);
  }, [eventId]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuerySearch(search);
      setOffset(0);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setEdgeOffset(0);
    setLink(null);
    if (content.current) content.current.scrollTop = 0;
  }, [selectedId, kind, direction]);
  useEffect(() => {
    // The event region places focus on itself. Do not undo its scroll when
    // returning from a concept or restoring an event URL.
    if (content.current && !(panel === "chronicle" && eventId))
      content.current.scrollTop = 0;
  }, [panel]);
  useEffect(() => {
    if (link) linkRegion.current?.focus();
  }, [link]);
  const scene = useQuery({
    queryKey: [
      "api",
      "scene",
      domain,
      layout,
      view,
      stamp,
      selectedId,
      eventPair,
      epoch,
    ],
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      measureBrainRead("spatial-map", async () => ({
        ...validateScene(
          await api.call("graph.scene", { domain }, undefined, {
            signal,
            maxResponseBytes: 65536,
            query: {
              layout,
              ...view,
              ...stamp,
              ...(eventPair
                ? { focus: eventPair.from, target: eventPair.to }
                : selectedId
                  ? { focus: selectedId }
                  : {}),
            },
          }),
          domain,
        ),
        sceneLayout: layout,
      })),
  });
  useEffect(() => {
    if (scene.data && !stamp && !scene.isPlaceholderData)
      setStamp({
        at_version: scene.data.at_version,
        visibility: scene.data.visibility,
      });
  }, [scene.data, stamp, scene.isPlaceholderData]);
  useEffect(() => {
    if (
      scene.data &&
      !scene.isFetching &&
      !scene.isPlaceholderData &&
      !scene.error
    )
      setRecoveryError(null);
  }, [scene.data, scene.isFetching, scene.isPlaceholderData, scene.error]);
  const list = useQuery({
    queryKey: [
      "api",
      "map-nodes",
      domain,
      layout,
      stamp,
      querySearch,
      offset,
      epoch,
    ],
    enabled: !!stamp && panel === "concepts",
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) =>
      validateNodePage(
        await api.call("graph.map_nodes", { domain }, undefined, {
          signal,
          maxResponseBytes: 65536,
          query: { layout, ...stamp, search: querySearch, offset },
        }),
        domain,
      ),
  });
  const neighbors = useQuery<MapNodePage>({
    queryKey: [
      "api",
      "map-neighbors",
      domain,
      layout,
      stamp,
      selectedId,
      edgeOffset,
      kind,
      direction,
      epoch,
    ],
    enabled: !!stamp && !!selectedId && (panel === "detail" || focusIntent),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous: MapNodePage | undefined) =>
      previous?.selected?.id === selectedId &&
      previous.at_version === stamp?.at_version &&
      previous.visibility === stamp?.visibility
        ? previous
        : undefined,
    queryFn: async ({ signal }) =>
      validateNodePage(
        await api.call("graph.map_nodes", { domain }, undefined, {
          signal,
          maxResponseBytes: 65536,
          query: {
            layout,
            ...stamp,
            focus: selectedId!,
            offset: edgeOffset,
            kind,
            direction,
          },
        }),
        domain,
      ),
  });
  const node = neighbors.data?.selected;
  useEffect(() => {
    if (
      focusIntent &&
      node?.id === selectedId &&
      neighbors.data?.focus_bounds
    ) {
      setFocus({
        bounds: neighbors.data!.focus_bounds!,
        sequence: ++focusSequence.current,
      });
      setFocusIntent(false);
    }
  }, [neighbors.data, focusIntent, node?.id, selectedId]);
  const detail = useQuery({
    queryKey: ["api", "progressive-concept", domain, selectedId, stamp, epoch],
    enabled:
      panel === "detail" &&
      !!node &&
      node.id === selectedId &&
      !!stamp &&
      !neighbors.error,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const result = validateConcept(
        await api.call(
          "concepts.read",
          { domain, concept_id: selectedId! },
          undefined,
          { signal },
        ),
      );
      const version = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      if (version.published_version !== stamp?.at_version)
        throw new ApiError(409, "projection_changed");
      return result;
    },
  });
  const history = useQuery({
    queryKey: [
      "api",
      "progressive-history",
      domain,
      stamp,
      epoch,
      historyWindow,
    ],
    enabled: owner && (historyEnabled || showChanges || !!eventId) && !!stamp,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      readApiBrain(api, domain, name, owner, historyWindow, signal),
  });
  const historyValid =
    !!history.data &&
    !history.isFetching &&
    !history.error &&
    history.data.version.published_version === stamp?.at_version;
  const events = useMemo(
    () =>
      (historyValid ? history.data!.projection.events : []).filter(
        (e) =>
          !interval ||
          (Date.parse(e.time) >= Date.parse(interval.from) &&
            Date.parse(e.time) < Date.parse(interval.to)),
      ),
    [history.data, historyValid, interval?.from, interval?.to],
  );
  const changes = useMemo(
    () => indexSceneChanges(showChanges ? events : []),
    [showChanges, events],
  );
  const observedLinks = useMemo(
    () => (scene.data ? observedSceneLinks(scene.data, changes.relations) : []),
    [scene.data, changes.relations],
  );
  const openEvent = (id: string) => {
    eventTrigger.current = document.activeElement as HTMLElement;
    const next = new URLSearchParams(params);
    next.delete("map_node");
    next.set("map_event", id);
    setParams(next);
    setPanel("chronicle");
  };
  const changedPublications = new Set(events.map((e) => e.publicationId)).size;
  const fatal =
    scene.error ||
    eventError ||
    recoveryError ||
    [list.error, neighbors.error, detail.error, history.error].find((e) =>
      [401, 403, 409].includes((e as ApiError)?.status),
    );
  useBrainReadPaint(scene.data, !!scene.data && !scene.isFetching && !fatal);
  const select = (id: string | null, recenter = true) => {
    const next = new URLSearchParams(params);
    next.delete("map_event");
    setEventPair(null);
    if (id) next.set("map_node", id);
    else next.delete("map_node");
    setParams(next);
    setPanel(id ? "detail" : "concepts");
    setLink(null);
    setFocusIntent(!!id && recenter);
  };
  const refresh = () => {
    // Keep the old scene masked until a fresh authorized response succeeds.
    if (fatal) setRecoveryError(fatal);
    setLink(null);
    setEventError(null);
    setEventPair(null);
    setStamp(null);
    setEpoch((n) => n + 1);
  };
  const openLink = (l: MapLink) => {
    trigger.current = document.activeElement as HTMLElement;
    setLink(l);
    setPanel("detail");
  };
  const closeLink = () => {
    setLink(null);
    if (trigger.current?.isConnected) trigger.current.focus();
  };
  const activeEvent = events.find((e) => e.id === eventId);
  const closeEvent = () => {
    const next = new URLSearchParams(params);
    next.delete("map_event");
    setParams(next);
    setEventPair(null);
    if (eventTrigger.current?.isConnected) eventTrigger.current.focus();
  };
  return (
    <section className="spatial-workspace" aria-label="BrainMap et Chronique">
      <header className="spatial-header">
        <div>
          <span className="spatial-eyebrow">CORTEX FUSION / {name}</span>
          <h1>
            BrainMap<span>Explorer le savoir.</span>
          </h1>
        </div>
        <div className="spatial-actions">
          <ThemeControl />
          <button onClick={refresh} disabled={scene.isFetching}>
            Actualiser
          </button>
        </div>
      </header>
      {fatal ? (
        <div className="spatial-error" role="alert">
          <h2>Lecture interrompue</h2>
          <p>{fatal.message}</p>
          <p>
            La carte précédente est masquée.{" "}
            {(fatal as ApiError).status === 401
              ? "Reconnectez-vous pour reprendre cette exploration."
              : "Actualisez pour relire le savoir accessible."}
          </p>
          {(fatal as ApiError).status === 401 && onReconnect && (
            <button onClick={onReconnect}>Se reconnecter</button>
          )}
        </div>
      ) : !scene.data ? (
        <p role="status" className="spatial-loading">
          Chargement de la carte autorisée…
        </p>
      ) : (
        <>
          <div className="spatial-summary">
            <span>
              <strong>{count(scene.data.totals.concepts)}</strong> concepts
              publiés
            </span>
            <span>
              <strong>{count(scene.data.totals.references)}</strong> références
              documentaires
            </span>
            <span>
              <strong>{count(scene.data.totals.relations)}</strong> relations
              validées
            </span>
            <small>Version {scene.data.at_version} · lecture privée</small>
          </div>
          <div className="spatial-toolbar">
            <label className="spatial-search">
              <span className="sr-only">Rechercher un concept</span>
              <input
                aria-label="Rechercher un concept"
                placeholder="Rechercher un concept, une famille…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPanel("concepts");
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    querySearch === search &&
                    list.data?.items[0]
                  )
                    select(list.data.items[0].node.id);
                }}
              />
            </label>
            <label>
              Disposition{" "}
              <select
                aria-label="Disposition de la carte"
                value={layout}
                onChange={(e) => {
                  setLayout(e.target.value as Layout);
                  setView(null);
                  setFocus(null);
                }}
              >
                <option value="territories">Territoires</option>
                <option value="fireworks">Fireworks</option>
                <option value="circle">Circulaire</option>
                <option value="lines">En lignes</option>
              </select>
            </label>
          </div>
          {owner && (
            <div className="scene-time-context">
              <button
                onClick={() => {
                  setPanel("chronicle");
                  setHistoryEnabled(true);
                }}
              >
                {interval
                  ? sceneIntervalLabel(interval)
                  : "Explorer les changements dans le temps"}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={showChanges}
                  onChange={(e) => {
                    const next = new URLSearchParams(params);
                    if (e.target.checked) next.set("map_changes", "1");
                    else next.delete("map_changes");
                    setParams(next);
                  }}
                />{" "}
                Repérer les changements
              </label>
              {showChanges && (
                <small role="status">
                  {history.isFetching
                    ? "Lecture des changements…"
                    : historyValid
                      ? `${count(events.length)} événements observés${history.data!.projection.coverage.partial ? " · couverture partielle" : ""}`
                      : "Changements indisponibles"}
                  . La carte et les stocks montrent le savoir actuel.
                </small>
              )}
              {showChanges && historyValid && (
                <details className="scene-change-key">
                  <summary>
                    Relations repérées dans la scène (
                    {count(observedLinks.length)})
                  </summary>
                  <p>
                    Anneaux : concepts concernés. Traits accentués : relations
                    actuelles ayant un événement dans l’historique chargé. Les
                    noms sont actuels.
                  </p>
                  <p>
                    Relations de l’historique non détaillées ici :{" "}
                    {count(changes.relations.size - observedLinks.length)}.
                    Elles peuvent être regroupées, hors de la zone, hors des
                    tracés retenus ou retirées. Les changements des
                    regroupements ne sont pas encore calculés ; une absence de
                    signal ne signifie pas une absence de changement.
                  </p>
                  {observedLinks.length > 0 && (
                    <div
                      className="scene-change-list"
                      aria-label="Relations actuelles avec historique"
                    >
                      {observedLinks.map(
                        ({ key, fromTitle, toTitle, observation }) => (
                          <button
                            key={key}
                            onClick={() => openEvent(observation.latest.id)}
                          >
                            <strong>
                              {fromTitle} → {toTitle}
                            </strong>
                            <span>{observation.label}</span>
                            <small>
                              {count(observation.events.length)} événement
                              {observation.events.length > 1 ? "s" : ""} chargé
                              {observation.events.length > 1 ? "s" : ""} ·
                              ouvrir le dernier, v{observation.latest.version}
                            </small>
                          </button>
                        ),
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setPanel("chronicle");
                      setHistoryEnabled(true);
                    }}
                  >
                    Voir tous les événements chargés
                  </button>
                </details>
              )}
            </div>
          )}
          <div className="spatial-body">
            <SceneCanvas
              cameraMemory={cameraMemory}
              data={scene.data}
              layout={scene.data.sceneLayout}
              selected={eventPair?.from ?? selectedId}
              changes={changes.nodes}
              relationChanges={changes.relations}
              emphasizedPair={eventPair}
              focus={focus}
              loading={scene.isFetching}
              onView={setView}
              onSelect={(id) => select(id, false)}
              onLink={(from, to, kind, weight) =>
                openLink({ from, to, kind: kind as MapLink["kind"], weight })
              }
            />
            <aside
              className="spatial-inspector"
              aria-label="Exploration du savoir"
            >
              <nav className="spatial-tabs" aria-label="Panneau BrainMap">
                <button
                  aria-pressed={panel === "concepts"}
                  onClick={() => setPanel("concepts")}
                >
                  Concepts
                </button>
                <button
                  aria-pressed={panel === "detail"}
                  disabled={!selectedId && !link}
                  onClick={() => setPanel("detail")}
                >
                  Détail
                </button>
                <button
                  aria-pressed={panel === "chronicle"}
                  onClick={() => {
                    setPanel("chronicle");
                    setHistoryEnabled(true);
                  }}
                >
                  Chronique
                </button>
              </nav>
              <div className="spatial-inspector-content" ref={content}>
                {panel === "concepts" &&
                  (list.isFetching ? (
                    <p role="status">Recherche dans le savoir…</p>
                  ) : list.error ? (
                    <p role="alert">{list.error.message}</p>
                  ) : (
                    list.data && (
                      <>
                        <p className="spatial-eyebrow">
                          {count(list.data.total)} CONCEPTS{" "}
                          {querySearch ? "TROUVÉS" : "À EXPLORER"}
                        </p>
                        <p className="spatial-help">
                          Sélectionnez un point ou zoomez dans un regroupement.
                          La recherche parcourt tout le savoir accessible.
                        </p>
                        <div className="spatial-node-list">
                          {list.data.items.map(({ node }) => (
                            <button
                              key={node.id}
                              onClick={() => select(node.id)}
                            >
                              <strong>{node.title}</strong>
                              <small>
                                {node.group} · {node.maturity}
                              </small>
                              <span aria-hidden>↗</span>
                            </button>
                          ))}
                        </div>
                        {!list.data.total && (
                          <p>Aucun concept ne correspond à cette recherche.</p>
                        )}
                        <div className="spatial-pagination">
                          <button
                            disabled={!offset}
                            onClick={() =>
                              setOffset((n) =>
                                Math.max(0, n - list.data!.page_size),
                              )
                            }
                          >
                            Précédents
                          </button>
                          <span>
                            {Math.min(offset + 1, list.data.total)}–
                            {offset + list.data.items.length} /{" "}
                            {count(list.data.total)}
                          </span>
                          <button
                            disabled={
                              offset + list.data.items.length >= list.data.total
                            }
                            onClick={() =>
                              setOffset((n) => n + list.data!.page_size)
                            }
                          >
                            Suivants
                          </button>
                        </div>
                      </>
                    )
                  ))}
                {panel === "detail" && (
                  <>
                    {link && (
                      <section
                        className="spatial-edge-detail"
                        aria-label="Détail du lien"
                        tabIndex={-1}
                        ref={linkRegion}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            closeLink();
                          }
                        }}
                      >
                        <p className="spatial-eyebrow">
                          {link.kind === "reference"
                            ? "RÉFÉRENCE DOCUMENTAIRE"
                            : "RELATION CORTEX PUBLIÉE"}
                        </p>
                        <button onClick={() => select(link.from)}>
                          Ouvrir le concept de départ ↗
                        </button>
                        <button onClick={() => select(link.to)}>
                          Ouvrir le concept cible ↗
                        </button>
                        <p>
                          {link.kind === "reference"
                            ? "Lien explicite dans la source. Aucun poids de relation n’est déduit."
                            : `Type ${link.kind} · poids publié ${link.weight}`}
                        </p>
                        <button onClick={closeLink}>Fermer le lien</button>
                      </section>
                    )}
                    {neighbors.error ? (
                      <div role="status">
                        <h2>Concept indisponible dans cette carte</h2>
                        <p>{neighbors.error.message}</p>
                        <button onClick={() => select(null)}>
                          Revenir aux concepts
                        </button>
                      </div>
                    ) : (
                      selectedId &&
                      (neighbors.isFetching && !node ? (
                        <p role="status">Lecture du voisinage…</p>
                      ) : (
                        node && (
                          <>
                            <p className="spatial-eyebrow">
                              {node.territory} / {node.group}
                            </p>
                            <h2>{node.title}</h2>
                            <div className="spatial-detail-actions">
                              <span>{node.maturity}</span>
                              <button onClick={() => setFocusIntent(true)}>
                                Cadrer le voisinage
                              </button>
                            </div>
                            {detail.isFetching ? (
                              <p role="status">
                                Lecture du concept et de ses preuves…
                              </p>
                            ) : detail.error ? (
                              <p role="alert">{detail.error.message}</p>
                            ) : (
                              detail.data && (
                                <>
                                  <div
                                    className="spatial-reading"
                                    tabIndex={0}
                                    role="region"
                                    aria-label="Contenu publié du concept"
                                  >
                                    <Markdown
                                      skipHtml
                                      components={{
                                        img: ({ alt }) => <span>{alt}</span>,
                                        a: ({ children }) => (
                                          <button
                                            className="spatial-inline-link"
                                            onClick={() => {
                                              setSearch(String(children));
                                              setPanel("concepts");
                                            }}
                                          >
                                            {children}
                                          </button>
                                        ),
                                      }}
                                    >
                                      {detail.data.body}
                                    </Markdown>
                                  </div>
                                  <details className="spatial-proofs">
                                    <summary>
                                      {detail.data.sources.length} preuve(s) du
                                      contenu publié
                                    </summary>
                                    {detail.data.sources.map((s, i) => (
                                      <div key={`${s.source_id}:${s.start}`}>
                                        <p>Preuve {i + 1}</p>
                                        <SourceEvidence
                                          api={api}
                                          domain={domain}
                                          source={s}
                                          onReadError={(error) => {
                                            if (
                                              error instanceof ApiError &&
                                              [401, 403, 404, 409].includes(
                                                error.status,
                                              )
                                            )
                                              setEventError(error);
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </details>
                                </>
                              )
                            )}
                            <div className="spatial-links-heading">
                              <h3>
                                {count(neighbors.data?.total ?? 0)} liens
                                entrants / sortants
                              </h3>
                              <select
                                aria-label="Type de liens"
                                value={kind}
                                onChange={(e) => setKind(e.target.value)}
                              >
                                <option value="all">Tous les liens</option>
                                <option value="reference">
                                  Références documentaires
                                </option>
                                <option value="structural">
                                  Relations structurelles
                                </option>
                                <option value="associative">
                                  Relations associatives
                                </option>
                              </select>
                              <select
                                aria-label="Sens des liens"
                                value={direction}
                                onChange={(e) =>
                                  setDirection(
                                    e.target.value as "both" | "in" | "out",
                                  )
                                }
                              >
                                <option value="both">Deux sens</option>
                                <option value="out">Sortants</option>
                                <option value="in">Entrants</option>
                              </select>
                            </div>
                            {neighbors.isFetching && (
                              <p role="status">Lecture des liens…</p>
                            )}
                            <div
                              className="spatial-neighbors"
                              aria-busy={neighbors.isFetching}
                            >
                              {neighbors.data?.items.map(
                                ({ node: n, link: l }) => (
                                  <div key={`${n.id}:${l?.kind}:${l?.from}`}>
                                    <button
                                      disabled={neighbors.isFetching}
                                      onClick={() => select(n.id)}
                                    >
                                      <span>
                                        {l?.from === selectedId ? "→" : "←"}{" "}
                                        {n.title}
                                      </span>
                                      <small>{linkLabel(l!.kind)}</small>
                                    </button>
                                    <button
                                      disabled={neighbors.isFetching}
                                      aria-label={`Détail du lien avec ${n.title}`}
                                      onClick={() => openLink(l!)}
                                    >
                                      ⓘ
                                    </button>
                                  </div>
                                ),
                              )}
                            </div>
                            {neighbors.data?.total === 0 && (
                              <p>
                                Aucun lien de ce type dans le savoir accessible.
                              </p>
                            )}
                            <div className="spatial-pagination">
                              <button
                                disabled={neighbors.isFetching || !edgeOffset}
                                onClick={() =>
                                  setEdgeOffset((n) =>
                                    Math.max(0, n - neighbors.data!.page_size),
                                  )
                                }
                              >
                                Liens précédents
                              </button>
                              <span>
                                {(neighbors.data?.offset ?? 0) /
                                  (neighbors.data?.page_size ?? 16) +
                                  1}
                                /
                                {Math.max(
                                  1,
                                  Math.ceil(
                                    (neighbors.data?.total ?? 0) /
                                      (neighbors.data?.page_size ?? 16),
                                  ),
                                )}
                              </span>
                              <button
                                disabled={
                                  neighbors.isFetching ||
                                  !neighbors.data ||
                                  edgeOffset + neighbors.data.items.length >=
                                    neighbors.data.total
                                }
                                onClick={() =>
                                  setEdgeOffset(
                                    (n) => n + neighbors.data!.page_size,
                                  )
                                }
                              >
                                Liens suivants
                              </button>
                            </div>
                          </>
                        )
                      ))
                    )}
                  </>
                )}
                {panel === "chronicle" && (
                  <>
                    <p className="spatial-eyebrow">CE QUI A CHANGÉ</p>
                    <h2>Chronique du cerveau</h2>
                    {owner && (
                      <>
                        <ScenePeriod
                          interval={interval}
                          onChange={changePeriod}
                        />
                        <label>
                          Couverture de lecture{" "}
                          <select
                            aria-label="Couverture de lecture"
                            value={maxPages}
                            onChange={(e) => {
                              const next = new URLSearchParams(params);
                              next.set("history_pages", e.target.value);
                              setParams(next);
                            }}
                          >
                            <option value={1}>20 publications maximum</option>
                            <option value={5}>100 publications maximum</option>
                          </select>
                        </label>
                      </>
                    )}
                    {!owner ? (
                      <p>
                        Le journal de publication n’est pas disponible pour
                        votre rôle.
                      </p>
                    ) : history.isFetching ? (
                      <p role="status">Lecture des publications…</p>
                    ) : history.error ? (
                      <p role="alert">{history.error.message}</p>
                    ) : historyValid ? (
                      <>
                        <p>
                          {count(events.length)} événements dans{" "}
                          {count(changedPublications)} publication
                          {changedPublications === 1 ? "" : "s"} avec
                          changements. {history.data!.observedPublications}{" "}
                          publication
                          {history.data!.observedPublications === 1
                            ? ""
                            : "s"}{" "}
                          examinée
                          {history.data!.observedPublications === 1
                            ? ""
                            : "s"}.{" "}
                          {history.data!.projection.coverage.partial
                            ? "Historique partiel : le total de la période est inconnu."
                            : "Toutes les publications accessibles de la période sont couvertes."}
                        </p>
                        <details>
                          <summary>Comprendre la couverture</summary>
                          <p>{history.data!.projection.coverage.detail}</p>
                        </details>
                        {activeEvent && stamp && (
                          <SceneEventDetail
                            key={activeEvent.id}
                            api={api}
                            domain={domain}
                            event={activeEvent}
                            stamp={stamp}
                            layout={layout}
                            onFatal={setEventError}
                            onOpen={select}
                            onClose={closeEvent}
                            onFocus={(bounds, pair) => {
                              setEventPair(pair);
                              setFocus({
                                bounds,
                                sequence: ++focusSequence.current,
                              });
                            }}
                          />
                        )}
                        {eventId && !activeEvent && (
                          <div role="status">
                            <p>
                              Cet événement n’est pas disponible dans la période
                              ou la couverture chargée.
                            </p>
                            <button onClick={closeEvent}>
                              Fermer l’événement
                            </button>
                          </div>
                        )}
                        {events
                          .slice(journalPage * 40, (journalPage + 1) * 40)
                          .map((e) => (
                            <button
                              className="spatial-event"
                              key={e.id}
                              aria-pressed={e.id === eventId}
                              onClick={() => openEvent(e.id)}
                            >
                              <time dateTime={e.time}>
                                {new Date(e.time).toLocaleString("fr-FR")}
                              </time>
                              <strong>{e.title}</strong>
                              <small>
                                {changeLabels[e.kind]} · v{e.version}
                              </small>
                            </button>
                          ))}
                        <div className="spatial-pagination">
                          <button
                            disabled={!journalPage}
                            onClick={() => setJournalPage((n) => n - 1)}
                          >
                            Plus récents
                          </button>
                          <span>
                            {journalPage + 1}/
                            {Math.max(1, Math.ceil(events.length / 40))}
                          </span>
                          <button
                            disabled={(journalPage + 1) * 40 >= events.length}
                            onClick={() => setJournalPage((n) => n + 1)}
                          >
                            Plus anciens
                          </button>
                        </div>
                        {!events.length && (
                          <p>
                            Aucun événement chargé dans cette période. Les
                            concepts publiés restent accessibles. Une couverture
                            partielle ne prouve pas une absence d’activité.
                          </p>
                        )}
                      </>
                    ) : (
                      <p>Actualisez pour aligner le journal avec la carte.</p>
                    )}
                  </>
                )}
              </div>
              <footer className="spatial-inspector-footer">
                Les références documentaires restent distinctes des relations
                validées.
              </footer>
            </aside>
          </div>
          <details className="spatial-disclosure">
            <summary>Origine, lecture et limites de cette carte</summary>
            <p>
              Les positions sont calculées pour explorer le savoir publié. Les
              regroupements et routes principales dépendent du zoom ; la liste
              et la recherche donnent accès à tous les concepts autorisés. Les
              liens documentaires ne prouvent ni relation validée ni
              renforcement. Les regroupements peuvent inclure des concepts hors
              du bord de la carte.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
