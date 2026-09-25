import { useEffect, useRef, useState } from "react";
import type { IssueView } from "../../../../packages/contracts/src/IssueView";
import type { IssueDecisionInput } from "../../../../packages/contracts/src/IssueDecisionInput";
import { CortexApi, ApiError } from "./client";
const actions: Record<IssueDecisionInput["action"], string> = {
  start: "Prendre en charge",
  resolve: "Marquer résolu",
  dismiss: "Écarter le ticket",
  reopen: "Rouvrir le ticket",
};
export function IssueActions({
  api,
  domain,
  issue,
  onChanged,
}: {
  api: CortexApi;
  domain: string;
  issue: IssueView;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [conflict, setConflict] = useState(false);
  const pending = useRef<IssueDecisionInput>();
  const abort = useRef<AbortController>();
  useEffect(() => () => abort.current?.abort(), []);
  const allowed: IssueDecisionInput["action"][] =
    issue.status === "open"
      ? ["start", "resolve", "dismiss"]
      : issue.status === "in_progress"
        ? ["resolve", "dismiss"]
        : ["reopen"];
  async function decide(action: IssueDecisionInput["action"]) {
    if (!pending.current && !reason.trim()) return;
    if (
      !pending.current &&
      proposal.trim() &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        proposal.trim(),
      )
    ) {
      setError("L’identifiant de proposition doit être un UUID.");
      return;
    }
    pending.current ??= {
      action,
      reason: reason.trim(),
      expected_revision: issue.revision,
      idempotency_key: crypto.randomUUID(),
      ...((action === "start" || action === "resolve") && proposal.trim()
        ? { correction_proposal_id: proposal.trim() }
        : {}),
    };
    setBusy(true);
    setError("");
    setReceipt("");
    abort.current = new AbortController();
    try {
      const result = await api.call(
        "issues.decide",
        { domain, ident: issue.id },
        pending.current,
        { signal: abort.current.signal },
      );
      if (
        !result ||
        result.issue_id !== issue.id ||
        typeof result.id !== "string" ||
        !Number.isInteger(result.revision)
      )
        throw new ApiError(200, "invalid_response");
      pending.current = undefined;
      setReason("");
      setProposal("");
      setReceipt(result.id);
      await onChanged();
    } catch (e) {
      if (!abort.current.signal.aborted) {
        setError(e instanceof Error ? e.message : "Décision non confirmée.");
        setConflict(
          e instanceof ApiError && [403, 404, 409, 422].includes(e.status),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Traiter le ticket">
      <p>
        Cette action met à jour le suivi du ticket. Elle ne publie aucune
        connaissance. Une correction liée doit être publiée avant la résolution.
      </p>
      <label>
        Motif du traitement
        <textarea
          maxLength={2000}
          value={reason}
          disabled={busy || !!pending.current}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {(issue.status === "open" || issue.status === "in_progress") && (
        <label>
          Proposition corrective (UUID, facultatif)
          <input
            value={proposal}
            disabled={busy || !!pending.current}
            onChange={(e) => setProposal(e.target.value)}
          />
        </label>
      )}
      <p>
        Sans proposition liée, « Marquer résolu » clôt le suivi avec votre
        motif, sans attester une correction du corpus.
      </p>
      {allowed.map((action) => (
        <button
          key={action}
          disabled={busy || !!pending.current || !reason.trim()}
          onClick={() => void decide(action)}
        >
          {actions[action]}
        </button>
      ))}
      {busy && <p role="status">Enregistrement du traitement…</p>}
      {receipt && <p role="status">Traitement enregistré · {receipt}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {pending.current &&
            (conflict ? (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onChanged()
                    .then(() => {
                      pending.current = undefined;
                      setConflict(false);
                      setError("");
                    })
                    .catch(() =>
                      setError(
                        "Actualisation impossible. Réessayez avant de décider.",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Actualiser avant une nouvelle décision
              </button>
            ) : (
              <>
                <p>
                  La même intention est conservée en mémoire jusqu’à la reprise.
                  Un rechargement de page perd cette reprise.
                </p>
                <button
                  disabled={busy}
                  onClick={() => void decide(pending.current!.action)}
                >
                  Réessayer le même traitement
                </button>
              </>
            ))}
        </div>
      )}
    </section>
  );
}
