import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import type { TaskProposalLinkInput } from "../../../../packages/contracts/src/TaskProposalLinkInput";
import type { ExpertReviewInput } from "../../../../packages/contracts/src/ExpertReviewInput";
import type { TaskProposalReferences } from "../../../../packages/contracts/src/TaskProposalReferences";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { expertOpinions, type ExpertChatIntent } from "./expertCommands";
import { workId } from "./workSelection";
import { proposalLabels } from "./proposal-receipt";
export interface TaskProposalActions {
  act: (intent: ExpertChatIntent) => Promise<string>;
}
type Pending =
  | {
      kind: "link";
      body: TaskProposalLinkInput;
      reason: string;
      expires: number;
    }
  | {
      kind: "opinion";
      body: ExpertReviewInput;
      reason: string;
      expires: number;
    };
function checked(v: TaskProposalReferences, task: string) {
  if (
    !v ||
    v.task_id !== task ||
    !Number.isSafeInteger(v.task_revision) ||
    v.task_revision < 1 ||
    !Array.isArray(v.items) ||
    v.items.length > 20 ||
    v.total !== v.items.length ||
    typeof v.can_link !== "boolean" ||
    v.items.some(
      (x) =>
        !workId(x.proposal_id) ||
        typeof x.digest !== "string" ||
        !Number.isSafeInteger(x.review_revision) ||
        typeof x.can_review !== "boolean",
    )
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
export const TaskProposals = forwardRef<
  TaskProposalActions,
  {
    api: CortexApi;
    domain: string;
    task: WorkTask;
    blocked: boolean;
    accessDenied?: boolean;
    onNotice: (message: string) => void;
    onHold: (value: boolean) => void;
    onOpenProposal?: (id: string) => void;
  }
>(function TaskProposals(
  {
    api,
    domain,
    task,
    blocked,
    accessDenied = false,
    onNotice,
    onHold,
    onOpenProposal,
  },
  ref,
) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState("");
  const [candidate, setCandidate] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [opinion, setOpinion] =
    useState<ExpertReviewInput["opinion"]>("supports");
  const [justification, setJustification] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [phase, setPhase] = useState<
    "prepared" | "sending" | "uncertain" | "rejected"
  >("prepared");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController>();
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const held = busy || phase === "uncertain";
  usePendingWork(
    "Avis ou lien de proposition",
    phase === "sending"
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const unavailable = blocked || held;
  useEffect(() => {
    if (pending && !busy) previewHeading.current?.focus();
  }, [pending, busy]);
  useEffect(() => {
    onHold(held);
    return () => onHold(false);
  }, [held, onHold]);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [api, domain, task.id],
  );
  const references = useQuery({
    queryKey: ["api", "task-proposals", domain, task.id],
    enabled: !accessDenied,
    queryFn: async ({ signal }) =>
      checked(
        await api.call(
          "task_proposals.list",
          { domain, task_id: task.id },
          undefined,
          { signal },
        ),
        task.id,
      ),
    retry: false,
  });
  const choices = useInfiniteQuery({
    queryKey: ["api", "expert-proposal-choices", domain],
    enabled: linkOpen && !accessDenied,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.call("proposals.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
      }),
    getNextPageParam: (v) => v.next_after ?? undefined,
    retry: false,
  });
  const proposal = useQuery({
    queryKey: ["api", "expert-proposal", domain, selected],
    enabled: !!selected && !accessDenied,
    queryFn: async ({ signal }) => {
      const p = await api.call(
        "proposals.read",
        { domain, proposal_id: selected },
        undefined,
        { signal },
      );
      if (
        !p ||
        p.id !== selected ||
        typeof p.digest !== "string" ||
        !Number.isSafeInteger(p.review_revision) ||
        !Array.isArray(p.validation?.source_ids)
      )
        throw new ApiError(200, "invalid_response");
      return p;
    },
    retry: false,
  });
  const reviews = useInfiniteQuery({
    queryKey: ["api", "expert-reviews", domain, task.id, selected],
    enabled: !!selected && !accessDenied,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const v = await api.call(
        "expert_reviews.list",
        { domain, task_id: task.id, proposal_id: selected },
        undefined,
        {
          signal,
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        },
      );
      if (
        !v ||
        v.task_id !== task.id ||
        v.proposal_id !== selected ||
        !Array.isArray(v.items) ||
        v.items.length > 50 ||
        !Number.isSafeInteger(v.total) ||
        v.has_more !== !!v.next_after ||
        v.items.some(
          (x) =>
            !workId(x.id) ||
            !Object.hasOwn(expertOpinions, x.opinion) ||
            !["current", "stale"].includes(x.validity) ||
            typeof x.justification !== "string",
        )
      )
        throw new ApiError(200, "invalid_response");
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
    retry: false,
  });
  const readError =
    accessDenied ||
    denied ||
    references.isError ||
    (!!selected && (proposal.isError || reviews.isError));
  const refs = readError ? [] : (references.data?.items ?? []);
  const current = refs.find((x) => x.proposal_id === selected);
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  function select(id: string) {
    if (unavailable) return notice("Vérifiez d’abord la commande en attente.");
    if (!refs.some((p) => p.proposal_id === id))
      return notice(
        "Choisissez une proposition liée et accessible dans cette tâche.",
      );
    setSelected(id);
    setPending(undefined);
    setJustification("");
    setSources([]);
    setDenied(false);
    return notice(
      "Proposition liée sélectionnée. Les preuves et les avis sont relus.",
    );
  }
  async function guard(work: (signal: AbortSignal) => Promise<string>) {
    if (active.current || blocked || accessDenied)
      return notice("Une autre commande de cette tâche est en cours.");
    active.current = true;
    setBusy(true);
    const seq = generation.current;
    const c = new AbortController();
    abort.current = c;
    try {
      const value = await work(c.signal);
      return seq === generation.current ? notice(value) : "Contexte fermé.";
    } catch (e) {
      if (seq !== generation.current) return "Contexte fermé.";
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setDenied(true);
      return notice(
        e instanceof ApiError
          ? e.message
          : "Lecture indisponible. Actualisez les propositions et avis.",
      );
    } finally {
      active.current = false;
      if (seq === generation.current) setBusy(false);
    }
  }
  async function prepareLink(id = candidate) {
    if (unavailable) return notice("Vérifiez d’abord la commande en attente.");
    if (!workId(id))
      return notice("Choisissez une proposition accessible à relier.");
    return guard(async (signal) => {
      const fresh = checked(
        await api.call(
          "task_proposals.list",
          { domain, task_id: task.id },
          undefined,
          { signal },
        ),
        task.id,
      );
      if (!fresh.can_link)
        return "Cette tâche ne permet plus d’ajouter une proposition.";
      const p = await api.call(
        "proposals.read",
        { domain, proposal_id: id },
        undefined,
        { signal },
      );
      if (p.id !== id || typeof p.reason !== "string")
        throw new ApiError(200, "invalid_response");
      if (fresh.items.some((x) => x.proposal_id === id))
        return "Cette proposition est déjà liée.";
      setPending({
        kind: "link",
        body: {
          proposal_id: id,
          expected_task_revision: fresh.task_revision,
          idempotency_key: crypto.randomUUID(),
        },
        reason: p.reason,
        expires: Date.now() + 300000,
      });
      setPhase("prepared");
      return "Lien préparé. Vérifiez la proposition puis confirmez le lien ; les droits sur les sources restent inchangés.";
    });
  }
  async function prepareOpinion(o = opinion, j = justification, e = sources) {
    if (unavailable) return notice("Vérifiez d’abord la commande en attente.");
    if (
      !selected ||
      !Object.hasOwn(expertOpinions, o) ||
      !j.trim() ||
      Array.from(j).length > 2000 ||
      e.length > 20 ||
      e.some((id) => !workId(id)) ||
      new Set(e).size !== e.length
    )
      return notice(
        "Choisissez une proposition liée, un avis et une justification de 2 000 caractères maximum ; jusqu’à 20 preuves distinctes.",
      );
    return guard(async (signal) => {
      const fresh = checked(
        await api.call(
          "task_proposals.list",
          { domain, task_id: task.id },
          undefined,
          { signal },
        ),
        task.id,
      );
      if (!fresh.items.some((p) => p.proposal_id === selected && p.can_review))
        return "Cet avis requiert une tâche acceptée dont vous êtes l’affectataire, sur la proposition d’un autre auteur.";
      const p = await api.call(
        "proposals.read",
        { domain, proposal_id: selected },
        undefined,
        { signal },
      );
      if (
        p.id !== selected ||
        !Array.isArray(p.validation?.source_ids) ||
        e.some((id) => !p.validation.source_ids.includes(id))
      )
        return "Les preuves doivent appartenir à la proposition accessible.";
      setOpinion(o);
      setJustification(j);
      setSources(e);
      setPending({
        kind: "opinion",
        body: {
          proposal_id: selected,
          digest: p.digest,
          expected_review_revision: p.review_revision,
          expected_task_revision: fresh.task_revision,
          opinion: o,
          justification: j,
          evidence_source_ids: e as ExpertReviewInput["evidence_source_ids"],
          idempotency_key: crypto.randomUUID(),
        },
        reason: p.reason,
        expires: Date.now() + 300000,
      });
      setPhase("prepared");
      return "Avis expert préparé. Confirmez l’avis ; il ne décide, ne clôture et ne publie aucun savoir.";
    });
  }
  async function confirm(linking: boolean) {
    if (!pending || linking !== (pending.kind === "link"))
      return notice("Aucun projet correspondant à confirmer.");
    if (phase === "rejected")
      return notice("Relisez puis préparez un nouveau projet après le refus.");
    if (readError) return notice("Actualisez les accès avant de confirmer.");
    if (phase !== "uncertain" && Date.now() >= pending.expires) {
      setPending(undefined);
      return notice("Le projet a expiré. Relisez et préparez à nouveau.");
    }
    const p = pending;
    return guard(async (signal) => {
      setPhase("sending");
      let receipt;
      try {
        receipt =
          p.kind === "link"
            ? await api.call(
                "task_proposals.link",
                { domain, task_id: task.id },
                p.body,
                { signal },
              )
            : await api.call(
                "expert_reviews.submit",
                { domain, task_id: task.id },
                p.body,
                { signal },
              );
        if (
          !receipt ||
          receipt.task_id !== task.id ||
          !workId(receipt.event_id) ||
          receipt.revision !== p.body.expected_task_revision + 1 ||
          (p.kind === "opinion" &&
            (!("expert_review_id" in receipt) ||
              typeof receipt.expert_review_id !== "string" ||
              !workId(receipt.expert_review_id)))
        )
          throw new ApiError(200, "invalid_response");
      } catch (e) {
        setPhase(
          e instanceof ApiError &&
            [400, 401, 403, 404, 409, 422].includes(e.status)
            ? "rejected"
            : "uncertain",
        );
        if (
          !(e instanceof ApiError) ||
          ![400, 401, 403, 404, 409, 422].includes(e.status)
        )
          return "Résultat inconnu. Vérifiez le même envoi pour retrouver son reçu ; ne créez pas un nouvel avis.";
        throw e;
      }
      setPending(undefined);
      setPhase("prepared");
      setSelected(p.body.proposal_id);
      setDenied(false);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["api", "task", domain, task.id] }),
        cache.invalidateQueries({
          queryKey: ["api", "task-proposals", domain, task.id],
        }),
        cache.invalidateQueries({
          queryKey: ["api", "task-events", domain, task.id],
        }),
        cache.invalidateQueries({
          queryKey: ["api", "expert-reviews", domain, task.id],
        }),
        cache.resetQueries({ queryKey: ["api", "tasks", domain] }),
        cache.resetQueries({ queryKey: ["api", "task-notifications", domain] }),
      ]);
      return `${p.kind === "link" ? "Proposition liée" : "Avis expert enregistré"} · reçu ${receipt.event_id}. Aucune approbation ni publication.`;
    });
  }
  async function refresh() {
    if (busy) return;
    setDenied(false);
    if (!held) setPending(undefined);
    await Promise.all([
      references.refetch(),
      ...(selected
        ? [
            proposal.refetch(),
            cache.resetQueries({
              queryKey: ["api", "expert-reviews", domain, task.id, selected],
            }),
          ]
        : []),
    ]);
  }
  useImperativeHandle(ref, () => ({
    act: async (intent) => {
      switch (intent.kind) {
        case "task_proposal_link":
          return prepareLink(intent.id);
        case "task_proposal_select":
          return select(intent.id);
        case "task_opinion_prepare":
          return prepareOpinion(
            intent.opinion,
            intent.justification,
            intent.sources,
          );
        case "task_expert_confirm":
          return confirm(intent.linking);
        case "task_expert_cancel":
          if (unavailable)
            return notice("Vérifiez d’abord la commande en attente.");
          setPending(undefined);
          return notice("Projet fermé sans nouvel envoi.");
      }
    },
  }));
  return (
    <section
      aria-label="Propositions et avis de la tâche"
      className="task-proposals"
    >
      <h4>Propositions et avis d’expert</h4>
      <p>
        Un lien n’accorde aucun accès. Un avis est une contribution motivée,
        distincte d’une décision du responsable de domaine.
      </p>
      <button disabled={busy} onClick={() => void refresh()}>
        Actualiser les propositions et avis
      </button>
      {(references.isPending ||
        (selected && (proposal.isPending || reviews.isPending))) && (
        <ActivityStatus>
          Lecture des propositions et avis autorisés…
        </ActivityStatus>
      )}
      {readError ? (
        <p role="alert">
          Proposition ou avis inaccessible. Les contenus précédents sont masqués
          ; actualisez vos accès.
        </p>
      ) : (
        <>
          <p>
            {refs.length} propositions liées accessibles · au plus 20 liens par
            tâche.
          </p>
          <ul
            className="task-list work-list-bounded"
            tabIndex={0}
            aria-label="Propositions liées"
          >
            {refs.map((p) => (
              <li key={p.proposal_id}>
                <button
                  disabled={unavailable}
                  aria-pressed={p.proposal_id === selected}
                  onClick={() => select(p.proposal_id)}
                >
                  Proposition {p.proposal_id.slice(0, 8)}
                  <small>
                    Révision {p.review_revision} ·{" "}
                    {(proposalLabels as Record<string, string>)[p.status] ??
                      "État inconnu"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {references.data?.can_link && (
            <details
              open={linkOpen}
              onToggle={(e) => setLinkOpen(e.currentTarget.open)}
            >
              <summary>Lier une proposition existante</summary>
              {choices.isError ? (
                <p role="alert">
                  Impossible de lire les propositions disponibles.
                </p>
              ) : (
                <label>
                  Proposition à relier
                  <select
                    value={candidate}
                    disabled={unavailable}
                    onChange={(e) => setCandidate(e.target.value)}
                  >
                    <option value="">Choisir une proposition</option>
                    {choices.data?.pages
                      .flatMap((p) => p.items)
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.reason} · {p.id.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {choices.hasNextPage && (
                <button
                  disabled={choices.isFetchingNextPage || unavailable}
                  onClick={() => void choices.fetchNextPage()}
                >
                  Propositions suivantes
                </button>
              )}
              <button
                disabled={unavailable || !candidate || choices.isError}
                onClick={() => void prepareLink()}
              >
                Préparer le lien
              </button>
            </details>
          )}
          {current && proposal.data && (
            <article>
              <h4>Proposition sélectionnée</h4>
              <p className="draft-text">{proposal.data.reason}</p>
              <p>
                Révision {proposal.data.review_revision} ·{" "}
                {proposalLabels[proposal.data.status]}
              </p>
              {onOpenProposal && (
                <button
                  disabled={unavailable}
                  onClick={() => onOpenProposal(selected)}
                >
                  Examiner la proposition et ses preuves
                </button>
              )}
              {current.can_review ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void prepareOpinion();
                  }}
                >
                  <label>
                    Votre avis expert
                    <select
                      value={opinion}
                      disabled={unavailable}
                      onChange={(e) =>
                        setOpinion(
                          e.target.value as ExpertReviewInput["opinion"],
                        )
                      }
                    >
                      {Object.entries(expertOpinions).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Justification de l’avis
                    <textarea
                      value={justification}
                      disabled={unavailable}
                      onChange={(e) => setJustification(e.target.value)}
                    />
                  </label>
                  <fieldset disabled={unavailable}>
                    <legend>Preuves citées dans cet avis</legend>
                    {proposal.data.validation.source_ids.map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={sources.includes(id)}
                          onChange={(e) =>
                            setSources((old) =>
                              e.target.checked
                                ? [...old, id]
                                : old.filter((v) => v !== id),
                            )
                          }
                        />
                        Source {id}
                      </label>
                    ))}
                  </fieldset>
                  <p>
                    Le texte reste dans cet onglet jusqu’à l’envoi. L’avis sera
                    visible aux coordinateurs et à l’affectataire ayant aussi
                    accès aux sources.
                  </p>
                  <button disabled={unavailable}>Préparer l’avis expert</button>
                </form>
              ) : (
                <p>
                  Vous pouvez lire les avis autorisés. Leur rédaction appartient
                  à l’affectataire actif, sur la proposition d’un autre auteur.
                </p>
              )}
              <h4>Avis conservés</h4>
              <p>
                {reviews.data?.pages.flatMap((p) => p.items).length ?? 0} avis
                chargés sur {reviews.data?.pages[0].total ?? "…"}.
              </p>
              <ul
                className="task-list work-list-bounded"
                tabIndex={0}
                aria-label="Avis experts"
              >
                {reviews.data?.pages
                  .flatMap((p) => p.items)
                  .map((r) => (
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
                      <small>
                        {r.evidence_source_ids.length} preuves citées. Avis
                        conservé, sans valeur d’approbation.
                      </small>
                    </li>
                  ))}
              </ul>
              {reviews.hasNextPage && (
                <button
                  disabled={reviews.isFetchingNextPage || unavailable}
                  onClick={() => void reviews.fetchNextPage()}
                >
                  Avis suivants
                </button>
              )}
            </article>
          )}
          {pending && (
            <section
              aria-label="Projet de lien ou avis"
              className="feedback-preview"
            >
              <h4 ref={previewHeading} tabIndex={-1}>
                {pending.kind === "link"
                  ? "Relier la proposition"
                  : "Enregistrer l’avis expert"}
              </h4>
              <p>{pending.reason}</p>
              <p>
                Proposition {pending.body.proposal_id} · tâche révision{" "}
                {pending.body.expected_task_revision}
              </p>
              {pending.kind === "opinion" && (
                <>
                  <p>
                    {expertOpinions[pending.body.opinion]} · révision de
                    proposition {pending.body.expected_review_revision}
                  </p>
                  <p className="draft-text">{pending.body.justification}</p>
                  <p>
                    Preuves :{" "}
                    {pending.body.evidence_source_ids.join(", ") ||
                      "aucune citée"}
                    .
                  </p>
                </>
              )}
              <p>
                Valable jusqu’à {new Date(pending.expires).toLocaleTimeString()}
                . Aucun changement de savoir.
              </p>
              <button
                disabled={busy || blocked || phase === "rejected"}
                onClick={() => void confirm(pending.kind === "link")}
              >
                {phase === "uncertain"
                  ? "Vérifier le même envoi"
                  : pending.kind === "link"
                    ? "Confirmer le lien"
                    : "Confirmer l’avis"}
              </button>
              <button
                disabled={unavailable}
                onClick={() => setPending(undefined)}
              >
                Annuler le projet
              </button>
            </section>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
});
