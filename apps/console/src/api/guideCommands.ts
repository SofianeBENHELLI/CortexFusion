export type GuideIntent =
  | { kind: "guide_list" }
  | { kind: "guide_open"; value: string };
export function guideIntent(input: string): GuideIntent | undefined {
  const parts = input.split(":"),
    head = parts[0]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  if (
    parts.length === 1 &&
    ["montre les guides mcp", "comment utiliser mon chatbot"].includes(head)
  )
    return { kind: "guide_list" };
  if (parts.length === 2 && head === "ouvre le guide mcp")
    return { kind: "guide_open", value: parts[1].trim() };
}
