import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { readSelection } from "./model";
import { ApiError, CortexApi } from "../api/client";
import { SourceEvidence } from "../api/SourceEvidence";
import { BrainWorkspace } from "./BrainWorkspace";
import { readApiBrain } from "./api-projection";
import { measureBrainRead, useBrainReadPaint } from "./read-measurement";
import {
  isUuid,
  readGraphWindow,
  summaryNode,
  type GraphRequest,
} from "./api-graph";

export function ApiBrainWorkspace({
  api,
  domain,
  name,
  owner,
}: {
  api: CortexApi;
  domain: string;
  name: string;
  owner: boolean;
}) {
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selection = readSelection(params);
  const period = selection.period;
  const maxPages = params.get("history_pages") === "5" ? 5 : 1;
  const [interactionError, setInteractionError] = useState<Error | null>(null);
  const [focusRecovered, setFocusRecovered] = useState(false);
  let relationOrigin: string | undefined;
  try {
    const relation = JSON.parse(selection.relation ?? "null");
    if (
      Array.isArray(relation) &&
      relation[0] === domain &&
      isUuid(relation[1])
    )
      relationOrigin = relation[1];
  } catch {
    /* No remote read for an invalid selection. */
  }
  const graphRequest: GraphRequest = {
    ...(params.has("map_v") ? { atVersion: Number(params.get("map_v")) } : {}),
    ...(params.get("map_visibility")
      ? { visibility: params.get("map_visibility")! }
      : {}),
    ...(params.get("map_after") ? { after: params.get("map_after")! } : {}),
    ...(params.get("map_before") ? { before: params.get("map_before")! } : {}),
    ...(selection.level === "concepts" && selection.group
      ? { focus: selection.group }
      : {}),
    ...(!params.get("map_after") &&
    !params.get("map_before") &&
    (params.get("map_locate") || selection.node)
      ? { locate: params.get("map_locate") ?? selection.node! }
      : {}),
    ...(selection.node || relationOrigin
      ? { detail: selection.node ?? relationOrigin }
      : {}),
    historical: !!selection.event || !!relationOrigin,
  };
  const [refresh, setRefresh] = useState(0);
  const scope = `${domain}:${period}:${refresh}:${maxPages}`;
  const [history, setHistory] = useState<{
    scope: string;
    cursors: { before: number; atVersion: number }[];
  }>({ scope, cursors: [] });
  const cursors = history.scope === scope ? history.cursors : [];
  const cursor = cursors.at(-1);
  const until = useMemo(() => new Date().toISOString(), [scope]);
  const since =
    period === "all"
      ? undefined
      : new Date(Date.parse(until) - Number(period) * 86400000).toISOString();
  const [source, setSource] = useState<string | null>(null);
  const evidencePanel = useRef<HTMLElement>(null);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);
  const workspacePanel = useRef<HTMLElement>(null);
  const closeEvidence = () => {
    setSource(null);
    if (evidenceTrigger.current?.isConnected) evidenceTrigger.current.focus();
    else workspacePanel.current?.focus();
    evidenceTrigger.current = null;
  };
  useEffect(() => {
    if (source) evidencePanel.current?.focus();
  }, [source]);
  const query = useQuery({
    queryKey: [
      "api",
      "brain",
      domain,
      owner,
      maxPages,
      refresh,
      until,
      since,
      cursor,
      graphRequest,
    ],
    retry: false,
    queryFn: ({ signal }) =>
      measureBrainRead("workspace", () =>
        readApiBrain(
          api,
          domain,
          name,
          owner,
          { ...cursor, since, until, maxPages },
          signal,
          graphRequest,
        ),
      ),
  });
  useBrainReadPaint(
    query.data,
    !query.isFetching && !query.error && !interactionError,
  );
  useEffect(() => {
    if (query.data && !query.isFetching && !query.error)
      cache.setQueryData(["api", "version", domain], query.data.version);
  }, [cache, domain, query.data, query.isFetching, query.error]);
  useEffect(() => setSource(null), [domain, params.toString()]);
  useEffect(() => {
    if (
      !query.data?.unavailableFocus ||
      query.isFetching ||
      query.error ||
      !selection.group
    )
      return;
    // Only a fully verified authorized root read may normalize a missing focus.
    const next = new URLSearchParams(params);
    for (const key of [...next.keys()])
      if (
        key.startsWith("map_") ||
        ["group", "territory", "node", "event", "relation", "page"].includes(
          key,
        )
      )
        next.delete(key);
    next.set("level", "groups");
    setFocusRecovered(true);
    setSource(null);
    setParams(next, { replace: true });
  }, [
    query.data,
    query.isFetching,
    query.error,
    selection.group,
    params,
    setParams,
  ]);
  const search = useCallback(
    async (term: string, signal: AbortSignal) => {
      if (!query.data) return [];
      try {
        const result = await readGraphWindow(
          api,
          domain,
          query.data.graph.at_version,
          { visibility: query.data.graph.visibility },
          signal,
          8,
          term,
        );
        return result.nodes.map(summaryNode);
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [401, 403, 409].includes(error.status)
        )
          setInteractionError(error);
        throw error;
      }
    },
    [api, domain, query.data],
  );
  const resetMap = (root = false, pages?: number) => {
    setFocusRecovered(false);
    const next = new URLSearchParams(params);
    for (const key of [...next.keys()])
      if (
        key.startsWith("map_") ||
        ["node", "event", "relation", "page"].includes(key) ||
        (root && ["level", "group", "territory"].includes(key))
      )
        next.delete(key);
    if (pages !== undefined) {
      if (pages === 5) next.set("history_pages", "5");
      else next.delete("history_pages");
    }
    setParams(next);
    setSource(null);
    setInteractionError(null);
  };
  const moveMap = (direction: "after" | "before") => {
    const data = query.data!;
    const next = new URLSearchParams(params);
    for (const key of [...next.keys()])
      if (
        key.startsWith("map_") ||
        ["node", "event", "relation", "page"].includes(key)
      )
        next.delete(key);
    next.set(
      "map_" + direction,
      direction === "after"
        ? data.graph.next_after!
        : data.graph.previous_before!,
    );
    next.set("map_v", String(data.graph.at_version));
    next.set("map_visibility", data.graph.visibility);
    setParams(next);
    setSource(null);
  };
  const error = query.error ?? interactionError;
  return (
    <section
      className="api-brain"
      aria-label="Cerveau connecté"
      ref={workspacePanel}
      tabIndex={-1}
    >
      <div className="api-brain-actions">
        <p>Lecture du savoir publié et des changements autorisés.</p>
        <button
          disabled={query.isFetching}
          onClick={() => {
            resetMap();
            setRefresh((n) => n + 1);
          }}
        >
          Actualiser le cerveau
        </button>
        <button onClick={() => resetMap(true)}>Revenir à la synthèse</button>
        {owner && (
          <label>
            Profondeur du journal
            <select
              aria-label="Profondeur du journal"
              value={maxPages}
              onChange={(e) => resetMap(false, Number(e.target.value))}
            >
              <option value={1}>Jusqu’à 20 publications</option>
              <option value={5}>Jusqu’à 100 publications</option>
            </select>
          </label>
        )}
      </div>
      {query.isFetching ? (
        <p role="status">
          Lecture des concepts
          {owner ? ` et de ${maxPages * 20} publications au maximum` : ""}, puis
          vérification des accès et des versions…
        </p>
      ) : error ? (
        <div role="alert">
          <p>{error.message}</p>
          <p>
            La lecture précédente est masquée. Actualisez après vérification de
            votre accès.
          </p>
        </div>
      ) : (
        query.data && (
          <>
            {focusRecovered &&
              selection.level === "groups" &&
              !selection.group && (
                <p role="status">
                  Le voisinage sélectionné n’est plus disponible avec vos droits
                  actuels. La synthèse autorisée du domaine est affichée.
                </p>
              )}
            {owner && (
              <nav
                className="api-brain-history"
                aria-label="Pages du journal publié"
              >
                <p>
                  Page {cursors.length + 1} · {query.data.observedPublications}{" "}
                  publications auditées.
                  {query.data.projection.coverage.partial
                    ? " Comptage partiel : publications datées de cette page uniquement."
                    : " Période accessible entièrement parcourue."}
                  {query.data.scanLimited
                    ? " Parcours des droits borné : poursuivez même si la page est vide."
                    : ""}
                  {query.data.eventLimited
                    ? " Journal dense : cette page conserve des publications entières dans la limite de 10 000 événements. Poursuivez avec les publications plus anciennes."
                    : ""}
                </p>
                <button
                  disabled={!cursors.length}
                  onClick={() => {
                    setSource(null);
                    setHistory({ scope, cursors: cursors.slice(0, -1) });
                  }}
                >
                  Publications plus récentes
                </button>
                <button
                  disabled={query.data.nextBefore === null}
                  onClick={() => {
                    setSource(null);
                    setHistory({
                      scope,
                      cursors: [
                        ...cursors,
                        {
                          before: query.data!.nextBefore!,
                          atVersion: query.data!.version.published_version,
                        },
                      ],
                    });
                  }}
                >
                  Publications plus anciennes
                </button>
              </nav>
            )}
            <BrainWorkspace
              projection={query.data.projection}
              onSource={(id, trigger) => {
                evidenceTrigger.current = trigger;
                setSource(id);
                if (source === id) evidencePanel.current?.focus();
              }}
              onSearch={search}
              mapControls={
                <nav aria-label="Pages serveur de la carte">
                  <button
                    disabled={!query.data.graph.previous_before}
                    onClick={() => moveMap("before")}
                  >
                    Concepts précédents
                  </button>
                  <button
                    disabled={!query.data.graph.next_after}
                    onClick={() => moveMap("after")}
                  >
                    Concepts suivants
                  </button>
                </nav>
              }
            />
            {source && (
              <section
                className="api-brain-evidence"
                ref={evidencePanel}
                tabIndex={-1}
                aria-label="Preuves du cerveau"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    closeEvidence();
                  }
                }}
              >
                <h3>Extraits cités dans le périmètre</h3>
                <p>
                  Source {source}. Chaque extrait est relu avec vos droits
                  actuels.
                </p>
                <button onClick={closeEvidence}>Fermer les preuves</button>
                {(query.data.evidence[source] ?? []).slice(0, 10).map((ref) => (
                  <div key={`${ref.start}-${ref.end}`}>
                    <p>
                      Caractères Unicode {ref.start}–{ref.end}
                    </p>
                    <SourceEvidence
                      api={api}
                      domain={domain}
                      source={ref}
                      onReadError={(error) => {
                        if (
                          error instanceof ApiError &&
                          [401, 403, 404, 409].includes(error.status)
                        )
                          setInteractionError(error);
                      }}
                    />
                  </div>
                ))}
                {(query.data.evidence[source]?.length ?? 0) > 10 && (
                  <p>
                    Les dix premiers extraits de cette source sont affichés.
                  </p>
                )}
              </section>
            )}
          </>
        )
      )}
    </section>
  );
}
