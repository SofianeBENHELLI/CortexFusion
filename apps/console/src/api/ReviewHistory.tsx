import { useState } from "react";
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
}: {
  api: CortexApi;
  domain: string;
  proposal: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["api", "reviews", domain, proposal],
    enabled: open,
    retry: false,
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
      return page;
    },
    getNextPageParam: (page) => page.next_after ?? undefined,
  });
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
          <button onClick={() => void query.refetch()}>
            Actualiser les décisions
          </button>
          {query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : query.isPending ? (
            <p role="status">Chargement des décisions…</p>
          ) : (
            <>
              {!query.data?.pages.some((p) => p.items.length) && (
                <p>Aucune décision enregistrée.</p>
              )}
              <ol>
                {query.data?.pages
                  .flatMap((p) => p.items)
                  .map((r) => (
                    <li key={r.id}>
                      <strong>{actions[r.action] ?? r.action}</strong> ·
                      révision {r.review_revision}
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
