import { validatePassage } from "./sourcePassage";
export { validatePassage } from "./sourcePassage";
import { ActivityStatus } from "../ActivityStatus";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SourcePassage } from "../../../../packages/contracts/src/SourcePassage";
import { ApiError, CortexApi } from "./client";
export type SourceReadAction = "proof" | "full" | "next" | "previous" | "close";
export type SourceEvidenceActions = {
  act: (action: SourceReadAction) => Promise<string>;
};
type Source = { source_id: string; content_hash?: string } & (
  | { start: number; end: number }
  | { start?: never; end?: never }
);
type Request = {
  mode: "proof" | "full";
  offset: number;
  limit: number;
  hash?: string;
  total?: number;
};
const PAGE = 8192;
export const SourceEvidence = forwardRef<
  SourceEvidenceActions,
  {
    api: CortexApi;
    domain: string;
    source: Source;
    onReadError?: (error: Error) => void;
  }
>(function SourceEvidence({ api, domain, source, onReadError }, ref) {
  const originalFull = source.start === undefined;
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<SourcePassage>(),
    [mode, setMode] = useState<"proof" | "full">(
      originalFull ? "full" : "proof",
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error>();
  const toggle = useRef<HTMLButtonElement>(null),
    reading = useRef<HTMLDivElement>(null),
    active = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController>(),
    lastRequest = useRef<Request>(),
    latest = useRef<SourcePassage>(),
    errorHandler = useRef(onReadError);
  errorHandler.current = onReadError;
  useEffect(() => {
    setOpen(false);
    setPage(undefined);
    setError(undefined);
    setPending(false);
    active.current = false;
    latest.current = undefined;
    lastRequest.current = undefined;
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [
    api,
    domain,
    source.source_id,
    source.start,
    source.end,
    source.content_hash,
  ]);
  useEffect(() => {
    if (open && page && !pending && !error) reading.current?.focus();
  }, [open, page, pending, error]);
  function close() {
    epoch.current++;
    controller.current?.abort();
    active.current = false;
    setOpen(false);
    setPage(undefined);
    setError(undefined);
    setPending(false);
    latest.current = undefined;
    lastRequest.current = undefined;
    toggle.current?.focus();
  }
  async function load(request: Request): Promise<string> {
    if (active.current) return "Une lecture de source est déjà en cours.";
    active.current = true;
    const stamp = ++epoch.current,
      a = new AbortController();
    controller.current = a;
    setOpen(true);
    setMode(request.mode);
    setPage(undefined);
    setError(undefined);
    setPending(true);
    lastRequest.current = request;
    try {
      if (
        !originalFull &&
        (!Number.isSafeInteger(source.start) ||
          !Number.isSafeInteger(source.end) ||
          source.start! < 0 ||
          source.end! <= source.start!)
      )
        throw new ApiError(200, "invalid_response");
      const value = validatePassage(
        await api.call(
          "sources.passage",
          { domain, source_id: source.source_id },
          undefined,
          {
            signal: a.signal,
            query: {
              offset: request.offset,
              limit: request.limit,
              ...(request.hash ? { expected_hash: request.hash } : {}),
            },
          },
        ),
        source,
        request,
      );
      if (a.signal.aborted || stamp !== epoch.current) return "";
      latest.current = value;
      setPage(value);
      return `Source relue : caractères ${value.start}–${value.end} sur ${value.total_characters}. Aucun contenu modifié.`;
    } catch (e) {
      if (a.signal.aborted || stamp !== epoch.current) return "";
      latest.current = undefined;
      const failure = e instanceof Error ? e : new ApiError(0, "network_error");
      setError(failure);
      errorHandler.current?.(failure);
      return "Lecture impossible. Le passage précédent est masqué ; relisez les accès ou la preuve.";
    } finally {
      if (stamp === epoch.current) {
        active.current = false;
        setPending(false);
      }
    }
  }
  async function act(action: SourceReadAction) {
    if (action === "close") {
      close();
      return "Lecture de source fermée.";
    }
    if (active.current) return "Une lecture de source est déjà en cours.";
    const prior = latest.current,
      hash = prior?.content_hash ?? source.content_hash;
    if (action === "next" || action === "previous") {
      if (!prior) return "Ouvrez d’abord une preuve ou sa source.";
      const begin = mode === "proof" ? source.start! : 0,
        end = mode === "proof" ? source.end! : prior.total_characters;
      const offset =
        action === "next" ? prior.end : Math.max(begin, prior.start - PAGE);
      if (
        (action === "next" && offset >= end) ||
        (action === "previous" && prior.start <= begin)
      )
        return "Vous êtes à la limite de cette lecture.";
      return load({
        mode,
        offset,
        limit: Math.min(PAGE, end - offset),
        hash,
        total: prior.total_characters,
      });
    }
    const nextMode = action === "full" || originalFull ? "full" : "proof",
      offset = nextMode === "proof" ? source.start! : 0;
    return load({
      mode: nextMode,
      offset,
      limit: nextMode === "proof" ? Math.min(PAGE, source.end! - offset) : PAGE,
      hash,
      total: prior?.total_characters,
    });
  }
  useImperativeHandle(ref, () => ({ act }));
  const noun = originalFull ? "la source" : "la preuve",
    begin = mode === "proof" ? source.start! : 0,
    end = mode === "proof" ? source.end! : page?.total_characters;
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggle}
        aria-expanded={open}
        onClick={() =>
          open ? close() : void act(originalFull ? "full" : "proof")
        }
      >
        {open ? `Fermer ${noun}` : `Lire ${noun}`}
      </button>
      {open &&
        (pending ? (
          <ActivityStatus>Lecture du passage de source…</ActivityStatus>
        ) : error ? (
          <div role="alert">
            {error.message}
            <button
              onClick={() =>
                lastRequest.current && void load(lastRequest.current)
              }
            >
              Réessayer {noun}
            </button>
          </div>
        ) : (
          page && (
            <>
              <p>
                {page.title} · {page.location}
              </p>
              <p>
                {mode === "proof" ? "Passage cité" : "Lecture de la source"} ·
                caractères {page.start}–{page.end} sur {page.total_characters}{" "}
                (début inclus, fin exclue).
              </p>
              <div
                ref={reading}
                className="source-evidence-reading"
                role="region"
                aria-label={`Texte de ${mode === "proof" ? "la preuve" : "la source"}`}
                tabIndex={0}
              >
                <blockquote>{page.excerpt}</blockquote>
              </div>
              <div aria-label="Parcourir la source">
                <button
                  disabled={page.start <= begin}
                  onClick={() => void act("previous")}
                >
                  Passage précédent
                </button>
                <button
                  disabled={page.end >= end!}
                  onClick={() => void act("next")}
                >
                  Passage suivant
                </button>
              </div>
              <p>
                {page.end >= end!
                  ? mode === "proof"
                    ? "Fin du passage cité. Le reste de la source peut être consulté séparément."
                    : "Fin de la source."
                  : "Lecture partielle : poursuivez avec le passage suivant. Aucun texte n’est omis entre les pages."}
              </p>
              {!originalFull && (
                <button
                  onClick={() => void act(mode === "proof" ? "full" : "proof")}
                >
                  {mode === "proof"
                    ? "Lire la source depuis le début"
                    : "Revenir au passage cité"}
                </button>
              )}
              <details>
                <summary>Provenance et unité des positions</summary>
                <p>Empreinte : {page.content_hash}</p>
                <p>
                  Positions en caractères Unicode, pas en unités UTF-16. Chaque
                  page relit vos droits ; une lecture n’est jamais une
                  approbation.
                </p>
              </details>
            </>
          )
        ))}
    </div>
  );
});
