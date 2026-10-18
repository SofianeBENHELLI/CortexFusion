import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CaseTaskCommand } from "../../../../packages/contracts/src/CaseTaskCommand";
import type { CaseTaskReferences } from "../../../../packages/contracts/src/CaseTaskReferences";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { taskStatuses } from "./taskCommands";
import { validateTask } from "./TaskWorkspace";
import { resolveWorkName, workId } from "./workSelection";
export type CaseTaskIntent =
  | { kind: "case_tasks_read" }
  | { kind: "case_tasks_prepare"; action: "link" | "unlink"; task: string }
  | { kind: "case_tasks_confirm" }
  | { kind: "case_tasks_recover" }
  | { kind: "case_tasks_cancel" };
export interface CaseTaskActions {
  act: (v: CaseTaskIntent) => Promise<string>;
}
export function validateCaseTasks(v: CaseTaskReferences, id: string) {
  if (
    !v ||
    v.case_id !== id ||
    !Number.isSafeInteger(v.case_revision) ||
    v.case_revision < 1 ||
    !["team", "declarant"].includes(v.audience) ||
    !Array.isArray(v.items) ||
    v.max_links !== 20 ||
    !Number.isSafeInteger(v.linked_count) ||
    v.linked_count < 0 ||
    v.linked_count > 20 ||
    typeof v.can_link !== "boolean" ||
    typeof v.can_unlink !== "boolean" ||
    !Number.isFinite(Date.parse(v.as_of)) ||
    (v.audience === "declarant"
      ? v.items.length !== 0 || v.can_link || v.can_unlink
      : v.items.length !== v.linked_count) ||
    v.items.some(
      (x) =>
        !workId(x.task_id) ||
        typeof x.title !== "string" ||
        !Object.hasOwn(taskStatuses, x.status) ||
        !Number.isSafeInteger(x.revision) ||
        x.revision < 1 ||
        !Number.isFinite(Date.parse(x.linked_at)),
    )
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
type Pending = { body: CaseTaskCommand; title: string; expires: number };
export const CaseTasks = forwardRef<
  CaseTaskActions,
  {
    api: CortexApi;
    domain: string;
    caseId: string;
    caseTitle?: string;
    blocked: boolean;
    accessDenied: boolean;
    onHold: (v: boolean) => void;
    onNotice: (s: string) => void;
    onDenied: () => void;
    onOpenTask?: (id: string) => void;
  }
>(function CaseTasks(
  {
    api,
    domain,
    caseId,
    caseTitle,
    blocked,
    accessDenied,
    onHold,
    onNotice,
    onDenied,
    onOpenTask,
  },
  ref,
) {
  const cache = useQueryClient();
  const [data, setData] = useState<CaseTaskReferences>();
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [phase, setPhase] = useState<"prepared" | "uncertain" | "rejected">(
    "prepared",
  );
  const active = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const heading = useRef<HTMLHeadingElement>(null);
  const held = busy || phase === "uncertain";
  usePendingWork(
    "Lien entre dossier et tâche",
    busy && pending
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const hidden = accessDenied || error;
  const notice = (s: string) => {
    setMessage(s);
    onNotice(s);
    return s;
  };
  useEffect(() => {
    onHold(held);
    return () => onHold(false);
  }, [held, onHold]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      active.current = false;
    },
    [api, domain, caseId],
  );
  useEffect(() => {
    if (pending && !busy && !hidden) heading.current?.focus();
  }, [pending, busy, hidden]);
  function mask(e: unknown) {
    setData(undefined);
    setTasks([]);
    setError(true);
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) onDenied();
  }
  async function run(fn: (signal: AbortSignal) => Promise<string>) {
    if (active.current) return "Une opération est déjà en cours.";
    active.current = true;
    setBusy(true);
    const g = generation.current;
    const c = new AbortController();
    controller.current = c;
    try {
      const s = await fn(c.signal);
      if (g === generation.current && !c.signal.aborted) return notice(s);
      return "Opération interrompue.";
    } catch (e) {
      if (g !== generation.current || c.signal.aborted)
        return "Opération interrompue.";
      mask(e);
      return notice(
        e instanceof ApiError && e.status === 409
          ? "Le dossier ou la tâche a changé. Relisez puis préparez à nouveau."
          : "Impossible de vérifier le dossier et ses tâches avec les accès actuels. Leur contenu est masqué.",
      );
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function read(signal: AbortSignal) {
    const v = validateCaseTasks(
      await api.call(
        "case_tasks.list",
        { domain, case_id: caseId },
        undefined,
        { signal },
      ),
      caseId,
    );
    if (signal.aborted) throw new Error("aborted");
    setData(v);
    setError(false);
    return v;
  }
  function inspect() {
    if (accessDenied)
      return Promise.resolve(notice("Relisez d’abord les accès du dossier."));
    return run(async (signal) => {
      await read(signal);
      return "Associations relues. Aucun accès ni contenu transféré.";
    });
  }
  useEffect(() => {
    setData(undefined);
    setTasks([]);
    setPending(undefined);
    setPhase("prepared");
    setMessage("");
  }, [api, domain, caseId]);
  useEffect(() => {
    if (!accessDenied) void inspect();
    else {
      setData(undefined);
      setTasks([]);
    }
  }, [api, domain, caseId, accessDenied]);
  async function candidates(next = false) {
    return run(async (signal) => {
      const v = await read(signal);
      if (v.audience !== "team" || !v.can_link)
        return "Aucune nouvelle association autorisée pour ce dossier.";
      const page = await api.call("tasks.list", { domain }, undefined, {
        signal,
        query: {
          active_only: true,
          assigned_to_me: false,
          limit: 20,
          ...(next && after ? { after } : {}),
        },
      });
      if (
        !page ||
        !Array.isArray(page.items) ||
        page.items.length > 20 ||
        !Number.isSafeInteger(page.total) ||
        page.total < page.items.length ||
        page.has_more !== !!page.next_after
      )
        throw new ApiError(200, "invalid_response");
      const entries = page.items.map(validateTask);
      if (signal.aborted) throw new Error("aborted");
      setTasks((old) => (next ? [...old, ...entries] : entries));
      setAfter(page.next_after);
      setTotal(page.total);
      setPicker(true);
      return "Choisissez une tâche existante. Aucune instruction n’est copiée du dossier.";
    });
  }
  function prepare(action: "link" | "unlink", input: string) {
    if (blocked || held || accessDenied)
      return Promise.resolve(notice("Vérifiez d’abord la commande en cours."));
    const choices =
      action === "link"
        ? tasks
        : (data?.items ?? []).map((x) => ({ id: x.task_id, title: x.title }));
    const match = resolveWorkName(input, choices);
    if (!match.id) {
      setSearch(input);
      setPending(undefined);
      return Promise.resolve(
        notice(
          match.ambiguous
            ? "Plusieurs tâches portent ce nom. Choisissez la bonne ligne."
            : "Choisissez une tâche chargée ou indiquez son identifiant. La recherche porte sur les lignes chargées.",
        ),
      );
    }
    return run(async (signal) => {
      setPending(undefined);
      const refs = await read(signal);
      if (
        refs.audience !== "team" ||
        !(action === "link" ? refs.can_link : refs.can_unlink)
      )
        return "Cette association n’est pas autorisée dans l’état actuel.";
      const task = validateTask(
        await api.call(
          "tasks.read",
          { domain, task_id: match.id! },
          undefined,
          { signal },
        ),
      );
      if (task.id !== match.id) throw new ApiError(200, "invalid_response");
      const linked = refs.items.some((t) => t.task_id === task.id);
      if (
        action === "link"
          ? linked ||
            refs.linked_count >= 20 ||
            ["completed", "cancelled"].includes(task.status)
          : !linked
      )
        return "La tâche est déjà liée, terminée, ou ne peut pas être retirée. Relisez les associations.";
      if (signal.aborted) throw new Error("aborted");
      setPhase("prepared");
      setPending({
        body: {
          action,
          task_id: task.id,
          expected_case_revision: refs.case_revision,
          expected_task_revision: task.revision,
          idempotency_key: crypto.randomUUID(),
        },
        title: task.title,
        expires: Date.now() + 300000,
      });
      return action === "link"
        ? "Association préparée. Vérifiez les deux objets puis confirmez."
        : "Retrait de l’association préparé. La tâche sera conservée.";
    });
  }
  function confirm(recover = false) {
    if (blocked || busy || (accessDenied && !recover))
      return Promise.resolve(notice("Une autre opération est en cours."));
    const p = pending;
    if (!p || phase === "rejected" || (recover && phase !== "uncertain"))
      return Promise.resolve(
        notice(
          "Aucune commande envoyée à récupérer. Préparez puis confirmez explicitement.",
        ),
      );
    if (!recover && phase === "uncertain")
      return Promise.resolve(
        notice("Vérifiez le résultat de la commande déjà envoyée."),
      );
    if (!recover && Date.now() > p.expires) {
      setPending(undefined);
      return Promise.resolve(
        notice("La préparation a expiré. Relisez et préparez à nouveau."),
      );
    }
    return run(async (signal) => {
      if (!recover) {
        const refs = await read(signal);
        const task = validateTask(
          await api.call(
            "tasks.read",
            { domain, task_id: p.body.task_id },
            undefined,
            { signal },
          ),
        );
        if (
          refs.case_revision !== p.body.expected_case_revision ||
          task.revision !== p.body.expected_task_revision ||
          task.id !== p.body.task_id
        ) {
          setPhase("rejected");
          return "Le dossier ou la tâche a changé. Préparez à nouveau.";
        }
      }
      try {
        const receipt = await api.call(
          "case_tasks.command",
          { domain, case_id: caseId },
          p.body,
          { signal },
        );
        if (
          !receipt ||
          receipt.case_id !== caseId ||
          receipt.revision !== p.body.expected_case_revision + 1 ||
          !workId(receipt.event_id)
        )
          throw new ApiError(200, "invalid_response");
        if (signal.aborted) throw new Error("aborted");
        setPending(undefined);
        setPhase("prepared");
        // Once a valid receipt is received, follow-up read failure does not make the command uncertain.
        try {
          await read(signal);
        } catch (e) {
          mask(e);
        }
        void cache.invalidateQueries({
          queryKey: ["api", domain, "shared-case"],
        });
        void cache.resetQueries({ queryKey: ["api", domain, "case-events"] });
        void cache.resetQueries({ queryKey: ["api", domain, "shared-cases"] });
        return `Association ${p.body.action === "link" ? "enregistrée" : "retirée"} · reçu ${receipt.event_id}. Tâche et savoir inchangés.`;
      } catch (e) {
        if (signal.aborted) throw e;
        const known =
          e instanceof ApiError &&
          [400, 401, 403, 404, 409, 422].includes(e.status);
        setPhase(recover || !known ? "uncertain" : "rejected");
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          mask(e);
        return known
          ? recover
            ? "Reprise refusée. La commande initiale reste à vérifier avec les accès autorisés."
            : "Commande refusée. Relisez les droits et révisions avant de préparer à nouveau."
          : "Résultat inconnu. Vérifiez avec la même commande ; aucune seconde association ne sera créée.";
      }
    });
  }
  function cancel() {
    if (held)
      return Promise.resolve(
        notice("Résultat en attente : conservez la commande pour la vérifier."),
      );
    setPending(undefined);
    return Promise.resolve(
      notice("Projet d’association fermé, sans nouvel envoi."),
    );
  }
  useImperativeHandle(ref, () => ({
    act: async (intent) => {
      switch (intent.kind) {
        case "case_tasks_read":
          return inspect();
        case "case_tasks_prepare":
          return prepare(intent.action, intent.task);
        case "case_tasks_confirm":
          return confirm();
        case "case_tasks_recover":
          return confirm(true);
        case "case_tasks_cancel":
          return cancel();
      }
    },
  }));
  const shown = tasks.filter((t) =>
    t.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section aria-label="Tâches liées au dossier" className="case-tasks">
      <h4>
        Travail associé au dossier
        {!hidden && caseTitle ? ` « ${caseTitle} »` : ""}
      </h4>
      <p>
        Une référence de suivi ne partage aucun extrait et ne donne aucun droit
        supplémentaire. Terminer une tâche ne clôture pas ce dossier.
      </p>
      <button
        disabled={busy || blocked || accessDenied}
        onClick={() => void inspect()}
      >
        Relire les tâches liées
      </button>
      {busy && (
        <ActivityStatus>
          Vérification du dossier et du travail autorisé…
        </ActivityStatus>
      )}
      {hidden ? (
        <p role="alert">Associations masquées. Relisez les accès du dossier.</p>
      ) : (
        data && (
          <>
            <p>
              {data.linked_count} tâche(s) liée(s) · lecture du{" "}
              {new Date(data.as_of).toLocaleString()}.
            </p>
            {data.audience === "declarant" ? (
              <p>
                Le détail du travail et les notes de l’équipe restent internes.
                Votre suivi se poursuit dans ce dossier.
              </p>
            ) : (
              <>
                <ul>
                  {data.items.map((t) => (
                    <li key={t.task_id}>
                      <strong>{t.title}</strong> · {taskStatuses[t.status]}
                      <div className="action-row">
                        <button
                          disabled={held || blocked}
                          onClick={() => onOpenTask?.(t.task_id)}
                        >
                          Ouvrir la tâche
                        </button>
                        {data.can_unlink && (
                          <button
                            disabled={held || blocked}
                            onClick={() => void prepare("unlink", t.task_id)}
                          >
                            Préparer le retrait du lien
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {data.can_link && (
                  <>
                    <button
                      disabled={held || blocked}
                      onClick={() => void candidates()}
                    >
                      Choisir une tâche à lier
                    </button>
                    <button
                      disabled={held || blocked}
                      onClick={() => onOpenTask?.("")}
                    >
                      Créer une tâche indépendante
                    </button>
                    <p>
                      Rédigez seulement les instructions autorisées dans la
                      tâche, puis revenez la lier ici. Maximum 20 liens actifs.
                    </p>
                  </>
                )}
                {picker && (
                  <>
                    <label>
                      Rechercher une tâche à lier
                      <input
                        value={search}
                        disabled={held || blocked}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <p>
                      {shown.length} correspondances parmi {tasks.length} tâches
                      chargées sur {total}. Les autres pages ne sont pas
                      recherchées.
                    </p>
                    <ul className="work-list-bounded" tabIndex={0}>
                      {shown.map((t) => (
                        <li key={t.id}>
                          <button
                            disabled={
                              held ||
                              blocked ||
                              ["completed", "cancelled"].includes(t.status)
                            }
                            onClick={() => void prepare("link", t.id)}
                          >
                            {t.title} · {taskStatuses[t.status]}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {after && (
                      <button
                        disabled={held || blocked}
                        onClick={() => void candidates(true)}
                      >
                        Tâches suivantes à lier
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )
      )}
      {pending && !hidden && (
        <div className="command-preview">
          <h4 ref={heading} tabIndex={-1}>
            Vérifier l’association
          </h4>
          <p>
            {pending.body.action === "link" ? "Lier" : "Délier"} :{" "}
            {pending.title}
          </p>
          <p>
            Dossier « {caseTitle ?? caseId} » · révision{" "}
            {pending.body.expected_case_revision} · tâche révision{" "}
            {pending.body.expected_task_revision}. Aucun contenu ni accès
            transféré. La tâche reste conservée.
          </p>
          {phase === "prepared" && (
            <button disabled={busy || blocked} onClick={() => void confirm()}>
              Confirmer l’association
            </button>
          )}
          <button disabled={held || blocked} onClick={() => void cancel()}>
            Annuler le projet d’association
          </button>
        </div>
      )}
      {phase === "uncertain" && (
        <button disabled={busy || blocked} onClick={() => void confirm(true)}>
          Vérifier l’association envoyée
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
});
