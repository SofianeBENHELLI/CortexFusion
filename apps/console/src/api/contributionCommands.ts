import { workId } from "./workSelection";
export type ContributionIntent =
  | {
      kind: "contribution_draft";
      action: "save" | "inspect" | "restore" | "recover" | "clear";
    }
  | { kind: "contribution_load"; source: string }
  | { kind: "contribution_source_search"; query: string }
  | { kind: "contribution_source_next" }
  | { kind: "contribution_source_select"; value: string }
  | { kind: "contribution_source_replace"; confirm: boolean }
  | { kind: "contribution_passage"; value: string }
  | { kind: "contribution_position"; value: string }
  | {
      kind: "contribution_prepare";
      source: string;
      title: string;
      excerpt: string;
      reason: string;
      start?: number;
    }
  | { kind: "contribution_form" }
  | { kind: "contribution_confirm" }
  | { kind: "contribution_recover" }
  | { kind: "contribution_cancel" }
  | { kind: "contribution_invalid" };
export function contributionIntent(
  input: string,
): ContributionIntent | undefined {
  const split = input.indexOf(":");
  const head = (split < 0 ? input : input.slice(0, split))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  const tail = split < 0 ? "" : input.slice(split + 1).trim();
  if (head === "passage de contribution suivant" && split < 0)
    return { kind: "contribution_passage", value: "next" };
  if (head === "passage de contribution precedent" && split < 0)
    return { kind: "contribution_passage", value: "previous" };
  if (head === "lis la source de contribution a")
    return { kind: "contribution_passage", value: tail };
  if (head === "debut du passage a proposer")
    return { kind: "contribution_position", value: tail };
  const draftActions = {
    "enregistre mon brouillon d'ajout": "save",
    "montre mon brouillon d'ajout": "inspect",
    "utilise mon brouillon d'ajout": "restore",
    "verifie mon brouillon d'ajout": "recover",
    "efface mon brouillon d'ajout": "clear",
  } as const;
  if (head in draftActions)
    return split < 0
      ? {
          kind: "contribution_draft",
          action: draftActions[head as keyof typeof draftActions],
        }
      : { kind: "contribution_invalid" };

  if (head === "cherche une source" || head === "recherche une source")
    return { kind: "contribution_source_search", query: tail };
  if (head === "sources suivantes" && split < 0)
    return { kind: "contribution_source_next" };
  if (head === "choisis la source")
    return { kind: "contribution_source_select", value: tail };
  if (head === "confirme le changement de source" && split < 0)
    return { kind: "contribution_source_replace", confirm: true };
  if (head === "annule le changement de source" && split < 0)
    return { kind: "contribution_source_replace", confirm: false };
  if (
    ["lis la source pour proposer", "ouvre la source pour proposer"].includes(
      head,
    )
  )
    return workId(tail)
      ? { kind: "contribution_load", source: tail.toLowerCase() }
      : tail
        ? { kind: "contribution_source_search", query: tail }
        : { kind: "contribution_invalid" };
  if (head === "prepare un ajout source") {
    const [source, title, excerpt, reason, start, ...excess] = tail
      .split("|")
      .map((v) => v.trim());
    return !excess.length &&
      workId(source ?? "") &&
      !!title &&
      !!excerpt &&
      !!reason &&
      (start === undefined ||
        (/^(0|[1-9][0-9]*)$/.test(start) && Number(start) <= 2147483646))
      ? {
          kind: "contribution_prepare",
          source: source.toLowerCase(),
          title,
          excerpt,
          reason,
          ...(start === undefined ? {} : { start: Number(start) }),
        }
      : { kind: "contribution_invalid" };
  }
  if (head === "prepare mon ajout" && split < 0)
    return { kind: "contribution_form" };
  if (head === "confirme l'ajout" && split < 0)
    return { kind: "contribution_confirm" };
  if (head === "verifie l'ajout" && split < 0)
    return { kind: "contribution_recover" };
  if (head === "annule le projet d'ajout" && split < 0)
    return { kind: "contribution_cancel" };
  if (
    /^(prepare (?:un ajout source|mon ajout)|(?:confirme|verifie) l'ajout|annule le projet d'ajout)/.test(
      head,
    )
  )
    return { kind: "contribution_invalid" };
}
