import { ProposalExpertReviews } from "./ProposalExpertReviews";
import { SourceEvidence } from "./SourceEvidence";
export { SourceEvidence } from "./SourceEvidence";
import { ReviewCommand, type ReviewCommandHandle } from "./ReviewCommand";
import { ReviewHistory } from "./ReviewHistory";
import { useEffect, useRef, useState, type Ref } from "react";
import { useSearchParams } from "react-router-dom";
import { proposalSelection } from "./navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type {
  Concept,
  ProposalDifference,
} from "../../../../packages/contracts/src/ProposalDifference";
import { ApiError, CortexApi } from "./client";
import { proposalLabels as labels } from "./proposal-receipt";
function validProposal(p: ProposalView): ProposalView {
  if (
    !p ||
    typeof p.id !== "string" ||
    !Object.hasOwn(labels, p.status) ||
    typeof p.reason !== "string" ||
    typeof p.digest !== "string" ||
    !p.digest ||
    !Number.isSafeInteger(p.base_version) ||
    p.base_version < 0 ||
    !Number.isSafeInteger(p.review_revision) ||
    p.review_revision < 0 ||
    !Array.isArray(p.payload)
  )
    throw new ApiError(200, "invalid_response");
  return p;
}
function ConceptState({
  value,
  api,
  domain,
  onReadError,
}: {
  value: Concept | null;
  api: CortexApi;
  domain: string;
  onReadError: (error: Error) => void;
}) {
  if (!value) return <p>Concept absent de cet état.</p>;
  return (
    <>
      <h5>{value.title}</h5>
      <p style={{ whiteSpace: "pre-wrap" }}>{value.body}</p>
      <p>Maturité : {value.maturity ?? "emerging"}</p>
      <details>
        <summary>Références des preuves ({value.sources.length})</summary>
        <p>Positions en caractères Unicode, début inclus et fin exclue.</p>
        <ul>
          {value.sources.map((s, i) => (
            <li key={i}>
              Source {s.source_id} · {s.start}–{s.end}
              <SourceEvidence
                api={api}
                domain={domain}
                source={s}
                onReadError={onReadError}
              />
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Relations ({value.links?.length ?? 0})</summary>
        <ul>
          {value.links?.map((l, i) => (
            <li key={i}>
              {l.target_id} · {l.kind} · poids {l.weight ?? 1}
              {l.primary ? " · principale" : ""}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
function validateDifference(
  d: ProposalDifference,
  id: string,
): ProposalDifference {
  if (
    !d ||
    d.proposal_id !== id ||
    !Array.isArray(d.items) ||
    !Number.isInteger(d.base_version) ||
    !Number.isInteger(d.published_version) ||
    typeof d.stale_base !== "boolean" ||
    !["accepted_before_state", "current_published_state"].includes(
      d.comparison,
    ) ||
    d.items.some(
      (i) =>
        !i ||
        typeof i.concept_id !== "string" ||
        [i.before, i.after].some(
          (c) =>
            c !== null &&
            (!c ||
              typeof c.title !== "string" ||
              typeof c.body !== "string" ||
              !Array.isArray(c.sources) ||
              (c.links !== undefined &&
                (!Array.isArray(c.links) ||
                  c.links.some(
                    (l) =>
                      !l ||
                      typeof l.target_id !== "string" ||
                      !["structural", "associative"].includes(l.kind),
                  ))) ||
              c.sources.some(
                (s) =>
                  !s ||
                  typeof s.source_id !== "string" ||
                  !Number.isInteger(s.start) ||
                  !Number.isInteger(s.end),
              )),
        ),
    )
  )
    throw new ApiError(200, "invalid_response");
  return d;
}
/** Read-only review. Approvals and publication stay behind the backend confirmation flow. */
export function ProposalWorkspace(props: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  canExpert?: boolean;
  capabilities?: readonly string[];
  decisionRef?: Ref<ReviewCommandHandle>;
  onDecisionNotice?: (message: string) => void;
  onOpenTask?: (id: string) => void;
}) {
  return <ProposalScope key={props.domain} {...props} />;
}
function ProposalScope({
  api,
  domain,
  onReconnect,
  canExpert = false,
  capabilities = [],
  decisionRef,
  onDecisionNotice,
  onOpenTask,
}: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  canExpert?: boolean;
  capabilities?: readonly string[];
  decisionRef?: Ref<ReviewCommandHandle>;
  onDecisionNotice?: (message: string) => void;
  onOpenTask?: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const { id: selected, invalid } = proposalSelection(params);
  const heading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focused = useRef("");
  const [readError, setReadError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["api", "proposals", domain],
    initialPageParam: undefined as string | undefined,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal, pageParam }) => {
      const page = await api.call("proposals.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
      });
      if (
        !page ||
        !Array.isArray(page.items) ||
        !(page.next_after === null || typeof page.next_after === "string")
      )
        throw new ApiError(200, "invalid_response");
      page.items.forEach(validProposal);
      return page;
    },
    getNextPageParam: (page) => page.next_after ?? undefined,
  });
  const review = useQuery({
    queryKey: ["api", "proposal-review", domain, selected],
    enabled: !!selected && !invalid && !list.error && !!list.data,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const read = async () => {
        const p = validProposal(
          await api.call(
            "proposals.read",
            { domain, proposal_id: selected },
            undefined,
            { signal },
          ),
        );
        if (p.id !== selected) throw new ApiError(200, "invalid_response");
        return p;
      };
      const before = await read();
      const difference = validateDifference(
        await api.call(
          "proposals.diff",
          { domain, ident: selected },
          undefined,
          { signal },
        ),
        selected,
      );
      // No snapshot fence is exposed by this contract. Bracket the comparison
      // with fresh revision reads; the trusted command still rechecks on execute.
      const after = await read();
      if (
        before.digest !== after.digest ||
        before.review_revision !== after.review_revision ||
        before.status !== after.status ||
        before.base_version !== after.base_version ||
        difference.base_version !== after.base_version
      )
        throw new ApiError(409, "review_changed");
      return { proposal: after, difference };
    },
  });
  const error = list.error || review.error || readError;
  const busy =
    refreshing ||
    list.isFetching ||
    (!!selected && !invalid && review.isFetching);
  const packet = !error && !busy && !invalid ? review.data : undefined;
  useEffect(() => {
    if (packet && heading.current && focused.current !== selected) {
      focused.current = selected;
      heading.current.focus();
    }
  }, [packet, selected]);
  function select(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("api_proposal", id);
    else next.delete("api_proposal");
    setParams(next);
    focused.current = "";
    if (!id)
      (opener.current?.isConnected
        ? opener.current
        : listHeading.current
      )?.focus();
  }
  async function refresh() {
    setRefreshing(true);
    try {
      const reads: Array<Promise<{ error: Error | null }>> = [list.refetch()];
      if (selected && !invalid) reads.push(review.refetch());
      if ((await Promise.all(reads)).every((r) => !r.error)) setReadError(null);
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <section aria-label="Revue des propositions">
      <h2 ref={listHeading} tabIndex={-1}>
        Propositions de connaissance
      </h2>
      <p>
        Consultez les changements et leurs preuves. Une proposition approuvée
        doit encore être publiée pour alimenter les réponses.
      </p>
      <button disabled={busy} onClick={() => void refresh()}>
        Actualiser les propositions
      </button>
      {(selected || invalid) && (
        <button onClick={() => select("")}>Fermer la proposition</button>
      )}
      {invalid && (
        <p role="alert">
          Ce lien de proposition est invalide. Fermez la sélection pour
          continuer.
        </p>
      )}
      {busy || list.isPending ? (
        <p role="status">Vérification des propositions…</p>
      ) : error ? (
        <div role="alert">
          <p>{error.message}</p>
          {error instanceof ApiError && error.status === 401 && onReconnect && (
            <button onClick={onReconnect}>Se reconnecter à la revue</button>
          )}
        </div>
      ) : (
        <>
          {list.data && !list.data.pages.some((p) => p.items.length) && (
            <p>Aucune proposition accessible.</p>
          )}
          <ul>
            {list.data?.pages
              .flatMap((p) => p.items)
              .map((p) => (
                <li key={p.id}>
                  <button
                    aria-pressed={selected === p.id}
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      select(p.id);
                    }}
                  >
                    {labels[p.status]} · {p.reason}
                  </button>
                </li>
              ))}
          </ul>
          {list.hasNextPage && (
            <button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Charger d’autres propositions
            </button>
          )}
          {selected &&
            !invalid &&
            (packet ? (
              <article aria-label="Détail de la proposition">
                <h3 ref={heading} tabIndex={-1}>
                  {packet.proposal.reason}
                </h3>
                <p>
                  {labels[packet.proposal.status]} · base v
                  {packet.proposal.base_version} · révision de revue{" "}
                  {packet.proposal.review_revision}
                </p>
                <p>Identifiant : {packet.proposal.id}</p>
                {packet.proposal.replaces_id && (
                  <p>Remplace la proposition {packet.proposal.replaces_id}.</p>
                )}
                <p>
                  {packet.difference.comparison === "accepted_before_state"
                    ? "Comparaison avec l’état précédant l’approbation."
                    : "Comparaison avec le savoir actuellement publié."}{" "}
                  Version publiée : {packet.difference.published_version}.
                </p>
                {packet.difference.stale_base && (
                  <p role="alert">
                    La base a évolué. Cette proposition nécessite une nouvelle
                    vérification avant décision.
                  </p>
                )}
                <p>
                  La validation contrôle la fidélité littérale des preuves et
                  l’absence de cycle. Elle ne remplace pas une revue de
                  pertinence ou de risque métier.
                </p>
                {packet.difference.items.map((i) => (
                  <section key={i.concept_id}>
                    <h4>
                      {i.before === null
                        ? "Ajout"
                        : i.after === null
                          ? "Retrait"
                          : "Modification"}{" "}
                      · {i.concept_id}
                    </h4>
                    <details>
                      <summary>Avant</summary>
                      <ConceptState
                        value={i.before}
                        api={api}
                        domain={domain}
                        onReadError={setReadError}
                      />
                    </details>
                    <details open>
                      <summary>Après</summary>
                      <ConceptState
                        value={i.after}
                        api={api}
                        domain={domain}
                        onReadError={setReadError}
                      />
                    </details>
                  </section>
                ))}
                {canExpert && (
                  <ProposalExpertReviews
                    key={`experts-${selected}-${packet.proposal.digest}-${packet.proposal.review_revision}`}
                    api={api}
                    domain={domain}
                    proposal={packet.proposal}
                    onReadError={setReadError}
                    onOpenTask={onOpenTask}
                  />
                )}
                <ReviewCommand
                  key={`command-${selected}-${packet.proposal.status}-${packet.proposal.digest}-${packet.proposal.review_revision}`}
                  ref={decisionRef}
                  api={api}
                  capabilities={capabilities}
                  onReadError={setReadError}
                  onNotice={onDecisionNotice}
                  domain={domain}
                  proposal={packet.proposal}
                />
                <ReviewHistory
                  key={`history-${selected}-${packet.proposal.review_revision}`}
                  api={api}
                  domain={domain}
                  proposal={selected}
                  expectedRevision={packet.proposal.review_revision}
                  onReadError={setReadError}
                />
              </article>
            ) : (
              <p role="status">Chargement de la comparaison…</p>
            ))}
        </>
      )}
    </section>
  );
}
