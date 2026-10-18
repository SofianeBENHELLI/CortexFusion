import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SourcePage } from "../../../../packages/contracts/src/SourcePage";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { workId } from "./workSelection";
export type SourcePickerHandle = {
  search: (q: string) => Promise<string>;
  next: () => Promise<string>;
  select: (value: string) => Promise<string>;
  clear: () => void;
};
export function validateSourcePage(page: SourcePage): SourcePage {
  if (
    !page ||
    !Array.isArray(page.items) ||
    page.items.length > 20 ||
    !(
      page.next_after === null ||
      (typeof page.next_after === "string" && workId(page.next_after))
    ) ||
    new Set(page.items.map((s) => s.id)).size !== page.items.length ||
    page.items.some(
      (s) =>
        !s ||
        !workId(s.id) ||
        typeof s.title !== "string" ||
        typeof s.location !== "string" ||
        !/^[0-9a-f]{64}$/.test(s.content_hash) ||
        !Array.isArray(s.allowed_subjects) ||
        s.allowed_subjects.some((a) => typeof a !== "string"),
    ) ||
    (page.next_after !== null &&
      (!page.items.length ||
        page.next_after !== page.items[page.items.length - 1].id))
  )
    throw new ApiError(200, "invalid_response");
  return page;
}
export const SourcePicker = forwardRef<
  SourcePickerHandle,
  {
    api: CortexApi;
    domain: string;
    disabled: boolean;
    onChoose: (id: string) => Promise<string>;
    onNotice: (text: string) => void;
  }
>(function SourcePicker({ api, domain, disabled, onChoose, onNotice }, ref) {
  const [open, setOpen] = useState(false),
    [input, setInput] = useState(""),
    [query, setQuery] = useState("");
  const [page, setPage] = useState<SourcePage>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController>();
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [api, domain],
  );
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  function clear() {
    generation.current++;
    controller.current?.abort();
    pending.current = false;
    setBusy(false);
    setPage(undefined);
    setMessage("");
  }
  async function read(q: string, after?: string) {
    if (disabled || pending.current)
      return notice(
        "Terminez ou annulez le projet actuel avant de changer de source.",
      );
    if (Array.from(q).length > 200 || q.includes("\0"))
      return notice("La recherche par titre accepte au plus 200 caractères.");
    setOpen(true);
    setInput(q);
    setQuery(q);
    setPage(undefined);
    setMessage("");
    pending.current = true;
    setBusy(true);
    const id = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const data = validateSourcePage(
        await api.call("sources.list", { domain }, undefined, {
          signal: abort.signal,
          query: { limit: 20, q, ...(after ? { after } : {}) },
        }),
      );
      if (id !== generation.current || abort.signal.aborted) return "";
      setPage(data);
      return notice(
        data.items.length
          ? `${data.items.length} source${data.items.length > 1 ? "s" : ""} accessible${data.items.length > 1 ? "s" : ""} affichée${data.items.length > 1 ? "s" : ""}${data.next_after ? " ; une autre page est disponible" : ""}. Choisissez une source ; son accès sera relu.`
          : "Aucune source accessible ne correspond à ce titre. Essayez un autre titre ou consultez vos imports.",
      );
    } catch {
      if (id !== generation.current || abort.signal.aborted) return "";
      setPage(undefined);
      return notice(
        "La liste des sources est indisponible. Les anciens résultats sont masqués ; relancez la recherche.",
      );
    } finally {
      if (id === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function next() {
    return page?.next_after
      ? read(query, page.next_after)
      : notice(
          "Aucune page suivante disponible. Relancez la recherche pour actualiser les résultats.",
        );
  }
  async function select(value: string) {
    if (disabled || pending.current)
      return notice(
        "Terminez la lecture ou le projet en cours avant de choisir une source.",
      );
    const n = /^[1-9][0-9]*$/.test(value) ? Number(value) : 0;
    const source = n
      ? page?.items[n - 1]
      : page?.items.find((s) => s.id === value);
    if (!source)
      return notice(
        "Choisissez le numéro d’une source de la page affichée, ou recherchez d’abord son titre.",
      );
    return onChoose(source.id);
  }
  useImperativeHandle(ref, () => ({
    search: (q) => read(q),
    next,
    select,
    clear,
  }));
  return (
    <section aria-label="Choisir une source accessible">
      <button disabled={disabled || busy} onClick={() => void read(input)}>
        Parcourir les sources
      </button>
      {open && (
        <>
          <label>
            Rechercher une source par titre
            <input
              maxLength={400}
              disabled={disabled || busy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button
            disabled={disabled || busy || Array.from(input).length > 200}
            onClick={() => void read(input)}
          >
            Rechercher les sources
          </button>
          {busy && (
            <ActivityStatus>Recherche des sources accessibles…</ActivityStatus>
          )}
          {page && (
            <>
              <p>
                {page.items.length} source{page.items.length > 1 ? "s" : ""} sur
                cette page
                {query ? ` · titre contenant « ${query} »` : ""}. Le total du
                catalogue n’est pas fourni par cette lecture. Chaque page
                remplace la précédente.
              </p>
              <ol aria-label="Sources accessibles">
                {page.items.map((s, i) => (
                  <li key={s.id}>
                    <button
                      disabled={disabled || busy}
                      onClick={() => void select(String(i + 1))}
                    >
                      Choisir la source {i + 1} · {s.title}
                    </button>
                    <p>{s.location}</p>
                    <details>
                      <summary>Référence de la source {i + 1}</summary>
                      <small className="task-id">{s.id}</small>
                    </details>
                  </li>
                ))}
              </ol>
              {page.next_after && (
                <button disabled={disabled || busy} onClick={() => void next()}>
                  Sources suivantes
                </button>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
});
