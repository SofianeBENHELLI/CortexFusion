import type { ReferenceReviewEventPage } from "../../../../packages/contracts/src/ReferenceReviewEventPage";
import {
  readReviewRecovery,
  rememberReviewRecovery,
  forgetReviewRecovery,
  type RecoveryScope,
  type ReviewRecoveryEntry,
} from "./reviewRecoveryStore";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReferenceDraft } from "../../../../packages/contracts/src/ReferenceDraft";
import type { ReferenceDraftPage } from "../../../../packages/contracts/src/ReferenceDraftPage";
import type { ReferenceReviewDetail } from "../../../../packages/contracts/src/ReferenceReviewDetail";
import type { ReferenceReviewerPage } from "../../../../packages/contracts/src/ReferenceReviewerPage";
import type { ReferenceReviewPage } from "../../../../packages/contracts/src/ReferenceReviewPage";
import type { ReferenceReviewPreparation } from "../../../../packages/contracts/src/ReferenceReviewPreparation";
import type { ReferenceReviewSubmitInput } from "../../../../packages/contracts/src/ReferenceReviewSubmitInput";
import type { ReferenceReviewCommandInput } from "../../../../packages/contracts/src/ReferenceReviewCommandInput";
import type { ReferenceReviewReceipt } from "../../../../packages/contracts/src/ReferenceReviewReceipt";
import { ApiError, type CortexApi } from "./client";
import { referenceContent } from "./ReferenceWorkspace";
import { ActivityStatus } from "../ActivityStatus";
import { usePendingWork } from "./PendingWorkBoundary";
import { workId } from "./workSelection";
import type { ReferenceReviewIntent } from "./referenceReviewCommands";
export type ReferenceReviewActions = {
  act: (intent: ReferenceReviewIntent) => Promise<string>;
};
const labels = {
  awaiting_review: "À relire",
  changes_requested: "Modifications demandées",
  ready_for_owner: "Prête à présenter à l’owner",
  withdrawn: "Retirée",
};
const eventLabels = {
  submit: "Envoi de la copie",
  request_changes: "Modifications demandées",
  ready_for_owner: "Avis favorable à présenter à l’owner",
  withdraw: "Retrait de la copie",
};
const actions = {
  withdraw: "Retirer cette revue",
  request_changes: "Demander des modifications",
  ready_for_owner: "Prête à présenter à l’owner",
};
type Pending =
  | {
      type: "submit";
      body: ReferenceReviewSubmitInput;
      preview: ReferenceReviewPreparation;
    }
  | {
      type: "command";
      review: ReferenceReviewDetail;
      body: ReferenceReviewCommandInput;
    };
const validRev = (n: number) => Number.isSafeInteger(n) && n > 0;
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
const bad = () => new ApiError(200, "invalid_response");
function select<T extends { id: string }>(
  items: T[] | undefined,
  value: string,
  label: string,
) {
  const index = /^[1-9]\d*$/.test(value) ? Number(value) - 1 : -1;
  const found =
    index >= 0 ? items?.[index] : items?.find((x) => x.id === value);
  if (!found)
    throw Error(`Choisissez ${label} par son numéro dans la page courante.`);
  return found;
}
export const ReferenceReviewWorkspace = forwardRef<
  ReferenceReviewActions,
  {
    api: CortexApi;
    domain: string;
    onNotice: (text: string) => void;
    recoveryScope?: RecoveryScope;
    onChanged?: () => void;
    onEditQuestion?: (id: string, reviewedRevision: number) => Promise<string>;
  }
>(function ReferenceReviewWorkspace(
  { api, domain, onNotice, recoveryScope, onChanged, onEditQuestion },
  ref,
) {
  const [drafts, setDrafts] = useState<ReferenceDraftPage>(),
    [draft, setDraft] = useState<ReferenceDraft>(),
    [recipients, setRecipients] = useState<ReferenceReviewerPage>(),
    [reviewer, setReviewer] = useState("");
  const [page, setPage] = useState<ReferenceReviewPage>(),
    [current, setCurrent] = useState<ReferenceReviewDetail>(),
    [note, setNote] = useState("");
  const [history, setHistory] = useState<ReferenceReviewEventPage>();
  const historyFocus = useRef<HTMLElement>(null);
  useEffect(() => {
    if (history) historyFocus.current?.focus();
  }, [history]);
  const [pending, setPending] = useState<Pending>(),
    [unknown, setUnknown] = useState(false),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState("Lecture des accès et versions"),
    [message, setMessage] = useState("");
  const previewFocus = useRef<HTMLElement>(null),
    detailFocus = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pending) previewFocus.current?.focus();
  }, [pending]);
  useEffect(() => {
    if (current) detailFocus.current?.focus();
  }, [current]);
  const active = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController>(),
    target = useRef<ReviewRecoveryEntry>();
  const recovery = recoveryScope
    ? readReviewRecovery(recoveryScope)
    : undefined;
  const recovered = recovery?.entries.filter((e) => e.domain === domain) ?? [];
  const unresolved = unknown || recovered.length > 0;
  usePendingWork(
    "Revue nominative de référence",
    busy && pending
      ? "sending"
      : unresolved
        ? "uncertain"
        : note || pending
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
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  function clearContent() {
    setDrafts(undefined);
    setDraft(undefined);
    setRecipients(undefined);
    setReviewer("");
    setPage(undefined);
    setCurrent(undefined);
    setHistory(undefined);
    setNote("");
    setPending(undefined);
  }
  async function run(
    fn: (signal: AbortSignal) => Promise<string>,
    label = "Lecture des accès et versions",
  ) {
    if (active.current) return "Une opération de revue est déjà en cours.";
    active.current = true;
    setBusy(true);
    setPhase(label);
    setMessage("");
    const e = epoch.current,
      a = new AbortController();
    controller.current = a;
    try {
      const text = await fn(a.signal);
      return e === epoch.current ? notice(text) : "";
    } catch (error) {
      if (e !== epoch.current) return "";
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        clearContent();
      return notice(
        error instanceof ApiError
          ? error.status === 409
            ? "La version, le destinataire ou les droits ont changé. Relisez puis préparez de nouveau."
            : "Lecture refusée ou indisponible. Un reçu absent ne prouve pas un échec."
          : error instanceof Error
            ? error.message
            : "Opération indisponible.",
      );
    } finally {
      if (e === epoch.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function identity(signal: AbortSignal) {
    const me = await api.call("identity.read", {}, undefined, { signal });
    if (
      !me.domains.some(
        (d) => d.id === domain && d.capabilities.includes("reference_reviews"),
      )
    )
      throw new ApiError(403, "denied");
  }
  function replaceable(replacesNote = false) {
    if (unresolved)
      throw Error(
        "Résultat inconnu : vérifiez le reçu avant une autre action.",
      );
    if (pending)
      throw Error(
        "Confirmez ou annulez la préparation visible avant de changer de version.",
      );
    if (replacesNote && note)
      throw Error(
        "Un motif non envoyé est conservé sur cette revue. Préparez votre avis ou utilisez « Effacer mon motif non envoyé » avant de changer de copie.",
      );
  }
  async function questions(next = false) {
    return run(async (signal) => {
      replaceable(true);
      const after = next ? drafts?.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante.");
      await identity(signal);
      const p = await api.call("reference_drafts.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(after ? { after } : {}) },
      });
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        p.items.some(
          (x) =>
            !workId(x.id) ||
            !validRev(x.revision) ||
            typeof x.question !== "string",
        )
      )
        throw bad();
      clearContent();
      setDrafts(p);
      return `${p.items.length} question(s) privée(s) dans cette page, sans total global.`;
    });
  }
  async function chooseQuestion(value: string) {
    return run(async (signal) => {
      replaceable();
      const item = select(drafts?.items, value, "une question");
      await identity(signal);
      setDraft(undefined);
      setRecipients(undefined);
      setReviewer("");
      const d = await api.call(
        "reference_drafts.read",
        { domain, question: item.id },
        undefined,
        { signal },
      );
      if (d.id !== item.id || !validRev(d.revision)) throw bad();
      referenceContent(d.content);
      const p = await api.call(
        "reference_reviewers.list",
        { domain, question: d.id },
        undefined,
        { signal, query: { limit: 20 } },
      );
      validateRecipients(p);
      setDraft(d);
      setRecipients(p);
      setCurrent(undefined);
      return "Choisissez le responsable nommé qui recevra cette version enregistrée.";
    });
  }
  function validateRecipients(p: ReferenceReviewerPage) {
    if (
      !p ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      p.items.some(
        (x) => !x.subject || !["owner", "corpus_manager"].includes(x.role),
      )
    )
      throw bad();
  }
  async function nextRecipients() {
    return run(async (signal) => {
      replaceable();
      if (!draft || !recipients?.next_after)
        throw Error("Aucune page suivante.");
      await identity(signal);
      const p = await api.call(
        "reference_reviewers.list",
        { domain, question: draft.id },
        undefined,
        { signal, query: { limit: 20, after: recipients.next_after } },
      );
      validateRecipients(p);
      setRecipients(p);
      setReviewer("");
      return "Page suivante des responsables déjà autorisés à lire la source.";
    });
  }
  async function chooseRecipient(value: string) {
    return run(async () => {
      replaceable();
      const n = /^[1-9]\d*$/.test(value) ? Number(value) - 1 : -1;
      const r =
        n >= 0
          ? recipients?.items[n]
          : recipients?.items.find((x) => x.subject === value);
      if (!r)
        throw Error(
          "Choisissez un responsable par son numéro dans la page courante.",
        );
      setReviewer(r.subject);
      return `Responsable sélectionné : ${r.subject}. Aucun envoi effectué.`;
    });
  }
  async function prepare() {
    return run(async (signal) => {
      replaceable();
      if (!draft || !reviewer)
        throw Error(
          "Choisissez d’abord une question enregistrée et un responsable.",
        );
      await identity(signal);
      const selection = {
        question_id: draft.id,
        draft_revision: draft.revision,
        reviewer,
      };
      const p = await api.call(
        "reference_reviews.prepare",
        { domain },
        selection,
        { signal },
      );
      if (
        !p ||
        p.question_id !== draft.id ||
        p.draft_revision !== draft.revision ||
        p.reviewer !== reviewer ||
        !workId(p.preparation_id) ||
        !Number.isFinite(Date.parse(p.expires_at)) ||
        Date.parse(p.expires_at) <= Date.now()
      )
        throw bad();
      referenceContent(p.content);
      if (
        [
          "theme",
          "question",
          "criteria",
          "excerpt",
          "source_id",
          "source_hash",
        ].some(
          (k) =>
            p.content[k as keyof typeof p.content] !==
            draft.content[k as keyof typeof draft.content],
        ) ||
        p.content.selection.start !== draft.content.selection.start ||
        p.content.selection.end !== draft.content.selection.end
      )
        throw bad();
      setPending({
        type: "submit",
        preview: p,
        body: {
          ...selection,
          preparation_id: p.preparation_id,
          idempotency_key: crypto.randomUUID(),
        },
      });
      return "Envoi préparé. Vérifiez la copie complète et le destinataire, puis confirmez explicitement.";
    }, "Préparation de la copie et vérification du destinataire");
  }
  async function list(scope: "mine" | "assigned", next = false) {
    return run(async (signal) => {
      replaceable(true);
      const after = next && page?.scope === scope ? page.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante.");
      await identity(signal);
      const p = await api.call(
        "reference_reviews.list",
        { domain },
        undefined,
        { signal, query: { limit: 20, scope, ...(after ? { after } : {}) } },
      );
      if (
        !p ||
        p.scope !== scope ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        p.items.some(
          (x) =>
            !workId(x.id) ||
            !validRev(x.revision) ||
            !Object.hasOwn(labels, x.status),
        )
      )
        throw bad();
      clearContent();
      setPage(p);
      return `${p.items.length} revue(s) dans cette page. Seuls les contenus actuellement accessibles apparaissent.`;
    });
  }
  async function open(value: string) {
    return run(async (signal) => {
      replaceable(true);
      setHistory(undefined);
      const id = workId(value)
        ? value
        : select(page?.items, value, "une revue").id;
      await identity(signal);
      setCurrent(undefined);
      const r = await api.call(
        "reference_reviews.read",
        { domain, review: id },
        undefined,
        { signal },
      );
      if (
        !r ||
        r.id !== id ||
        !validRev(r.revision) ||
        !Object.hasOwn(labels, r.status) ||
        !Array.isArray(r.actions) ||
        r.actions.some((x) => !Object.hasOwn(actions, x)) ||
        (r.status === "withdrawn"
          ? r.content !== null || r.review_note !== "" || r.actions.length > 0
          : !r.content)
      )
        throw bad();
      if (r.content) referenceContent(r.content);
      setCurrent(r);
      setNote("");
      return "Version de revue relue. Son avis ne vaut pas approbation officielle.";
    });
  }
  async function editQuestion() {
    return run(async (signal) => {
      replaceable();
      if (
        !current ||
        !recoveryScope ||
        current.author !== recoveryScope.subject ||
        !onEditQuestion
      )
        throw Error(
          "Seul l’auteur peut reprendre sa question privée depuis cette revue.",
        );
      const selected = current;
      await identity(signal);
      const latest = await api.call(
        "reference_reviews.read",
        { domain, review: selected.id },
        undefined,
        { signal },
      );
      if (
        !latest ||
        latest.id !== selected.id ||
        latest.author !== recoveryScope.subject ||
        !workId(latest.question_id) ||
        !validRev(latest.draft_revision)
      )
        throw bad();
      if (
        latest.question_id !== selected.question_id ||
        latest.draft_revision !== selected.draft_revision ||
        latest.revision !== selected.revision ||
        latest.status !== selected.status
      ) {
        clearContent();
        throw new ApiError(409, "review_changed");
      }
      if (signal.aborted) return "";
      return onEditQuestion(latest.question_id, latest.draft_revision);
    });
  }
  async function readHistory(next = false) {
    return run(async (signal) => {
      replaceable();
      if (!current) throw Error("Ouvrez d’abord la revue à relire.");
      const after = next ? history?.next_after : undefined;
      if (next && !after)
        throw Error("Aucune page suivante dans cet historique.");
      const selected = current;
      setHistory(undefined);
      try {
        await identity(signal);
        const h = await api.call(
          "reference_reviews.events",
          { domain, review: selected.id },
          undefined,
          {
            signal,
            query: {
              limit: 20,
              expected_revision: selected.revision,
              ...(after ? { after } : {}),
            },
          },
        );
        const limit = after ?? 0;
        const mapped = {
          submit: "awaiting_review",
          request_changes: "changes_requested",
          ready_for_owner: "ready_for_owner",
          withdraw: "withdrawn",
        };
        if (
          !h ||
          h.review_id !== selected.id ||
          h.review_revision !== selected.revision ||
          h.status !== selected.status ||
          h.content_withheld !== (h.status === "withdrawn") ||
          !Number.isSafeInteger(h.total) ||
          h.total < 0 ||
          h.total !== h.review_revision ||
          !Array.isArray(h.items) ||
          h.items.length !== Math.min(20, h.total - limit) ||
          h.items.some(
            (e, i) =>
              !e ||
              !workId(e.id) ||
              typeof e.actor !== "string" ||
              !e.actor.trim() ||
              Array.from(e.actor).length > 200 ||
              !Object.hasOwn(mapped, e.action) ||
              mapped[e.action] !== e.status ||
              e.revision !== limit + i + 1 ||
              !Number.isFinite(Date.parse(e.created_at)) ||
              (h.content_withheld
                ? e.note !== null
                : typeof e.note !== "string" ||
                  Array.from(e.note).length > 2000),
          ) ||
          new Set(h.items.map((e) => e.id)).size !== h.items.length ||
          h.next_after !==
            (limit + h.items.length < h.total ? limit + h.items.length : null)
        )
          throw bad();
        setHistory(h);
        return "Historique relu sous vos accès actuels. Aucune action exécutée.";
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) clearContent();
        throw error;
      }
    }, "Lecture de l’historique autorisé");
  }
  async function prepareAction(action: ReferenceReviewCommandInput["action"]) {
    return run(async (signal) => {
      replaceable();
      if (!current || !current.actions.includes(action))
        throw Error("Cette action n’est pas disponible sur la revue courante.");
      if (!note.trim() || Array.from(note).length > 2000 || note.includes("\0"))
        throw Error("Saisissez un motif de 1 à 2 000 caractères.");
      await identity(signal);
      setPending({
        type: "command",
        review: current,
        body: {
          action,
          expected_revision: current.revision,
          note,
          idempotency_key: crypto.randomUUID(),
        },
      });
      return "Action préparée sur cette version. Relisez l’effet et le motif puis confirmez.";
    });
  }
  function validReceipt(
    r: ReferenceReviewReceipt,
    t: NonNullable<typeof target.current>,
  ) {
    if (
      !r ||
      !workId(r.review_id) ||
      !workId(r.event_id) ||
      r.revision !== t.revision ||
      r.status !== t.status ||
      (t.review && t.review !== r.review_id)
    )
      throw bad();
    return r;
  }
  function success(r: ReferenceReviewReceipt, command: string) {
    onChanged?.();
    if (recoveryScope) forgetReviewRecovery(recoveryScope, command);
    target.current = undefined;
    setUnknown(false);
    clearContent();
    return `Action enregistrée · ${labels[r.status]} · révision ${r.revision}. Relisez la revue pour son état actuel. Aucun savoir approuvé ou publié.`;
  }
  async function confirm(retry = false) {
    return run(async (signal) => {
      if (!pending)
        throw Error(
          unknown
            ? "Charge non disponible : vérifiez uniquement le reçu."
            : "Préparez d’abord l’action.",
        );
      if (unknown && !retry)
        throw Error(
          "Résultat inconnu : vérifiez le reçu, ou reprenez explicitement la même action.",
        );
      if (
        !unknown &&
        pending.type === "submit" &&
        Date.parse(pending.preview.expires_at) <= Date.now()
      ) {
        setPending(undefined);
        throw Error("Préparation expirée. Préparez de nouveau l’envoi.");
      }
      await identity(signal);
      const t: ReviewRecoveryEntry = {
        domain,
        started: Date.now(),
        command: pending.body.idempotency_key,
        revision:
          pending.type === "submit" ? 1 : pending.body.expected_revision + 1,
        status:
          pending.type === "submit"
            ? "awaiting_review"
            : pending.body.action === "withdraw"
              ? "withdrawn"
              : pending.body.action === "request_changes"
                ? "changes_requested"
                : "ready_for_owner",
        review: pending.type === "command" ? pending.review.id : null,
      };
      if (!recoveryScope)
        throw Error(
          "Identité vérifiée nécessaire pour conserver la référence de reprise.",
        );
      try {
        rememberReviewRecovery(recoveryScope, t);
      } catch {
        throw Error(
          "Référence de reprise indisponible. Aucun envoi effectué : libérez explicitement une ancienne référence ou rétablissez le stockage de cet onglet.",
        );
      }
      target.current = t;
      try {
        const r =
          pending.type === "submit"
            ? await api.call(
                "reference_reviews.submit",
                { domain },
                pending.body,
                { signal },
              )
            : await api.call(
                "reference_reviews.command",
                { domain, review: pending.review.id },
                pending.body,
                { signal },
              );
        return success(validReceipt(r, t), t.command);
      } catch (e) {
        if (!unknown && rejected(e)) {
          forgetReviewRecovery(recoveryScope, t.command);
          target.current = undefined;
          setPending(undefined);
          throw e;
        }
        setUnknown(true);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          clearContent();
        return "Résultat inconnu : vérifiez le reçu sans renvoyer. Une reprise refusée ne prouve pas l’échec de l’envoi initial.";
      }
    }, "Enregistrement de l’action de revue");
  }
  async function verify(value?: string) {
    return run(async (signal) => {
      const t = value
        ? recovered.find((e) => e.command === value)
        : (target.current ??
          (recovered.length === 1 ? recovered[0] : undefined));
      if (!t)
        throw Error(
          "Choisissez une référence de commande à vérifier dans la liste de reprise.",
        );
      await identity(signal);
      const r = await api.call(
        "reference_review_receipts.read",
        { domain, command_id: t.command },
        undefined,
        { signal },
      );
      if (!r || r.command_id !== t.command) throw bad();
      return success(validReceipt(r.receipt, t), t.command);
    }, "Vérification du reçu, sans nouvel envoi");
  }
  async function act(i: ReferenceReviewIntent): Promise<string> {
    if (active.current) return "Une opération de revue est déjà en cours.";
    switch (i.kind) {
      case "reference_review_discard_note":
        return run(async () => {
          replaceable();
          setNote("");
          return "Motif non envoyé effacé de cet onglet. Aucun avis enregistré n’est modifié.";
        });
      case "reference_review_edit":
        return editQuestion();
      case "reference_review_history":
        return readHistory(i.next);
      case "reference_review_list":
        return list(i.scope, i.next);
      case "reference_review_questions":
        return questions(i.next);
      case "reference_review_question":
        return chooseQuestion(i.value);
      case "reference_review_recipient":
        return chooseRecipient(i.value);
      case "reference_review_recipients_next":
        return nextRecipients();
      case "reference_review_prepare":
        return prepare();
      case "reference_review_open":
        return open(i.value);
      case "reference_review_note":
        return run(async () => {
          replaceable();
          if (Array.from(i.value).length > 2000 || i.value.includes("\0"))
            throw Error("Motif limité à 2 000 caractères.");
          setNote(i.value);
          return "Motif saisi, aucune action envoyée.";
        });
      case "reference_review_action":
        return prepareAction(i.action);
      case "reference_review_confirm":
        return confirm();
      case "reference_review_retry":
        return unknown
          ? confirm(true)
          : notice("Aucun résultat inconnu à reprendre.");
      case "reference_review_verify":
        return verify(i.value);
      case "reference_review_forget":
        if (unknown)
          return notice("Vérifiez d’abord l’action encore en mémoire.");
        if (!recoveryScope || !recovered.some((e) => e.command === i.value))
          return notice("Référence locale absente.");
        forgetReviewRecovery(recoveryScope, i.value);
        return notice(
          "Référence retirée de cet onglet seulement. Cela n’annule aucune action et ne prouve aucun échec.",
        );
      case "reference_review_cancel":
        if (unknown)
          return notice(
            "Vérifiez le résultat inconnu avant de remplacer son intention.",
          );
        setPending(undefined);
        return notice("Préparation annulée, aucun envoi effectué.");
    }
  }
  useImperativeHandle(ref, () => ({ act }));
  const disabled = busy || unresolved || !!pending;
  const preview =
    pending?.type === "submit"
      ? pending.preview.content
      : pending?.review.content;
  return (
    <section
      className="source-contribution reference-review-workspace"
      aria-label="Revues nominatives de référence"
    >
      <h3>Faire relire une question</h3>
      <p>
        Envoyez une version enregistrée à un responsable nommé, puis suivez son
        avis. Une revue favorable reste à présenter à l’owner : elle n’approuve
        pas le savoir.
      </p>
      <div className="button-row">
        <button disabled={disabled} onClick={() => void questions()}>
          Choisir une question à soumettre
        </button>
        <button disabled={disabled} onClick={() => void list("mine")}>
          Mes envois en revue
        </button>
        <button disabled={disabled} onClick={() => void list("assigned")}>
          Mes références à relire
        </button>
      </div>
      {drafts && (
        <details open={!draft}>
          <summary>
            Questions privées · {drafts.items.length} sur cette page
          </summary>
          <ol>
            {drafts.items.map((d, n) => (
              <li key={d.id}>
                <button
                  disabled={disabled}
                  onClick={() => void chooseQuestion(String(n + 1))}
                >
                  {n + 1}. {d.question} · v{d.revision}
                </button>
              </li>
            ))}
          </ol>
          {drafts.next_after && (
            <button disabled={disabled} onClick={() => void questions(true)}>
              Questions à soumettre suivantes
            </button>
          )}
        </details>
      )}
      {draft && (
        <p>
          Question choisie : {draft.content.question} · version privée{" "}
          {draft.revision}
        </p>
      )}
      {recipients && (
        <>
          <h4>Responsable nommé</h4>
          <p>
            Déjà autorisé à lire la source. Aucun accès supplémentaire ne sera
            accordé.
          </p>
          <ol>
            {recipients.items.map((r, n) => (
              <li key={r.subject}>
                <button
                  aria-pressed={reviewer === r.subject}
                  disabled={disabled}
                  onClick={() => void chooseRecipient(String(n + 1))}
                >
                  {n + 1}. {r.subject} ·{" "}
                  {r.role === "owner" ? "Owner" : "Responsable de corpus"}
                </button>
              </li>
            ))}
          </ol>
          {!recipients.items.length && (
            <p>Aucun responsable disponible sur cette page.</p>
          )}
          {recipients.next_after && (
            <button disabled={disabled} onClick={() => void nextRecipients()}>
              Responsables suivants
            </button>
          )}
          <button
            disabled={disabled || !reviewer}
            onClick={() => void prepare()}
          >
            Préparer l’envoi en revue
          </button>
        </>
      )}
      {page && (
        <>
          <p>{page.items.length} revue(s) sur cette page · total non fourni.</p>
          <ol>
            {page.items.map((r, n) => (
              <li key={r.id}>
                <button
                  disabled={disabled}
                  onClick={() => void open(String(n + 1))}
                >
                  {n + 1}. {r.question ?? "Revue retirée"} · {labels[r.status]}
                </button>
              </li>
            ))}
          </ol>
          {page.next_after && (
            <button
              disabled={disabled}
              onClick={() => void list(page.scope, true)}
            >
              Revues suivantes
            </button>
          )}
        </>
      )}
      {current && (
        <section
          ref={detailFocus}
          tabIndex={-1}
          aria-label="Version de référence en revue"
        >
          <h4>{labels[current.status]}</h4>
          <p>
            Auteur {current.author} → responsable {current.reviewer}. Version
            privée figée {current.draft_revision} · suivi de revue{" "}
            {current.revision}.
          </p>
          <button disabled={disabled} onClick={() => void readHistory()}>
            Lire l’historique de la revue
          </button>
          {onEditQuestion && recoveryScope?.subject === current.author && (
            <div>
              <button disabled={disabled} onClick={() => void editQuestion()}>
                Reprendre ma question privée
              </button>
              <p>
                Ouvre votre version privée actuelle. La copie partagée et son
                avis restent inchangés ; une correction devra être enregistrée
                puis soumise à nouveau.
              </p>
            </div>
          )}
          {current.content && <Evidence content={current.content} />}
          <p>
            {current.status === "withdrawn"
              ? "Copie retirée. Contenu et avis masqués."
              : current.review_note || "Aucun avis rendu."}
          </p>
          {current.actions.length > 0 && (
            <>
              <label>
                Motif de revue
                <textarea
                  value={note}
                  disabled={disabled}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>
                {Array.from(note).length} / 2 000 caractères · non envoyé tant
                que vous n’avez pas confirmé l’action.
              </p>
              {!!note && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    void act({ kind: "reference_review_discard_note" })
                  }
                >
                  Effacer mon motif non envoyé
                </button>
              )}
              {current.actions.map((a) => (
                <button
                  key={a}
                  disabled={disabled}
                  onClick={() => void prepareAction(a)}
                >
                  {actions[a]}
                </button>
              ))}
            </>
          )}
        </section>
      )}
      {history && (
        <section
          ref={historyFocus}
          tabIndex={-1}
          aria-label="Historique de la revue"
        >
          <h4>Qui a fait quoi</h4>
          <p>
            État relu : {labels[history.status]} · version{" "}
            {history.review_revision}. {history.items.length} événements dans
            cette page sur {history.total}, du plus ancien au plus récent.
          </p>
          {history.content_withheld && (
            <p>Copie retirée : tous les motifs historiques sont masqués.</p>
          )}
          <ol>
            {history.items.map((e) => (
              <li key={e.id}>
                <p>
                  <strong>{eventLabels[e.action]}</strong> · version{" "}
                  {e.revision}
                </p>
                <p>
                  {e.actor} · {new Date(e.created_at).toLocaleString("fr-FR")} ·{" "}
                  {labels[e.status]}
                </p>
                {e.note !== null && e.note && <p>{e.note}</p>}
              </li>
            ))}
          </ol>
          {history.next_after !== null && (
            <button disabled={disabled} onClick={() => void readHistory(true)}>
              Événements suivants
            </button>
          )}
        </section>
      )}
      {pending && (
        <section
          ref={previewFocus}
          tabIndex={-1}
          aria-label="Action de revue à confirmer"
        >
          <h4>
            {pending.type === "submit"
              ? `Envoyer à ${pending.preview.reviewer}`
              : actions[pending.body.action]}
          </h4>
          {pending.type === "submit" ? (
            <p>
              Copie figée de la version {pending.preview.draft_revision}.
              Préparation valable jusqu’à{" "}
              {new Date(pending.preview.expires_at).toLocaleTimeString("fr-FR")}
              . Seuls vous et ce responsable pourrez lire cette copie, selon vos
              droits actuels.
            </p>
          ) : (
            <p>
              {pending.body.action === "withdraw"
                ? "Le destinataire ne verra plus le contenu de cette copie."
                : "Cet avis ne vaut pas approbation officielle."}{" "}
              Révision attendue {pending.body.expected_revision}. Motif :{" "}
              {pending.body.note}
            </p>
          )}
          {preview && <Evidence content={preview} />}
          <button disabled={busy || unknown} onClick={() => void confirm()}>
            Confirmer l’action de revue
          </button>
          <button
            disabled={busy || unknown}
            onClick={() => void act({ kind: "reference_review_cancel" })}
          >
            Annuler la préparation de revue
          </button>
        </section>
      )}
      {unresolved && (
        <section aria-label="Résultat de revue inconnu">
          <h4>Actions à vérifier</h4>
          <p>
            Seuls des identifiants, état attendu, révision et date sont
            conservés dans cet onglet pendant 24 heures. Aucun texte ni jeton.
            Vérifier ne renvoie pas l’action.
          </p>
          {recovered.map((e) => (
            <div key={e.command}>
              <p>
                Commande {e.command} · {labels[e.status]} · révision attendue{" "}
                {e.revision} · {new Date(e.started).toLocaleString("fr-FR")}
              </p>
              <button disabled={busy} onClick={() => void verify(e.command)}>
                Vérifier le reçu {e.command}
              </button>
              {!unknown && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({
                      kind: "reference_review_forget",
                      value: e.command,
                    })
                  }
                >
                  Retirer cette référence locale {e.command}
                </button>
              )}
            </div>
          ))}
          {unknown && (
            <>
              <button disabled={busy} onClick={() => void verify()}>
                Vérifier le reçu de revue
              </button>
              {pending && (
                <button disabled={busy} onClick={() => void confirm(true)}>
                  Reprendre exactement l’action de revue
                </button>
              )}
            </>
          )}
        </section>
      )}
      {!!recovery?.expired && (
        <p>
          Une référence de reprise a expiré. Cela ne prouve pas l’échec de
          l’action : relisez le suivi avant tout nouvel envoi.
        </p>
      )}
      {busy && <ActivityStatus>{phase}</ActivityStatus>}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Agir par chat</summary>
        <p>
          Sur la copie ouverte : « historique de la revue », puis « historique
          de revue suivant ». Pour l’auteur : « reprends ma question privée ».
          Pour abandonner le motif local : « efface mon motif de revue ».
        </p>
        <p>
          Commandes explicites, sans agent LLM général : « questions à soumettre
          », « question à soumettre : 1 », « responsable de la revue : 1 », «
          prépare l’envoi en revue », « confirme l’action de revue ». Pour le
          suivi : « mes revues de référence », « références à relire », « ouvre
          la revue de référence : 1 », « motif de revue : … », « demande des
          corrections de référence », « prépare pour l’owner » ou « retire la
          revue de référence ». Vérification : « vérifie le reçu de revue : UUID
          ». Pour retirer seulement une référence locale après rechargement : «
          retire la référence de revue : UUID ». Les boutons utilisent les mêmes
          mécanismes.
        </p>
      </details>
    </section>
  );
});
function Evidence({ content }: { content: ReferenceDraft["content"] }) {
  return (
    <div>
      <p>
        <strong>{content.theme}</strong>
      </p>
      <p>{content.question}</p>
      <p>Critères attendus : {content.criteria}</p>
      <blockquote>{content.excerpt}</blockquote>
      <details>
        <summary>Provenance de la copie</summary>
        <p>
          Source {content.source_id} · caractères Unicode{" "}
          {content.selection.start}–{content.selection.end} · empreinte{" "}
          {content.source_hash}
        </p>
      </details>
    </div>
  );
}
