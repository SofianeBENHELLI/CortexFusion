import { changeLabels } from "./model";
import { measureBrainRead, useBrainReadPaint } from "./read-measurement";
import Markdown from "react-markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { BrandName } from "../BrandName";
import { ThemeControl } from "../theme";
import { ApiError, CortexApi } from "../api/client";
import { SourceEvidence } from "../api/SourceEvidence";
import { readApiBrain, validateConcept } from "./api-projection";
import { SpatialCanvas } from "./SpatialCanvas";
import { validateTopology, type Layout } from "./spatial-model";
import "./spatial.css";
const count = (n: number) => n.toLocaleString("fr-FR");
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
export function SpatialBrainWorkspace({
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
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("map_node");
  const [layout, setLayout] = useState<Layout>("territories"),
    [search, setSearch] = useState(""),
    [panel, setPanel] = useState<"concepts" | "chronicle" | "detail">(() =>
      params.has("map_node") ? "detail" : "concepts",
    );
  const [focus, setFocus] = useState<{
      ids: string[];
      sequence: number;
    } | null>(null),
    [colors, setColors] = useState(false),
    [onlyChanges, setOnlyChanges] = useState(false);
  const [page, setPage] = useState(0),
    [edgePage, setEdgePage] = useState(0),
    [kind, setKind] = useState("all"),
    [direction, setDirection] = useState("both");
  const [edgeSelection, setEdgeSelection] = useState<{
    index: number;
    version: number;
  } | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [sourceError, setSourceError] = useState<Error | null>(null);
  const [recoveryError, setRecoveryError] = useState<Error | null>(null);
  const detailRegion = useRef<HTMLElement>(null);
  const edgeRegion = useRef<HTMLElement>(null);
  const edgeTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const content = detailRegion.current?.querySelector(
      ".spatial-inspector-content",
    );
    if (content) content.scrollTop = 0;
  }, [selectedId, panel]);
  const query = useQuery({
    queryKey: ["api", "spatial-map", domain],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) =>
      measureBrainRead("spatial-map", async () =>
        validateTopology(
          await api.call("graph.map", { domain }, undefined, {
            signal,
            timeoutMs: 30000,
            maxResponseBytes: 8_000_000,
          }),
          domain,
        ),
      ),
  });
  useEffect(() => {
    if (query.data && !query.isFetching && !query.error) setRecoveryError(null);
  }, [query.data, query.isFetching, query.error]);
  const data = query.data,
    selected = data?.nodes.findIndex((n) => n.id === selectedId) ?? -1,
    node = selected >= 0 ? data!.nodes[selected] : null;
  const edge =
    edgeSelection?.version === data?.at_version
      ? (edgeSelection?.index ?? null)
      : null;
  const setEdge = (index: number | null) =>
    setEdgeSelection(
      index === null || !data ? null : { index, version: data.at_version },
    );
  const openEdge = (index: number) => {
    edgeTrigger.current = document.activeElement as HTMLElement | null;
    setEdge(index);
    setPanel("detail");
  };
  const closeEdge = () => {
    setEdge(null);
    if (edgeTrigger.current?.isConnected) edgeTrigger.current.focus();
  };
  useEffect(() => {
    if (edge !== null && panel === "detail") edgeRegion.current?.focus();
  }, [edge, panel]);
  const detail = useQuery({
    queryKey: [
      "api",
      "spatial-concept",
      domain,
      selectedId,
      data?.at_version,
      epoch,
    ],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: !!node && !query.isFetching && !query.error,
    retry: false,
    queryFn: async ({ signal }) => {
      const c = validateConcept(
        await api.call(
          "concepts.read",
          { domain, concept_id: selectedId! },
          undefined,
          { signal },
        ),
      );
      const v = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      if (v.published_version !== data?.at_version)
        throw new ApiError(409, "projection_changed");
      return c;
    },
  });
  const history = useQuery({
    queryKey: ["api", "spatial-history", domain, data?.at_version, epoch],
    enabled: historyEnabled && !!data && !query.isFetching && !query.error,
    retry: false,
    queryFn: ({ signal }) =>
      readApiBrain(api, domain, name, owner, { maxPages: 5 }, signal),
  });
  const historyValid =
    history.data?.version.published_version === data?.at_version;
  const [period, setPeriod] = useState("all");
  const [journalPage, setJournalPage] = useState(0);
  useEffect(() => setJournalPage(0), [period, data?.at_version]);
  const events = useMemo(() => {
    const all = historyValid ? (history.data?.projection.events ?? []) : [];
    const from = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
    return all.filter((e) => Date.parse(e.time) >= from);
  }, [history.data, historyValid, period]);
  const changes = useMemo(
    () => (onlyChanges ? new Set(events.flatMap((e) => e.nodeIds)) : null),
    [onlyChanges, events],
  );
  useEffect(() => {
    setPage(0);
  }, [search]);
  useEffect(() => {
    setEdgePage(0);
    setEdge(null);
  }, [selectedId, kind, direction]);
  const matches = useMemo(
    () =>
      data?.nodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) =>
          normalize(n.title + " " + n.group + " " + n.territory).includes(
            normalize(search),
          ),
        )
        .sort((a, b) => a.n.title.localeCompare(b.n.title, "fr")) ?? [],
    [data, search],
  );
  const neighbors = useMemo(
    () =>
      data?.edges
        .map((e, i) => ({ e, i }))
        .filter(
          ({ e }) =>
            (direction === "out"
              ? e[0] === selected
              : direction === "in"
                ? e[1] === selected
                : e[0] === selected || e[1] === selected) &&
            (kind === "all" || e[2] === kind),
        ) ?? [],
    [data, selected, direction, kind],
  );
  const select = (index: number | null, recenter = false) => {
    const next = new URLSearchParams(params);
    if (index === null) next.delete("map_node");
    else next.set("map_node", data!.nodes[index].id);
    setParams(next);
    setPanel(index === null ? "concepts" : "detail");
    if (index !== null && recenter) {
      const neighborhood = new Set([index]);
      data!.edges.forEach(([a, b]) => {
        if (a === index) neighborhood.add(b);
        if (b === index) neighborhood.add(a);
      });
      setFocus((f) => ({
        ids: [...neighborhood].map((i) => data!.nodes[i].id),
        sequence: (f?.sequence ?? 0) + 1,
      }));
    }
  };
  const refresh = () => {
    if (blocked) setRecoveryError(blocked);
    setSourceError(null);
    setEdge(null);
    // A new read generation cannot reuse detail from before a refused proof.
    setEpoch((n) => n + 1);
    void query.refetch();
  };
  const blocked =
    query.error ||
    sourceError ||
    recoveryError ||
    ([401, 403, 409].includes((detail.error as ApiError)?.status)
      ? detail.error
      : null) ||
    ([401, 403, 409].includes((history.error as ApiError)?.status)
      ? history.error
      : null);
  useBrainReadPaint(data, !!data && !query.isFetching && !blocked);
  const showHistory = () => {
    setPanel("chronicle");
    setHistoryEnabled(true);
  };
  return (
    <section
      className="spatial-workspace"
      aria-label="BrainMap et Chronique"
      data-refreshing={query.isFetching && !!data}
    >
      <header className="spatial-header">
        <div>
          <span className="spatial-eyebrow">
            <BrandName /> / {name}
          </span>
          <h1>
            BrainMap<span>Explorer le savoir.</span>
          </h1>
        </div>
        <div className="spatial-actions">
          <ThemeControl />
          <button onClick={refresh} disabled={query.isFetching}>
            Actualiser
          </button>
        </div>
      </header>
      {blocked ? (
        <div className="spatial-error" role="alert">
          <h2>Lecture interrompue</h2>
          <p>{blocked.message}</p>
          <p>
            {(blocked as ApiError).status === 401
              ? "La carte précédente est masquée. Reconnectez-vous pour reprendre votre exploration."
              : "La carte précédente est masquée. Actualisez après vérification de votre accès."}
          </p>
          {(blocked as ApiError).status === 401 && onReconnect && (
            <button onClick={onReconnect}>Se reconnecter</button>
          )}
        </div>
      ) : !data ? (
        <p role="status" className="spatial-loading">
          Chargement de la carte autorisée…
        </p>
      ) : (
        <>
          <div className="spatial-summary">
            <span>
              <strong>{count(data.nodes.length)}</strong> concepts publiés
            </span>
            <span>
              <strong>{count(data.documentary_references)}</strong> références
              documentaires
            </span>
            <span>
              <strong>{count(data.published_relations)}</strong> relations
              validées
            </span>
            <span className="spatial-version">
              Version {data.at_version} · lecture privée
            </span>
          </div>
          <div className="spatial-toolbar">
            <label className="spatial-search">
              <span className="sr-only">Rechercher un concept</span>
              <input
                placeholder="Rechercher un concept, une famille…"
                aria-label="Rechercher un concept"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPanel("concepts");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0])
                    select(matches[0].i, true);
                  if (e.key === "Escape") setSearch("");
                }}
              />
            </label>
            <label>
              Disposition
              <select
                aria-label="Disposition de la carte"
                value={layout}
                onChange={(e) => setLayout(e.target.value as Layout)}
              >
                <option value="territories">Territoires</option>
                <option value="fireworks">Fireworks</option>
                <option value="circle">Circulaire</option>
                <option value="lines">En lignes</option>
              </select>
            </label>
            <label className="spatial-check">
              <input
                type="checkbox"
                checked={colors}
                onChange={(e) => setColors(e.target.checked)}
              />
              Couleurs de maturité
            </label>
          </div>
          <div className="spatial-body">
            <SpatialCanvas
              data={data}
              layout={layout}
              selected={selected >= 0 ? selected : null}
              focus={focus}
              colors={colors}
              changes={changes}
              onSelect={(i) => select(i)}
              onEdge={openEdge}
            />
            <aside
              className="spatial-inspector"
              aria-label="Exploration du savoir"
              ref={detailRegion}
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
                  disabled={!node && edge === null}
                  onClick={() => setPanel("detail")}
                >
                  Détail
                </button>
                <button
                  aria-pressed={panel === "chronicle"}
                  onClick={showHistory}
                >
                  Chronique
                </button>
              </nav>
              <div className="spatial-inspector-content">
                {panel === "concepts" && (
                  <>
                    <p className="spatial-eyebrow">
                      {count(matches.length)} CONCEPTS{" "}
                      {search ? "TROUVÉS" : "À EXPLORER"}
                    </p>
                    <p className="spatial-help">
                      Sélectionnez un point ou recherchez un concept. Zoomez
                      pour déployer les regroupements.
                    </p>
                    <div className="spatial-node-list">
                      {matches
                        .slice(page * 40, (page + 1) * 40)
                        .map(({ n, i }) => (
                          <button key={n.id} onClick={() => select(i, true)}>
                            <strong>{n.title}</strong>
                            <small>
                              {n.group} · {n.maturity}
                            </small>
                            <span aria-hidden>↗</span>
                          </button>
                        ))}
                    </div>
                    {!matches.length && (
                      <p>Aucun concept ne correspond à cette recherche.</p>
                    )}
                    <div className="spatial-pagination">
                      <button
                        disabled={!page}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Précédents
                      </button>
                      <span>
                        {Math.min(page * 40 + 1, matches.length)}–
                        {Math.min((page + 1) * 40, matches.length)} /{" "}
                        {count(matches.length)}
                      </span>
                      <button
                        disabled={(page + 1) * 40 >= matches.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Suivants
                      </button>
                    </div>
                  </>
                )}
                {panel === "detail" && (
                  <>
                    {!node && edge === null && (
                      <div role="status">
                        <h2>Concept indisponible dans cette carte</h2>
                        <p>
                          Ce lien ne correspond plus à un concept accessible
                          dans la version publiée. Retrouvez le savoir
                          disponible dans la liste.
                        </p>
                        <button onClick={() => select(null)}>
                          Revenir aux concepts
                        </button>
                      </div>
                    )}
                    {edge !== null && data.edges[edge] && (
                      <section
                        className="spatial-edge-detail"
                        aria-label="Détail du lien"
                        tabIndex={-1}
                        ref={edgeRegion}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            closeEdge();
                          }
                        }}
                      >
                        <p className="spatial-eyebrow">
                          {data.edges[edge][2] === "reference"
                            ? "RÉFÉRENCE DOCUMENTAIRE"
                            : "RELATION CORTEX PUBLIÉE"}
                        </p>
                        {[0, 1].map((endpoint) => (
                          <button
                            key={endpoint}
                            onClick={() =>
                              select(Number(data.edges[edge!][endpoint]), true)
                            }
                          >
                            {endpoint === 0 ? "Depuis" : "Vers"} :{" "}
                            {
                              data.nodes[Number(data.edges[edge!][endpoint])]
                                .title
                            }{" "}
                            ↗
                          </button>
                        ))}
                        <p>
                          {data.edges[edge][2] === "reference"
                            ? "Lien explicite de la source importée. Aucun poids ou type de relation Open BrAIn n’en est déduit."
                            : `Type ${data.edges[edge][2]} · poids publié ${data.edges[edge][3]}`}
                        </p>
                        <button onClick={closeEdge}>Fermer le lien</button>
                      </section>
                    )}
                    {node && (
                      <>
                        <p className="spatial-eyebrow">
                          {node.territory} / {node.group}
                        </p>
                        <h2>{node.title}</h2>
                        <div className="spatial-detail-actions">
                          <span>{node.maturity}</span>
                          <button onClick={() => select(selected, true)}>
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
                                    a: ({ children }) => {
                                      const title = normalize(String(children));
                                      const targets = [
                                        ...new Set(
                                          neighbors.map(({ e }) =>
                                            e[0] === selected ? e[1] : e[0],
                                          ),
                                        ),
                                      ].filter(
                                        (i) =>
                                          normalize(data.nodes[i].title) ===
                                          title,
                                      );
                                      return targets.length === 1 ? (
                                        <button
                                          className="spatial-inline-link"
                                          onClick={() =>
                                            select(targets[0], true)
                                          }
                                        >
                                          {children}
                                        </button>
                                      ) : (
                                        <span>{children}</span>
                                      );
                                    },
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
                                          [401, 403, 404, 409].includes(
                                            (error as ApiError).status,
                                          )
                                        )
                                          setSourceError(error);
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
                            {count(neighbors.length)} liens{" "}
                            {direction === "both"
                              ? "entrants / sortants"
                              : direction === "out"
                                ? "sortants"
                                : "entrants"}
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
                            onChange={(e) => setDirection(e.target.value)}
                          >
                            <option value="both">Deux sens</option>
                            <option value="out">Sortants</option>
                            <option value="in">Entrants</option>
                          </select>
                        </div>
                        <div className="spatial-neighbors">
                          {neighbors
                            .slice(edgePage * 30, (edgePage + 1) * 30)
                            .map(({ e, i }) => {
                              const other = e[0] === selected ? e[1] : e[0];
                              return (
                                <div key={i}>
                                  <button onClick={() => select(other, true)}>
                                    <span>
                                      {e[0] === selected ? "→" : "←"}{" "}
                                      {data.nodes[other].title}
                                    </span>
                                    <small>
                                      {e[2] === "reference"
                                        ? "Référence documentaire"
                                        : `Relation ${e[2]}`}
                                    </small>
                                  </button>
                                  <button
                                    aria-label={`Détail du lien avec ${data.nodes[other].title}`}
                                    onClick={() => openEdge(i)}
                                  >
                                    ⓘ
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                        {!neighbors.length && (
                          <p>
                            Aucun lien de ce type dans le savoir accessible.
                          </p>
                        )}
                        {neighbors.length > 30 && (
                          <div className="spatial-pagination">
                            <button
                              disabled={!edgePage}
                              onClick={() => setEdgePage((p) => p - 1)}
                            >
                              Liens précédents
                            </button>
                            <span>
                              {edgePage + 1}/{Math.ceil(neighbors.length / 30)}
                            </span>
                            <button
                              disabled={(edgePage + 1) * 30 >= neighbors.length}
                              onClick={() => setEdgePage((p) => p + 1)}
                            >
                              Liens suivants
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {panel === "chronicle" && (
                  <>
                    <p className="spatial-eyebrow">CE QUI A CHANGÉ</p>
                    <h2>Chronique du cerveau</h2>
                    <label>
                      Période
                      <select
                        aria-label="Période de la chronique"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                      >
                        <option value="all">Historique chargé</option>
                        <option value="1">24 heures</option>
                        <option value="7">7 jours</option>
                        <option value="30">30 jours</option>
                      </select>
                    </label>
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
                          {events.length} changements dans{" "}
                          {history.data!.observedPublications} publications
                          chargées.{" "}
                          {history.data!.partialHistory
                            ? "Historique partiel."
                            : ""}
                        </p>
                        <label className="spatial-check">
                          <input
                            type="checkbox"
                            checked={onlyChanges}
                            onChange={(e) => setOnlyChanges(e.target.checked)}
                          />
                          Isoler ces changements sur la carte
                        </label>
                        {events
                          .slice(journalPage * 40, (journalPage + 1) * 40)
                          .map((e) => (
                            <button
                              className="spatial-event"
                              key={e.id}
                              onClick={() => {
                                const ids = e.nodeIds
                                  .map((id) =>
                                    data.nodes.findIndex((n) => n.id === id),
                                  )
                                  .filter((i) => i >= 0);
                                if (ids.length) {
                                  select(ids[0], true);
                                } else setFocus(null);
                              }}
                            >
                              <time>
                                {new Date(e.time).toLocaleString("fr-FR")}
                              </time>
                              <strong>{e.title}</strong>
                              <small>
                                {changeLabels[e.kind]} · v{e.version}
                              </small>
                            </button>
                          ))}
                        {events.length > 40 && (
                          <div className="spatial-pagination">
                            <button
                              disabled={!journalPage}
                              onClick={() => setJournalPage((p) => p - 1)}
                            >
                              Plus récents
                            </button>
                            <span>
                              {journalPage + 1}/{Math.ceil(events.length / 40)}
                            </span>
                            <button
                              disabled={(journalPage + 1) * 40 >= events.length}
                              onClick={() => setJournalPage((p) => p + 1)}
                            >
                              Plus anciens
                            </button>
                          </div>
                        )}
                        {!events.length && (
                          <p>
                            Aucun événement sur cette période. Les concepts
                            publiés restent accessibles dans la carte.
                          </p>
                        )}
                      </>
                    ) : (
                      <p>
                        Actualisez pour aligner le journal avec la version de la
                        carte.
                      </p>
                    )}
                  </>
                )}
              </div>
              <footer className="spatial-inspector-footer">
                Les références documentaires sont navigables, sans être
                assimilées à des relations validées.
              </footer>
            </aside>
          </div>
          {onlyChanges && (
            <p className="spatial-filter-note">
              Carte filtrée sur les changements chargés.{" "}
              <button onClick={() => setOnlyChanges(false)}>
                Afficher tout le savoir
              </button>
            </p>
          )}
          <details className="spatial-coverage">
            <summary>Origine, lecture et limites de cette carte</summary>
            <p>
              Les concepts et relations publiées viennent de la version publiée{" "}
              {data.at_version}. Les références et regroupements documentaires
              viennent d’un index privé du corpus importé, vérifié contre les
              empreintes du contenu publié et de ses sources. Ils ne sont ni une
              nouvelle publication, ni des relations validées.
            </p>
            <p>
              La carte charge des identités et des titres, puis lit le contenu à
              la sélection. Les tracés et étiquettes sont limités à l’écran ; la
              liste des liens conserve toutes les connexions accessibles du
              concept. Le positionnement est une aide à la navigation, pas une
              mesure de proximité sémantique. Les mécanismes de sommeil, de
              mémoire et d’archivage restent à construire.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
