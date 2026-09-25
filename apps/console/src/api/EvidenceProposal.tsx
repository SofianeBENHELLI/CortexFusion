import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryResult } from "../../../../packages/contracts/src/QueryResult";
import type { ProposalInput } from "../../../../packages/contracts/src/ProposalInput";
import { CortexApi, ApiError } from "./client";
/** An evidence-backed addition, never an implicit replacement of a published concept. */
export function EvidenceProposal({
  api,
  domain,
  issueId,
  citations,
}: {
  api: CortexApi;
  domain: string;
  issueId: string;
  citations: QueryResult["citations"];
}) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [definite, setDefinite] = useState(false);
  const pending = useRef<ProposalInput>();
  const abort = useRef<AbortController>();
  const cache = useQueryClient();
  useEffect(() => () => abort.current?.abort(), []);
  async function create() {
    if (
      !pending.current &&
      (!title.trim() || !reason.trim() || !citations[index])
    )
      return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      if (!pending.current) {
        const v = await api.call("domain.version", { domain }, undefined, {
          signal,
        });
        if (v.domain_id !== domain || !Number.isInteger(v.published_version))
          throw new ApiError(200, "invalid_response");
        const c = citations[index];
        pending.current = {
          base_version: v.published_version,
          reason: `Ticket ${issueId} : ${reason.trim()}`,
          idempotency_key: crypto.randomUUID(),
          changes: [
            {
              kind: "put_concept",
              concept: {
                concept_id: crypto.randomUUID(),
                title: title.trim(),
                body: c.excerpt,
                maturity: "observed",
                sources: [
                  { source_id: c.source_id, start: c.start, end: c.end },
                ],
                links: [],
              },
            },
          ],
        };
      }
      const p = await api.call(
        "proposals.create",
        { domain },
        pending.current,
        { signal },
      );
      if (!p || typeof p.id !== "string" || p.status !== "ready")
        throw new ApiError(200, "invalid_response");
      setReceipt(p.id);
      pending.current = undefined;
      await cache.invalidateQueries({ queryKey: ["api", "proposals", domain] });
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : "Création non confirmée.");
        setDefinite(
          e instanceof ApiError && [403, 404, 409, 422].includes(e.status),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  if (!citations.length)
    return (
      <p>
        Cette réponse ne fournit aucune preuve réutilisable. Importez ou
        retrouvez une source avant de préparer une proposition.
      </p>
    );
  if (receipt)
    return (
      <p role="status">
        Proposition prête à examiner : {receipt}. Le savoir publié reste
        inchangé. Le motif conserve la référence au ticket ; le ticket n’est pas
        automatiquement résolu.
      </p>
    );
  return (
    <details>
      <summary>Préparer un ajout sourcé depuis ce ticket</summary>
      <p>
        Réutilisez une preuve pour proposer un concept supplémentaire. Ce
        formulaire ne remplace pas les concepts existants et ne permet pas
        d’inventer une nouvelle affirmation. Évitez les doublons ; vérifiez le
        titre et la portée avant revue.
      </p>
      <label>
        Preuve à reprendre
        <select
          value={index}
          disabled={busy || !!pending.current}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {citations.map((c, i) => (
            <option key={i} value={i}>
              {i + 1} · {c.title}
            </option>
          ))}
        </select>
      </label>
      <blockquote>{citations[index].excerpt}</blockquote>
      <label>
        Titre du concept proposé
        <input
          maxLength={200}
          value={title}
          disabled={busy || !!pending.current}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Motif de la proposition
        <textarea
          maxLength={1800}
          value={reason}
          disabled={busy || !!pending.current}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !!pending.current || !title.trim() || !reason.trim()}
        onClick={() => void create()}
      >
        Créer la proposition à examiner
      </button>
      {busy && <p role="status">Préparation de la proposition…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {pending.current &&
            (definite ? (
              <button
                disabled={busy}
                onClick={() => {
                  pending.current = undefined;
                  setError("");
                  setDefinite(false);
                }}
              >
                Revoir le brouillon avant une nouvelle tentative
              </button>
            ) : (
              <button disabled={busy} onClick={() => void create()}>
                Réessayer la même proposition
              </button>
            ))}
        </div>
      )}
    </details>
  );
}
