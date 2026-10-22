import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { TextImportInput } from "../../../../packages/contracts/src/TextImportInput";
import type { CollectionInput } from "../../../../packages/contracts/src/CollectionInput";
import type { CollectionView } from "../../../../packages/contracts/src/CollectionView";
import type { ImportCommandInput } from "../../../../packages/contracts/src/ImportCommandInput";
import type { ImportCommandState } from "../../../../packages/contracts/src/ImportCommandState";
import { ApiError, type CortexApi } from "./client";
import { ActivityStatus } from "../ActivityStatus";
import { validateImport, importLabels } from "./import-contract";
import { importActionLabel, type ImportChatIntent } from "./importCommands";
import { workId } from "./workSelection";

type Item = { filename: string; content: string };
type Pending =
  | {
      kind: "create";
      collection: CollectionView;
      body: TextImportInput;
      hashes: string[];
      expires: number;
    }
  | { kind: "collection"; body: CollectionInput; expires: number }
  | {
      kind: "command";
      state: ImportCommandState;
      body: ImportCommandInput;
      expires: number;
    };
export interface ImportActionsHandle {
  act: (intent: ImportChatIntent) => Promise<string>;
}
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export function importState(value: ImportCommandState, id: string) {
  validateImport(value?.job, id);
  if (
    !digest(value.digest) ||
    !Array.isArray(value.allowed_actions) ||
    value.allowed_actions.some((a) => !Object.hasOwn(importActionLabel, a))
  )
    throw new ApiError(200, "invalid_response");
  return value;
}
export function checkImportItems(items: Item[]) {
  if (!items.length || items.length > 20)
    throw new Error("Sélectionnez de 1 à 20 fichiers texte.");
  const names = new Set<string>();
  for (const item of items) {
    if (
      !item.filename ||
      Array.from(item.filename).length > 200 ||
      /[\\/\x00-\x1f]/.test(item.filename) ||
      !/\.(txt|md|markdown)$/i.test(item.filename)
    )
      throw new Error(
        "Formats acceptés : .txt, .md, .markdown ; nom sans chemin, limité à 200 caractères.",
      );
    if (names.has(item.filename))
      throw new Error(
        "Deux fichiers ont le même nom : renommez-les avant l’import.",
      );
    names.add(item.filename);
    if (
      !item.content.trim() ||
      Array.from(item.content).length > 30000 ||
      item.content.includes("\0")
    )
      throw new Error(
        "Chaque texte doit être non vide, sans caractère nul et limité à 30 000 caractères. Aucun texte n’est tronqué.",
      );
  }
}
function collectionView(value: CollectionView, id?: string) {
  if (
    !value ||
    !workId(value.id) ||
    (id && value.id !== id) ||
    typeof value.name !== "string" ||
    !Array.isArray(value.allowed_subjects) ||
    value.allowed_subjects.some((s) => typeof s !== "string")
  )
    throw new ApiError(200, "invalid_response");
  return value;
}
const hashText = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);

export const ImportActions = forwardRef<
  ImportActionsHandle,
  {
    api: CortexApi;
    domain: string;
    selected: string;
    onSelect: (id: string) => void;
    onRefresh: () => Promise<unknown>;
    onNotice: (text: string) => void;
    canManage: boolean;
  }
>(function ImportActions(
  { api, domain, selected, onSelect, onRefresh, onNotice, canManage },
  ref,
) {
  const cache = useQueryClient();
  const [collection, setCollection] = useState("");
  const [newName, setNewName] = useState("");
  const [filename, setFilename] = useState("document.md");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<Item[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [phase, setPhase] = useState<
    "prepared" | "sending" | "uncertain" | "rejected"
  >("prepared");
  const [busy, setBusy] = useState(false);
  usePendingWork(
    "Import documentaire",
    phase === "sending"
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const [message, setMessage] = useState("");
  const [hidden, setHidden] = useState(false);
  const [limit, setLimit] = useState(1);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const active = useRef(false);
  const preview = useRef<HTMLHeadingElement>(null);
  const held = busy || phase === "uncertain" || phase === "sending";
  useEffect(
    () => () => {
      generation.current++;
    },
    [domain, api],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (pending && phase === "prepared") preview.current?.focus();
  }, [pending, phase]);
  const collections = useInfiniteQuery({
    queryKey: ["api", "import-collections", domain],
    enabled: canManage,
    retry: false,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const value = await api.call("collections.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
      });
      if (
        !value ||
        !Array.isArray(value.items) ||
        value.items.length > 20 ||
        (value.next_after !== null && !workId(value.next_after))
      )
        throw new ApiError(200, "invalid_response");
      value.items.forEach((v) => collectionView(v));
      return value;
    },
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  async function freshSelf() {
    const me = await api.call("identity.read", {}, undefined);
    if (
      !me ||
      typeof me.subject !== "string" ||
      !me.domains.some(
        (d) => d.id === domain && d.capabilities.includes("import_commands"),
      )
    )
      throw new ApiError(403, "forbidden");
    return me.subject;
  }
  async function prepare(
    kind: "create" | "collection" | "command",
    input?: {
      items?: Item[];
      collection?: string;
      name?: string;
      action?: ImportCommandInput["action"];
      id?: string;
      limit?: number;
    },
  ) {
    if (active.current || held)
      return notice("Vérifiez d’abord la commande d’import en cours.");
    if (!canManage)
      return notice(
        "La gestion des imports n’est pas disponible avec vos droits actuels.",
      );
    active.current = true;
    setBusy(true);
    setPending(undefined);
    setHidden(false);
    const g = generation.current;
    try {
      const subject = await freshSelf();
      let value: Pending;
      if (kind === "collection") {
        const name = (input?.name ?? newName).trim();
        if (!name || Array.from(name).length > 200)
          throw new Error("Donnez un nom de collection de 1 à 200 caractères.");
        value = {
          kind,
          body: {
            name,
            description: "",
            allowed_subjects: [subject],
            idempotency_key: crypto.randomUUID(),
          },
          expires: Date.now() + 300000,
        };
      } else if (kind === "create") {
        const items = input?.items ?? [{ filename, content }];
        checkImportItems(items);
        const cid = input?.collection ?? collection;
        if (!workId(cid))
          throw new Error("Choisissez une collection accessible.");
        const target = collectionView(
          await api.call(
            "collections.read",
            { domain, collection_id: cid },
            undefined,
          ),
          cid,
        );
        if (!target.allowed_subjects.includes(subject))
          throw new ApiError(403, "forbidden");
        const body = {
          items: items.map((item) => ({
            ...item,
            allowed_subjects: [subject],
          })),
          idempotency_key: crypto.randomUUID(),
        } as unknown as TextImportInput;
        if (new TextEncoder().encode(JSON.stringify(body)).length > 3000000)
          throw new Error(
            "Ce lot dépasse 3 Mo de données encodées. Réduisez le lot ; aucun fichier n’est tronqué.",
          );
        const hashes = await Promise.all(
          items.map((item) => hashText(item.content)),
        );
        value = {
          kind,
          collection: target,
          body,
          hashes,
          expires: Date.now() + 300000,
        };
      } else {
        const id = input?.id ?? selected;
        if (!workId(id))
          throw new Error("Ouvrez un import avant de préparer une action.");
        const state = importState(
          await api.call(
            "imports.command_state",
            { domain, import_id: id },
            undefined,
          ),
          id,
        );
        const action = input?.action!;
        if (!(state.allowed_actions as readonly string[]).includes(action))
          throw new Error(
            "Aucun élément éligible à cette action dans l’état actuel.",
          );
        const count = action === "process" ? (input?.limit ?? limit) : 1;
        if (!Number.isInteger(count) || count < 1 || count > 20)
          throw new Error("Traitez de 1 à 20 éléments par commande.");
        value = {
          kind,
          state,
          body: {
            action,
            expected_digest: state.digest,
            limit: count,
            idempotency_key: crypto.randomUUID(),
          },
          expires: Date.now() + 300000,
        };
        onSelect(id);
      }
      if (g !== generation.current) return "";
      setPending(value);
      setPhase("prepared");
      return notice(
        "Projet prêt. Vérifiez le récapitulatif puis confirmez explicitement.",
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setHidden(true);
      return notice(
        e instanceof Error ? e.message : "Préparation indisponible.",
      );
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function send(recovery = false) {
    if (active.current || busy)
      return notice("Une commande d’import est déjà en cours.");
    if (!canManage)
      return notice(
        "La gestion des imports n’est pas disponible avec vos droits actuels.",
      );
    if (recovery && phase !== "uncertain")
      return notice(
        "Aucun envoi incertain à récupérer. Un projet doit d’abord être confirmé.",
      );
    if (!pending) return notice("Aucun projet d’import à confirmer.");
    if (phase === "rejected")
      return notice("Repréparez l’action après avoir actualisé son état.");
    if (phase === "uncertain" && !recovery)
      return notice(
        "Utilisez Vérifier le résultat pour reprendre exactement le même envoi.",
      );
    if (!recovery && Date.now() > pending.expires)
      return notice(
        "Ce projet a expiré après cinq minutes. Préparez-le à nouveau.",
      );
    active.current = true;
    setBusy(true);
    setPhase("sending");
    const g = generation.current;
    try {
      if (pending.kind === "collection") {
        const result = collectionView(
          await api.call("collections.create", { domain }, pending.body),
        );
        if (
          result.name !== pending.body.name ||
          result.allowed_subjects.length !== 1 ||
          result.allowed_subjects[0] !== pending.body.allowed_subjects[0]
        )
          throw new ApiError(200, "invalid_response");
        if (g !== generation.current) return "";
        setCollection(result.id);
      } else if (pending.kind === "create") {
        const result = validateImport(
          await api.call(
            "imports.create",
            { domain, collection_id: pending.collection.id },
            pending.body,
          ),
        );
        if (
          result.collection_id !== pending.collection.id ||
          result.items.length !== pending.body.items.length ||
          result.items.some(
            (item, i) => item.filename !== pending.body.items[i].filename,
          )
        )
          throw new ApiError(200, "invalid_response");
        if (g !== generation.current) return "";
        onSelect(result.id);
        setContent("");
        setFiles([]);
      } else {
        const result = await api.call(
          "imports.command",
          { domain, import_id: pending.state.job.id },
          pending.body,
        );
        if (
          !result ||
          result.import_id !== pending.state.job.id ||
          result.idempotency_key !== pending.body.idempotency_key ||
          result.action !== pending.body.action ||
          result.before_digest !== pending.body.expected_digest ||
          !digest(result.after_digest) ||
          !Number.isSafeInteger(result.affected_items) ||
          result.affected_items < 0 ||
          result.affected_items > 20
        )
          throw new ApiError(200, "invalid_response");
      }
      if (g !== generation.current) return "";
      setPending(undefined);
      setPhase("prepared");
      setHidden(false);
      const text = notice(
        "Commande d’import enregistrée. Le savoir publié reste inchangé. Relecture du suivi…",
      );
      try {
        await cache.invalidateQueries({
          queryKey: ["api", "work-overview", domain],
        });
        await cache.invalidateQueries({
          queryKey: ["api", "import-collections", domain],
        });
        await onRefresh();
        return text;
      } catch {
        return notice(
          "Commande enregistrée, mais suivi non relu. Actualisez les imports ; ne recréez pas la commande.",
        );
      }
    } catch (e) {
      if (g !== generation.current) return "";
      if (rejected(e)) {
        setPhase("rejected");
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          setHidden(true);
        return notice(
          `${e instanceof Error ? e.message : "Commande refusée."} Aucun nouvel envoi automatique.`,
        );
      }
      setPhase("uncertain");
      return notice(
        "Résultat non confirmé. Conservez ce projet et vérifiez le résultat avec la même clé ; n’en créez pas un second.",
      );
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function discard() {
    if (held)
      return notice("Vérifiez d’abord le résultat de la commande en cours.");
    setPending(undefined);
    setPhase("prepared");
    setHidden(false);
    return notice("Projet fermé sans nouvel envoi.");
  }
  useImperativeHandle(ref, () => ({
    act: async (intent) => {
      switch (intent.kind) {
        case "import_select":
          if (held) return notice("Vérifiez d’abord la commande en cours.");
          onSelect(intent.id);
          return notice("Lecture de l’import personnel sélectionné.");
        case "import_collection":
          return prepare("collection", { name: intent.name });
        case "import_text":
          return prepare("create", {
            collection: intent.collection,
            items: [{ filename: intent.filename, content: intent.content }],
          });
        case "import_files":
          return prepare("create", { items: files });
        case "import_action":
          return prepare("command", intent);
        case "import_confirm":
          return send();
        case "import_recover":
          return send(true);
        case "import_discard":
          return discard();
        case "import_refresh":
          await onRefresh();
          return notice(
            "Imports relus. Une commande non confirmée conserve sa clé et sa cible.",
          );
        default:
          return notice(
            "Commande d’import à préciser. Exemple : prépare un import : UUID collection | document.md | texte. Aucun envoi au corpus.",
          );
      }
    },
  }));
  async function loadFiles(selection: FileList | null) {
    if (held || active.current) return;
    active.current = true;
    setBusy(true);
    setFiles([]);
    const g = generation.current;
    try {
      const picked = Array.from(selection ?? []);
      if (!picked.length) return;
      if (picked.length > 20)
        throw new Error("Sélectionnez au plus 20 fichiers.");
      const loaded = await Promise.all(
        picked.map(async (f) => {
          if (f.size > 120000)
            throw new Error(
              "Un fichier dépasse 120 000 octets UTF-8 (30 000 caractères maximum).",
            );
          return {
            filename: f.name,
            content: new TextDecoder("utf-8", { fatal: true }).decode(
              await f.arrayBuffer(),
            ),
          };
        }),
      );
      checkImportItems(loaded);
      if (g === generation.current) {
        setFiles(loaded);
        notice(
          `${loaded.length} fichier(s) lus localement. Aucun envoi avant préparation et confirmation.`,
        );
      }
    } catch (e) {
      if (g === generation.current)
        notice(e instanceof Error ? e.message : "Lecture UTF-8 impossible.");
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className="import-actions"
      aria-label="Préparer et gérer les imports"
    >
      {canManage && (
        <>
          <h3>Ajouter des textes</h3>
          <p>
            Texte UTF-8 ou Markdown uniquement : 20 fichiers par lot, 30 000
            caractères par fichier. Cette première étape crée des sources
            lisibles uniquement par vous, même dans une collection partagée.
            Elle ne produit ni extraction, ni proposition, ni publication.
          </p>
          <label>
            Collection
            <select
              value={collection}
              disabled={held}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="">Choisir une collection</option>
              {!collections.error &&
                collections.data?.pages
                  .flatMap((p) => p.items)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
            </select>
          </label>
          {collections.isFetching && (
            <ActivityStatus>Lecture des collections…</ActivityStatus>
          )}
          {collections.error && (
            <p role="alert">
              Collections inaccessibles.{" "}
              <button onClick={() => void collections.refetch()}>
                Relire les collections
              </button>
            </p>
          )}
          {collections.hasNextPage && (
            <button onClick={() => void collections.fetchNextPage()}>
              Collections suivantes
            </button>
          )}
          <details>
            <summary>Créer une collection personnelle</summary>
            <label>
              Nom de la collection
              <input
                value={newName}
                disabled={held}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <button disabled={held} onClick={() => void prepare("collection")}>
              Préparer la collection
            </button>
          </details>
          <label>
            Nom du texte
            <input
              value={filename}
              disabled={held}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>
          <label>
            Texte à importer
            <textarea
              value={content}
              disabled={held}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <button disabled={held} onClick={() => void prepare("create")}>
            Préparer ce texte
          </button>
          <label>
            Fichiers texte
            <input
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              multiple
              disabled={held}
              onChange={(e) => void loadFiles(e.target.files)}
            />
          </label>
          <button
            disabled={held || !files.length}
            onClick={() => void prepare("create", { items: files })}
          >
            Préparer les fichiers sélectionnés
          </button>
          {selected && (
            <fieldset disabled={held}>
              <legend>Actions sur l’import sélectionné</legend>
              <label>
                Éléments à traiter
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </label>
              {Object.entries(importActionLabel).map(([a, label]) => (
                <button
                  key={a}
                  onClick={() =>
                    void prepare("command", {
                      action: a as ImportCommandInput["action"],
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </fieldset>
          )}
        </>
      )}
      {busy && (
        <ActivityStatus>
          Vérification ou enregistrement de l’import…
        </ActivityStatus>
      )}
      {message && <p role="status">{message}</p>}
      {pending && (
        <section aria-label="Projet d’import">
          <h4 tabIndex={-1} ref={preview}>
            Vérifier avant confirmation
          </h4>
          {hidden || !canManage ? (
            <p>
              Les détails sont masqués après le refus d’accès. La commande
              conserve sa cible et sa clé.
            </p>
          ) : pending.kind === "collection" ? (
            <>
              <p>Créer la collection « {pending.body.name} ».</p>
              <p>Lecteur unique : {pending.body.allowed_subjects[0]}.</p>
            </>
          ) : pending.kind === "create" ? (
            <>
              <p>
                Collection : {pending.collection.name} ·{" "}
                {pending.body.items.length} texte(s).
              </p>
              <p>
                Lecteur unique des nouvelles sources :{" "}
                {pending.body.items[0].allowed_subjects[0]}. Le partage
                ultérieur exige son propre parcours autorisé.
              </p>
              <ul>
                {pending.body.items.map((item, i) => (
                  <li key={i}>
                    <strong>{item.filename}</strong>
                    <p>
                      {Array.from(item.content).length} caractères · SHA-256{" "}
                      {pending.hashes[i]}
                    </p>
                    <details>
                      <summary>Relire le texte exact</summary>
                      <pre className="draft-text">{item.content}</pre>
                    </details>
                  </li>
                ))}
              </ul>
              <p>
                Le contrôle local ne prouve pas l’absence de doublon dans les
                sources existantes. Les identités retournées par le serveur font
                foi.
              </p>
            </>
          ) : (
            <>
              <p>
                {importActionLabel[pending.body.action]} · import{" "}
                {pending.state.job.id}.
              </p>
              <p>
                État relu : {importLabels[pending.state.job.status]}.{" "}
                {pending.body.action === "process"
                  ? `Au plus ${pending.body.limit} élément(s) en attente.`
                  : pending.body.action === "retry"
                    ? "Les échecs redeviennent en attente ; un traitement distinct reste nécessaire."
                    : "Les éléments en attente seront arrêtés. Les réussites seront conservées. Un lot arrêté ne peut pas être repris."}
              </p>
              <ul>
                {pending.state.job.items
                  .filter(
                    (i) =>
                      i.status ===
                      (pending.body.action === "retry" ? "failed" : "pending"),
                  )
                  .slice(
                    0,
                    pending.body.action === "process" ? pending.body.limit : 20,
                  )
                  .map((i) => (
                    <li key={i.position}>
                      {i.filename} · tentative {i.attempts}
                    </li>
                  ))}
              </ul>
            </>
          )}
          <p>
            Aucune publication ni appel à un modèle. Préparation valable cinq
            minutes ; un résultat incertain se récupère avec la même commande.
          </p>
          {phase === "uncertain" ? (
            <button disabled={busy} onClick={() => void send(true)}>
              Vérifier le résultat de l’import
            </button>
          ) : (
            <button
              disabled={
                busy ||
                hidden ||
                !canManage ||
                phase === "rejected" ||
                now > pending.expires
              }
              onClick={() => void send()}
            >
              Confirmer l’import
            </button>
          )}
          <button disabled={held} onClick={discard}>
            Annuler le projet d’import
          </button>
        </section>
      )}
    </section>
  );
});
