import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { WorkActivityPage } from "../../../../packages/contracts/src/WorkActivityPage";
import type { WorkActivityItem } from "../../../../packages/contracts/src/WorkActivityItem";
import { ApiError, type CortexApi } from "./client";
import { ActivityStatus } from "../ActivityStatus";
import { workId } from "./workSelection";
import {
  dateValid,
  whole,
  textBound,
  missionLabels,
} from "./missionValidation";
import { caseStatuses } from "./caseCommands";
import { taskStatuses, taskEventLabels } from "./taskCommands";
import type { ActivityIntent } from "./activityCommands";
import type { RecoveryScope } from "./taskRecoveryStore";
export type WorkActivityActions = {
  act: (i: ActivityIntent) => Promise<string>;
};
const reviewStatuses = {
  awaiting_review: "À relire",
  changes_requested: "Modifications demandées",
  ready_for_owner: "Prête à présenter au responsable",
  withdrawn: "Retirée",
};
const kinds = {
  task: "Tâche",
  reference_review: "Revue de référence",
  mission: "Mission d’agent",
  shared_case: "Dossier partagé",
};
function status(n: WorkActivityItem) {
  const labels =
    n.kind === "task"
      ? taskStatuses
      : n.kind === "mission"
        ? missionLabels
        : n.kind === "shared_case"
          ? caseStatuses
          : reviewStatuses;
  return labels[n.current_status as keyof typeof labels] ?? n.current_status;
}
function eventLabel(n: WorkActivityItem) {
  if (n.kind === "shared_case")
    return (
      {
        share: "Partage reçu",
        link_task: "Tâche associée",
        unlink_task: "Association de tâche retirée",
        qualify: "Dossier qualifié",
        close_without_change: "Dossier clos sans changement",
        reopen: "Dossier rouvert",
        withdraw: "Partage retiré",
      }[n.action] ?? n.action
    );
  return n.kind === "task"
    ? ({ create: "Création", ...taskEventLabels }[n.action] ?? n.action)
    : n.kind === "mission"
      ? n.action === "claim"
        ? "Bail réclamé par le service"
        : "Rapport candidat remis"
      : ({
          submit: "Demande de revue reçue",
          withdraw: "Copie retirée",
          request_changes: "Modifications demandées",
          ready_for_owner: "Avis prêt pour le responsable",
        }[n.action] ?? n.action);
}
const keys = [
  "kind",
  "event_id",
  "target_id",
  "title",
  "current_status",
  "current_revision",
  "action",
  "actor",
  "event_revision",
  "created_at",
  "read_at",
  "content_available",
]
  .sort()
  .join();
export function validateActivity(p: WorkActivityPage) {
  const bad = () => new ApiError(200, "invalid_response");
  if (
    !p ||
    !Array.isArray(p.items) ||
    p.items.length > 20 ||
    !whole(p.total) ||
    !whole(p.unread, 0, p.total) ||
    p.total < p.items.length ||
    !dateValid(p.as_of) ||
    !whole(p.permissions_version) ||
    !whole(p.work_version) ||
    !whole(p.source_access_version) ||
    p.scope !== "personal" ||
    p.sort !== "created_kind_event_desc" ||
    !(p.next_after === null || workId(p.next_after)) ||
    !Array.isArray(p.coverage) ||
    p.coverage.join() !==
      "task_notifications,named_reference_reviews,mission_claims_and_reports,named_shared_cases"
  )
    throw bad();
  for (const n of p.items) {
    if (
      !n ||
      Object.keys(n).sort().join() !== keys ||
      !Object.hasOwn(kinds, n.kind) ||
      !workId(n.event_id) ||
      !workId(n.target_id) ||
      !whole(n.current_revision, 1) ||
      !whole(n.event_revision, 1, n.current_revision) ||
      !dateValid(n.created_at) ||
      !(n.read_at === null || dateValid(n.read_at)) ||
      typeof n.content_available !== "boolean" ||
      !textBound(n.action, 100) ||
      !(n.actor === null || textBound(n.actor, 300)) ||
      !(n.title === null || textBound(n.title, 2000))
    )
      throw bad();
    if (
      !Object.hasOwn(
        n.kind === "task"
          ? taskStatuses
          : n.kind === "mission"
            ? missionLabels
            : n.kind === "shared_case"
              ? caseStatuses
              : reviewStatuses,
        n.current_status,
      )
    )
      throw bad();
    if (
      n.content_available
        ? n.title === null || (n.kind !== "shared_case" && n.actor === null)
        : n.kind === "task" || n.title !== null || n.actor !== null
    )
      throw bad();
    if (
      n.kind === "shared_case" &&
      (n.actor !== null ||
        ![
          "share",
          "qualify",
          "close_without_change",
          "reopen",
          "withdraw",
          "link_task",
          "unlink_task",
        ].includes(n.action))
    )
      throw bad();
    if (n.kind === "mission" && !["claim", "complete"].includes(n.action))
      throw bad();
    if (
      n.kind === "reference_review" &&
      !["submit", "withdraw", "request_changes", "ready_for_owner"].includes(
        n.action,
      )
    )
      throw bad();
  }
  if (
    new Set(p.items.map((n) => `${n.kind}:${n.event_id}`)).size !==
    p.items.length
  )
    throw bad();
  return p;
}
export const WorkActivity = forwardRef<
  WorkActivityActions,
  {
    api: CortexApi;
    domain: string;
    scope?: RecoveryScope;
    onNotice: (s: string) => void;
    onOpen: (n: WorkActivityItem) => Promise<string>;
  }
>(function WorkActivity({ api, domain, scope, onNotice, onOpen }, ref) {
  const [page, setPage] = useState<WorkActivityPage>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [phase, setPhase] = useState("Lecture de votre activité…");
  const [pending, setPending] = useState<{
    item: WorkActivityItem;
    key: string;
  }>();
  const active = useRef(false),
    epoch = useRef(0),
    abort = useRef<AbortController>(),
    focus = useRef<HTMLElement>(null);
  useEffect(
    () => () => {
      epoch.current++;
      abort.current?.abort();
    },
    [api, domain],
  );
  useEffect(() => {
    if (page) focus.current?.focus();
  }, [page]);
  function notice(s: string) {
    setMessage(s);
    onNotice(s);
    return s;
  }
  async function identity(signal: AbortSignal) {
    const me = await api.call("identity.read", {}, undefined, { signal });
    if (
      (scope &&
        (me.tenant_id !== scope.tenant || me.subject !== scope.subject)) ||
      !me.domains.some(
        (d) => d.id === domain && d.capabilities.includes("work_activity"),
      )
    )
      throw new ApiError(403, "denied");
  }
  async function run(
    fn: (s: AbortSignal) => Promise<string>,
    label = "Lecture de votre activité…",
  ) {
    if (active.current) return "Une lecture est déjà en cours.";
    active.current = true;
    setBusy(true);
    setPhase(label);
    setMessage("");
    const e = epoch.current,
      a = new AbortController();
    abort.current = a;
    try {
      const result = await fn(a.signal);
      return e === epoch.current ? notice(result) : "";
    } catch (error) {
      if (e !== epoch.current) return "";
      setPage(undefined);
      return notice(
        error instanceof ApiError
          ? error.status === 409
            ? "La liste a changé. Actualisez votre boîte de réception avant de poursuivre."
            : "Activité indisponible ou accès retiré. Les anciens éléments sont masqués."
          : error instanceof Error
            ? error.message
            : "Lecture indisponible.",
      );
    } finally {
      if (e === epoch.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function list(next = false) {
    return run(async (signal) => {
      const after = next ? page?.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante chargée.");
      setPage(undefined);
      await identity(signal);
      const p = validateActivity(
        await api.call("work_activity.list", { domain }, undefined, {
          signal,
          query: { limit: 20, ...(after ? { after } : {}) },
        }),
      );
      if (signal.aborted) return "";
      setPage(p);
      if (
        pending &&
        p.items.some(
          (n) =>
            n.kind === pending.item.kind &&
            n.event_id === pending.item.event_id &&
            n.read_at !== null,
        )
      ) {
        setPending(undefined);
        return "État relu : cet événement est marqué comme lu. Aucun état métier n’a changé.";
      }
      return `${p.items.length} événements affichés sur ${p.total}, dont ${p.unread} non lus au total.${pending ? " La lecture en attente n’est pas confirmée sur cette page ; aucun renvoi effectué." : ""}`;
    });
  }
  function selected(value: string) {
    return (
      page?.items.find((n) => `${n.kind}:${n.event_id}` === value) ??
      (/^[1-9]\d*$/.test(value) ? page?.items[Number(value) - 1] : undefined)
    );
  }
  async function open(value: string) {
    return run(async (signal) => {
      const item = selected(value);
      if (!item) throw Error("Choisissez un événement de la page affichée.");
      await identity(signal);
      if (signal.aborted) return "";
      return onOpen(item);
    });
  }
  async function read(value?: string) {
    return run(async (signal) => {
      const item = value ? selected(value) : pending?.item;
      if (!item)
        throw Error(
          "Choisissez un événement affiché ou reprenez la lecture en attente.",
        );
      if (
        pending &&
        (pending.item.kind !== item.kind ||
          pending.item.event_id !== item.event_id)
      )
        throw Error("Vérifiez d’abord la lecture en attente.");
      const command = pending ?? { item, key: crypto.randomUUID() };
      await identity(signal);
      try {
        const r = await api.call(
          "work_activity.read",
          { domain, event: item.event_id },
          { kind: item.kind, idempotency_key: command.key },
          { signal },
        );
        if (
          r.kind !== item.kind ||
          r.event_id !== item.event_id ||
          !dateValid(r.read_at)
        )
          throw new ApiError(200, "invalid_response");
        if (signal.aborted) return "";
        setPending(undefined);
        setPage(undefined);
        return "Événement marqué comme lu. Aucune acceptation, approbation ou clôture. Actualisez la liste pour les compteurs courants.";
      } catch (error) {
        if (signal.aborted) return "";
        setPage(undefined);
        if (
          pending ||
          !(
            error instanceof ApiError &&
            [400, 401, 403, 404, 409, 422].includes(error.status)
          )
        )
          setPending(command);
        throw error;
      }
    }, "Enregistrement de votre lecture…");
  }
  async function act(i: ActivityIntent) {
    if (i.kind === "activity_list") return list(i.next);
    if (i.kind === "activity_open") return open(i.value);
    if (i.kind === "activity_read") return read(i.value);
    return read();
  }
  useImperativeHandle(ref, () => ({ act }));
  return (
    <section aria-label="Boîte de réception personnelle">
      <p>
        Ce qui vous a été adressé : tâches, échanges de revue, prises en charge
        ou rapports de missions et suites des dossiers explicitement partagés.
        Ouvrir un objet ne marque pas l’événement comme lu.
      </p>
      <p>
        Le rôle lecteur donne accès aux suites de ses propres partages. Ce suivi
        ne couvre pas encore les imports et décisions de publication ; leurs
        dossiers conservent leur propre suivi.
      </p>
      <button disabled={busy} onClick={() => void list()}>
        Actualiser ma boîte de réception
      </button>
      {busy && <ActivityStatus>{phase}</ActivityStatus>}
      {page && (
        <section ref={focus} tabIndex={-1} aria-label="Événements personnels">
          <p>
            {page.unread} non lus sur {page.total} événements visibles ·{" "}
            {page.items.length} sur cette page · état du{" "}
            {new Date(page.as_of).toLocaleString("fr-FR")}.
          </p>
          {page.items.length === 0 && (
            <p>Aucun événement visible dans ce périmètre.</p>
          )}
          <ol className="task-notifications">
            {page.items.map((n, i) => (
              <li key={`${n.kind}:${n.event_id}`}>
                <strong>
                  {n.title ??
                    `${kinds[n.kind]} ${n.target_id.slice(0, 8)} — contenu indisponible`}
                </strong>
                <p>
                  {kinds[n.kind]} · {eventLabel(n)}
                  {n.actor ? ` · ${n.actor}` : ""} ·{" "}
                  {new Date(n.created_at).toLocaleString("fr-FR")}
                </p>
                <p>
                  Événement révision {n.event_revision} · état actuel :{" "}
                  {status(n)}, révision {n.current_revision} ·{" "}
                  {n.read_at ? "Lu" : "Non lu"}.
                </p>
                {!n.content_available && (
                  <p>
                    Le contenu est masqué. L’ouverture donne seulement accès au
                    contrôle ou au témoin de retrait autorisé.
                  </p>
                )}
                <div className="task-actions">
                  <button
                    disabled={busy}
                    onClick={() => void open(String(i + 1))}
                  >
                    Ouvrir l’événement {i + 1}
                  </button>
                  {!n.read_at && (
                    <button
                      disabled={busy || !!pending}
                      onClick={() => void read(String(i + 1))}
                    >
                      Marquer l’événement {i + 1} comme lu
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <button
            disabled={busy || !page.next_after}
            onClick={() => void list(true)}
          >
            Événements suivants
          </button>
        </section>
      )}
      {pending && (
        <div role="status">
          <p>
            Résultat de lecture non confirmé. Actualisez la liste sans renvoi ;
            si nécessaire, reprenez explicitement le même envoi. Après
            rechargement, la liste indique l’état enregistré.
          </p>
          <button disabled={busy} onClick={() => void read()}>
            Reprendre le même envoi de lecture
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Commandes de la boîte de réception</summary>
        <p>
          Montre ma boîte de réception · Activité suivante · Ouvre l’événement :
          numéro · Marque l’événement comme lu : numéro · Vérifie la lecture de
          l’événement · Reprends la même lecture d’événement.
        </p>
      </details>
    </section>
  );
});
