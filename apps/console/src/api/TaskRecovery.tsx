import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { validateTaskRecord } from "./TaskReceipts";
import { taskEventLabels, taskStatuses } from "./taskCommands";
import {
  forgetTaskRecovery,
  readTaskRecovery,
  type RecoveryScope,
} from "./taskRecoveryStore";
export type TaskRecoveryHandle = {
  verify: (id?: string) => Promise<string>;
  forget: (id: string) => Promise<string>;
};
export const TaskRecovery = forwardRef<
  TaskRecoveryHandle,
  {
    api: CortexApi;
    scope: RecoveryScope;
    domain: string;
    refresh: number;
    onNotice: (text: string) => void;
    onResolved: (id: string) => void;
    onBusy: (busy: boolean) => void;
  }
>(function TaskRecovery(
  { api, scope, domain, refresh, onNotice, onResolved, onBusy },
  ref,
) {
  const [state, setState] = useState(() => readTaskRecovery(scope));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false),
    controller = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => {
    setState(readTaskRecovery(scope));
  }, [scope.tenant, scope.subject, domain, refresh]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  function notice(text: string) {
    if (mounted.current) {
      setMessage(text);
      onNotice(text);
    }
    return text;
  }
  async function verify(id?: string) {
    if (active.current)
      return notice("Une vérification de reçu est déjà en cours.");
    const entries = readTaskRecovery(scope).entries.filter(
      (e) => e.domain === domain,
    );
    const entry = id
      ? entries.find((e) => e.command === id)
      : entries.length === 1
        ? entries[0]
        : undefined;
    if (!entry)
      return notice(
        entries.length
          ? "Choisissez la référence de l’action à vérifier dans le dossier."
          : "Aucune référence locale à vérifier dans ce domaine.",
      );
    active.current = true;
    setMessage("");
    setBusy(true);
    onBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const record = validateTaskRecord(
        await api.call(
          "task_receipts.read",
          { domain, command_id: entry.command },
          undefined,
          { signal: abort.signal },
        ),
      );
      if (
        record.command_id !== entry.command ||
        record.action !== entry.action ||
        record.receipt.revision !== entry.revision ||
        (entry.task !== null && record.receipt.task_id !== entry.task)
      )
        throw new ApiError(200, "invalid_response");
      if (!mounted.current || abort.signal.aborted) return "";
      forgetTaskRecovery(scope, entry.command);
      setState(readTaskRecovery(scope));
      onResolved(entry.command);
      return notice(
        `Action retrouvée : ${taskEventLabels[record.action]} · ${taskStatuses[record.receipt.status]} · révision ${record.receipt.revision}. Aucun nouvel envoi. Consultez les actions enregistrées pour l’état actuel.`,
      );
    } catch {
      if (!mounted.current || abort.signal.aborted) return "";
      return notice(
        "Aucun reçu confirmé. L’action peut encore être en cours ou inaccessible ; son résultat reste inconnu. Aucun nouvel envoi.",
      );
    } finally {
      active.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  async function forget(id: string) {
    if (active.current) return notice("Attendez la fin de la vérification.");
    if (
      !readTaskRecovery(scope).entries.some(
        (e) => e.domain === domain && e.command === id,
      )
    )
      return notice("Référence introuvable dans cet espace.");
    forgetTaskRecovery(scope, id);
    setState(readTaskRecovery(scope));
    onResolved(id);
    return notice(
      "Référence locale retirée. Cela n’annule pas l’action et ne prouve pas son échec. Les reçus restent consultables.",
    );
  }
  useImperativeHandle(ref, () => ({ verify, forget }));
  const entries = state.entries.filter((e) => e.domain === domain);
  if (!entries.length && !state.expired && !message) return null;
  return (
    <section aria-label="Actions à vérifier après interruption">
      <h3>Actions à vérifier</h3>
      <p>
        Les références de cet onglet sont utilisables pendant 24 heures,
        sans texte ni jeton. Aucun renvoi automatique. Fermer l’espace efface
        ces références ; les reçus du serveur restent disponibles.
      </p>
      {!!state.expired && (
        <p role="status">
          {state.expired} référence(s) ont dépassé les 24 heures. Consultez vos
          actions enregistrées avant de relancer un travail.
        </p>
      )}
      {entries.map((e) => (
        <article key={e.command} aria-label={`Action ${e.command}`}>
          <strong>{taskEventLabels[e.action]}</strong>
          <p>
            Envoi tenté le {new Date(e.started).toLocaleString("fr-FR")} ·
            résultat à vérifier.
          </p>
          <details>
            <summary>Référence de récupération</summary>
            <code className="task-id">{e.command}</code>
          </details>
          <button disabled={busy} onClick={() => void verify(e.command)}>
            Vérifier le reçu sans renvoyer
          </button>
          <details>
            <summary>Retirer la référence locale</summary>
            <p>
              Cette action ne supprime aucun reçu et n’annule aucune commande.
              Vérifiez le résultat avant de créer une autre intention.
            </p>
            <button disabled={busy} onClick={() => void forget(e.command)}>
              Retirer uniquement cette référence
            </button>
          </details>
        </article>
      ))}
      {busy && (
        <ActivityStatus>Vérification du reçu enregistré…</ActivityStatus>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
});
