import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiError, CortexApi } from "./client";
const actions: Record<string, string> = {
  approve: "Approbation",
  reject: "Rejet",
  defer: "Report",
  request_changes: "Demande de correction",
  reopen: "Réouverture",
};
export function ReviewHistory({
  api,
  domain,
  proposal,
  expectedRevision,
  onReadError,
}: {
  api: CortexApi;
  domain: string;
  proposal: string;
  expectedRevision?: number;
  onReadError?: (error: Error) => void;
}) {
  const [open, setOpen] = useState(false);
  const errorHandler = useRef(onReadError);
  errorHandler.current = onReadError;
  const query = useInfiniteQuery({
    queryKey: ["api", "reviews", domain, proposal, expectedRevision],
    enabled: open,
    retry: false,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const page = await api.call(
        "proposals.reviews",
        { domain, ident: proposal },
        undefined,
        {
          signal,
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        },
      );
      if (
        !page ||
        !Array.isArray(page.items) ||
        !(page.next_after === null || typeof page.next_after === "string") ||
        page.items.some(
          (r) =>
            !r ||
            r.proposal_id !== proposal ||
            [
              r.id,
              r.author,
              r.action,
              r.reason,
              r.created_at,
              r.resulting_status,
            ].some((s) => typeof s !== "string") ||
            !Number.isInteger(r.review_revision),
        )
      )
        throw new ApiError(200, "invalid_response");
      if (
        expectedRevision !== undefined &&
        page.items.some((r) => r.review_revision > expectedRevision)
      )
        throw new ApiError(409, "review_changed");
      return page;
    },
    getNextPageParam: (page) => page.next_after ?? undefined,
  });
  useEffect(() => {
    if (query.error) errorHandler.current?.(query.error);
  }, [query.error]);
  // The transport cursor is an opaque ID, not chronological order. Sorting
  // only the loaded decisions must never imply that all revisions were read.
  const decisions = (
    query.data?.pages.flatMap((page) => page.items) ?? []
  ).sort(
    (a, b) => b.review_revision - a.review_revision || a.id.localeCompare(b.id),
  );
  return (
    <section aria-label="Historique des décisions">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Masquer les décisions" : "Consulter les décisions"}
      </button>
      {open && (
        <>
          <p>
            Les décisions nécessitent une confirmation signée par un hôte de
            confiance. Cet historique présente les décisions enregistrées par le
            serveur.
          </p>
          <p>
            Reports, demandes de correction, rejets et réouvertures sont
            présentés ici. L’approbation et la publication possèdent des reçus
            distincts.
          </p>
          <button onClick={() => void query.refetch()}>
            Actualiser les décisions
          </button>
          {query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : query.isPending || query.isFetching ? (
            <p role="status">Chargement des décisions…</p>
          ) : (
            <>
              {!decisions.length && <p>Aucune décision enregistrée.</p>}
              {decisions.length > 0 && (
                <>
                  <p role="status">
                    {decisions.length} décisions chargées ·{" "}
                    {query.hasNextPage
                      ? "lecture partielle"
                      : "toutes les pages de cette lecture sont chargées"}
                    .
                  </p>
                  <p>
                    Décisions chargées de la révision la plus récente à la plus
                    ancienne.
                    {query.hasNextPage &&
                      " Des décisions peuvent manquer entre ces révisions ; chargez la suite pour compléter la lecture."}
                  </p>
                </>
              )}
              <ol>
                {decisions.map((r) => (
                  <li key={r.id}>
                    <strong>{actions[r.action] ?? r.action}</strong> · révision{" "}
                    {r.review_revision}
                    <p>{r.reason}</p>
                    <p>
                      {r.author} ·{" "}
                      <time dateTime={r.created_at}>{r.created_at}</time>
                    </p>
                  </li>
                ))}
              </ol>
              {query.hasNextPage && (
                <button
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Décisions suivantes
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
