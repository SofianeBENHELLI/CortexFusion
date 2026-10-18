import { expertChatIntent, type ExpertChatIntent } from "./expertCommands";
import type { WorkTaskCommand } from "../../../../packages/contracts/src/WorkTaskCommand";
export type TaskChatIntent =
  | ExpertChatIntent
  | {
      kind: "task_plan";
      priority: "low" | "normal" | "high";
      due: string;
      reason: string;
    }
  | { kind: "task_plan_invalid" }
  | { kind: "task_filter"; active: boolean; mine: boolean }
  | { kind: "task_receipts" }
  | { kind: "task_verify_receipt" }
  | { kind: "task_recovery_verify"; id: string }
  | { kind: "task_recovery_forget"; id: string }
  | { kind: "task_notifications" }
  | { kind: "task_notification_read"; id: string }
  | {
      kind: "task_create";
      title: string;
      instructions: string;
      criteria: string;
      due_at?: string;
    }
  | { kind: "task_select"; id: string }
  | {
      kind: "task_action";
      action: WorkTaskCommand["action"];
      reason: string;
      assignee?: string;
      result_summary?: string;
    }
  | { kind: "task_confirm" }
  | { kind: "task_cancel_preparation" };
export const taskActionLabels: Record<WorkTaskCommand["action"], string> = {
  offer: "Proposer l’affectation",
  accept: "Accepter la tâche",
  decline: "Refuser la tâche",
  block: "Signaler un blocage",
  resume: "Reprendre le travail",
  submit: "Soumettre le résultat",
  request_changes: "Demander une modification",
  complete: "Terminer la tâche",
  cancel: "Annuler la tâche",
  reopen: "Rouvrir la tâche",
};
export const taskStatuses = {
  unassigned: "À affecter",
  offered: "Affectation proposée",
  in_progress: "En cours",
  blocked: "Bloquée",
  review: "En revue",
  completed: "Terminée",
  cancelled: "Annulée",
};
export function taskChatIntent(
  head: string,
  value: string,
  content: string,
): TaskChatIntent | undefined {
  if (value === "planifie la tache") {
    const parts = content.split("|").map((s) => s.trim());
    const names: Record<string, "low" | "normal" | "high"> = {
      basse: "low",
      normale: "normal",
      haute: "high",
      low: "low",
      normal: "normal",
      high: "high",
    };
    const priority = names[parts[0]?.toLowerCase()];
    if (parts.length !== 3 || !priority || !parts[1] || !parts[2])
      return { kind: "task_plan_invalid" };
    const due = ["sans", "aucune", "sans échéance"].includes(
      parts[1].toLowerCase(),
    )
      ? ""
      : parts[1];
    return { kind: "task_plan", priority, due, reason: parts[2] };
  }
  if (
    value === "montre mes actions enregistrees" ||
    value === "montre mes recus de taches"
  )
    return { kind: "task_receipts" };
  if (
    value === "verifie l’action en attente" ||
    value === "verifie l'action en attente"
  )
    return { kind: "task_recovery_verify", id: content.trim() };
  if (value === "retire la reference locale")
    return { kind: "task_recovery_forget", id: content.trim() };
  if (value === "verifie le recu de la tache")
    return { kind: "task_verify_receipt" };
  const expert = expertChatIntent(value, content);
  if (expert) return expert;
  if (value === "montre mon activite" || value === "montre mes notifications")
    return { kind: "task_notifications" };
  if (value === "marque la notification comme lue")
    return { kind: "task_notification_read", id: content.trim() };
  const files: Record<string, { active: boolean; mine: boolean }> = {
    "montre mes taches actives": { active: true, mine: true },
    "montre toutes mes taches": { active: false, mine: true },
    "montre les taches actives du domaine": { active: true, mine: false },
    "montre toutes les taches du domaine": { active: false, mine: false },
  };
  if (files[value]) return { kind: "task_filter", ...files[value] };
  if (value === "confirme la tache" || value === "/confirmer-tache")
    return { kind: "task_confirm" };
  if (
    value === "annule le projet de tache" ||
    value === "/annuler-projet-tache"
  )
    return { kind: "task_cancel_preparation" };
  if (value === "cree une tache" || value === "prepare une tache") {
    const [
      title = "",
      instructions = "",
      criteria = "",
      due_at = "",
      ...excess
    ] = content.split("|").map((s) => s.trim());
    if (excess.length) return undefined;
    return {
      kind: "task_create",
      title,
      instructions,
      criteria,
      ...(due_at ? { due_at } : {}),
    };
  }
  if (
    ["selectionne la tache", "ouvre la tache", "trouve la tache"].includes(
      value,
    )
  )
    return { kind: "task_select", id: content.trim() };
  const assign = head.match(
    /^(?:assigne|propose la tâche à|propose la tache a)\s+(.+)$/i,
  );
  if (assign && content.trim())
    return {
      kind: "task_action",
      action: "offer",
      assignee: assign[1].trim(),
      reason: content,
    };
  const actions: Record<string, WorkTaskCommand["action"]> = {
    "accepte la tache": "accept",
    "refuse la tache": "decline",
    "bloque la tache": "block",
    "reprends la tache": "resume",
    "soumets le resultat": "submit",
    "demande une modification": "request_changes",
    "termine la tache": "complete",
    "annule la tache": "cancel",
    "rouvre la tache": "reopen",
  };
  const action = actions[value];
  if (action)
    return {
      kind: "task_action",
      action,
      reason: content,
      ...(action === "submit" ? { result_summary: content } : {}),
    };
}

export const taskEventLabels: Record<string, string> = {
  ...taskActionLabels,
  create: "Création",
  plan: "Planification révisée",
  link_proposal: "Proposition liée",
  expert_review: "Avis expert enregistré",
};

export const taskPriorityLabels = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
} as const;
