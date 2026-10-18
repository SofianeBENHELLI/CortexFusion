export type ReferenceReviewIntent =
  | { kind: "reference_review_edit" | "reference_review_discard_note" }
  | { kind: "reference_review_history"; next?: boolean }
  | { kind: "reference_review_verify"; value?: string }
  | { kind: "reference_review_forget"; value: string }
  | {
      kind: "reference_review_list";
      scope: "mine" | "assigned";
      next?: boolean;
    }
  | { kind: "reference_review_questions"; next?: boolean }
  | {
      kind:
        | "reference_review_question"
        | "reference_review_recipient"
        | "reference_review_open"
        | "reference_review_note";
      value: string;
    }
  | {
      kind: "reference_review_action";
      action: "withdraw" | "request_changes" | "ready_for_owner";
    }
  | {
      kind:
        | "reference_review_prepare"
        | "reference_review_confirm"
        | "reference_review_cancel"
        | "reference_review_retry"
        | "reference_review_recipients_next";
    };
export function referenceReviewIntent(
  input: string,
): ReferenceReviewIntent | undefined {
  const i = input.indexOf(":"),
    value = i < 0 ? "" : input.slice(i + 1).trim();
  const head = (i < 0 ? input : input.slice(0, i))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim();
  const plain: Record<string, ReferenceReviewIntent> = {
    "efface mon motif de revue": { kind: "reference_review_discard_note" },
    "reprends ma question privee": { kind: "reference_review_edit" },
    "historique de la revue": { kind: "reference_review_history" },
    "historique de revue suivant": {
      kind: "reference_review_history",
      next: true,
    },
    "mes revues de reference": { kind: "reference_review_list", scope: "mine" },
    "mes revues de reference suivantes": {
      kind: "reference_review_list",
      scope: "mine",
      next: true,
    },
    "references a relire": { kind: "reference_review_list", scope: "assigned" },
    "references a relire suivantes": {
      kind: "reference_review_list",
      scope: "assigned",
      next: true,
    },
    "questions a soumettre": { kind: "reference_review_questions" },
    "questions a soumettre suivantes": {
      kind: "reference_review_questions",
      next: true,
    },
    "responsables de reference suivants": {
      kind: "reference_review_recipients_next",
    },
    "prepare l'envoi en revue": { kind: "reference_review_prepare" },
    "confirme l'action de revue": { kind: "reference_review_confirm" },
    "annule la preparation de revue": { kind: "reference_review_cancel" },
    "reprends l'action de revue": { kind: "reference_review_retry" },
    "verifie le recu de revue": { kind: "reference_review_verify" },
    "demande des corrections de reference": {
      kind: "reference_review_action",
      action: "request_changes",
    },
    "prepare pour l'owner": {
      kind: "reference_review_action",
      action: "ready_for_owner",
    },
    "retire la revue de reference": {
      kind: "reference_review_action",
      action: "withdraw",
    },
  };
  if (i < 0) return plain[head];
  if (head === "verifie le recu de revue")
    return { kind: "reference_review_verify", value };
  if (head === "retire la reference de revue")
    return { kind: "reference_review_forget", value };
  const fields: Record<string, ReferenceReviewIntent["kind"]> = {
    "question a soumettre": "reference_review_question",
    "responsable de la revue": "reference_review_recipient",
    "ouvre la revue de reference": "reference_review_open",
    "motif de revue": "reference_review_note",
  };
  if (fields[head])
    return { kind: fields[head], value } as ReferenceReviewIntent;
}
