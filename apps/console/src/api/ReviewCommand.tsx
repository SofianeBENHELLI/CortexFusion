import { useState } from "react";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ReviewInput } from "../../../../packages/contracts/src/ReviewInput";
export function reviewCommand(
  domain: string,
  proposal: ProposalView,
  action: ReviewInput["action"],
  reason: string,
  key: string,
) {
  const allowed =
    proposal.status === "ready"
      ? ["reject", "defer", "request_changes"]
      : proposal.status === "deferred"
        ? ["reject", "request_changes", "reopen"]
        : proposal.status === "changes_requested"
          ? ["reject"]
          : [];
  if (!allowed.includes(action) || !reason.trim() || reason.length > 2000)
    throw new Error(
      "Décision incompatible avec l’état affiché ou motif invalide.",
    );
  return {
    name: "api_proposals_review",
    arguments: {
      path: { domain, ident: proposal.id },
      body: {
        action,
        digest: proposal.digest,
        expected_review_revision: proposal.review_revision,
        reason: reason.trim(),
        idempotency_key: key,
      },
    },
  };
}
const labels: Record<ReviewInput["action"], string> = {
  reject: "Rejeter",
  defer: "Différer",
  request_changes: "Demander une correction",
  reopen: "Rouvrir",
};
export function ReviewCommand({
  domain,
  proposal,
}: {
  domain: string;
  proposal: ProposalView;
}) {
  const [reason, setReason] = useState("");
  const [command, setCommand] = useState("");
  const allowed: ReviewInput["action"][] =
    proposal.status === "ready"
      ? ["defer", "request_changes", "reject"]
      : proposal.status === "deferred"
        ? ["reopen", "request_changes", "reject"]
        : proposal.status === "changes_requested"
          ? ["reject"]
          : [];
  if (!allowed.length) return null;
  return (
    <details>
      <summary>Préparer une décision pour l’hôte de confiance</summary>
      <p>
        La commande ci-dessous doit être examinée puis confirmée par votre hôte
        MCP. Cet écran ne signe et n’exécute aucune décision.
      </p>
      <p>
        Proposition {proposal.id} · révision {proposal.review_revision} ·
        empreinte {proposal.digest}
      </p>
      <label>
        Motif de la décision
        <textarea
          maxLength={2000}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setCommand("");
          }}
        />
      </label>
      {allowed.map((a) => (
        <button
          key={a}
          disabled={!reason.trim()}
          onClick={() =>
            setCommand(
              JSON.stringify(
                reviewCommand(domain, proposal, a, reason, crypto.randomUUID()),
                null,
                2,
              ),
            )
          }
        >
          Préparer : {labels[a]}
        </button>
      ))}
      {command && (
        <>
          <label>
            Commande MCP à faire confirmer
            <textarea readOnly rows={16} value={command} />
          </label>
          <p>
            Commande préparée, décision non exécutée. Après exécution par
            l’hôte, actualisez la proposition et son historique. Conservez cette
            même commande pour une reprise ; une nouvelle préparation crée une
            nouvelle intention.
          </p>
        </>
      )}
    </details>
  );
}
