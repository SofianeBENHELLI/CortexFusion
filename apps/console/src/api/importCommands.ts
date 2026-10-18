import { workId, workName } from "./workSelection";
import type { ImportCommandInput } from "../../../../packages/contracts/src/ImportCommandInput";
export type ImportChatIntent =
  | { kind: "import_select"; id: string }
  | {
      kind: "import_text";
      collection: string;
      filename: string;
      content: string;
    }
  | { kind: "import_files" }
  | { kind: "import_collection"; name: string }
  | {
      kind: "import_action";
      id: string;
      action: ImportCommandInput["action"];
      limit: number;
    }
  | {
      kind:
        | "import_confirm"
        | "import_discard"
        | "import_recover"
        | "import_refresh";
    }
  | { kind: "import_invalid" };
export function importChatIntent(input: string): ImportChatIntent | undefined {
  const [head, ...parts] = input.split(":");
  const h = workName(head).replace(/[’‘]/g, "'");
  const text = parts.join(":").trim();
  if (h === "ouvre l'import" && workId(text))
    return { kind: "import_select", id: text.toLowerCase() };
  if (h === "prepare une collection")
    return { kind: "import_collection", name: text };
  if (h === "prepare les fichiers selectionnes")
    return { kind: "import_files" };
  if (h === "prepare un import") {
    const [collection, filename, ...body] = text.split("|");
    if (workId(collection?.trim() ?? "") && filename && body.length)
      return {
        kind: "import_text",
        collection: collection.trim().toLowerCase(),
        filename: filename.trim(),
        content: body.join("|").trim(),
      };
    return { kind: "import_invalid" };
  }
  const actions: Record<string, ImportCommandInput["action"]> = {
    "prepare le traitement de l'import": "process",
    "prepare la reprise de l'import": "retry",
    "prepare l'arret de l'import": "cancel",
  };
  if (actions[h]) {
    const [id, n, ...extra] = text.split("|").map((s) => s.trim());
    const limit = n === undefined ? 1 : Number(n);
    if (
      workId(id) &&
      !extra.length &&
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= 20 &&
      (actions[h] === "process" || limit === 1)
    )
      return {
        kind: "import_action",
        id: id.toLowerCase(),
        action: actions[h],
        limit,
      };
    return { kind: "import_invalid" };
  }
  const simple: Record<string, ImportChatIntent["kind"]> = {
    "confirme l'import": "import_confirm",
    "annule le projet d'import": "import_discard",
    "verifie l'import": "import_recover",
    "actualise les imports": "import_refresh",
  };
  if (simple[h] && !text) return { kind: simple[h] } as ImportChatIntent;
  if (
    /^(ouvre l.import|prepare (un import|une collection|les fichiers|le traitement de l.import|la reprise de l.import|l.arret de l.import)|confirme l.import|verifie l.import|annule le projet d.import)/.test(
      h,
    )
  )
    return { kind: "import_invalid" };
}
export const importActionLabel = {
  process: "Traiter les éléments en attente",
  retry: "Remettre les échecs en attente",
  cancel: "Arrêter les éléments en attente",
} as const;
