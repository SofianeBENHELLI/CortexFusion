export type ActivityIntent =
  | { kind: "activity_list"; next?: boolean }
  | { kind: "activity_open" | "activity_read"; value: string }
  | { kind: "activity_retry" };
export function activityIntent(input: string): ActivityIntent | undefined {
  const at = input.indexOf(":"),
    head = (at < 0 ? input : input.slice(0, at))
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘]/g, "'")
      .toLowerCase()
      .trim(),
    value = at < 0 ? "" : input.slice(at + 1).trim();
  if (
    at < 0 &&
    [
      "montre ma boite de reception",
      "actualise ma boite de reception",
      "verifie la lecture de l'evenement",
    ].includes(head)
  )
    return { kind: "activity_list" };
  if (at < 0 && head === "activite suivante")
    return { kind: "activity_list", next: true };
  if (at < 0 && head === "reprends la meme lecture d'evenement")
    return { kind: "activity_retry" };
  if (at >= 0 && head === "ouvre l'evenement")
    return { kind: "activity_open", value };
  if (at >= 0 && head === "marque l'evenement comme lu")
    return { kind: "activity_read", value };
}
