import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type {
  Concept,
  ProposalDifference,
} from "../../../../packages/contracts/src/ProposalDifference";
import { ApiError, CortexApi } from "./client";

const labels: Record<ProposalView["status"], string> = {
  ready: "À examiner",
  approved: "Approuvée",
  published: "Publiée",
  rejected: "Rejetée",
  deferred: "Différée",
  changes_requested: "Correction demandée",
  superseded: "Remplacée",
};
function validProposal(p: ProposalView): ProposalView {
  if (
    !p ||
    typeof p.id !== "string" ||
    !Object.hasOwn(labels, p.status) ||
    typeof p.reason !== "string" ||
    !Number.isInteger(p.base_version) ||
    !Number.isInteger(p.review_revision) ||
    !Array.isArray(p.payload)
  )
    throw new ApiError(200, "invalid_response");
  return p;
}
function ConceptState({
  value,
  api,
  domain,
}: {
  value: Concept | null;
  api: CortexApi;
  domain: string;
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
              <SourceEvidence api={api} domain={domain} source={s} />
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
export function SourceEvidence({
  api,
  domain,
  source,
}: {
  api: CortexApi;
  domain: string;
  source: { source_id: string; start: number; end: number };
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "api",
      "source-evidence",
      domain,
      source.source_id,
      source.start,
      source.end,
    ],
    enabled: open,
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await api.call(
        "sources.read",
        { domain, source_id: source.source_id },
        undefined,
        { signal },
      );
      if (
        !value ||
        value.id !== source.source_id ||
        typeof value.content !== "string" ||
        typeof value.title !== "string" ||
        typeof value.location !== "string" ||
        typeof value.content_hash !== "string"
      )
        throw new ApiError(200, "invalid_response");
      const points = Array.from(value.content);
      if (
        !Number.isInteger(source.start) ||
        !Number.isInteger(source.end) ||
        source.start < 0 ||
        source.end <= source.start ||
        source.end > points.length
      )
        throw new ApiError(200, "invalid_response");
      return {
        title: value.title,
        location: value.location,
        hash: value.content_hash,
        excerpt: points.slice(source.start, source.end).join(""),
      };
    },
  });
  return (
    <div>
      <button onClick={() => setOpen(!open)}>
        {open ? "Fermer la preuve" : "Lire la preuve"}
      </button>
      {open &&
        (query.error ? (
          <div role="alert">
            {query.error.message}
            <button onClick={() => void query.refetch()}>
              Réessayer la preuve
            </button>
          </div>
        ) : query.isPending ? (
          <p role="status">Chargement de la preuve…</p>
        ) : (
          query.data && (
            <>
              <p>
                {query.data.title} · {query.data.location}
              </p>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {query.data.excerpt}
              </blockquote>
              <p>Empreinte : {query.data.hash}</p>
            </>
          )
        ))}
    </div>
  );
}
/** Read-only review. Approvals and publication stay behind the backend confirmation flow. */
export function ProposalWorkspace({
  api,
  domain,
}: {
  api: CortexApi;
  domain: string;
}) {
  const [selected, setSelected] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["api", "proposals", domain],
    initialPageParam: undefined as string | undefined,
    retry: false,
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
  const detail = useQuery({
    queryKey: ["api", "proposal", domain, selected],
    enabled: !!selected && !list.error,
    retry: false,
    queryFn: async ({ signal }) => {
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
    },
  });
  const diff = useQuery({
    queryKey: ["api", "proposal-diff", domain, selected],
    enabled: !!detail.data && !detail.error && !list.error,
    retry: false,
    queryFn: async ({ signal }) =>
      validateDifference(
        await api.call(
          "proposals.diff",
          { domain, ident: selected },
          undefined,
          { signal },
        ),
        selected,
      ),
  });
  return (
    <section aria-label="Revue des propositions">
      <h2>Propositions de connaissance</h2>
      <p>
        Consultez les changements et leurs preuves. Une proposition approuvée
        doit encore être publiée pour alimenter les réponses.
      </p>
      <button
        onClick={() => {
          void list.refetch();
          if (selected) {
            void detail.refetch();
            void diff.refetch();
          }
        }}
      >
        Actualiser les propositions
      </button>
      {list.isPending && <p role="status">Chargement des propositions…</p>}
      {list.error ? (
        <p role="alert">{list.error.message}</p>
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
                    onClick={() => setSelected(p.id)}
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
          {selected && (
            <article aria-label="Détail de la proposition">
              {detail.isPending && (
                <p role="status">Chargement de la proposition…</p>
              )}
              {detail.error ? (
                <p role="alert">{detail.error.message}</p>
              ) : (
                detail.data && (
                  <>
                    <h3>{detail.data.reason}</h3>
                    <p>
                      {labels[detail.data.status]} · base v
                      {detail.data.base_version} · révision de revue{" "}
                      {detail.data.review_revision}
                    </p>
                    <p>Identifiant : {detail.data.id}</p>
                    {detail.data.replaces_id && (
                      <p>Remplace la proposition {detail.data.replaces_id}.</p>
                    )}
                    {diff.isPending && (
                      <p role="status">Chargement de la comparaison…</p>
                    )}
                    {diff.error ? (
                      <p role="alert">{diff.error.message}</p>
                    ) : (
                      diff.data && (
                        <>
                          <p>
                            {diff.data.comparison === "accepted_before_state"
                              ? "Comparaison avec l’état précédant l’approbation."
                              : "Comparaison avec le savoir actuellement publié."}{" "}
                            Version publiée : {diff.data.published_version}.
                          </p>
                          {diff.data.stale_base && (
                            <p role="alert">
                              La base a évolué. Cette proposition nécessite une
                              nouvelle vérification avant décision.
                            </p>
                          )}
                          {diff.data.items.map((i) => (
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
                                />
                              </details>
                              <details open>
                                <summary>Après</summary>
                                <ConceptState
                                  value={i.after}
                                  api={api}
                                  domain={domain}
                                />
                              </details>
                            </section>
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
