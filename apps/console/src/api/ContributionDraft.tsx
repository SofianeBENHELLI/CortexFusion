import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  ContributionDraft as Draft,
  ContributionDraftContent,
} from "../../../../packages/contracts/src/ContributionDraft";
import type { ContributionDraftInput } from "../../../../packages/contracts/src/ContributionDraftInput";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { workId } from "./workSelection";
export interface ContributionDraftHandle {
  hide: () => void;
  act: (
    action: "save" | "inspect" | "restore" | "recover" | "clear",
  ) => Promise<string>;
}
const rejected = (e: unknown): e is ApiError =>
  e instanceof ApiError &&
  [400, 401, 403, 404, 409, 413, 422].includes(e.status);
export function validateContributionDraft(v: Draft): Draft {
  const c = v?.content;
  if (
    !v ||
    !(c === null || (typeof c === "object" && c !== null)) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !["empty", "available", "source_unavailable", "source_changed"].includes(
      v.state,
    ) ||
    !(v.updated_at === null || typeof v.updated_at === "string") ||
    (v.state === "available") !== (c !== null) ||
    (c &&
      (!workId(c.source_id) ||
        !/^[a-f0-9]{64}$/.test(c.source_hash) ||
        [c.title, c.excerpt, c.reason].some((x) => typeof x !== "string") ||
        Array.from(c.title).length > 200 ||
        Array.from(c.excerpt).length > 200000 ||
        Array.from(c.reason).length > 2000 ||
        (c.selection !== null &&
          (!c.selection ||
            !Number.isSafeInteger(c.selection.start) ||
            !Number.isSafeInteger(c.selection.end) ||
            c.selection.start < 0 ||
            c.selection.end <= c.selection.start))))
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
export const ContributionDraft = forwardRef<
  ContributionDraftHandle,
  {
    api: CortexApi;
    domain: string;
    enabled: boolean;
    disabled: boolean;
    value: ContributionDraftContent | null;
    onRestore: (content: ContributionDraftContent) => Promise<boolean>;
    onNotice: (text: string) => void;
    onSourceUnavailable?: () => void;
  }
>(function ContributionDraft(
  {
    api,
    domain,
    enabled,
    disabled,
    value,
    onRestore,
    onNotice,
    onSourceUnavailable,
  },
  ref,
) {
  const [remote, setRemote] = useState<Draft>();
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<ContributionDraftInput>();
  const [conflict, setConflict] = useState(false);
  usePendingWork(
    "Sauvegarde de contribution",
    busy && pending ? "sending" : pending ? "uncertain" : undefined,
  );
  const active = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const current = useRef({ enabled, disabled });
  current.current = { enabled, disabled };
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  async function read(signal: AbortSignal) {
    return validateContributionDraft(
      await api.call("contribution_drafts.read", { domain }, undefined, {
        signal,
      }),
    );
  }
  function begin() {
    active.current = true;
    setBusy(true);
    const c = new AbortController();
    controller.current = c;
    return { g: generation.current, signal: c.signal };
  }
  function end(g: number) {
    if (g === generation.current) {
      active.current = false;
      setBusy(false);
    }
  }
  async function inspect(show = true): Promise<string> {
    if (active.current || disabled || pending || !enabled)
      return "Terminez ou vérifiez la commande en cours avant de lire le brouillon.";
    const { g, signal } = begin();
    setRemote(undefined);
    setPreview(false);
    setMessage("");
    try {
      const out = await read(signal);
      if (g !== generation.current) return "";
      setRemote(out);
      if (out.state === "source_unavailable" || out.state === "source_changed")
        onSourceUnavailable?.();
      setPreview(show);
      setConflict(false);
      return show
        ? notice(
            out.state === "available"
              ? "Brouillon relu. Sa restauration remplacera les champs locaux, sans soumettre de proposition."
              : out.state === "empty"
                ? "Aucun brouillon de contribution enregistré."
                : "Le contenu enregistré est masqué : sa source a changé ou n’est plus accessible.",
          )
        : "";
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        onSourceUnavailable?.();
      return notice(e instanceof Error ? e.message : "Lecture indisponible.");
    } finally {
      end(g);
    }
  }
  async function save(clear = false, recovery = false): Promise<string> {
    if (active.current || disabled || !enabled)
      return "Une commande est déjà en cours.";
    if (recovery && !pending)
      return notice("Aucune sauvegarde incertaine à vérifier.");
    if (!recovery && pending)
      return notice(
        "Vérifiez la sauvegarde précédente avant d’en préparer une autre.",
      );
    if (!recovery && (!remote || conflict))
      return notice("Relisez le brouillon enregistré avant de sauvegarder.");
    if (!recovery && !clear && !value)
      return notice(
        "Relisez une source avant d’enregistrer votre projet d’ajout.",
      );
    const input = recovery
      ? pending!
      : {
          content: clear ? null : value,
          expected_revision: remote!.revision,
          idempotency_key: crypto.randomUUID(),
        };
    const { g, signal } = begin();
    setPending(input);
    setMessage("");
    let committed = false;
    try {
      const receipt = await api.call(
        "contribution_drafts.save",
        { domain },
        input,
        { signal },
      );
      if (
        !receipt ||
        !workId(receipt.receipt_id) ||
        receipt.revision !== input.expected_revision + 1
      )
        throw new ApiError(200, "invalid_response");
      if (g !== generation.current) return "";
      committed = true;
      setPending(undefined);
      setRemote(undefined);
      setPreview(false);
      setConflict(false);
      // An older receipt does not assert that its content is still the latest draft.
      const result = await read(signal);
      if (g !== generation.current) return "";
      setRemote(result);
      if (
        result.state === "source_unavailable" ||
        result.state === "source_changed"
      )
        onSourceUnavailable?.();
      return notice(
        `Sauvegarde privée confirmée · révision ${receipt.revision} · reçu ${receipt.receipt_id}. État courant relu : révision ${result.revision}. Aucune proposition soumise.`,
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (committed) {
        setRemote(undefined);
        return notice(
          "Sauvegarde confirmée ; relecture indisponible. Relisez le brouillon avant toute nouvelle sauvegarde.",
        );
      }
      if (rejected(e)) {
        if ([401, 403, 404].includes(e.status)) onSourceUnavailable?.();
        if (!recovery) setPending(undefined);
        setRemote(undefined);
        setPreview(false);
        setConflict(e.status === 409);
        return notice(
          `${e.message} Votre saisie locale est conservée. ${recovery ? "Le résultat précédent reste à vérifier avec la même demande." : "Relisez avant de sauvegarder."}`,
        );
      }
      return notice(
        "Résultat de sauvegarde inconnu. Vérifiez avec la même demande et la même clé, sans envoyer une proposition.",
      );
    } finally {
      end(g);
    }
  }
  async function restore(): Promise<string> {
    if (active.current || disabled || pending || !enabled)
      return "Terminez ou vérifiez la commande en cours avant de restaurer le brouillon.";
    if (!preview || !remote?.content)
      return notice(
        "Inspectez d’abord le brouillon enregistré avant de remplacer les champs locaux.",
      );
    const expected = remote.revision;
    const { g, signal } = begin();
    try {
      const out = await read(signal);
      if (g !== generation.current) return "";
      setRemote(out);
      if (out.state === "source_unavailable" || out.state === "source_changed")
        onSourceUnavailable?.();
      if (out.revision !== expected || !out.content)
        return notice(
          "Le brouillon ou ses accès ont changé. Examinez sa nouvelle version avant restauration.",
        );
      if (!current.current.enabled || current.current.disabled)
        return "Restauration interrompue par une autre commande.";
      const restored = await onRestore(out.content);
      if (g !== generation.current) return "";
      if (!restored) {
        setRemote(undefined);
        setPreview(false);
      }
      return notice(
        restored
          ? "Brouillon restauré dans les champs. Préparez puis confirmez séparément la proposition."
          : "Restauration non effectuée. Vérifiez la source et le projet en cours.",
      );
    } catch (e) {
      if (g !== generation.current) return "";
      setRemote(undefined);
      setPreview(false);
      return notice(
        e instanceof Error ? e.message : "Restauration indisponible.",
      );
    } finally {
      end(g);
    }
  }
  async function act(
    action: "save" | "inspect" | "restore" | "recover" | "clear",
  ) {
    if (action === "inspect") return inspect();
    if (action === "restore") return restore();
    return save(action === "clear", action === "recover");
  }
  function hide() {
    generation.current++;
    controller.current?.abort();
    active.current = false;
    setBusy(false);
    setRemote(undefined);
    setPreview(false);
  }
  useImperativeHandle(ref, () => ({ act, hide }));
  useEffect(() => {
    if (enabled) void inspect(false);
    else {
      setRemote(undefined);
      setPreview(false);
    }
    return () => {
      generation.current++;
      controller.current?.abort();
      active.current = false;
    };
  }, [api, domain, enabled]);
  if (!enabled) return null;
  return (
    <section
      className="contribution-draft"
      aria-label="Brouillon privé de contribution"
    >
      <h4>Retrouver votre projet d’ajout</h4>
      <p>
        Un brouillon privé par domaine, enregistré à votre demande. Il ne crée
        aucune proposition et reste conservé jusqu’à votre effacement explicite.
      </p>
      <button
        disabled={disabled || busy || !!pending}
        onClick={() => void inspect()}
      >
        Voir le brouillon d’ajout enregistré
      </button>
      <button
        disabled={
          disabled || busy || !!pending || !value || !remote || conflict
        }
        onClick={() => void save()}
      >
        Enregistrer le brouillon d’ajout
      </button>
      {pending && (
        <button
          disabled={disabled || busy}
          onClick={() => void save(false, true)}
        >
          Vérifier la sauvegarde du brouillon d’ajout
        </button>
      )}
      {remote && (
        <p>
          État courant : révision {remote.revision} ·{" "}
          {remote.state === "empty"
            ? "vide"
            : remote.state === "available"
              ? "brouillon disponible"
              : remote.state === "source_changed"
                ? "source modifiée, contenu masqué"
                : "source inaccessible, contenu masqué"}
          .
        </p>
      )}
      {preview && remote?.content && (
        <>
          <h5>{remote.content.title || "Ajout sans titre"}</h5>
          <blockquote>
            {remote.content.excerpt || "Aucun passage saisi"}
          </blockquote>
          <p>{remote.content.reason || "Aucun motif saisi"}</p>
          <p>
            La restauration remplace les champs locaux. Elle revalide la source
            et ne confirme aucune proposition.
          </p>
          <button
            disabled={disabled || busy || !!pending}
            onClick={() => void restore()}
          >
            Remplacer les champs par le brouillon d’ajout
          </button>
        </>
      )}
      {preview && remote && remote.state !== "empty" && (
        <button
          disabled={disabled || busy || !!pending}
          onClick={() => void save(true)}
        >
          Effacer le brouillon d’ajout enregistré
        </button>
      )}
      {busy && (
        <ActivityStatus>
          Vérification du brouillon de contribution…
        </ActivityStatus>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
});
