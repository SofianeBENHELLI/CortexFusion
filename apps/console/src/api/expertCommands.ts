import type { ExpertReviewInput } from "../../../../packages/contracts/src/ExpertReviewInput";
export type ExpertChatIntent =
  | { kind: "task_proposal_link"; id: string }
  | { kind: "task_proposal_select"; id: string }
  | {
      kind: "task_opinion_prepare";
      opinion: ExpertReviewInput["opinion"];
      justification: string;
      sources: string[];
    }
  | { kind: "task_expert_confirm"; linking: boolean }
  | { kind: "task_expert_cancel" };
export const expertOpinions = {
  supports: "Favorable",
  changes_requested: "Modification nécessaire",
  insufficient_evidence: "Preuves insuffisantes",
};
export function expertChatIntent(
  value: string,
  content: string,
): ExpertChatIntent | undefined {
  if (value === "lie la proposition")
    return { kind: "task_proposal_link", id: content.trim() };
  if (value === "ouvre la proposition de la tache")
    return { kind: "task_proposal_select", id: content.trim() };
  if (value === "confirme l'avis")
    return { kind: "task_expert_confirm", linking: false };
  if (value === "confirme le lien")
    return { kind: "task_expert_confirm", linking: true };
  if (["annule le projet d'avis", "annule le projet de lien"].includes(value))
    return { kind: "task_expert_cancel" };
  if (value === "prepare un avis") {
    const [raw = "", justification = "", sources = "", ...extra] = content
      .split("|")
      .map((x) => x.trim());
    const opinion = (
      {
        favorable: "supports",
        "à revoir": "changes_requested",
        "a revoir": "changes_requested",
        "preuves insuffisantes": "insufficient_evidence",
      } as Record<string, ExpertReviewInput["opinion"]>
    )[raw.toLowerCase()];
    if (!opinion || extra.length) return undefined;
    return {
      kind: "task_opinion_prepare",
      opinion,
      justification,
      sources: sources
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
}
