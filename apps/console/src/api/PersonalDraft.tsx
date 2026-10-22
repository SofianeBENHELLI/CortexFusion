import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ConversationDraft } from "../../../../packages/contracts/src/ConversationDraft";
import type { ConversationDraftInput } from "../../../../packages/contracts/src/ConversationDraftInput";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";

export interface PersonalDraftActions {
  save: (text: string) => Promise<void>;
  inspect: () => Promise<void>;
  apply: () => boolean;
}
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
function validate(v: ConversationDraft, key: string) {
  if (
    !v ||
    v.draft_key !== key ||
    typeof v.text !== "string" ||
    Array.from(v.text).length > 2000 ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !(v.updated_at === null || typeof v.updated_at === "string")
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
/** Explicit personal saves only. Never overwrites the composer on load or replays a query. */
export const PersonalDraft = forwardRef<
  PersonalDraftActions,
  {
    api: CortexApi;
    domain: string;
    draftKey: string;
    text: string;
    disabled: boolean;
    onApply: (text: string) => void;
  }
>(function PersonalDraft(
  { api, domain, draftKey, text, disabled, onApply },
  ref,
) {
  const [remote, setRemote] = useState<ConversationDraft>();
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [pending, setPending] = useState<ConversationDraftInput>();
  usePendingWork(
    "Sauvegarde du brouillon privé",
    busy && pending ? "sending" : pending ? "uncertain" : undefined,
  );
  const active = useRef(false);
  const controller = useRef<AbortController>();
  const generation = useRef(0);
  const scope = { domain, draft_key: draftKey };
  async function read(signal: AbortSignal) {
    return validate(
      await api.call("drafts.read", scope, undefined, { signal }),
      draftKey,
    );
  }
  async function inspect(show = true) {
    if (active.current || pending || disabled) return;
    active.current = true;
    setBusy(true);
    setError("");
    const id = generation.current;
    const request = new AbortController();
    controller.current = request;
    try {
      const value = await read(request.signal);
      if (id !== generation.current) return;
      setRemote(value);
      setPreview(show);
    } catch {
      if (id !== generation.current) return;
      setRemote(undefined);
      setPreview(false);
      setError(
        "Lecture du brouillon indisponible. Votre saisie locale est conservée ; relisez le brouillon avant une sauvegarde.",
      );
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function save(value: string) {
    if (
      active.current ||
      disabled ||
      conflict ||
      !remote ||
      Array.from(value).length > 2000
    )
      return;
    const body = pending ?? {
      text: value,
      expected_revision: remote.revision,
      idempotency_key: crypto.randomUUID(),
    };
    active.current = true;
    setBusy(true);
    setError("");
    setReceipt("");
    setPending(body);
    const id = generation.current;
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await api.call("drafts.save", scope, body, {
        signal: request.signal,
      });
      if (id !== generation.current) return;
      if (
        !result ||
        result.draft_key !== draftKey ||
        !result.receipt_id ||
        result.revision !== body.expected_revision + 1
      )
        throw new ApiError(200, "invalid_response");
      setPending(undefined);
      setReceipt(
        `Sauvegarde privée confirmée · révision ${result.revision} · reçu ${result.receipt_id}`,
      );
      // A replayed receipt may predate another tab's save. Read again before the next write.
      setRemote(undefined);
      try {
        const fresh = await read(request.signal);
        if (id === generation.current) setRemote(fresh);
      } catch {
        if (id === generation.current) {
          setPreview(false);
          setError(
            "Sauvegarde confirmée, mais relecture indisponible. Relisez avant toute nouvelle sauvegarde.",
          );
        }
      }
    } catch (e) {
      if (id !== generation.current) return;
      if (rejected(e)) setPending(undefined);
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setPreview(true);
        setRemote(undefined);
        setError(
          "Un autre enregistrement existe. Comparez les deux textes avant de continuer ; votre texte n’a pas été remplacé.",
        );
        try {
          const fresh = await read(request.signal);
          if (id === generation.current) setRemote(fresh);
        } catch {
          if (id === generation.current) setRemote(undefined);
        }
      } else if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        setRemote(undefined);
        setPreview(false);
        setReceipt("");
        setError(
          "Le brouillon n’est plus accessible. Aucun contenu enregistré n’est affiché.",
        );
      } else
        setError(
          rejected(e)
            ? "Sauvegarde refusée. Vérifiez le texte puis réessayez."
            : "Résultat inconnu. Réessayez la même sauvegarde pour retrouver son reçu ; votre nouvelle saisie ne sera pas envoyée à sa place.",
        );
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function apply() {
    if (disabled || active.current || pending || !remote || !preview)
      return false;
    onApply(remote.text);
    setConflict(false);
    setPreview(false);
    return true;
  }
  useImperativeHandle(ref, () => ({
    save,
    inspect: () => inspect(true),
    apply,
  }));
  useEffect(() => {
    setRemote(undefined);
    setPreview(false);
    setConflict(false);
    setPending(undefined);
    setReceipt("");
    setError("");
    void inspect(false);
    return () => {
      generation.current++;
      controller.current?.abort();
      active.current = false;
    };
    // Parent keys this component to the authenticated scope; late completions are fenced here too.
  }, [api, domain, draftKey]);
  return (
    <section className="personal-draft" aria-label="Brouillon privé">
      <div className="personal-draft-actions">
        <button
          type="button"
          disabled={
            disabled ||
            busy ||
            conflict ||
            !remote ||
            (!pending && Array.from(text).length > 2000)
          }
          onClick={() => void save(text)}
        >
          {pending
            ? "Réessayer la même sauvegarde"
            : "Enregistrer mon brouillon"}
        </button>
        <button
          type="button"
          disabled={disabled || busy || !!pending}
          onClick={() => void inspect()}
        >
          Voir le brouillon enregistré
        </button>
      </div>
      <small>
        Privé · sauvegarde à votre demande · aucun partage ni envoi de question.
        Enregistrer un texte vide efface le brouillon courant.
      </small>
      {remote && !receipt && (
        <p>
          Brouillon enregistré : révision {remote.revision}
          {remote.revision === 0 ? " · aucun texte sauvegardé" : ""}.
        </p>
      )}
      {busy && (
        <ActivityStatus>Synchronisation du brouillon privé…</ActivityStatus>
      )}
      {receipt && (
        <p role="status" className="draft-receipt">
          {receipt}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {preview && remote && (
        <div className="draft-comparison">
          <h3>Version enregistrée · {remote.revision}</h3>
          <p className="draft-text">{remote.text || "Brouillon vide."}</p>
          <p>
            « Utiliser » remplace uniquement votre saisie locale. Aucun message
            n’est envoyé.
          </p>
          <button
            type="button"
            disabled={disabled || busy || !!pending}
            onClick={apply}
          >
            Utiliser le brouillon enregistré
          </button>
          {conflict && (
            <button
              type="button"
              disabled={disabled || busy || !!pending}
              onClick={() => {
                setConflict(false);
                setPreview(false);
                setError(
                  "Votre texte local est conservé. Enregistrez-le explicitement pour remplacer la version comparée.",
                );
              }}
            >
              Garder mon texte local
            </button>
          )}
        </div>
      )}
    </section>
  );
});
