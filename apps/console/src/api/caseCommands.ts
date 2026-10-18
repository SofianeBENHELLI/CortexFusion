import type { CaseTaskIntent } from "./CaseTasks";
import type { SharedCaseCommand } from "../../../../packages/contracts/src/SharedCaseCommand";
import type { SharedCaseContent } from "../../../../packages/contracts/src/SharedCaseContent";
export type CaseChatIntent =
  | CaseTaskIntent
  | { kind: "case_list"; scope: "mine" | "team" }
  | { kind: "case_select"; id: string }
  | {
      kind: "case_prepare";
      title: string;
      excerpt: string;
      recipients: string[];
      target: SharedCaseContent["target"];
    }
  | {
      kind: "case_action";
      action: SharedCaseCommand["action"];
      qualification?: SharedCaseCommand["qualification"];
      public_conclusion?: string;
    }
  | { kind: "case_confirm"; sharing: boolean }
  | { kind: "case_cancel" };
export const caseStatuses = {
  new: "À qualifier",
  qualified: "Qualifié",
  closed_without_change: "Clos sans changement",
  withdrawn: "Partage retiré",
};
export const caseActions = {
  withdraw: "Retirer mon partage",
  qualify: "Qualifier le dossier",
  close_without_change: "Clore sans changement",
  reopen: "Rouvrir le dossier",
};
export const caseTargets = {
  retrieved_evidence: "Preuves retrouvées",
  delivered_answer: "Réponse reçue",
  client_behavior: "Comportement du chatbot",
};
export const qualifications = {
  incorrect: "Incorrect",
  missing: "Manquant",
  outdated: "Périmé",
  unclear: "Peu clair",
  behavior: "Comportement",
  other: "Autre",
};
export function caseChatIntent(
  value: string,
  content: string,
): CaseChatIntent | undefined {
  if (value === "montre les taches du dossier" && !content)
    return { kind: "case_tasks_read" };
  if (value === "lie une tache au dossier" && content)
    return { kind: "case_tasks_prepare", action: "link", task: content.trim() };
  if (value === "delie la tache du dossier" && content)
    return {
      kind: "case_tasks_prepare",
      action: "unlink",
      task: content.trim(),
    };
  if (value === "confirme l'association" && !content)
    return { kind: "case_tasks_confirm" };
  if (value === "verifie l'association" && !content)
    return { kind: "case_tasks_recover" };
  if (value === "annule l'association" && !content)
    return { kind: "case_tasks_cancel" };
  if (value === "montre mes partages")
    return { kind: "case_list", scope: "mine" };
  if (value === "montre les dossiers partages")
    return { kind: "case_list", scope: "team" };
  if (
    [
      "selectionne le dossier partage",
      "ouvre le dossier partage",
      "trouve le dossier partage",
    ].includes(value)
  )
    return { kind: "case_select", id: content.trim() };
  if (value === "confirme le partage")
    return { kind: "case_confirm", sharing: true };
  if (value === "confirme le dossier")
    return { kind: "case_confirm", sharing: false };
  if (
    value === "annule le projet de partage" ||
    value === "annule le projet de dossier"
  )
    return { kind: "case_cancel" };
  if (value === "prepare un partage") {
    const [
      title = "",
      excerpt = "",
      people = "",
      target = "réponse",
      ...extra
    ] = content.split("|").map((x) => x.trim());
    const targets: Record<string, SharedCaseContent["target"]> = {
      réponse: "delivered_answer",
      reponse: "delivered_answer",
      preuves: "retrieved_evidence",
      client: "client_behavior",
    };
    if (extra.length || !targets[target.toLowerCase()]) return undefined;
    return {
      kind: "case_prepare",
      title,
      excerpt,
      recipients: people
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      target: targets[target.toLowerCase()],
    };
  }
  if (value === "retire mon partage")
    return { kind: "case_action", action: "withdraw" };
  if (value === "clos le dossier sans changement")
    return {
      kind: "case_action",
      action: "close_without_change",
      public_conclusion: content,
    };
  if (value === "rouvre le dossier")
    return {
      kind: "case_action",
      action: "reopen",
      public_conclusion: content,
    };
  if (value === "qualifie le dossier") {
    const labels: Record<string, SharedCaseCommand["qualification"]> = {
      incorrect: "incorrect",
      manquant: "missing",
      périmé: "outdated",
      perime: "outdated",
      ambigu: "unclear",
      "peu clair": "unclear",
      comportement: "behavior",
      autre: "other",
    };
    return {
      kind: "case_action",
      action: "qualify",
      qualification: labels[content.toLowerCase()],
    };
  }
}
