import type { GuideIntent } from "./guideCommands";
import type { ActivityIntent } from "./activityCommands";
import type { MissionIntent } from "./missionCommands";
import type { ReferenceReviewIntent } from "./referenceReviewCommands";
import type { ReferenceIntent } from "./referenceCommands";
import type { DecisionIntent } from "./decisionCommands";
import { usePendingWork } from "./PendingWorkBoundary";
import { WorkOverview, type OverviewSection } from "./WorkOverview";
import type { ContributionIntent } from "./contributionCommands";
import { WorkBrief, type BriefScope } from "./WorkBrief";
import type { ImportChatIntent } from "./importCommands";
import type { CaseChatIntent } from "./caseCommands";
import type { TaskChatIntent } from "./taskCommands";
import { PersonalDraft, type PersonalDraftActions } from "./PersonalDraft";
import { createPortal } from "react-dom";
import { ActivityStatus } from "../ActivityStatus";
import { SourceEvidence, type SourceEvidenceActions } from "./SourceEvidence";
import {
  chatIntent,
  workspaceCommands,
  type DossierCommand,
} from "./workspaceCommands";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { Link, useSearchParams } from "react-router-dom";
import type { QueryResult } from "../../../../packages/contracts/src/QueryResult";
import type { FeedbackInput } from "../../../../packages/contracts/src/FeedbackInput";
import { ApiError, CortexApi } from "./client";
import {
  brainConceptHref,
  conversationSelection,
  domainViewParams,
} from "./navigation";

const inputLimit = 2000;
const overLimit = (value: string) => Array.from(value).length > inputLimit;
// These responses reject the submitted request. Network failures, 5xx, and
// unreadable success bodies remain uncertain and must keep their original key.
const rejectedRequest = (error: unknown) =>
  error instanceof ApiError &&
  [400, 401, 403, 404, 409, 422].includes(error.status);

export function validateAnswer(v: QueryResult): QueryResult {
  if (
    !v ||
    typeof v.episode_id !== "string" ||
    typeof v.answer !== "string" ||
    !Number.isInteger(v.served_version) ||
    !["knowledge_gap", "evidence_found", "context_limited"].includes(
      v.status,
    ) ||
    !Array.isArray(v.citations) ||
    v.citations.some(
      (c) =>
        !c ||
        [c.source_id, c.title, c.excerpt, c.location, c.content_hash].some(
          (s) => typeof s !== "string",
        ) ||
        !Number.isInteger(c.start) ||
        !Number.isInteger(c.end),
    ) ||
    (v.status === "evidence_found" && !v.citations.length) ||
    (v.context_passages !== undefined &&
      (!Array.isArray(v.context_passages) ||
        v.context_passages.some(
          (p) =>
            !p ||
            typeof p.concept_id !== "string" ||
            typeof p.title !== "string" ||
            typeof p.text !== "string" ||
            !Number.isInteger(p.body_start) ||
            !Number.isInteger(p.body_end) ||
            !Number.isInteger(p.body_total_chars) ||
            p.body_start < 0 ||
            p.body_end <= p.body_start ||
            p.body_end > p.body_total_chars ||
            Array.from(p.text).length !== p.body_end - p.body_start,
        )))
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
interface FeedbackState {
  comment: string;
  busy: boolean;
  error: string;
  receipt: string;
  pending?: FeedbackInput;
}
const emptyFeedback: FeedbackState = {
  comment: "",
  busy: false,
  error: "",
  receipt: "",
};
function Answer({
  domain,
  result,
  feedback,
  onComment,
  onFeedback,
  onInspect,
  canFeedback = true,
}: {
  domain: string;
  result: QueryResult;
  feedback: FeedbackState;
  onComment: (value: string) => void;
  onFeedback: (rating: FeedbackInput["rating"]) => void;
  onInspect?: () => void;
  canFeedback?: boolean;
}) {
  const [params] = useSearchParams();
  const { comment, busy, error, receipt, pending } = feedback;
  const commentTooLong = overLimit(comment);
  const feedbackTrigger = useRef<HTMLButtonElement | null>(null);
  const receiptMessage = useRef<HTMLParagraphElement>(null);
  const submitFeedback = (
    rating: FeedbackInput["rating"],
    trigger: HTMLButtonElement,
  ) => {
    feedbackTrigger.current = trigger;
    onFeedback(rating);
  };
  useEffect(() => {
    if (!receipt || !feedbackTrigger.current) return;
    // A removed/disabled submit button can leave focus on BODY. Keep the
    // receipt discoverable, but do not interrupt typing elsewhere meanwhile.
    if (
      document.activeElement === document.body ||
      document.activeElement === feedbackTrigger.current
    )
      receiptMessage.current?.focus();
    feedbackTrigger.current = null;
  }, [receipt]);
  return (
    <article className="api-answer">
      <p>
        <strong>
          {result.status === "context_limited"
            ? "Passage trop étendu pour cette réponse"
            : result.status === "knowledge_gap"
              ? "Connaissance insuffisante"
              : "Extraits sourcés retrouvés"}
        </strong>{" "}
        · version {result.served_version}
      </p>
      {result.status !== "context_limited" && (
        <Markdown
          components={{
            img: ({ alt }) => (
              <span>{alt || "Image référencée dans la source"}</span>
            ),
          }}
        >
          {result.answer}
        </Markdown>
      )}
      {result.status === "evidence_found" && (
        <p>
          Ces passages correspondent aux termes recherchés. Vérifiez leur portée
          : ils ne garantissent pas une réponse complète à la question.
        </p>
      )}
      {result.status === "knowledge_gap" && (
        <p>
          Aucun extrait ne couvre tous les termes utiles de la recherche.
          Essayez des mots-clés précis ou signalez la connaissance manquante.
        </p>
      )}
      {result.status === "context_limited" && (
        <p>
          Du savoir publié correspond à votre recherche, mais aucun passage
          complet ne tient dans le budget de cette réponse. Précisez la question
          ou consultez le concept dans BrainMap. Aucune lacune de connaissance
          n’a été créée.{" "}
          <Link to={brainConceptHref(params, domain)}>Ouvrir BrainMap</Link>
        </p>
      )}
      {result.context_passages?.some(
        (p) => p.body_end - p.body_start < p.body_total_chars,
      ) && (
        <p>
          La réponse présente des passages sélectionnés. Les fiches publiées
          restent consultables intégralement dans BrainMap.
        </p>
      )}
      {result.context_passages?.map((p, i) => (
        <p key={`${p.concept_id}-${i}`}>
          <Link to={brainConceptHref(params, domain, p.concept_id)}>
            Ouvrir la fiche actuelle : {p.title}
          </Link>
        </p>
      ))}
      {onInspect && result.citations.length > 0 && (
        <button type="button" onClick={onInspect}>
          Examiner les preuves ({result.citations.length})
        </button>
      )}
      {!onInspect &&
        result.citations.map((c, i) => (
          <details key={`${c.source_id}-${i}`}>
            <summary>
              Source {i + 1} : {c.title}
            </summary>
            <p>{c.location}</p>
            <blockquote>{c.excerpt}</blockquote>
            <small>
              Extrait {c.start}–{c.end} · source {c.source_id}
            </small>
          </details>
        ))}
      {!canFeedback ? (
        <p>Le feedback n’est pas disponible avec vos accès actuels.</p>
      ) : receipt ? (
        <p role="status" ref={receiptMessage} tabIndex={-1}>
          Retour enregistré · {receipt}
        </p>
      ) : (
        <div className="answer-feedback">
          <label>
            Commentaire sur cette réponse
            <textarea
              rows={2}
              placeholder="Un détail à préciser ? (facultatif)"
              value={comment}
              maxLength={inputLimit * 2}
              disabled={busy || !!pending}
              onChange={(e) => onComment(e.target.value)}
            />
          </label>
          {commentTooLong && (
            <p role="alert">
              Le commentaire doit contenir au plus 2 000 caractères.
            </p>
          )}
          <button
            disabled={busy || !!pending || commentTooLong}
            onClick={(e) => submitFeedback("helpful", e.currentTarget)}
          >
            Utile
          </button>
          <button
            disabled={busy || !!pending || commentTooLong}
            onClick={(e) => submitFeedback("unhelpful", e.currentTarget)}
          >
            À améliorer
          </button>
          {busy && <ActivityStatus>Enregistrement du retour…</ActivityStatus>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              {pending ? (
                <button
                  disabled={busy}
                  onClick={(e) =>
                    submitFeedback(pending.rating, e.currentTarget)
                  }
                >
                  Réessayer le même retour
                </button>
              ) : (
                <p>
                  Ce retour a été refusé. Vous pouvez modifier le commentaire
                  avant de l’envoyer à nouveau.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
export function ConversationWorkspace({
  api,
  domain,
  onReconnect,
  evidenceTarget,
  onInspectEvidence,
  onWorkspaceAction,
  canFeedback = true,
  canDraft = false,
  canBrief = false,
  canOverview = false,
  coordinate = false,
  onTaskIntent,
  onCaseIntent,
  onSelectProposal,
  onImportIntent,
  onGuideIntent,
  onActivityIntent,
  onMissionIntent,
  onReferenceReviewIntent,
  onReferenceIntent,
  onContributionIntent,
  onDecisionIntent,
  taskNotice,
}: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  evidenceTarget?: HTMLElement | null;
  onInspectEvidence?: () => void;
  onWorkspaceAction?: (command: DossierCommand) => boolean;
  canFeedback?: boolean;
  canDraft?: boolean;
  canBrief?: boolean;
  canOverview?: boolean;
  coordinate?: boolean;
  onCaseIntent?: (intent: CaseChatIntent) => Promise<string>;
  onSelectProposal?: (id: string) => boolean;
  onDecisionIntent?: (intent: DecisionIntent) => Promise<string>;
  onGuideIntent?: (intent: GuideIntent) => Promise<string>;
  onActivityIntent?: (intent: ActivityIntent) => Promise<string>;
  onMissionIntent?: (intent: MissionIntent) => Promise<string>;
  onReferenceReviewIntent?: (intent: ReferenceReviewIntent) => Promise<string>;
  onReferenceIntent?: (intent: ReferenceIntent) => Promise<string>;
  onContributionIntent?: (intent: ContributionIntent) => Promise<string>;
  onImportIntent?: (intent: ImportChatIntent) => Promise<string>;
  onTaskIntent?: (intent: TaskChatIntent) => Promise<string>;
  taskNotice?: string;
}) {
  const [briefSection, setBriefSection] = useState<OverviewSection>("auto");
  const [briefScope, setBriefScope] = useState<BriefScope>("assigned");
  const [briefVisible, setBriefVisible] = useState(true);
  const [briefRefresh, setBriefRefresh] = useState(0);
  useEffect(() => {
    if (!coordinate) setBriefScope("assigned");
  }, [coordinate]);
  const draftActions = useRef<PersonalDraftActions>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const cache = useQueryClient();
  const sourceReaders = useRef(new Map<number, SourceEvidenceActions>());
  const [evidenceEpisode, setEvidenceEpisode] = useState("");
  const [evidenceAccessError, setEvidenceAccessError] = useState<Error | null>(
    null,
  );
  const [refreshingEvidence, setRefreshingEvidence] = useState(false);
  const [commandMessage, setCommandMessage] = useState("");
  useEffect(() => {
    // A fresh dossier outcome replaces an older command preview, including after access loss.
    if (taskNotice) setCommandMessage("");
  }, [taskNotice]);
  const [preparedFeedback, setPreparedFeedback] = useState<{
    episode: string;
    rating: FeedbackInput["rating"];
    comment: string;
    conversation: string;
    expiresAt: number;
  }>();
  const [params, setParams] = useSearchParams();
  const { id: conversation, invalid: invalidConversation } =
    conversationSelection(params);
  const setConversation = (id: string, replace = false) => {
    setParams(
      (current) => {
        const next = domainViewParams(current, domain, "work");
        if (id) next.set("api_conversation", id);
        else next.delete("api_conversation");
        return next;
      },
      { replace },
    );
  };
  // Feedback belongs to its episode, including while the answer moves into
  // history or another conversation is selected. No intent moves to a new reply.
  const feedbackStates = useRef(new Map<string, FeedbackState>());
  const feedbackControllers = useRef(new Map<string, AbortController>());
  const [, renderFeedback] = useState(0);
  const updateFeedback = (episode: string, patch: Partial<FeedbackState>) => {
    feedbackStates.current.set(episode, {
      ...(feedbackStates.current.get(episode) ?? emptyFeedback),
      ...patch,
    });
    renderFeedback((revision) => revision + 1);
  };
  useEffect(
    () => () => {
      feedbackControllers.current.forEach((controller) => controller.abort());
    },
    [],
  );
  async function recordFeedback(
    episode: string,
    rating: FeedbackInput["rating"],
  ) {
    const state = feedbackStates.current.get(episode) ?? emptyFeedback;
    if (
      state.busy ||
      state.receipt ||
      (!state.pending && overLimit(state.comment))
    )
      return;
    const input = state.pending ?? {
      rating,
      explanation: state.comment,
      idempotency_key: crypto.randomUUID(),
    };
    const controller = new AbortController();
    feedbackControllers.current.set(episode, controller);
    updateFeedback(episode, { pending: input, busy: true, error: "" });
    try {
      const result = await api.call(
        "episodes.feedback",
        { domain, episode_id: episode },
        input,
        { signal: controller.signal },
      );
      if (typeof result?.feedback_id !== "string")
        throw new ApiError(200, "invalid_response");
      if (!controller.signal.aborted) {
        updateFeedback(episode, {
          receipt: result.feedback_id,
          pending: undefined,
        });
        if (input.rating === "unhelpful")
          void cache.invalidateQueries({ queryKey: ["api", "issues", domain] });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          setEvidenceAccessError(error);
        updateFeedback(episode, {
          error:
            error instanceof Error ? error.message : "Retour non confirmé.",
          ...(rejectedRequest(error) ? { pending: undefined } : {}),
        });
      }
    } finally {
      feedbackControllers.current.delete(episode);
      if (!controller.signal.aborted) updateFeedback(episode, { busy: false });
    }
  }
  const answerView = (result: QueryResult) => (
    <Answer
      key={result.episode_id}
      domain={domain}
      canFeedback={canFeedback}
      result={result}
      feedback={feedbackStates.current.get(result.episode_id) ?? emptyFeedback}
      onComment={(comment) =>
        updateFeedback(result.episode_id, { comment, error: "" })
      }
      onFeedback={(rating) => {
        if (onWorkspaceAction)
          preparePersonalFeedback(
            result.episode_id,
            rating,
            feedbackStates.current.get(result.episode_id)?.comment ?? "",
          );
        else void recordFeedback(result.episode_id, rating);
      }}
      onInspect={
        evidenceTarget
          ? () => {
              setEvidenceEpisode(result.episode_id);
              onInspectEvidence?.();
            }
          : undefined
      }
    />
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requiresReconnect, setRequiresReconnect] = useState(false);
  const [latest, setLatest] = useState<{
    conversation: string;
    question: string;
    result: QueryResult;
  }>();
  const pending = useRef<{
    question: string;
    createKey: string;
    queryKey: string;
    conversation: string;
  }>();
  usePendingWork(
    "Question dans la conversation",
    busy ? "sending" : pending.current ? "uncertain" : undefined,
  );
  const activeFeedback = [...feedbackStates.current.values()];
  usePendingWork(
    "Retour sur une réponse",
    activeFeedback.some((state) => state.busy)
      ? "sending"
      : activeFeedback.some((state) => state.pending)
        ? "uncertain"
        : undefined,
  );
  const abort = useRef<AbortController>();
  const createdSelection = useRef<string>();
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (conversation && conversation === createdSelection.current) {
      createdSelection.current = undefined;
      return;
    }
    createdSelection.current = undefined;
    setEvidenceEpisode("");
    setEvidenceAccessError(null);
    setPreparedFeedback(undefined);
    setCommandMessage("");
    // Browser Back can change scope even while the select is disabled. A late
    // result must never become the answer or retry intention of another chat.
    abort.current?.abort();
    pending.current = undefined;
    setBusy(false);
    setError("");
    setRequiresReconnect(false);
    setQuestion("");
  }, [conversation, invalidConversation]);
  const list = useInfiniteQuery({
    queryKey: ["api", "conversations", domain],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const v = await api.call("conversations.list", { domain }, undefined, {
        signal,
        query: pageParam ? { after: pageParam } : {},
      });
      if (
        !v ||
        !Array.isArray(v.items) ||
        v.items.some(
          (x) => typeof x?.id !== "string" || typeof x.title !== "string",
        ) ||
        !(v.next_after === null || typeof v.next_after === "string")
      )
        throw new ApiError(200, "invalid_response");
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
  });
  const history = useInfiniteQuery({
    queryKey: ["api", "messages", domain, conversation],
    enabled: !!conversation,
    initialPageParam: undefined as number | undefined,
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const v = await api.call(
        "conversations.messages",
        { domain, ident: conversation },
        undefined,
        { signal, query: pageParam === undefined ? {} : { after: pageParam } },
      );
      if (
        !v ||
        !Array.isArray(v.items) ||
        !(v.next_after === null || Number.isInteger(v.next_after))
      )
        throw new ApiError(200, "invalid_response");
      v.items.forEach((x) => {
        if (typeof x.question !== "string")
          throw new ApiError(200, "invalid_response");
        validateAnswer(x.result);
      });
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
  });
  async function send() {
    if (
      invalidConversation ||
      busy ||
      (!pending.current && (!question.trim() || overLimit(question.trim())))
    )
      return;
    pending.current ??= {
      question: question.trim(),
      createKey: crypto.randomUUID(),
      queryKey: crypto.randomUUID(),
      conversation,
    };
    const intent = pending.current;
    setBusy(true);
    setError("");
    setRequiresReconnect(false);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      if (!intent.conversation) {
        const c = await api.call(
          "conversations.create",
          { domain },
          {
            title: intent.question.slice(0, 100),
            idempotency_key: intent.createKey,
          },
          { signal },
        );
        if (typeof c?.id !== "string")
          throw new ApiError(200, "invalid_response");
        if (signal.aborted) return;
        intent.conversation = c.id;
        createdSelection.current = c.id;
        setConversation(c.id, true);
        void list.refetch();
      }
      const result = validateAnswer(
        await api.call(
          "conversations.query",
          { domain, ident: intent.conversation },
          { question: intent.question, idempotency_key: intent.queryKey },
          { signal },
        ),
      );
      if (signal.aborted) return;
      setLatest({
        conversation: intent.conversation,
        question: intent.question,
        result,
      });
      setQuestion("");
      pending.current = undefined;
      void cache.invalidateQueries({
        queryKey: ["api", "messages", domain, intent.conversation],
      });
      if (result.status === "knowledge_gap")
        void cache.invalidateQueries({ queryKey: ["api", "issues", domain] });
    } catch (e) {
      if (!signal.aborted) {
        if (rejectedRequest(e)) pending.current = undefined;
        setError(e instanceof Error ? e.message : "Résultat non confirmé.");
        setRequiresReconnect(e instanceof ApiError && e.status === 401);
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const messages =
    history.error || list.error || evidenceAccessError
      ? []
      : (history.data?.pages.flatMap((p) => p.items) ?? []);
  const currentLatest =
    !list.error &&
    !history.error &&
    !evidenceAccessError &&
    latest?.conversation === conversation
      ? latest
      : undefined;
  const conversations = list.data?.pages.flatMap((p) => p.items) ?? [];
  const inspected =
    evidenceEpisode &&
    !history.error &&
    !list.error &&
    !evidenceAccessError &&
    !invalidConversation
      ? [currentLatest?.result, ...messages.map((m) => m.result)].find(
          (r) => r?.episode_id === evidenceEpisode,
        )
      : undefined;
  const readableAnswers = [
    ...messages.filter(
      (m) => m.result.episode_id !== currentLatest?.result.episode_id,
    ),
    ...(currentLatest ? [currentLatest] : []),
  ];
  const readable =
    !invalidConversation &&
    !list.error &&
    !history.error &&
    !evidenceAccessError;
  const preparedState = preparedFeedback?.episode
    ? (feedbackStates.current.get(preparedFeedback.episode) ?? emptyFeedback)
    : emptyFeedback;
  function preparePersonalFeedback(
    episode: string,
    rating: FeedbackInput["rating"],
    comment: string,
  ) {
    if (preparedState.pending || preparedState.busy) {
      setCommandMessage(
        "Vérifiez d’abord le retour dont le résultat n’est pas encore confirmé.",
      );
      return;
    }
    if (!canFeedback) {
      setCommandMessage(
        "Le feedback n’est pas disponible avec vos accès actuels.",
      );
      return;
    }
    const existing = feedbackStates.current.get(episode);
    if (existing?.receipt || existing?.busy || existing?.pending) {
      setCommandMessage(
        "Cette réponse possède déjà un retour enregistré ou en attente. Consultez son reçu ou reprenez la même demande.",
      );
      return;
    }
    setPreparedFeedback({
      episode,
      rating,
      comment,
      conversation,
      expiresAt: Date.now() + 300000,
    });
    setCommandMessage(
      "Retour préparé, pas encore envoyé. Vérifiez la réponse ciblée et le commentaire.",
    );
  }
  async function confirmPreparedFeedback() {
    if (!canFeedback) {
      setCommandMessage(
        "Le feedback n’est pas disponible avec vos accès actuels.",
      );
      return;
    }
    const draft = preparedFeedback;
    if (!draft) {
      setCommandMessage(
        "Aucun retour n’est préparé. Précisez d’abord votre avis et la réponse concernée.",
      );
      return;
    }
    if (
      !readable ||
      draft.conversation !== conversation ||
      !readableAnswers.some((m) => m.result.episode_id === draft.episode)
    ) {
      setCommandMessage(
        "Choisissez une réponse accessible dans cette conversation avant de confirmer.",
      );
      return;
    }
    const prior = feedbackStates.current.get(draft.episode) ?? emptyFeedback;
    if (!prior.pending && Date.now() > draft.expiresAt) {
      setCommandMessage(
        "Ce projet de retour a expiré. Préparez à nouveau votre avis.",
      );
      return;
    }
    if (overLimit(draft.comment)) {
      setCommandMessage(
        "Le commentaire doit contenir au plus 2 000 caractères.",
      );
      return;
    }
    // A previously uncertain request keeps its original input and idempotency key.
    if (!prior.pending && !prior.receipt && !prior.busy)
      updateFeedback(draft.episode, { comment: draft.comment });
    await recordFeedback(draft.episode, draft.rating);
    if (feedbackStates.current.get(draft.episode)?.receipt)
      setCommandMessage("Retour enregistré dans votre suivi personnel.");
  }
  function cancelPreparedFeedback() {
    if (preparedState.pending || preparedState.busy) {
      setCommandMessage(
        "L’enregistrement de ce retour est en cours ou non confirmé. Vérifiez-le avec la même demande avant d’en préparer un autre.",
      );
      return;
    }
    setPreparedFeedback(undefined);
    setCommandMessage("Projet de retour fermé. Aucun nouvel envoi.");
  }
  async function submitComposer() {
    if (!onWorkspaceAction) return send();
    const intent = chatIntent(question);
    if (intent.kind === "source_read") {
      setQuestion("");
      const reader = inspected && sourceReaders.current.get(intent.index);
      if (!reader || !onWorkspaceAction("sources")) {
        setCommandMessage(
          "Examinez d’abord les preuves d’une réponse accessible, puis choisissez son numéro de source.",
        );
        return;
      }
      setCommandMessage(await reader.act(intent.action));
      return;
    }
    if (intent.kind.startsWith("decision_")) {
      setQuestion("");
      setCommandMessage(
        (await onDecisionIntent?.(intent as DecisionIntent)) ??
          "Ouvrez une proposition autorisée pour préparer une décision.",
      );
      return;
    }
    if (intent.kind.startsWith("guide_")) {
      setQuestion("");
      setCommandMessage(
        (await onGuideIntent?.(intent as GuideIntent)) ??
          "Guides indisponibles.",
      );
      return;
    }
    if (intent.kind.startsWith("activity_")) {
      setQuestion("");
      setCommandMessage(
        (await onActivityIntent?.(intent as ActivityIntent)) ??
          "La boîte de réception n’est pas disponible avec vos accès actuels.",
      );
      return;
    }
    if (intent.kind.startsWith("mission_")) {
      setQuestion("");
      setCommandMessage(
        (await onMissionIntent?.(intent as MissionIntent)) ??
          "Les missions d’agents ne sont pas disponibles ici.",
      );
      return;
    }
    if (intent.kind.startsWith("reference_review_")) {
      setQuestion("");
      setCommandMessage(
        (await onReferenceReviewIntent?.(intent as ReferenceReviewIntent)) ??
          "Les revues nominatives ne sont pas disponibles ici.",
      );
      return;
    }
    if (intent.kind.startsWith("reference_")) {
      setQuestion("");
      setCommandMessage(
        (await onReferenceIntent?.(intent as ReferenceIntent)) ??
          "Les questions de référence ne sont pas disponibles ici.",
      );
      return;
    }
    if (intent.kind.startsWith("contribution_")) {
      if (!onContributionIntent) {
        setCommandMessage("La contribution n’est pas disponible ici.");
        return;
      }
      setQuestion("");
      setCommandMessage("");
      setCommandMessage(
        await onContributionIntent(intent as ContributionIntent),
      );
      return;
    }
    if (intent.kind === "work_brief") {
      if (
        (!canBrief && !canOverview) ||
        (intent.scope === "domain" && !coordinate)
      ) {
        setCommandMessage(
          "Ce brief n’est pas disponible avec vos accès actuels.",
        );
        return;
      }
      if (
        intent.section &&
        (!canOverview ||
          (["received", "imports", "reviews", "missions"].includes(
            intent.section,
          ) &&
            !coordinate) ||
          (intent.section === "sentReviews" && !onReferenceReviewIntent))
      ) {
        setCommandMessage(
          "Cet accueil n’est pas disponible avec vos accès actuels.",
        );
        return;
      }
      setBriefSection(
        intent.section ?? (intent.scope === "domain" ? "tasks" : "auto"),
      );
      setBriefScope(intent.scope);
      setBriefVisible(true);
      setBriefRefresh((v) => v + 1);
      setQuestion("");
      setCommandMessage(
        "Lecture du travail et de son suivi autorisé. Aucun état n’est modifié.",
      );
      return;
    }
    if (intent.kind === "proposal_select") {
      const opened = onSelectProposal?.(intent.id);
      if (opened) setQuestion("");
      setCommandMessage(
        opened
          ? "Lecture de la proposition et de ses avis autorisés."
          : "Les propositions ne sont pas disponibles avec vos accès actuels.",
      );
      return;
    }
    if (intent.kind.startsWith("import_")) {
      if (!onImportIntent) {
        setCommandMessage("Les imports ne sont pas disponibles ici.");
        return;
      }
      setQuestion("");
      setCommandMessage("");
      setCommandMessage(await onImportIntent(intent as ImportChatIntent));
      return;
    }
    if (intent.kind.startsWith("case_")) {
      if (!onCaseIntent) {
        setCommandMessage("Les dossiers partagés ne sont pas disponibles ici.");
        return;
      }
      setQuestion("");
      setCommandMessage("");
      await onCaseIntent(intent as CaseChatIntent);
      return;
    }
    if (intent.kind.startsWith("task_")) {
      if (!onTaskIntent) {
        setCommandMessage("Les tâches ne sont pas disponibles ici.");
        return;
      }
      setQuestion("");
      setCommandMessage("");
      await onTaskIntent(intent as TaskChatIntent);
      return;
    }
    if (
      intent.kind === "save_draft" ||
      intent.kind === "inspect_draft" ||
      intent.kind === "apply_draft"
    ) {
      if (!canDraft || !draftActions.current) {
        setCommandMessage(
          "Les brouillons privés ne sont pas disponibles avec vos accès actuels.",
        );
        return;
      }
      if (intent.kind === "save_draft") {
        setQuestion(intent.text);
        await draftActions.current.save(intent.text);
      } else if (intent.kind === "inspect_draft") {
        setQuestion("");
        await draftActions.current.inspect();
      } else if (!draftActions.current.apply())
        setCommandMessage(
          "Affichez d’abord votre brouillon avec « reprends mon brouillon », puis choisissez le texte à utiliser.",
        );
      return;
    }
    if (intent.kind === "question") {
      if (
        preparedFeedback &&
        /^(oui|d’accord|d'accord|confirme)[.!]?$/i.test(question.trim())
      ) {
        setCommandMessage(
          "Pour confirmer le projet affiché, écrivez « confirme le retour » ou utilisez son bouton.",
        );
        return;
      }
      return send();
    }
    if (busy || pending.current) return;
    if (intent.kind === "unsupported") {
      setCommandMessage(
        "Cette action n’est pas encore disponible par chat. Consultez les actions disponibles ci-dessous ; aucune action n’a été exécutée.",
      );
      return;
    }
    if (intent.kind === "dossier") {
      if (
        intent.dossier === "sources" &&
        !evidenceEpisode &&
        readableAnswers.length === 1
      )
        setEvidenceEpisode(readableAnswers[0].result.episode_id);
      if (!onWorkspaceAction(intent.dossier)) {
        setCommandMessage(
          "Ce dossier n’est pas disponible avec vos accès actuels.",
        );
        return;
      }
      setCommandMessage(
        `${workspaceCommands[intent.dossier].label} ouvert. La conversation est conservée.`,
      );
    } else if (intent.kind === "feedback") {
      if (!readable || !readableAnswers.length) {
        setCommandMessage(
          "Ouvrez ou obtenez d’abord une réponse accessible pour préparer votre retour.",
        );
        return;
      }
      if (preparedState.pending || preparedState.busy) {
        setCommandMessage(
          "Vérifiez d’abord le retour dont le résultat n’est pas encore confirmé.",
        );
        return;
      }
      preparePersonalFeedback(
        readableAnswers.some((m) => m.result.episode_id === evidenceEpisode)
          ? evidenceEpisode
          : readableAnswers.length === 1
            ? readableAnswers[0].result.episode_id
            : "",
        intent.rating,
        intent.comment,
      );
    } else if (intent.kind === "confirm_feedback")
      await confirmPreparedFeedback();
    else cancelPreparedFeedback();
    setQuestion("");
  }
  const evidence =
    evidenceTarget &&
    createPortal(
      <div className="conversation-evidence">
        {evidenceAccessError || history.error || list.error ? (
          <div role="alert">
            <p>
              Les preuves sont masquées. Rétablissez l’accès puis relisez la
              conversation.
            </p>
            <button
              disabled={refreshingEvidence}
              onClick={async () => {
                setRefreshingEvidence(true);
                try {
                  const [a, b] = await Promise.all([
                    list.refetch(),
                    ...(conversation ? [history.refetch()] : []),
                  ]);
                  if (!a.error && !b?.error) {
                    setEvidenceAccessError(null);
                    setEvidenceEpisode("");
                  }
                } finally {
                  setRefreshingEvidence(false);
                }
              }}
            >
              Relire la conversation
            </button>
          </div>
        ) : inspected ? (
          <>
            <p>Preuves de la réponse · version {inspected.served_version}</p>
            <details>
              <summary>Lire les sources par chat</summary>
              <p>
                Lis la preuve : numéro · Lis la source : numéro · Passage source
                suivant : numéro · Passage source précédent : numéro · Reviens
                au passage cité : numéro · Ferme la lecture source : numéro.
              </p>
            </details>
            {inspected.citations.map((c, i) => (
              <article key={`${c.source_id}:${i}`}>
                <h3>
                  Source {i + 1} : {c.title}
                </h3>
                <p>{c.location}</p>
                <blockquote>{c.excerpt}</blockquote>
                <p>
                  Passage {c.start}–{c.end} · preuve enregistrée avec la
                  réponse.
                </p>
                <SourceEvidence
                  ref={(reader) => {
                    if (reader) sourceReaders.current.set(i + 1, reader);
                    else sourceReaders.current.delete(i + 1);
                  }}
                  api={api}
                  domain={domain}
                  source={c}
                  onReadError={(e) => {
                    if (
                      e instanceof ApiError &&
                      [401, 403, 404, 409].includes(e.status)
                    )
                      setEvidenceAccessError(e);
                  }}
                />
              </article>
            ))}
          </>
        ) : (
          <p>
            Posez une question puis choisissez « Examiner les preuves » pour
            lire les passages et leurs sources ici.
          </p>
        )}
      </div>,
      evidenceTarget,
    );
  return (
    <section className="api-conversations">
      <div className="conversation-flow">
        {evidence}
        {evidenceAccessError && (
          <div role="alert">
            <p>{evidenceAccessError.message}</p>
            {onReconnect && (
              <button onClick={onReconnect}>Rétablir l’accès</button>
            )}
          </div>
        )}
        <h2 className={evidenceTarget ? "sr-only" : undefined}>
          Conversations du domaine
        </h2>
        <p>
          Recherche extractive dans le savoir publié, sans appel à un modèle
          externe.
        </p>
        {(canBrief || canOverview) && (
          <>
            <button
              aria-expanded={briefVisible}
              onClick={() => {
                setBriefVisible(!briefVisible);
                setBriefRefresh((v) => v + 1);
              }}
            >
              {briefVisible ? "Masquer mon brief" : "Que dois-je faire ?"}
            </button>
            {briefVisible &&
              (canOverview ? (
                <WorkOverview
                  api={api}
                  domain={domain}
                  scope={coordinate ? briefScope : "assigned"}
                  coordinate={coordinate}
                  onScope={setBriefScope}
                  section={briefSection}
                  onSection={setBriefSection}
                  refresh={briefRefresh}
                  focus={briefRefresh > 0}
                  onTask={(id) => {
                    void onTaskIntent?.({ kind: "task_select", id });
                  }}
                  onAllTasks={() => {
                    void onTaskIntent?.({
                      kind: "task_filter",
                      active: true,
                      mine: briefScope === "assigned",
                    });
                  }}
                  onCase={(id) => {
                    void onCaseIntent?.({ kind: "case_select", id });
                  }}
                  onAllCases={(scope) => {
                    void onCaseIntent?.({ kind: "case_list", scope });
                  }}
                  onImport={(id) => {
                    void onImportIntent?.({ kind: "import_select", id });
                  }}
                  onReview={(id) => {
                    void onReferenceReviewIntent?.({
                      kind: "reference_review_open",
                      value: id,
                    });
                  }}
                  onMission={(id, controlOnly) => {
                    void onMissionIntent?.({
                      kind: controlOnly ? "mission_control" : "mission_open",
                      value: id,
                    });
                  }}
                  onAllMissions={() => {
                    void onMissionIntent?.({ kind: "mission_controls" });
                  }}
                  onAllReviews={(scope) => {
                    void onReferenceReviewIntent?.({
                      kind: "reference_review_list",
                      scope,
                    });
                  }}
                  onAllImports={() => {
                    void onImportIntent?.({ kind: "import_refresh" });
                  }}
                />
              ) : (
                <WorkBrief
                  api={api}
                  domain={domain}
                  scope={coordinate ? briefScope : "assigned"}
                  coordinate={coordinate}
                  onScope={setBriefScope}
                  refresh={briefRefresh}
                  focus={briefRefresh > 0}
                  onOpen={(id) => {
                    void onTaskIntent?.({ kind: "task_select", id });
                  }}
                  onAll={() => {
                    void onTaskIntent?.({
                      kind: "task_filter",
                      active: true,
                      mine: briefScope === "assigned",
                    });
                  }}
                />
              ))}
          </>
        )}
        {list.isPending && (
          <ActivityStatus>Chargement des conversations…</ActivityStatus>
        )}
        {list.error && (
          <div role="alert">
            {list.error.message}
            {list.error instanceof ApiError &&
              list.error.status === 401 &&
              onReconnect && (
                <button onClick={onReconnect}>
                  Se reconnecter aux conversations
                </button>
              )}
            <button onClick={() => void list.refetch()}>
              Recharger les conversations
            </button>
          </div>
        )}
        {invalidConversation && (
          <div role="alert">
            <p>
              Ce lien de conversation est invalide. Aucune conversation n’a été
              chargée.
            </p>
            <button onClick={() => setConversation("")}>
              Revenir à une nouvelle conversation
            </button>
          </div>
        )}
        <label>
          Conversation
          <select
            disabled={busy || !!pending.current}
            value={conversation}
            onChange={(e) => {
              setConversation(e.target.value);
              setLatest(undefined);
              setError("");
            }}
          >
            <option value="">Nouvelle conversation</option>
            {conversation &&
              !conversations.some((c) => c.id === conversation) && (
                <option value={conversation}>
                  Conversation sélectionnée par le lien
                </option>
              )}
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        {list.hasNextPage && (
          <button
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Plus de conversations
          </button>
        )}
        {conversation && history.isPending && (
          <ActivityStatus>Chargement des échanges…</ActivityStatus>
        )}
        {history.error && (
          <div role="alert">
            {history.error.message}
            {history.error instanceof ApiError &&
              history.error.status === 401 &&
              onReconnect && (
                <button onClick={onReconnect}>
                  Se reconnecter à cette conversation
                </button>
              )}
            <button onClick={() => void history.refetch()}>
              Recharger les échanges
            </button>
          </div>
        )}
        {messages
          .filter(
            (m) => m.result.episode_id !== currentLatest?.result.episode_id,
          )
          .map((m) => (
            <div key={m.result.episode_id}>
              <h3>{m.question}</h3>
              {answerView(m.result)}
            </div>
          ))}
        {history.hasNextPage && (
          <button
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Échanges suivants
          </button>
        )}
        {currentLatest && !history.error && (
          <div>
            <h3>{currentLatest.question}</h3>
            {answerView(currentLatest.result)}
          </div>
        )}
        {onWorkspaceAction && (
          <details className="chat-command-help">
            <summary>Actions disponibles dans le chat</summary>
            {canOverview && (
              <p>
                Accueil : « que dois-je faire ? », « montre le suivi de mes
                partages ». Responsables : « montre mes dossiers à traiter », «
                montre mes imports à traiter », « montre mes revues à traiter ».
                Auteurs : « montre le suivi de mes revues ». Ces lectures
                n’exécutent aucune action.
              </p>
            )}
            {onDecisionIntent && (
              <p>
                Sur la proposition ouverte : « Prépare l’approbation : motif »,
                « Prépare la publication », « Prépare une demande de correction
                : motif » ou « Annule le projet de décision ». La confirmation
                reste dans votre hôte MCP de confiance.
              </p>
            )}
            {onImportIntent && (
              <p>
                Imports : « prépare une collection : nom », « prépare un import
                : UUID collection | document.md | texte », « prépare les
                fichiers sélectionnés », « prépare le traitement de l’import :
                UUID | 1 », « prépare la reprise de l’import : UUID », « prépare
                l’arrêt de l’import : UUID », « confirme l’import », « vérifie
                l’import », « annule le projet d’import ».
              </p>
            )}
            {onCaseIntent && (
              <p>
                Partage volontaire : « prépare un partage : titre | extrait |
                destinataire | réponse ». Puis « confirme le partage ». « montre
                mes partages » ou « montre les dossiers partagés ». Sélectionnez
                un dossier par son identifiant ; « qualifie le dossier : ambigu
                », « clos le dossier sans changement : conclusion », « retire
                mon partage », puis « confirme le dossier ».
              </p>
            )}
            {onReferenceIntent && (
              <p>
                Questions privées : « mes questions de référence », « cherche
                une source de référence : titre », « choisis la source de
                référence : numéro », « thème de référence : … », « question de
                référence : … », « critères de référence : … », « preuve de
                référence : passage exact », « prépare la question de référence
                », « confirme la question de référence ». Reprise : « reprends
                la sauvegarde de référence ». Navigation : « ouvre la question
                de référence : numéro », « questions de référence suivantes », «
                nouvelle question de référence ». Abandon local : « annule la
                saisie de référence ».
              </p>
            )}
            {onContributionIntent && (
              <p>
                Contribution : « cherche une source : titre », « choisis la
                source : numéro », « sources suivantes ». Un changement de
                source conserve vos champs tant que vous n’avez pas dit «
                confirme le changement de source » ; « annule le changement de
                source » garde votre travail. « lis la source pour proposer :
                identifiant », « prépare un ajout sourcé : source | titre |
                passage exact | motif », ou remplissez le formulaire puis «
                prépare mon ajout ». « Confirme l’ajout », « vérifie l’ajout »,
                « annule le projet d’ajout ». Pour le travail d’un dossier
                partagé : « montre les tâches du dossier », « lie une tâche au
                dossier : nom exact ou identifiant », « délie la tâche du
                dossier : identifiant », « confirme l’association », « vérifie
                l’association » et « annule l’association ». Aucun ajout n’est
                publié automatiquement. Pour la sauvegarde privée : « enregistre
                mon brouillon d’ajout », « montre mon brouillon d’ajout », «
                utilise mon brouillon d’ajout », « vérifie mon brouillon d’ajout
                », « efface mon brouillon d’ajout ».
              </p>
            )}
            {onSelectProposal && (
              <p>
                « Ouvre la proposition : identifiant » affiche sa comparaison et
                les avis autorisés. « Montre les avis de la proposition :
                identifiant » ouvre le même dossier.
              </p>
            )}
            {onActivityIntent && (
              <p>
                Boîte de réception : Montre ma boîte de réception · Ouvre
                l’événement : numéro · Marque l’événement comme lu : numéro. La
                lecture ne change aucun état métier.
              </p>
            )}
            {onMissionIntent && (
              <p>
                Missions : « montre le suivi de mes missions », « mes missions
                d’agents » ou « mes contrôles de mission ». Une mission ouverte
                affiche ses commandes et les confirmations nécessaires ; aucun
                service n’est lancé par une lecture.
              </p>
            )}
            {onTaskIntent && (
              <p>
                Brief : « que dois-je faire ? » ou « montre le brief du domaine
                ». Tâches : « montre mes tâches », « montre mes tâches actives
                », « montre toutes les tâches du domaine », « montre mes actions
                enregistrées », « vérifie le reçu de la tâche », « vérifie
                l’action en attente : référence », « retire la référence locale
                : référence », « montre mon activité », « marque la notification
                comme lue : identifiant », « sélectionne la tâche : nom exact ou
                identifiant », « trouve le dossier partagé : nom exact », « crée
                une tâche : titre | consigne | critères | échéance ISO
                facultative », « assigne reader : motif », « accepte la tâche :
                motif », « bloque la tâche : motif », « reprends la tâche :
                motif », « soumets le résultat : compte rendu », « demande une
                modification : motif », « termine la tâche : motif », « planifie
                la tâche : haute | 2026-12-01T12:00:00Z | motif » (ou « sans »
                pour retirer l’échéance), puis « confirme la tâche ». Chaque
                action dépend de vos droits ; la création reste réservée aux
                coordinateurs. Pour une tâche sélectionnée : « lie la
                proposition : identifiant », « ouvre la proposition de la tâche
                : identifiant », « prépare un avis : favorable | justification |
                identifiants des preuves », puis « confirme le lien » ou «
                confirme l’avis ».
              </p>
            )}
            {canDraft && (
              <p>
                Brouillon privé : « enregistre ce brouillon : votre texte », «
                reprends mon brouillon » pour le comparer, puis « utilise le
                brouillon enregistré » pour le remettre dans la saisie.
              </p>
            )}
            <p>
              Commandes guidées : « montre mes signalements », « ouvre les
              propositions », « ouvre mes imports », « montre les preuves ».
            </p>
            <p>
              Pour un avis : « cette réponse est utile : votre commentaire » ou
              « cette réponse est à améliorer : votre commentaire ». Vérifiez le
              projet, puis « confirme le retour » ou « annule le retour ».
            </p>
            <p>
              La compréhension libre et les autres actions métier ne sont pas
              encore disponibles par chat. Vos autres messages interrogent le
              savoir publié.
            </p>
          </details>
        )}
        {commandMessage && <p role="status">{commandMessage}</p>}
        {taskNotice && taskNotice !== commandMessage && (
          <p role="status" className="task-chat-notice">
            {taskNotice}
          </p>
        )}
        {preparedFeedback && readable && canFeedback && (
          <section
            className="chat-command-card"
            aria-label="Projet de retour personnel"
          >
            <h3>Votre retour personnel</h3>
            <p>
              {preparedFeedback.rating === "helpful" ? "Utile" : "À améliorer"}{" "}
              · aucun partage avec une équipe.
            </p>
            <label>
              Réponse ciblée
              <select
                value={preparedFeedback.episode}
                disabled={
                  preparedState.busy ||
                  !!preparedState.pending ||
                  !!preparedState.receipt
                }
                onChange={(e) =>
                  setPreparedFeedback({
                    ...preparedFeedback,
                    episode: e.target.value,
                    expiresAt: Date.now() + 300000,
                  })
                }
              >
                <option value="">Choisir la réponse concernée</option>
                {readableAnswers.map((m) => (
                  <option
                    key={m.result.episode_id}
                    value={m.result.episode_id}
                    disabled={
                      !!feedbackStates.current.get(m.result.episode_id)
                        ?.pending ||
                      !!feedbackStates.current.get(m.result.episode_id)
                        ?.receipt ||
                      !!feedbackStates.current.get(m.result.episode_id)?.busy
                    }
                  >
                    {m.question} · v{m.result.served_version} ·{" "}
                    {m.result.episode_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <p>{preparedFeedback.comment || "Sans commentaire."}</p>
            {preparedState.receipt ? (
              <p role="status">Retour enregistré · {preparedState.receipt}</p>
            ) : (
              <>
                <p>
                  Projet valable cinq minutes. L’accès est vérifié par le
                  serveur lors de l’envoi.
                </p>
                {preparedState.error && (
                  <p role="alert">{preparedState.error}</p>
                )}
                <button
                  disabled={!preparedFeedback.episode || preparedState.busy}
                  onClick={() => void confirmPreparedFeedback()}
                >
                  {preparedState.pending
                    ? "Vérifier le même retour"
                    : "Confirmer le retour"}
                </button>
              </>
            )}
            <button
              disabled={preparedState.busy}
              onClick={cancelPreparedFeedback}
            >
              {preparedState.receipt ? "Fermer le reçu" : "Annuler le retour"}
            </button>
            {preparedState.busy && (
              <ActivityStatus>Enregistrement du retour…</ActivityStatus>
            )}
          </section>
        )}
      </div>
      <div className="conversation-compose">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitComposer();
          }}
        >
          <label>
            Votre question
            <textarea
              required
              maxLength={inputLimit * 2}
              ref={composerInput}
              value={question}
              disabled={invalidConversation || busy || !!pending.current}
              onChange={(e) => {
                setQuestion(e.target.value);
                setError("");
              }}
            />
          </label>
          {overLimit(question.trim()) && (
            <p role="alert">
              La question doit contenir au plus 2 000 caractères.
            </p>
          )}
          <button
            className="primary"
            disabled={
              invalidConversation ||
              busy ||
              !!pending.current ||
              !question.trim() ||
              overLimit(question.trim())
            }
          >
            {onWorkspaceAction ? "Envoyer" : "Poser la question"}
          </button>
        </form>
        <div
          className="conversation-support"
          role="region"
          aria-label="Sauvegarde et état de l’envoi"
          tabIndex={0}
        >
          {canDraft && !invalidConversation && (
            <PersonalDraft
              key={`${domain}:${conversation || "new"}`}
              ref={draftActions}
              api={api}
              domain={domain}
              draftKey={conversation || "new"}
              text={question}
              disabled={busy || !!pending.current}
              onApply={(text) => {
                setQuestion(text);
                composerInput.current?.focus();
              }}
            />
          )}
          {busy && (
            <ActivityStatus state="searching">
              Recherche dans le savoir publié…
            </ActivityStatus>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              {requiresReconnect && onReconnect && (
                <button onClick={onReconnect}>
                  Se reconnecter pour poser la question
                </button>
              )}
              {pending.current ? (
                <>
                  <p>
                    La demande est conservée en mémoire. Réessayer reprend la
                    même intention ; un rechargement de page perd cette reprise.
                  </p>
                  <button disabled={busy} onClick={() => void send()}>
                    Réessayer la même demande
                  </button>
                </>
              ) : (
                <p>
                  La demande a été refusée. Vous pouvez modifier la question ou
                  choisir une autre conversation.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
