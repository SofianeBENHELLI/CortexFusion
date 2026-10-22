import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReferenceDraft } from "../../../../packages/contracts/src/ReferenceDraft";
import type { ReferenceDraftContent } from "../../../../packages/contracts/src/ReferenceDraftContent";
import type { ReferenceDraftInput } from "../../../../packages/contracts/src/ReferenceDraftInput";
import type { ReferenceDraftPage } from "../../../../packages/contracts/src/ReferenceDraftPage";
import type { SourcePassage } from "../../../../packages/contracts/src/SourcePassage";
import {
  readSourcePage,
  verifySourceExcerpt,
  locateSourceExcerpt,
} from "./sourcePassage";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { SourcePicker, type SourcePickerHandle } from "./SourcePicker";
import { usePendingWork } from "./PendingWorkBoundary";
import { workId } from "./workSelection";
import type { ReferenceIntent } from "./referenceCommands";
import {
  readReferenceRecovery,
  rememberReferenceRecovery,
  forgetReferenceRecovery,
  type RecoveryScope,
} from "./referenceRecoveryStore";
export type ReferenceActions = {
  act: (intent: ReferenceIntent) => Promise<string>;
};
const empty = { theme: "", question: "", criteria: "", excerpt: "" };
const valid = (s: string, n: number) =>
  typeof s === "string" &&
  !!s.trim() &&
  Array.from(s).length <= n &&
  !s.includes("\0");
export function referenceContent(value: ReferenceDraftContent) {
  if (
    !value ||
    !valid(value.theme, 200) ||
    !valid(value.question, 2000) ||
    !valid(value.criteria, 8000) ||
    !valid(value.excerpt, 10000) ||
    !workId(value.source_id) ||
    !/^[0-9a-f]{64}$/.test(value.source_hash) ||
    !value.selection ||
    !Number.isSafeInteger(value.selection.start) ||
    !Number.isSafeInteger(value.selection.end) ||
    value.selection.start < 0 ||
    value.selection.end - value.selection.start !==
      Array.from(value.excerpt).length ||
    value.selection.end <= value.selection.start
  )
    throw Error(
      "Question ou preuve invalide. Complétez tous les champs sans dépasser leurs limites.",
    );
  return value;
}
export const ReferenceWorkspace = forwardRef<
  ReferenceActions,
  {
    api: CortexApi;
    domain: string;
    onNotice: (text: string) => void;
    recoveryScope?: RecoveryScope;
  }
>(function ReferenceWorkspace({ api, domain, onNotice, recoveryScope }, ref) {
  const [page, setPage] = useState<ReferenceDraftPage>(),
    [source, setSource] = useState<SourcePassage>(),
    [current, setCurrent] = useState<ReferenceDraft>();
  const [fields, setFields] = useState(empty),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<{
      id: string;
      body: ReferenceDraftInput;
    }>(),
    [uncertain, setUncertain] = useState(false);
  const [phase, setPhase] = useState<"reading" | "saving" | "receipt">(
    "reading",
  );
  const [proofStart, setProofStart] = useState("");
  const [readOffset, setReadOffset] = useState("");
  const sourceText = useRef<HTMLTextAreaElement>(null);
  const sourceMeta = useRef<SourcePassage>();
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const receiptTarget = useRef<{
    command: string;
    question: string;
    revision: number;
  }>();
  const recovery = recoveryScope
    ? readReferenceRecovery(recoveryScope)
    : undefined;
  const recovered = recovery?.entries.filter((e) => e.domain === domain) ?? [];
  const unresolved = uncertain || recovered.length > 0;
  const active = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController>(),
    picker = useRef<SourcePickerHandle>(null);
  usePendingWork(
    "Sauvegarde de question de référence",
    busy && prepared
      ? "sending"
      : unresolved
        ? "uncertain"
        : dirty || prepared
          ? "draft"
          : undefined,
  );
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [api, domain],
  );
  function notice(t: string) {
    setMessage(t);
    onNotice(t);
    return t;
  }
  function reset() {
    setFields(empty);
    setDirty(false);
    setSource(undefined);
    sourceMeta.current = undefined;
    setProofStart("");
    setReadOffset("");
    setCurrent(undefined);
    setPrepared(undefined);
    picker.current?.clear();
  }
  async function run(
    fn: (signal: AbortSignal) => Promise<string>,
    nextPhase: "reading" | "saving" | "receipt" = "reading",
  ) {
    if (active.current) return notice("Une opération est en cours.");
    active.current = true;
    setBusy(true);
    setPhase(nextPhase);
    const id = epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const text = await fn(abort.signal);
      return id === epoch.current ? notice(text) : "";
    } catch (e) {
      if (id !== epoch.current) return "";
      if (e instanceof ApiError && e.status === 409) setSource(undefined);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        reset();
        setPage(undefined);
      }
      return notice(
        e instanceof ApiError
          ? e.status === 422 && e.code === "AMBIGUOUS_EXCERPT"
            ? e.message
            : e.status === 409
              ? "La révision ou la preuve a changé. Votre saisie est conservée ; annulez-la seulement lorsque vous êtes prêt à relire la version courante."
              : "Lecture refusée ou indisponible. Actualisez vos accès et réessayez."
          : e instanceof Error
            ? e.message
            : "Opération indisponible.",
      );
    } finally {
      if (id === epoch.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function identity(signal: AbortSignal) {
    const id = await api.call("identity.read", {}, undefined, { signal });
    if (
      !id.domains.some(
        (d) => d.id === domain && d.capabilities.includes("reference_drafts"),
      )
    )
      throw new ApiError(403, "denied");
  }
  async function readSource(
    id: string,
    signal: AbortSignal,
    offset = 0,
    hash?: string,
  ) {
    return readSourcePage(api, domain, id, signal, offset, hash);
  }
  async function passage(value: "next" | "previous" | string) {
    if (prepared || unresolved)
      return notice("Terminez la sauvegarde avant de parcourir la source.");
    const prior = source ?? sourceMeta.current;
    if (!prior) return notice("Choisissez d’abord une source de référence.");
    const offset =
      value === "next"
        ? prior.next_offset
        : value === "previous"
          ? Math.max(0, prior.start - 8192)
          : /^(0|[1-9][0-9]*)$/.test(value)
            ? Number(value)
            : NaN;
    if (offset === null) return notice("Fin de la source atteinte.");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > Math.min(prior.total_characters, 2147483646)
    )
      return notice("Indiquez une position Unicode comprise dans la source.");
    if (active.current) return notice("Une opération est en cours.");
    setSource(undefined);
    return run(async (signal) => {
      await identity(signal);
      const next = await readSourcePage(
        api,
        domain,
        prior.source_id,
        signal,
        offset,
        prior.content_hash,
        8192,
        prior.total_characters,
      );
      if (signal.aborted) return "";
      setSource(next);
      sourceMeta.current = next;
      setReadOffset(String(next.start));
      requestAnimationFrame(() => sourceText.current?.focus());
      return `Source : caractères ${next.start}–${next.end} sur ${next.total_characters}. Votre saisie reste inchangée.`;
    });
  }
  function position(value: string) {
    if (active.current || prepared || unresolved)
      return notice("Terminez la sauvegarde avant de modifier la preuve.");
    if (!sourceMeta.current)
      return notice("Choisissez d’abord une source de référence.");
    setProofStart(value);
    setDirty(true);
    return notice(
      "Position locale modifiée ; le passage sera vérifié avant sauvegarde.",
    );
  }
  function useSelection() {
    const input = sourceText.current;
    if (!source || !input || active.current || prepared || unresolved) return;
    const start = input.selectionStart,
      end = input.selectionEnd;
    if (end <= start)
      return notice("Sélectionnez un passage dans le texte affiché.");
    setFields((f) => ({ ...f, excerpt: source.excerpt.slice(start, end) }));
    setProofStart(
      String(source.start + Array.from(source.excerpt.slice(0, start)).length),
    );
    setDirty(true);
    return notice(
      "Passage et occurrence sélectionnés. Rien n’est encore enregistré.",
    );
  }
  async function list(next = false) {
    if (unresolved)
      return notice(
        "Résultat inconnu : vérifiez le reçu avant une autre action.",
      );
    const after = next ? page?.next_after : undefined;
    if (next && !after) return notice("Aucune page suivante disponible.");
    setPage(undefined);
    return run(async (signal) => {
      await identity(signal);
      const p = await api.call("reference_drafts.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(after ? { after } : {}) },
      });
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        new Set(p.items.map((x) => x.id)).size !== p.items.length ||
        p.items.some(
          (x) =>
            !workId(x.id) ||
            !valid(x.theme, 200) ||
            !valid(x.question, 2000) ||
            !Number.isSafeInteger(x.revision) ||
            x.revision < 1,
        ) ||
        !(
          p.next_after === null ||
          (p.items.length > 0 &&
            p.next_after === p.items[p.items.length - 1].id)
        )
      )
        throw new ApiError(200, "invalid_response");
      if (signal.aborted) return "";
      setPage(p);
      return `${p.items.length} préparation(s) privée(s) sur cette page. Aucun contrôle exécuté.`;
    });
  }
  async function chooseSource(id: string) {
    if (dirty || prepared || unresolved)
      return notice(
        "Conservez votre travail ou utilisez « Annuler la saisie de référence » avant de changer de source.",
      );
    return run(async (signal) => {
      await identity(signal);
      const s = await readSource(id, signal);
      if (signal.aborted) return "";
      setSource(s);
      sourceMeta.current = s;
      setProofStart("");
      setReadOffset("0");
      setCurrent(undefined);
      setFields(empty);
      return "Source relue. Décrivez votre question, vos critères et un passage exact.";
    });
  }
  async function open(value: string, reviewedRevision?: number) {
    if (dirty || prepared || unresolved)
      return notice(
        "Enregistrez ou annulez votre saisie avant d’ouvrir une autre préparation.",
      );
    const id = /^[1-9][0-9]*$/.test(value)
      ? page?.items[Number(value) - 1]?.id
      : workId(value)
        ? value
        : undefined;
    if (!id) return notice("Choisissez le numéro d’une question affichée.");
    setSource(undefined);
    sourceMeta.current = undefined;
    setProofStart("");
    setReadOffset("");
    setCurrent(undefined);
    setFields(empty);
    return run(async (signal) => {
      await identity(signal);
      const q = await api.call(
        "reference_drafts.read",
        { domain, question: id },
        undefined,
        { signal },
      );
      referenceContent(q.content);
      if (
        q.id !== id ||
        q.status !== "draft" ||
        q.visibility !== "personal" ||
        !Number.isSafeInteger(q.revision) ||
        q.revision < 1
      )
        throw new ApiError(200, "invalid_response");
      const s = await verifySourceExcerpt(
        api,
        domain,
        q.content.source_id,
        q.content.source_hash,
        q.content.selection.start,
        q.content.excerpt,
        10000,
        signal,
      );
      if (signal.aborted) return "";
      setCurrent(q);
      setSource(s);
      sourceMeta.current = s;
      setProofStart(String(q.content.selection.start));
      setReadOffset(String(s.start));
      setFields({
        theme: q.content.theme,
        question: q.content.question,
        criteria: q.content.criteria,
        excerpt: q.content.excerpt,
      });
      setDirty(false);
      requestAnimationFrame(() => questionInput.current?.focus());
      return reviewedRevision === undefined
        ? "Préparation privée restaurée. Elle n’est pas approuvée."
        : `Question privée actuelle restaurée en version ${q.revision}. La copie relue reste figée en version ${reviewedRevision}. Vos corrections devront être enregistrées puis soumises à une nouvelle revue.`;
    });
  }
  function field(name: keyof typeof empty, value: string) {
    if (active.current || prepared || unresolved)
      return notice(
        "Terminez la préparation en cours avant de modifier ses champs.",
      );
    if (!sourceMeta.current)
      return notice("Choisissez d’abord une source de référence.");
    setFields((f) => ({ ...f, [name]: value }));
    setDirty(true);
    return notice("Saisie locale modifiée ; rien n’est encore enregistré.");
  }
  async function prepare() {
    if (prepared || unresolved)
      return notice("Une sauvegarde est déjà préparée.");
    const selected = source ?? sourceMeta.current;
    if (!selected) return notice("Choisissez d’abord une source de référence.");
    return run(async (signal) => {
      await identity(signal);
      if (!valid(fields.excerpt, 10000))
        throw Error(
          "La preuve accepte de 1 à 10 000 caractères exacts, sans troncature.",
        );
      if (proofStart !== "" && !/^(0|[1-9][0-9]*)$/.test(proofStart))
        throw Error("Indiquez une position Unicode entière, début inclus.");
      const located = await locateSourceExcerpt(
        api,
        domain,
        selected.source_id,
        fields.excerpt,
        signal,
        selected.content_hash,
        proofStart === "" ? undefined : Number(proofStart),
      );
      const start = located.start;
      const content = referenceContent({
        ...fields,
        source_id: selected.source_id,
        source_hash: selected.content_hash,
        selection: { start, end: start + Array.from(fields.excerpt).length },
      });
      await verifySourceExcerpt(
        api,
        domain,
        selected.source_id,
        selected.content_hash,
        start,
        fields.excerpt,
        10000,
        signal,
      );
      if (current) {
        const fresh = await api.call(
          "reference_drafts.read",
          { domain, question: current.id },
          undefined,
          { signal },
        );
        if (fresh.revision !== current.revision)
          throw Error(
            "Cette préparation a changé dans un autre onglet. Annulez votre saisie puis relisez-la.",
          );
      }
      if (signal.aborted) return "";
      setPrepared({
        id: current?.id ?? crypto.randomUUID(),
        body: {
          content,
          expected_revision: current?.revision ?? 0,
          idempotency_key: crypto.randomUUID(),
        },
      });
      return "Vérifiez la question et sa preuve, puis confirmez la sauvegarde privée.";
    });
  }
  async function confirm(retry = false) {
    if (retry && uncertain && !prepared)
      return notice(
        "Le contenu a été masqué. Vérifiez le reçu de référence sans renvoyer la sauvegarde.",
      );
    if (!prepared || active.current)
      return notice("Préparez d’abord une question complète.");
    if (uncertain && !retry)
      return notice(
        "Résultat inconnu : utilisez la reprise de la même sauvegarde.",
      );
    if (retry && !uncertain)
      return notice("Aucune sauvegarde incertaine à reprendre.");
    const intent = prepared;
    if (!recoveryScope)
      return notice("Votre identité doit être vérifiée avant de sauvegarder.");
    try {
      rememberReferenceRecovery(recoveryScope, {
        command: intent.body.idempotency_key,
        domain,
        question: intent.id,
        revision: intent.body.expected_revision + 1,
        started: Date.now(),
      });
    } catch {
      return notice(
        "La référence de reprise ne peut pas être conservée dans cet onglet. Aucun nouvel envoi ; votre préparation reste en mémoire.",
      );
    }
    receiptTarget.current = {
      command: intent.body.idempotency_key,
      question: intent.id,
      revision: intent.body.expected_revision + 1,
    };
    return run(async (signal) => {
      try {
        const r = await api.call(
          "reference_drafts.save",
          { domain, question: intent.id },
          intent.body,
          { signal },
        );
        if (
          !r ||
          !workId(r.receipt_id) ||
          r.question_id !== intent.id ||
          r.revision !== intent.body.expected_revision + 1
        )
          throw new ApiError(200, "invalid_receipt");
        if (signal.aborted) return "";
        forgetReferenceRecovery(recoveryScope, intent.body.idempotency_key);
        setUncertain(false);
        receiptTarget.current = undefined;
        setPrepared(undefined);
        setDirty(false);
        setCurrent({
          id: intent.id,
          content: intent.body.content,
          revision: r.revision,
          status: "draft",
          visibility: "personal",
          updated_at: "",
        });
        return `Question privée enregistrée, révision ${r.revision}. Aucune approbation ni campagne exécutée. Relisez-la pour vérifier l’état courant.`;
      } catch (e) {
        if (signal.aborted) return "";
        if (
          e instanceof ApiError &&
          [400, 401, 403, 404, 409, 422].includes(e.status)
        ) {
          if (retry) {
            // This refusal concerns the retry, not the first attempt whose
            // response was lost. Never turn it into proof of non-execution.
            if ([401, 403, 404].includes(e.status)) {
              reset();
              setPage(undefined);
            }
            return "Reprise refusée ; le résultat du premier envoi reste inconnu. Vérifiez le reçu de référence sans renvoyer.";
          }
          receiptTarget.current = undefined;
          forgetReferenceRecovery(recoveryScope, intent.body.idempotency_key);
          setPrepared(undefined);
          setUncertain(false);
          throw e;
        }
        setUncertain(true);
        return "Résultat inconnu. Vérifiez d’abord le reçu sans renvoyer. Si vous reprenez la sauvegarde, conservez exactement cette charge et cette clé en mémoire dans cet onglet.";
      }
    }, "saving");
  }
  async function verifyReceipt(command?: string) {
    const target = command
      ? recovered.find((e) => e.command === command)
      : (receiptTarget.current ??
        (recovered.length === 1 ? recovered[0] : undefined));
    if (!target)
      return notice(
        recovered.length
          ? "Choisissez la référence de sauvegarde à vérifier."
          : "Aucune sauvegarde de référence inconnue à vérifier dans cet onglet.",
      );
    return run(async (signal) => {
      try {
        const record = await api.call(
          "reference_draft_receipts.read",
          {
            domain,
            command_id: target.command,
          },
          undefined,
          { signal },
        );
        if (
          !record ||
          record.command_id !== target.command ||
          !workId(record.receipt?.receipt_id) ||
          record.receipt.question_id !== target.question ||
          record.receipt.revision !== target.revision
        )
          throw new ApiError(200, "invalid_receipt");
        if (signal.aborted) return "";
        if (recoveryScope)
          forgetReferenceRecovery(recoveryScope, target.command);
        receiptTarget.current = undefined;
        setUncertain(false);
        reset();
        setPage(undefined);
        return `Sauvegarde retrouvée, révision ${record.receipt.revision}. Aucun nouvel envoi. Relisez vos questions pour connaître leur contenu actuel, si vos droits le permettent.`;
      } catch (e) {
        if (signal.aborted) return "";
        if (e instanceof ApiError && [401, 403].includes(e.status)) {
          reset();
          setPage(undefined);
        }
        return "Aucun reçu confirmé. Le premier envoi peut avoir réussi ; le résultat reste inconnu. Aucun nouvel envoi.";
      }
    }, "receipt");
  }
  function cancel() {
    if (active.current || unresolved)
      return notice(
        "Sauvegarde en cours ou inconnue : reprenez-la avant d’abandonner la saisie.",
      );
    reset();
    return notice(
      "Saisie locale abandonnée. Les questions enregistrées sont conservées.",
    );
  }
  function forgetRecovery(command: string) {
    if (
      active.current ||
      (uncertain && receiptTarget.current?.command === command)
    )
      return notice(
        "Vérifiez la sauvegarde en cours ou inconnue avant de retirer sa référence.",
      );
    if (!recoveryScope || !recovered.some((e) => e.command === command))
      return notice("Référence introuvable dans ce domaine.");
    try {
      forgetReferenceRecovery(recoveryScope, command);
    } catch {
      return notice("La référence locale n’a pas pu être retirée.");
    }
    return notice(
      "Référence locale retirée. Cela n’annule pas la sauvegarde et ne prouve pas son échec. Les reçus du serveur sont conservés.",
    );
  }
  async function act(i: ReferenceIntent): Promise<string> {
    if (i.kind === "reference_list") return list(i.next);
    if (i.kind === "reference_open") return open(i.value, i.reviewedRevision);
    if (i.kind === "reference_source_next")
      return picker.current?.next() ?? "Recherche indisponible.";
    if (i.kind === "reference_source_search")
      return picker.current?.search(i.value) ?? "Recherche indisponible.";
    if (i.kind === "reference_source_select")
      return picker.current?.select(i.value) ?? "Choix indisponible.";
    if (i.kind === "reference_passage") return passage(i.value);
    if (i.kind === "reference_position") return position(i.value);
    if (i.kind === "reference_field") return field(i.field, i.value);
    if (i.kind === "reference_prepare") return prepare();
    if (i.kind === "reference_confirm") return confirm();
    if (i.kind === "reference_retry") return confirm(true);
    if (i.kind === "reference_verify") return verifyReceipt(i.value);
    if (i.kind === "reference_forget") return forgetRecovery(i.value);
    if (i.kind === "reference_cancel") return cancel();
    if (unresolved)
      return notice(
        "Résultat inconnu : vérifiez le reçu avant une nouvelle question.",
      );
    if (dirty || prepared)
      return notice(
        "Enregistrez ou annulez la saisie actuelle avant une nouvelle question.",
      );
    reset();
    return notice("Nouvelle question privée : choisissez une source.");
  }
  useImperativeHandle(ref, () => ({ act }));
  return (
    <section
      className="source-contribution"
      aria-label="Préparer mes questions de référence"
    >
      <h3>Mes questions de référence</h3>
      <p>
        Préparations privées, visibles par vous seul. Ni référence approuvée, ni
        test exécuté. Les campagnes et leur couverture ne sont pas disponibles.
        Pour faire relire une version enregistrée, ouvrez le dossier « Revues de
        référence » si vos accès le permettent.
      </p>
      <button disabled={busy || unresolved} onClick={() => void list()}>
        Voir mes questions de référence
      </button>
      <button
        disabled={busy || unresolved || dirty || !!prepared}
        onClick={() => void act({ kind: "reference_new" })}
      >
        Nouvelle question de référence
      </button>
      {page && (
        <details open={!source}>
          <summary>
            Mes préparations enregistrées · {page.items.length} sur cette page
          </summary>
          <p>
            {page.items.length} préparation(s) affichée(s). Total non fourni ;
            les questions sans source actuellement accessible sont omises.
          </p>
          <ol aria-label="Questions privées">
            {page.items.map((q, n) => (
              <li key={q.id}>
                <button
                  disabled={busy || dirty || !!prepared || unresolved}
                  onClick={() => void open(q.id)}
                >
                  Ouvrir la référence {n + 1} · {q.question}
                </button>
                <p>
                  {q.theme} · Révision {q.revision}
                </p>
              </li>
            ))}
          </ol>
          {page.next_after && (
            <button
              disabled={busy || unresolved}
              onClick={() => void list(true)}
            >
              Questions de référence suivantes
            </button>
          )}
        </details>
      )}
      <SourcePicker
        ref={picker}
        api={api}
        domain={domain}
        disabled={busy || !!prepared || unresolved}
        onChoose={chooseSource}
        onNotice={notice}
      />
      {sourceMeta.current && (
        <>
          <h4>{sourceMeta.current.title}</h4>
          <section aria-label="Lecture de la source de référence">
            <p>
              Une page à la fois, au plus 8 192 caractères Unicode. Les champs
              de la question restent conservés en changeant de page.
            </p>
            {source ? (
              <>
                <p>
                  Caractères {source.start}–{source.end} sur{" "}
                  {source.total_characters} · début inclus, fin exclue.
                </p>
                <label>
                  Passage source de référence
                  <textarea
                    ref={sourceText}
                    readOnly
                    className="source-text"
                    value={source.excerpt}
                  />
                </label>
                <button
                  disabled={busy || !!prepared || unresolved}
                  onClick={useSelection}
                >
                  Utiliser la sélection comme preuve
                </button>
                <button
                  disabled={
                    busy || !!prepared || unresolved || source.start === 0
                  }
                  onClick={() => void passage("previous")}
                >
                  Passage de référence précédent
                </button>
                <button
                  disabled={
                    busy ||
                    !!prepared ||
                    unresolved ||
                    source.next_offset === null
                  }
                  onClick={() => void passage("next")}
                >
                  Passage de référence suivant
                </button>
                <p>
                  {source.next_offset === null
                    ? "Fin de la source."
                    : "Lecture partielle ; la suite reste accessible."}
                </p>
              </>
            ) : (
              <p>
                Passage masqué pendant la lecture ou après son échec. Relisez
                explicitement la source.
              </p>
            )}
            <label>
              Lire à partir du caractère
              <input
                inputMode="numeric"
                value={readOffset}
                disabled={busy || !!prepared || unresolved}
                onChange={(e) => setReadOffset(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !!prepared || unresolved}
              onClick={() => void passage(readOffset)}
            >
              Lire à cette position
            </button>
          </section>
          {(Object.keys(empty) as (keyof typeof empty)[]).map((k) => (
            <label key={k}>
              {
                {
                  theme: "Thème de référence",
                  question: "Question de référence",
                  criteria: "Critères de référence",
                  excerpt: "Preuve de référence",
                }[k]
              }
              <textarea
                ref={k === "question" ? questionInput : undefined}
                disabled={busy || !!prepared || unresolved}
                value={fields[k]}
                onChange={(e) => field(k, e.target.value)}
              />
            </label>
          ))}
          <p>
            Thème : 200 caractères ; question : 2 000 ; critères : 8 000 ;
            preuve exacte : 10 000. Aucun dépassement n’est tronqué. Sans
            position explicite, la preuve doit apparaître une seule fois dans la
            source entière, même hors de la page affichée. Si elle se répète,
            sélectionnez son occurrence ou indiquez sa position. La preuve est
            relue en entier avant sauvegarde.
          </p>
          <label>
            Début de la preuve (facultatif)
            <input
              inputMode="numeric"
              value={proofStart}
              disabled={busy || !!prepared || unresolved}
              onChange={(e) => position(e.target.value)}
            />
          </label>
          <details>
            <summary>Commandes de lecture dans le chat</summary>
            <p>
              « Passage de référence suivant », « Passage de référence précédent
              », « Lis la source de référence à : position », « Début de preuve
              de référence : position ». Les positions comptent les caractères
              Unicode, depuis zéro.
            </p>
          </details>
          <button
            disabled={busy || !!prepared || unresolved}
            onClick={() => void prepare()}
          >
            Préparer la question de référence
          </button>
          <button disabled={busy || unresolved} onClick={cancel}>
            Annuler la saisie de référence
          </button>
        </>
      )}
      {prepared && (
        <section aria-label="Sauvegarde de référence à confirmer">
          <h4>Confirmer une préparation privée</h4>
          <p>{prepared.body.content.theme}</p>
          <p>{prepared.body.content.question}</p>
          <p>{prepared.body.content.criteria}</p>
          <blockquote>{prepared.body.content.excerpt}</blockquote>
          <p>
            Preuve vérifiée aux caractères{" "}
            {prepared.body.content.selection.start}–
            {prepared.body.content.selection.end} · début inclus, fin exclue,
            positions Unicode.
          </p>
          <p>
            Révision {prepared.body.expected_revision} →{" "}
            {prepared.body.expected_revision + 1}. Aucun partage ni publication.
          </p>
          <button disabled={busy} onClick={() => void confirm(uncertain)}>
            {uncertain
              ? "Reprendre la même sauvegarde"
              : "Confirmer la question de référence"}
          </button>
        </section>
      )}
      {uncertain && receiptTarget.current && (
        <section aria-label="Sauvegarde de référence à vérifier">
          <p>
            Résultat du premier envoi inconnu. Un refus de reprise ne prouve pas
            son échec.
          </p>
          <button disabled={busy} onClick={() => void verifyReceipt()}>
            Vérifier le reçu de référence sans renvoyer
          </button>
          <details>
            <summary>Référence de cette sauvegarde</summary>
            <code className="task-id">{receiptTarget.current.command}</code>
            <p>
              Référence conservée dans cet onglet pendant 24 heures, sans texte
              ni jeton. Après rechargement, vérifiez le reçu sans renvoyer.
            </p>
          </details>
        </section>
      )}
      {!uncertain && recovered.length > 0 && (
        <section aria-label="Sauvegardes de référence après interruption">
          <h4>Sauvegardes à vérifier</h4>
          <p>
            Ces références ne contiennent ni question ni preuve. Aucun renvoi
            automatique. Vérifiez leur résultat avant une nouvelle préparation.
          </p>
          {recovered.map((e) => (
            <article key={e.command}>
              <p>
                Envoi tenté le {new Date(e.started).toLocaleString("fr-FR")} ·
                révision attendue {e.revision}.
              </p>
              <button
                disabled={busy}
                onClick={() => void verifyReceipt(e.command)}
              >
                Vérifier la sauvegarde sans renvoyer
              </button>
              <details>
                <summary>Référence et retrait local</summary>
                <code className="task-id">{e.command}</code>
                <p>
                  Retirer cette référence n’annule pas la sauvegarde et ne
                  prouve pas son échec.
                </p>
                <button
                  disabled={busy}
                  onClick={() => forgetRecovery(e.command)}
                >
                  Retirer uniquement cette référence de sauvegarde
                </button>
              </details>
            </article>
          ))}
        </section>
      )}
      {!!recovery?.expired && (
        <p role="status">
          {recovery.expired} référence(s) ont dépassé 24 heures. Relisez vos
          questions avant de relancer un travail ; l’expiration ne prouve pas un
          échec.
        </p>
      )}
      {busy && (
        <ActivityStatus>
          {phase === "saving"
            ? "Sauvegarde privée en cours…"
            : phase === "receipt"
              ? "Vérification du reçu enregistré…"
              : "Lecture des droits et des preuves…"}
        </ActivityStatus>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        Les textes restent en mémoire avant sauvegarde. Les seules références
        techniques de reprise restent dans cet onglet pendant 24 heures ; fermer
        l’espace les efface. Aucun texte ni jeton dans le stockage navigateur.
        L’effacement des préparations enregistrées n’est pas encore disponible.
      </p>
    </section>
  );
});
