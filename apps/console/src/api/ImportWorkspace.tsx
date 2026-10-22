import { ActivityStatus } from "../ActivityStatus";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ApiError, type CortexApi } from "./client";
import { SourceEvidence } from "./SourceEvidence";
import {
  importId,
  importLabels,
  itemLabels,
  importProgress,
  validateImport,
  validateImportPage,
} from "./import-contract";

/** Personal text-import receipts with explicit source-to-proposal handoff. */
export function ImportWorkspace({
  api,
  domain,
  onReconnect,
  canManage = false,
  onProposeSource,
}: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  canManage?: boolean;
  onProposeSource?: (id: string) => void;
}) {
  return (
    <ImportScope
      key={domain}
      api={api}
      domain={domain}
      onReconnect={onReconnect}
      canManage={canManage}
      onProposeSource={onProposeSource}
    />
  );
}
function ImportScope({
  api,
  domain,
  onReconnect,
  canManage = false,
  onProposeSource,
}: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  canManage?: boolean;
  onProposeSource?: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("api_import") ?? "";
  const invalidLink =
    !!selected &&
    (!importId(selected) || params.getAll("api_import").length !== 1);
  const [cursors, setCursors] = useState<string[]>([""]);
  const cursor = cursors.at(-1)!;
  const heading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focused = useRef("");
  const [evidenceError, setEvidenceError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const list = useQuery({
    queryKey: ["api", "imports", domain, cursor],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) =>
      validateImportPage(
        await api.call("imports.list", { domain }, undefined, {
          signal,
          maxResponseBytes: 262144,
          query: { limit: 10, ...(cursor ? { after: cursor } : {}) },
        }),
        cursor,
      ),
  });
  const detail = useQuery({
    queryKey: ["api", "import", domain, selected],
    retry: false,
    gcTime: 0,
    enabled: !!selected && !invalidLink && !list.error && !list.isFetching,
    queryFn: async ({ signal }) =>
      validateImport(
        await api.call(
          "imports.read",
          { domain, import_id: selected },
          undefined,
          { signal, maxResponseBytes: 32768 },
        ),
        selected,
      ),
  });
  const visible =
    !list.error &&
    !list.isFetching &&
    !invalidLink &&
    !detail.error &&
    !detail.isFetching
      ? detail.data
      : undefined;
  const collectionId = detail.data?.collection_id;
  const collection = useQuery({
    queryKey: ["api", "import-collection", domain, collectionId],
    retry: false,
    gcTime: 0,
    enabled: !!visible,
    queryFn: async ({ signal }) => {
      const value = await api.call(
        "collections.read",
        { domain, collection_id: collectionId! },
        undefined,
        { signal, maxResponseBytes: 65536 },
      );
      if (
        !value ||
        value.id !== collectionId ||
        typeof value.name !== "string" ||
        !value.name ||
        Array.from(value.name).length > 200 ||
        typeof value.description !== "string" ||
        Array.from(value.description).length > 2000
      )
        throw new ApiError(200, "invalid_response");
      return value;
    },
  });
  useEffect(() => {
    if (
      visible &&
      !refreshing &&
      !evidenceError &&
      !collection.error &&
      heading.current &&
      focused.current !== selected
    ) {
      focused.current = selected;
      heading.current?.focus();
    }
  }, [visible, selected, refreshing, evidenceError, collection.error]);
  function choose(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("api_import", id);
    else next.delete("api_import");
    setParams(next);
    focused.current = "";
    if (!id)
      (opener.current?.isConnected
        ? opener.current
        : listHeading.current
      )?.focus();
  }
  function error(error: Error) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        {error instanceof ApiError && error.status === 401 && onReconnect && (
          <button onClick={onReconnect}>
            Se reconnecter au suivi des imports
          </button>
        )}
      </div>
    );
  }
  async function refresh() {
    setRefreshing(true);
    try {
      const reads: Array<Promise<{ error: Error | null }>> = [list.refetch()];
      if (selected && !invalidLink) {
        reads.push(detail.refetch());
        if (collection.data || collection.error)
          reads.push(collection.refetch());
      }
      const results = await Promise.all(reads);
      if (results.every((r) => !r.error)) setEvidenceError(null);
    } finally {
      setRefreshing(false);
    }
  }
  const detailDenied =
    detail.error instanceof ApiError &&
    [401, 403, 404].includes(detail.error.status)
      ? detail.error
      : null;
  const scopeError =
    list.error || evidenceError || collection.error || detailDenied;
  return (
    <section aria-label="Suivi des imports de texte" className="api-imports">
      <h2 ref={listHeading} tabIndex={-1}>
        Mes imports de texte
      </h2>
      <p>
        Suivez les lots créés par votre compte. Une source importée doit encore
        être transformée en proposition, revue puis publiée avant d’alimenter le
        savoir publié.
      </p>
      <p>
        Ce suivi n’inclut pas les autres canaux d’ingestion.{" "}
        {canManage
          ? "Préparez les créations et actions dans le panneau ci-dessus. Le traitement reste une commande explicite, sans worker automatique."
          : "Le lancement et la reprise exigent les droits de gestion du corpus."}
      </p>
      <button
        disabled={list.isFetching || refreshing}
        onClick={() => void refresh()}
      >
        Actualiser les imports
      </button>
      {invalidLink && (
        <div role="alert">
          Ce lien d’import est invalide.{" "}
          <button onClick={() => choose("")}>
            Effacer la sélection d’import
          </button>
        </div>
      )}
      {refreshing ? (
        <ActivityStatus>Vérification des imports…</ActivityStatus>
      ) : scopeError ? (
        <>
          {error(scopeError)}
          {selected && (
            <button onClick={() => choose("")}>
              Fermer le détail de l’import
            </button>
          )}
        </>
      ) : list.isFetching || list.isPending ? (
        <ActivityStatus>Chargement des imports…</ActivityStatus>
      ) : (
        <>
          {list.data?.items.length === 0 && (
            <p>
              Aucun import de texte accessible sur cette page pour votre compte.
            </p>
          )}
          <ul className="api-import-list">
            {list.data?.items.map((job) => (
              <li key={job.id}>
                <button
                  aria-pressed={selected === job.id}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    choose(job.id);
                  }}
                >
                  {importLabels[job.status]} · {job.items[0].filename}
                  {job.items.length > 1
                    ? ` et ${job.items.length - 1} autre(s)`
                    : ""}
                </button>
                <p>{importProgress(job)}</p>
              </li>
            ))}
          </ul>
          <nav aria-label="Pages des imports">
            <button
              disabled={cursors.length < 2}
              onClick={() => setCursors((v) => v.slice(0, -1))}
            >
              Page précédente des imports
            </button>
            <span>
              Page {cursors.length} · {list.data?.items.length ?? 0} lot(s)
              affiché(s)
            </span>
            <button
              disabled={!list.data?.next_after}
              onClick={() => {
                if (list.data?.next_after)
                  setCursors((v) => [...v, list.data!.next_after!]);
              }}
            >
              Page suivante des imports
            </button>
          </nav>
          {selected && !invalidLink && (
            <article aria-label="Détail de l’import">
              <button onClick={() => choose("")}>
                Fermer le détail de l’import
              </button>
              {detail.error ? (
                <>
                  {error(detail.error)}
                  <button onClick={() => void detail.refetch()}>
                    Réessayer le détail de l’import
                  </button>
                </>
              ) : detail.isPending || detail.isFetching ? (
                <p role="status">Chargement du lot…</p>
              ) : (
                visible && (
                  <>
                    <h3 ref={heading} tabIndex={-1}>
                      Lot {visible.id}
                    </h3>
                    <p>
                      {importLabels[visible.status]} · {importProgress(visible)}
                    </p>
                    {visible.processing === "local_text_only" && (
                      <p>Traitement local de texte, sans appel à un modèle.</p>
                    )}
                    {collection.isFetching || collection.isPending ? (
                      <ActivityStatus>
                        Chargement de la collection…
                      </ActivityStatus>
                    ) : (
                      collection.data && (
                        <p>Collection : {collection.data.name}</p>
                      )
                    )}
                    {!collection.isFetching && collection.data && (
                      <ol className="api-import-items">
                        {visible.items.map((item) => (
                          <li key={item.position}>
                            <h4>{item.filename}</h4>
                            <p>
                              {itemLabels[item.status]} · {item.attempts}{" "}
                              tentative(s)
                            </p>
                            {item.error_code && (
                              <p>
                                {item.error_code === "UNSUPPORTED_FORMAT"
                                  ? "Format non pris en charge. Seuls les fichiers texte acceptés par ce canal peuvent être traités."
                                  : "Le traitement de ce fichier a échoué. Relisez le lot avant de le reprendre."}
                              </p>
                            )}
                            {item.source_id && onProposeSource && (
                              <button
                                onClick={() => onProposeSource(item.source_id!)}
                              >
                                Proposer un ajout depuis {item.filename}
                              </button>
                            )}
                            {item.source_id && (
                              <SourceEvidence
                                key={item.source_id}
                                api={api}
                                domain={domain}
                                source={{ source_id: item.source_id }}
                                onReadError={setEvidenceError}
                              />
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
