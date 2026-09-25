import { IssueActions } from "./IssueActions";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { IssueView } from "../../../../packages/contracts/src/IssueView";
import { CortexApi, ApiError } from "./client";
import { validateAnswer } from "./ConversationWorkspace";
const statuses: Record<IssueView["status"], string> = {
  open: "Ouvert",
  in_progress: "En cours",
  resolved: "Résolu",
  dismissed: "Écarté",
};
function validateIssue(v: IssueView): IssueView {
  if (
    !v ||
    typeof v.id !== "string" ||
    typeof v.episode_id !== "string" ||
    typeof v.reason !== "string" ||
    !Object.hasOwn(statuses, v.status) ||
    !["knowledge_gap", "disputed_answer"].includes(v.kind) ||
    !Number.isInteger(v.revision)
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
export function IssueWorkspace({
  api,
  domain,
}: {
  api: CortexApi;
  domain: string;
}) {
  const [selected, setSelected] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["api", "issues", domain],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const page = await api.call("issues.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
      });
      if (
        !page ||
        !Array.isArray(page.items) ||
        !(page.next_after === null || typeof page.next_after === "string")
      )
        throw new ApiError(200, "invalid_response");
      page.items.forEach(validateIssue);
      return page;
    },
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  const detail = useQuery({
    queryKey: ["api", "issue", domain, selected],
    enabled: !!selected && !list.error,
    retry: false,
    queryFn: async ({ signal }) => {
      const v = validateIssue(
        await api.call("issues.read", { domain, ident: selected }, undefined, {
          signal,
        }),
      );
      if (v.id !== selected) throw new ApiError(200, "invalid_response");
      return v;
    },
  });
  const episodeId = detail.data?.episode_id ?? "";
  const episode = useQuery({
    queryKey: ["api", "issue-episode", domain, episodeId],
    enabled: !!episodeId && !list.error && !detail.error,
    retry: false,
    queryFn: async ({ signal }) => {
      const v = validateAnswer(
        await api.call(
          "episodes.read",
          { domain, episode_id: episodeId },
          undefined,
          { signal },
        ),
      );
      if (v.episode_id !== episodeId)
        throw new ApiError(200, "invalid_response");
      return v;
    },
  });
  return (
    <section aria-label="Tickets de connaissance">
      <h2>Retours à traiter</h2>
      <p>
        Les réponses contestées et les connaissances manquantes ouvrent des
        tickets. Leur traitement ne modifie pas directement le savoir publié.
      </p>
      <button
        onClick={() => {
          void list.refetch();
          if (selected) {
            void detail.refetch();
            if (episodeId) void episode.refetch();
          }
        }}
      >
        Actualiser les tickets
      </button>
      {list.error ? (
        <p role="alert">{list.error.message}</p>
      ) : list.isPending ? (
        <p role="status">Chargement des tickets…</p>
      ) : (
        <>
          {!list.data?.pages.some((p) => p.items.length) && (
            <p>Aucun ticket accessible.</p>
          )}
          <ul>
            {list.data?.pages
              .flatMap((p) => p.items)
              .map((i) => (
                <li key={i.id}>
                  <button
                    aria-pressed={selected === i.id}
                    onClick={() => setSelected(i.id)}
                  >
                    {statuses[i.status]} ·{" "}
                    {i.kind === "disputed_answer"
                      ? "Réponse contestée"
                      : "Connaissance manquante"}{" "}
                    · {i.reason || "Sans commentaire"}
                  </button>
                </li>
              ))}
          </ul>
          {list.hasNextPage && (
            <button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Tickets suivants
            </button>
          )}
          {selected && (
            <article aria-label="Détail du ticket">
              {detail.error ? (
                <p role="alert">{detail.error.message}</p>
              ) : detail.isPending ? (
                <p role="status">Chargement du ticket…</p>
              ) : (
                detail.data && (
                  <>
                    <h3>
                      {statuses[detail.data.status]} · révision{" "}
                      {detail.data.revision}
                    </h3>
                    <p>{detail.data.reason || "Sans commentaire"}</p>
                    <p>Épisode : {episodeId}</p>
                    <IssueActions
                      key={selected}
                      api={api}
                      domain={domain}
                      issue={detail.data}
                      onChanged={async () => {
                        await Promise.all([detail.refetch(), list.refetch()]);
                      }}
                    />
                    {episode.error ? (
                      <p role="alert">{episode.error.message}</p>
                    ) : episode.isPending ? (
                      <p role="status">Chargement de la réponse concernée…</p>
                    ) : (
                      episode.data && (
                        <>
                          <h4>
                            Réponse concernée · version{" "}
                            {episode.data.served_version}
                          </h4>
                          <p>
                            {episode.data.status === "knowledge_gap"
                              ? "Connaissance insuffisante"
                              : "Extraits sourcés retrouvés"}
                          </p>
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            {episode.data.answer}
                          </p>
                          {episode.data.citations.map((c, i) => (
                            <details key={i}>
                              <summary>
                                Preuve {i + 1} : {c.title}
                              </summary>
                              <p>{c.location}</p>
                              <blockquote>{c.excerpt}</blockquote>
                            </details>
                          ))}
                        </>
                      )
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
