import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import type { QueryResult } from "../../../../packages/contracts/src/QueryResult";
import type { FeedbackInput } from "../../../../packages/contracts/src/FeedbackInput";
import { ApiError, CortexApi } from "./client";

export function validateAnswer(v: QueryResult): QueryResult {
  if (
    !v ||
    typeof v.episode_id !== "string" ||
    typeof v.answer !== "string" ||
    !Number.isInteger(v.served_version) ||
    !["knowledge_gap", "evidence_found"].includes(v.status) ||
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
    (v.status === "evidence_found" && !v.citations.length)
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
function Answer({
  result,
  api,
  domain,
}: {
  result: QueryResult;
  api: CortexApi;
  domain: string;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const pending = useRef<FeedbackInput>();
  const abort = useRef<AbortController>();
  useEffect(() => () => abort.current?.abort(), []);
  async function feedback(rating: FeedbackInput["rating"]) {
    pending.current ??= {
      rating,
      explanation: comment,
      idempotency_key: crypto.randomUUID(),
    };
    const input = pending.current;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const r = await api.call(
        "episodes.feedback",
        { domain, episode_id: result.episode_id },
        input,
        { signal: abort.current.signal },
      );
      if (typeof r?.feedback_id !== "string")
        throw new ApiError(200, "invalid_response");
      setReceipt(r.feedback_id);
      pending.current = undefined;
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : "Retour non confirmé.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="api-answer">
      <p>
        <strong>
          {result.status === "knowledge_gap"
            ? "Connaissance insuffisante"
            : "Réponse extractive sourcée"}
        </strong>{" "}
        · version {result.served_version}
      </p>
      <Markdown
        components={{
          img: ({ alt }) => (
            <span>{alt || "Image référencée dans la source"}</span>
          ),
        }}
      >
        {result.answer}
      </Markdown>
      {result.citations.map((c, i) => (
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
      {receipt ? (
        <p role="status">Retour enregistré · {receipt}</p>
      ) : (
        <div>
          <label>
            Commentaire sur cette réponse
            <textarea
              value={comment}
              disabled={busy || !!pending.current}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !!pending.current}
            onClick={() => void feedback("helpful")}
          >
            Utile
          </button>
          <button
            disabled={busy || !!pending.current}
            onClick={() => void feedback("unhelpful")}
          >
            À améliorer
          </button>
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                disabled={busy}
                onClick={() => void feedback(pending.current!.rating)}
              >
                Réessayer le même retour
              </button>
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
}: {
  api: CortexApi;
  domain: string;
}) {
  const [conversation, setConversation] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<{
    question: string;
    result: QueryResult;
  }>();
  const pending = useRef<{
    question: string;
    createKey: string;
    queryKey: string;
    conversation: string;
  }>();
  const abort = useRef<AbortController>();
  useEffect(() => () => abort.current?.abort(), []);
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
    if (!pending.current && !question.trim()) return;
    pending.current ??= {
      question: question.trim(),
      createKey: crypto.randomUUID(),
      queryKey: crypto.randomUUID(),
      conversation,
    };
    const intent = pending.current;
    setBusy(true);
    setError("");
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
        intent.conversation = c.id;
        setConversation(c.id);
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
      setLatest({ question: intent.question, result });
      setQuestion("");
      pending.current = undefined;
      if (conversation) void history.refetch();
    } catch (e) {
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : "Résultat non confirmé.");
    } finally {
      setBusy(false);
    }
  }
  const messages = history.error
    ? []
    : (history.data?.pages.flatMap((p) => p.items) ?? []);
  return (
    <section className="api-conversations">
      <h2>Conversations du domaine</h2>
      <p>
        Recherche extractive dans le savoir publié, sans appel à un modèle
        externe.
      </p>
      {list.isPending && <p role="status">Chargement des conversations…</p>}
      {list.error && (
        <div role="alert">
          {list.error.message}
          <button onClick={() => void list.refetch()}>
            Recharger les conversations
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
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((c) => (
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
        <p role="status">Chargement des échanges…</p>
      )}
      {history.error && (
        <div role="alert">
          {history.error.message}
          <button onClick={() => void history.refetch()}>
            Recharger les échanges
          </button>
        </div>
      )}
      {messages
        .filter((m) => m.result.episode_id !== latest?.result.episode_id)
        .map((m) => (
          <div key={m.result.episode_id}>
            <h3>{m.question}</h3>
            <Answer result={m.result} api={api} domain={domain} />
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
      {latest && !history.error && (
        <div>
          <h3>{latest.question}</h3>
          <Answer
            key={latest.result.episode_id}
            result={latest.result}
            api={api}
            domain={domain}
          />
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label>
          Votre question
          <textarea
            required
            value={question}
            disabled={busy || !!pending.current}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !!pending.current || !question.trim()}
        >
          Poser la question
        </button>
      </form>
      {busy && <p role="status">Traitement de la demande…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <p>
            La demande est conservée en mémoire. Réessayer reprend la même
            intention ; un rechargement de page perd cette reprise.
          </p>
          <button disabled={busy} onClick={() => void send()}>
            Réessayer la même demande
          </button>
        </div>
      )}
    </section>
  );
}
