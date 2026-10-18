export type ReferenceIntent =
  | { kind: "reference_list"; next: boolean }
  | { kind: "reference_open"; value: string; reviewedRevision?: number }
  | { kind: "reference_verify"; value?: string }
  | { kind: "reference_forget"; value: string }
  | { kind: "reference_passage"; value: string }
  | { kind: "reference_position"; value: string }
  | { kind: "reference_source_next" }
  | { kind: "reference_source_search"; value: string }
  | { kind: "reference_source_select"; value: string }
  | {
      kind: "reference_field";
      field: "theme" | "question" | "criteria" | "excerpt";
      value: string;
    }
  | {
      kind:
        | "reference_prepare"
        | "reference_confirm"
        | "reference_retry"
        | "reference_cancel"
        | "reference_new";
    };
export function referenceIntent(input: string): ReferenceIntent | undefined {
  const split = input.indexOf(":"),
    value = split < 0 ? "" : input.slice(split + 1).trim();
  const head = (split < 0 ? input : input.slice(0, split))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim();
  const commands: Record<string, ReferenceIntent> = {
    "passage de reference suivant": {
      kind: "reference_passage",
      value: "next",
    },
    "passage de reference precedent": {
      kind: "reference_passage",
      value: "previous",
    },
    "sources de reference suivantes": { kind: "reference_source_next" },
    "mes questions de reference": { kind: "reference_list", next: false },
    "questions de reference suivantes": { kind: "reference_list", next: true },
    "nouvelle question de reference": { kind: "reference_new" },
    "prepare la question de reference": { kind: "reference_prepare" },
    "confirme la question de reference": { kind: "reference_confirm" },
    "reprends la sauvegarde de reference": { kind: "reference_retry" },
    "verifie le recu de reference": { kind: "reference_verify" },
    "annule la saisie de reference": { kind: "reference_cancel" },
  };
  if (split < 0 && commands[head]) return commands[head];
  if (split < 0) return;
  if (head === "lis la source de reference a")
    return { kind: "reference_passage", value };
  if (head === "debut de preuve de reference")
    return { kind: "reference_position", value };
  if (head === "verifie le recu de reference")
    return { kind: "reference_verify", value };
  if (head === "retire la reference de sauvegarde")
    return { kind: "reference_forget", value };
  if (head === "ouvre la question de reference")
    return { kind: "reference_open", value };
  if (head === "cherche une source de reference")
    return { kind: "reference_source_search", value };
  if (head === "choisis la source de reference")
    return { kind: "reference_source_select", value };
  const fields = {
    "theme de reference": "theme",
    "question de reference": "question",
    "criteres de reference": "criteria",
    "preuve de reference": "excerpt",
  } as const;
  if (Object.hasOwn(fields, head))
    return {
      kind: "reference_field",
      field: fields[head as keyof typeof fields],
      value,
    };
}
