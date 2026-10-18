import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ProposalExpertReviewPage } from "../../../../packages/contracts/src/ProposalExpertReviewPage";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { expertOpinions } from "./expertCommands";
import { workId } from "./workSelection";

export function checkExpertPage(
  page: ProposalExpertReviewPage,
  proposal: ProposalView,
) {
  if (
    !page ||
    page.proposal_id !== proposal.id ||
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    !Number.isSafeInteger(page.total) ||
    page.total < page.items.length ||
    typeof page.has_more !== "boolean" ||
    !(
      page.next_after === null ||
      (typeof page.next_after === "string" && !!workId(page.next_after))
    ) ||
    page.has_more !== (page.next_after !== null) ||
    !Number.isFinite(Date.parse(page.as_of)) ||
    !Number.isSafeInteger(page.permissions_version) ||
    !Number.isSafeInteger(page.work_version) ||
    page.items.some(
      (v) =>
        !v ||
        !workId(v.id) ||
        !workId(v.task_id) ||
        v.proposal_id !== proposal.id ||
        !Object.hasOwn(expertOpinions, v.opinion) ||
        typeof v.author !== "string" ||
        typeof v.justification !== "string" ||
        Array.from(v.justification).length > 2000 ||
        !Number.isSafeInteger(v.proposal_review_revision) ||
        !["current", "stale"].includes(v.validity) ||
        !Array.isArray(v.evidence_source_ids) ||
        v.evidence_source_ids.some((id) => !workId(id)) ||
        !Number.isFinite(Date.parse(v.created_at)),
    )
  )
    throw new ApiError(200, "invalid_response");
  if (
    page.proposal_digest !== proposal.digest ||
    page.proposal_review_revision !== proposal.review_revision
  )
    throw new ApiError(409, "review_changed");
  for (const item of page.items) {
    const current =
      item.proposal_digest === proposal.digest &&
      item.proposal_review_revision === proposal.review_revision;
    if ((item.validity === "current") !== current)
      throw new ApiError(200, "invalid_response");
  }
  return page;
}
/** Only opinions from currently visible tasks and source-authorized proposals. */
export function ProposalExpertReviews({
  api,
  domain,
  proposal,
  onReadError,
  onOpenTask,
}: {
  api: CortexApi;
  domain: string;
  proposal: ProposalView;
  onReadError: (e: Error) => void;
  onOpenTask?: (id: string) => void;
}) {
  const errorHandler = useRef(onReadError);
  errorHandler.current = onReadError;
  const query = useInfiniteQuery({
    queryKey: [
      "api",
      "proposal-expert-reviews",
      domain,
      proposal.id,
      proposal.digest,
      proposal.review_revision,
    ],
    initialPageParam: undefined as string | undefined,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal, pageParam }) =>
      checkExpertPage(
        await api.call(
          "proposals.expert_reviews",
          { domain, proposal_id: proposal.id },
          undefined,
          {
            signal,
            query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
          },
        ),
        proposal,
      ),
    getNextPageParam: (last) => last.next_after ?? undefined,
  });
  useEffect(() => {
    if (query.error && !query.isFetching) errorHandler.current(query.error);
  }, [query.error, query.isFetching]);
  const pages = query.data?.pages;
  const inconsistent = !!pages?.some(
    (page) =>
      page.total !== pages[0].total ||
      page.permissions_version !== pages[0].permissions_version ||
      page.work_version !== pages[0].work_version,
  );
  const rows = pages?.flatMap((p) => p.items) ?? [];
  const duplicate = new Set(rows.map((r) => r.id)).size !== rows.length;
  useEffect(() => {
    if (inconsistent || duplicate)
      errorHandler.current(new ApiError(409, "review_changed"));
  }, [inconsistent, duplicate]);
  const hidden = query.error || inconsistent || duplicate || query.isFetching;
  return (
    <section aria-label="Avis experts sur la proposition">
      <h4>Avis des experts</h4>
      <p>
        Contributions motivées sur les tâches auxquelles vous avez accès. Elles
        ne constituent ni une approbation ni un vote collectif.
      </p>
      {query.error ? (
        <p role="alert">
          Les avis ne peuvent pas être relus. Actualisez la proposition pour
          vérifier vos accès et sa révision.
        </p>
      ) : hidden || query.isPending ? (
        <ActivityStatus>Lecture des avis experts autorisés…</ActivityStatus>
      ) : (
        <>
          <p>
            {rows.length} avis chargés sur {pages?.[0].total ?? 0} autorisés ·
            situation au {new Date(pages![0].as_of).toLocaleString()}.
          </p>
          {!rows.length && (
            <p>
              Aucun avis accessible pour cette proposition. Cela ne prouve pas
              qu’une revue a été réalisée.
            </p>
          )}
          <ul
            className="work-list-bounded"
            tabIndex={0}
            aria-label="Avis de la proposition"
          >
            {rows.map((r) => (
              <li key={r.id}>
                <strong>
                  {expertOpinions[r.opinion]} ·{" "}
                  {r.validity === "current"
                    ? "Révision actuelle"
                    : "À revalider : ancienne révision"}
                </strong>
                <p>
                  {r.author} · {new Date(r.created_at).toLocaleString()} ·
                  révision {r.proposal_review_revision}
                </p>
                <p className="draft-text">{r.justification}</p>
                <p>
                  {r.evidence_source_ids.length} preuve(s) citée(s) · avis non
                  décisionnel.
                </p>
                {onOpenTask && (
                  <button onClick={() => onOpenTask(r.task_id)}>
                    Ouvrir la tâche {r.task_id.slice(0, 8)}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button onClick={() => void query.fetchNextPage()}>
              Avis experts suivants
            </button>
          )}
        </>
      )}
    </section>
  );
}
