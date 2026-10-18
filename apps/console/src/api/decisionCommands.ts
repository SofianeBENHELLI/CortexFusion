import type { ReviewInput } from "../../../../packages/contracts/src/ReviewInput";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { DomainVersion } from "../../../../packages/contracts/src/DomainVersion";
export type DecisionAction = ReviewInput["action"] | "approve" | "publish";
export type DecisionIntent =
  | { kind: "decision_prepare"; action: DecisionAction; reason: string }
  | { kind: "decision_cancel" }
  | { kind: "decision_inspect" }
  | { kind: "decision_confirm" };
export const decisionLabels: Record<DecisionAction, string> = {
  approve: "Approuver",
  publish: "Publier",
  reject: "Rejeter",
  defer: "Différer",
  request_changes: "Demander une correction",
  reopen: "Rouvrir",
};
export function decisionIntent(
  head: string,
  reason: string,
): DecisionIntent | null {
  const actions: Record<string, DecisionAction> = {
    "prepare l'approbation": "approve",
    "prepare la publication": "publish",
    "prepare le rejet": "reject",
    "prepare le report": "defer",
    "prepare une demande de correction": "request_changes",
    "prepare la reouverture": "reopen",
  };
  if (Object.hasOwn(actions, head))
    return { kind: "decision_prepare", action: actions[head], reason };
  if (head === "annule le projet de decision")
    return { kind: "decision_cancel" };
  if (head === "montre la commande de decision")
    return { kind: "decision_inspect" };
  if (head === "confirme la decision") return { kind: "decision_confirm" };
  return null;
}
export function availableDecisions(
  status: ProposalView["status"],
  capabilities: readonly string[],
): DecisionAction[] {
  const actions: DecisionAction[] = [];
  if (capabilities.includes("review")) {
    if (status === "ready") actions.push("defer", "request_changes", "reject");
    if (status === "deferred")
      actions.push("reopen", "request_changes", "reject");
    if (status === "changes_requested") actions.push("reject");
  }
  if (status === "ready" && capabilities.includes("approve"))
    actions.unshift("approve");
  if (status === "approved" && capabilities.includes("publish"))
    actions.push("publish");
  return actions;
}
export function decisionCommand(
  domain: string,
  proposal: ProposalView,
  version: DomainVersion,
  action: DecisionAction,
  reason: string,
  key: string,
) {
  if (
    !version ||
    !proposal ||
    !/^[a-f0-9]{64}$/.test(proposal.digest) ||
    version.domain_id !== domain ||
    ![
      version.accepted_version,
      version.published_version,
      proposal.base_version,
      proposal.review_revision,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    version.accepted_version < version.published_version
  )
    throw new Error("Versions incompatibles ; actualisez la proposition.");
  const validReason =
    reason.trim().length > 0 && Array.from(reason).length <= 2000;
  if (action !== "publish" && !validReason)
    throw new Error("Un motif de 1 à 2 000 caractères est nécessaire.");
  if (
    !availableDecisions(proposal.status, [
      "review",
      "approve",
      "publish",
    ]).includes(action)
  )
    throw new Error(
      "Cette action n’est pas disponible pour l’état de la proposition.",
    );
  if (action === "publish") {
    if (version.accepted_version !== version.published_version + 1)
      throw new Error(
        "Aucun lot accepté unique à publier. Actualisez les versions.",
      );
    return {
      name: "api_proposals_publish",
      arguments: {
        path: { domain, proposal_id: proposal.id },
        body: { expected_published_version: version.published_version },
      },
    };
  }
  if (action === "approve") {
    if (version.accepted_version !== version.published_version)
      throw new Error("Un lot accepté attend déjà sa publication.");
    if (proposal.base_version !== version.published_version)
      throw new Error(
        "La proposition repose sur une ancienne version publiée. Une nouvelle revue est nécessaire.",
      );
    return {
      name: "api_proposals_approve",
      arguments: {
        path: { domain, proposal_id: proposal.id },
        body: {
          digest: proposal.digest,
          expected_review_revision: proposal.review_revision,
          expected_version: version.published_version,
          reason: reason.trim(),
          idempotency_key: key,
        },
      },
    };
  }
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
export const decisionEffect = (action: DecisionAction) =>
  action === "approve"
    ? "Accepter cette révision dans le journal. Le savoir servi reste inchangé jusqu’à publication."
    : action === "publish"
      ? "Rendre le lot accepté consultable dans les réponses. Cette étape est distincte de l’approbation."
      : "Modifier l’état de revue et conserver le motif. Aucun savoir n’est publié.";
