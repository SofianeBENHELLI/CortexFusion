export type MissionField =
  | "title"
  | "objective"
  | "criteria"
  | "max_reads"
  | "max_chars"
  | "minutes"
  | "reason";
export type MissionIntent =
  | {
      kind:
        | "mission_controls"
        | "mission_list"
        | "mission_candidates"
        | "mission_history";
      next?: boolean;
    }
  | {
      kind:
        | "mission_evidence"
        | "mission_control"
        | "mission_open"
        | "mission_agent"
        | "mission_source"
        | "mission_source_search"
        | "mission_forget";
      value: string;
    }
  | { kind: "mission_field"; field: MissionField; value: string }
  | { kind: "mission_verify"; value?: string }
  | { kind: "mission_action"; action: "stop" | "resume" }
  | {
      kind:
        | "mission_prepare"
        | "mission_confirm"
        | "mission_cancel"
        | "mission_discard"
        | "mission_retry"
        | "mission_source_next";
    };
export function missionIntent(input: string): MissionIntent | undefined {
  const i = input.indexOf(":"),
    value = i < 0 ? "" : input.slice(i + 1).trim();
  const head = (i < 0 ? input : input.slice(0, i))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim();
  const plain: Record<string, MissionIntent> = {
    "mes controles de mission": { kind: "mission_controls" },
    "controles de mission suivants": { kind: "mission_controls", next: true },
    "mes missions d'agents": { kind: "mission_list" },
    "missions suivantes": { kind: "mission_list", next: true },
    "services pour la mission": { kind: "mission_candidates" },
    "services suivants": { kind: "mission_candidates", next: true },
    "historique de la mission": { kind: "mission_history" },
    "historique de mission suivant": { kind: "mission_history", next: true },
    "prepare la mission": { kind: "mission_prepare" },
    "confirme la mission": { kind: "mission_confirm" },
    "annule la preparation de mission": { kind: "mission_cancel" },
    "efface le projet de mission": { kind: "mission_discard" },
    "reprends l'envoi de mission": { kind: "mission_retry" },
    "verifie le recu de mission": { kind: "mission_verify" },
    "arrete la mission": { kind: "mission_action", action: "stop" },
    "reactive la mission": { kind: "mission_action", action: "resume" },
    "sources de mission suivantes": { kind: "mission_source_next" },
  };
  if (i < 0) return plain[head];
  const fields: Record<string, MissionField> = {
    "titre de mission": "title",
    "objectif de mission": "objective",
    "criteres de mission": "criteria",
    "lectures de mission": "max_reads",
    "caracteres de mission": "max_chars",
    "duree de mission": "minutes",
    "motif de mission": "reason",
  };
  if (fields[head])
    return { kind: "mission_field", field: fields[head], value };
  const names: Record<
    string,
    | "mission_evidence"
    | "mission_control"
    | "mission_open"
    | "mission_agent"
    | "mission_source"
    | "mission_source_search"
    | "mission_verify"
    | "mission_forget"
  > = {
    "lis le passage de mission": "mission_evidence",
    "lire le passage de mission": "mission_evidence",
    "ouvre le controle de mission": "mission_control",
    "ouvre la mission": "mission_open",
    "service de mission": "mission_agent",
    "source de mission": "mission_source",
    "cherche une source de mission": "mission_source_search",
    "verifie le recu de mission": "mission_verify",
    "retire la reference de mission": "mission_forget",
  };
  if (names[head]) return { kind: names[head], value };
}
