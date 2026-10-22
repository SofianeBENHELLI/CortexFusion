import { TaskRecovery, type TaskRecoveryHandle } from "./TaskRecovery";
import {
  readTaskRecovery,
  rememberTaskRecovery,
  forgetTaskRecovery,
  type RecoveryScope,
} from "./taskRecoveryStore";
import { usePendingWork } from "./PendingWorkBoundary";
import { TaskReceipts, validateTaskRecord } from "./TaskReceipts";
import type { TaskPlanInput } from "../../../../packages/contracts/src/TaskPlanInput";
import type { TaskPlanState } from "../../../../packages/contracts/src/TaskPlanState";
import { TaskProposals, type TaskProposalActions } from "./TaskProposals";
import { useWorkSelection, workName, resolveWorkName } from "./workSelection";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import type { WorkTaskCreate } from "../../../../packages/contracts/src/WorkTaskCreate";
import type { WorkTaskCommand } from "../../../../packages/contracts/src/WorkTaskCommand";
import {
  TaskNotifications,
  type TaskNotificationsActions,
} from "./TaskNotifications";
import { taskDueAt, localDateInput, elapsedLabel } from "./workDates";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import {
  taskActionLabels,
  taskPriorityLabels,
  taskEventLabels,
  taskStatuses,
  type TaskChatIntent,
} from "./taskCommands";
export interface TaskWorkspaceActions {
  act: (intent: TaskChatIntent) => Promise<string>;
}
type Preparation =
  | {
      kind: "plan";
      body: TaskPlanInput;
      task: string;
      title: string;
      before: TaskPlanState;
      status: WorkTask["status"];
      expires: number;
    }
  | { kind: "create"; body: WorkTaskCreate; title: string; expires: number }
  | {
      kind: "command";
      body: WorkTaskCommand;
      task: string;
      title: string;
      expires: number;
    };
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
const valid = (s: string, n: number) => !!s.trim() && Array.from(s).length <= n;
export function validateTask(v: WorkTask): WorkTask {
  if (
    !v ||
    typeof v.id !== "string" ||
    !Object.hasOwn(taskStatuses, v.status) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    [
      v.title,
      v.instructions,
      v.criteria,
      v.creator,
      v.created_at,
      v.updated_at,
      v.result_summary,
    ].some((s) => typeof s !== "string") ||
    !(v.assignee === null || typeof v.assignee === "string") ||
    (v.priority !== undefined &&
      !Object.hasOwn(taskPriorityLabels, v.priority)) ||
    (v.priority_reason !== undefined &&
      typeof v.priority_reason !== "string") ||
    (v.planning_allowed !== undefined &&
      typeof v.planning_allowed !== "boolean") ||
    (v.planning_allowed === true &&
      (!v.priority || typeof v.priority_reason !== "string")) ||
    !Array.isArray(v.allowed_actions) ||
    v.allowed_actions.some((a) => !Object.hasOwn(taskActionLabels, a))
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
function validatePage<
  T extends { items: unknown[]; next_after: string | null },
>(v: T, check?: (item: T["items"][number]) => unknown) {
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 50 ||
    !(v.next_after === null || typeof v.next_after === "string")
  )
    throw new ApiError(200, "invalid_response");
  v.items.forEach((item) => check?.(item));
  return v;
}
export const TaskWorkspace = forwardRef<
  TaskWorkspaceActions,
  {
    api: CortexApi;
    domain: string;
    coordinate: boolean;
    onNotice: (text: string) => void;
    canExpert?: boolean;
    canReceipts?: boolean;
    recoveryScope?: RecoveryScope;
    onOpenProposal?: (id: string) => void;
    routeSelection?: string;
    onSelection?: (id: string, replace?: boolean) => void;
  }
>(function TaskWorkspace(
  {
    api,
    domain,
    coordinate,
    onNotice,
    routeSelection,
    onSelection,
    canExpert = false,
    canReceipts = false,
    recoveryScope,
    onOpenProposal,
  },
  ref,
) {
  const cache = useQueryClient();
  const recovery = useRef<TaskRecoveryHandle>(null);
  const [recoveryRefresh, setRecoveryRefresh] = useState(0);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const unresolved =
    recoveryScope && canReceipts
      ? readTaskRecovery(recoveryScope).entries.filter(
          (e) => e.domain === domain,
        )
      : [];
  function settleRecovery(id: string) {
    if (recoveryScope) forgetTaskRecovery(recoveryScope, id);
    setRecoveryRefresh((n) => n + 1);
  }
  const expert = useRef<TaskProposalActions>(null);
  const [expertHeld, setExpertHeld] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const activity = useRef<TaskNotificationsActions>(null);
  const [planPriority, setPlanPriority] =
    useState<TaskPlanInput["priority"]>("normal");
  const [planDue, setPlanDue] = useState("");
  const [due, setDue] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [criteria, setCriteria] = useState("");
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("");
  const [result, setResult] = useState("");
  const [prepared, setPrepared] = useState<Preparation>();
  const [phase, setPhase] = useState<
    "prepared" | "sending" | "uncertain" | "rejected"
  >("prepared");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [error, setError] = useState("");
  const [localNotice, setLocalNotice] = useState("");
  const [accessError, setAccessError] = useState(false);
  const abort = useRef<AbortController>();
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTask = useRef(routeSelection ?? "");
  const held =
    busy ||
    recoveryBusy ||
    phase === "uncertain" ||
    expertHeld ||
    unresolved.length > 0;
  usePendingWork(
    "Action sur une tâche",
    phase === "sending"
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const [selected, setSelected] = useWorkSelection({
    requested: routeSelection,
    onNavigate: onSelection,
    locked: held,
    onReset: () => {
      setPrepared(undefined);
      setError("");
      setLocalNotice("");
      onNotice("");
      setAccessError(false);
      setReason("");
      setResult("");
      setAssignee("");
      focusTask.current = routeSelection ?? "";
    },
    onBlocked: () =>
      notice(
        "La commande en attente conserve sa tâche. Vérifiez son résultat avant de naviguer.",
      ),
  });
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [api, domain],
  );
  const list = useInfiniteQuery({
    queryKey: ["api", "tasks", domain, activeOnly, mineOnly],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const page = validatePage(
        await api.call("tasks.list", { domain }, undefined, {
          signal,
          query: {
            limit: 20,
            active_only: activeOnly,
            assigned_to_me: mineOnly,
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
        validateTask,
      );
      if (
        !Number.isSafeInteger(page.total) ||
        page.total < page.items.length ||
        typeof page.as_of !== "string" ||
        !Number.isFinite(Date.parse(page.as_of)) ||
        !["domain", "assigned"].includes(page.scope) ||
        !Number.isSafeInteger(page.permissions_version) ||
        page.permissions_version < 0 ||
        !Number.isSafeInteger(page.work_version) ||
        page.work_version < 0 ||
        page.sort !== "created_at_asc_id_asc" ||
        page.has_more !== (page.next_after !== null)
      )
        throw new ApiError(200, "invalid_response");
      return page;
    },
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  const detail = useQuery({
    queryKey: ["api", "task", domain, selected],
    enabled: !!selected && !list.error,
    retry: false,
    queryFn: async ({ signal }) => {
      const value = validateTask(
        await api.call("tasks.read", { domain, task_id: selected }, undefined, {
          signal,
        }),
      );
      if (value.id !== selected) throw new ApiError(200, "invalid_response");
      return value;
    },
  });
  useEffect(() => {
    // A successful mutation can be newer than the last minute tick.
    setNow(Date.now());
  }, [detail.dataUpdatedAt]);
  const history = useInfiniteQuery({
    queryKey: ["api", "task-events", domain, selected],
    enabled: !!selected && !list.error && !detail.error,
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: async ({ signal, pageParam }) =>
      validatePage(
        await api.call(
          "tasks.events",
          { domain, task_id: selected },
          undefined,
          {
            signal,
            query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
          },
        ),
        (event) => {
          if (event.planning !== undefined && event.planning !== null) {
            for (const state of [event.planning.before, event.planning.after]) {
              if (
                !state ||
                !Object.hasOwn(taskPriorityLabels, state.priority) ||
                !(
                  state.due_at === null ||
                  (typeof state.due_at === "string" &&
                    Number.isFinite(Date.parse(state.due_at)))
                )
              )
                throw new ApiError(200, "invalid_response");
            }
          }
        },
      ),
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  const candidates = useInfiniteQuery({
    queryKey: ["api", "task-candidates", domain],
    enabled: coordinate,
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: async ({ signal, pageParam }) =>
      validatePage(
        await api.call("tasks.candidates", { domain }, undefined, {
          signal,
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        }),
      ),
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  const readable =
    !list.error && !detail.error && !history.error && !accessError;
  useEffect(() => {
    if (!readable) {
      const message =
        "Tâche ou historique inaccessible : les détails et le projet sont masqués. Actualisez vos accès.";
      setLocalNotice(message);
      onNotice(message);
    }
  }, [readable, onNotice]);
  const current = readable ? detail.data : undefined;
  useEffect(() => {
    if (current && !prepared && !held) {
      setPlanPriority(current.priority ?? "normal");
      setPlanDue(current.due_at ? localDateInput(current.due_at) : "");
    }
  }, [current?.id, current?.revision, prepared, held]);

  useEffect(() => {
    if (current?.id === focusTask.current && heading.current) {
      heading.current.focus();
      focusTask.current = "";
    }
  }, [current?.id]);
  const notice = useCallback(
    (message: string) => {
      setLocalNotice(message);
      onNotice(message);
      return message;
    },
    [onNotice],
  );
  function select(id: string) {
    if (held)
      return notice("Vérifiez d’abord le résultat de la commande en cours.");
    focusTask.current = id;
    setSelected(id);
    setPrepared(undefined);
    setError("");
    setAccessError(false);
    setReason("");
    setResult("");
    setAssignee("");
    if (current?.id === id) {
      heading.current?.focus();
      focusTask.current = "";
    }
    return notice("Tâche sélectionnée. Ses droits et son état sont relus.");
  }
  function prepareCreate(
    t = title,
    i = instructions,
    c = criteria,
    date = due,
  ) {
    if (held)
      return notice("Vérifiez d’abord le résultat de la commande en cours.");
    if (!coordinate)
      return notice(
        "La création de tâches nécessite le rôle owner ou corpus manager.",
      );
    setSelected("");
    setAccessError(false);
    setTitle(t);
    setInstructions(i);
    setCriteria(c);
    if (!valid(t, 200) || !valid(i, 2000) || !valid(c, 1000)) {
      setError(
        "Renseignez un titre (200 caractères), une consigne (2 000) et des critères (1 000 maximum).",
      );
      return notice(
        "Complétez le titre, la consigne et les critères dans le dossier avant de préparer la tâche.",
      );
    }
    let dueAt: string | undefined;
    try {
      dueAt = taskDueAt(date);
    } catch {
      setError(
        "Échéance invalide. Choisissez une date locale valide ou un horodatage ISO avec fuseau dans le chat.",
      );
      return notice("Corrigez l’échéance avant de préparer la tâche.");
    }
    setDue(dueAt ? localDateInput(dueAt) : "");
    setPrepared({
      kind: "create",
      body: {
        title: t,
        instructions: i,
        criteria: c,
        ...(dueAt ? { due_at: dueAt } : {}),
        idempotency_key: crypto.randomUUID(),
      },
      title: t,
      expires: Date.now() + 300000,
    });
    setPhase("prepared");
    setError("");
    return notice(
      `Projet de tâche « ${t} » préparé : consigne et critères partagés avec les coordinateurs du domaine, puis l’affectataire. Rien n’est encore créé. Vérifiez puis confirmez la tâche.`,
    );
  }
  async function prepareAction(
    action: WorkTaskCommand["action"],
    why = reason,
    to = assignee,
    summary = result,
  ) {
    if (active.current || held)
      return notice("Vérifiez d’abord le résultat de la commande en cours.");
    if (!selected)
      return notice("Choisissez d’abord une tâche dans le dossier.");
    if (
      !valid(why, 2000) ||
      (action === "offer" && !valid(to, 200)) ||
      (action === "submit" && !valid(summary, 2000))
    ) {
      setError("Précisez le motif, le destinataire ou le résultat demandé.");
      return notice("Complétez les informations de l’action dans le dossier.");
    }
    active.current = true;
    setBusy(true);
    setError("");
    const id = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const fresh = validateTask(
        await api.call("tasks.read", { domain, task_id: selected }, undefined, {
          signal: controller.signal,
        }),
      );
      if (id !== generation.current) return "";
      if (fresh.id !== selected || !fresh.allowed_actions.includes(action))
        return notice(
          "Cette action n’est plus disponible. Actualisez la tâche.",
        );
      cache.setQueryData(["api", "task", domain, selected], fresh);
      setPrepared({
        kind: "command",
        task: selected,
        title: fresh.title,
        expires: Date.now() + 300000,
        body: {
          action,
          expected_revision: fresh.revision,
          reason: why,
          idempotency_key: crypto.randomUUID(),
          ...(action === "offer" ? { assignee: to } : {}),
          ...(action === "submit" ? { result_summary: summary } : {}),
        },
      });
      setPhase("prepared");
      return notice(
        `${taskActionLabels[action]} · « ${fresh.title} » · révision ${fresh.revision}${action === "offer" ? ` · destinataire ${to}` : ""}. Motif : ${why}. Projet à confirmer ; aucune publication de savoir.`,
      );
    } catch (e) {
      if (id !== generation.current) return "";
      setAccessError(true);
      setPrepared(undefined);
      setError(
        "Impossible de relire la tâche. Les détails précédents sont masqués.",
      );
      return notice(
        "La tâche n’est pas lisible ; aucune commande n’est préparée.",
      );
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function preparePlan(
    priority = planPriority,
    date = planDue,
    why = reason,
  ) {
    if (active.current || held)
      return notice("Vérifiez d’abord le résultat de la commande en cours.");
    if (!selected)
      return notice("Choisissez d’abord une tâche dans le dossier.");
    let due_at: string | null;
    try {
      due_at = taskDueAt(date) ?? null;
    } catch {
      return notice(
        "Échéance invalide. Utilisez une date ISO ou indiquez sans échéance.",
      );
    }
    if (!Object.hasOwn(taskPriorityLabels, priority) || !valid(why, 2000))
      return notice(
        "Choisissez une priorité et précisez le motif de planification.",
      );
    active.current = true;
    setBusy(true);
    setError("");
    const g = generation.current,
      controller = new AbortController();
    abort.current = controller;
    try {
      const fresh = validateTask(
        await api.call("tasks.read", { domain, task_id: selected }, undefined, {
          signal: controller.signal,
        }),
      );
      if (g !== generation.current) return "";
      if (fresh.id !== selected || !fresh.planning_allowed || !fresh.priority)
        return notice(
          "Cette tâche ne peut pas être replanifiée avec vos accès actuels.",
        );
      if (
        fresh.priority === priority &&
        (fresh.due_at === null
          ? due_at === null
          : due_at !== null && Date.parse(fresh.due_at) === Date.parse(due_at))
      )
        return notice(
          "La priorité et l’échéance sont inchangées. Aucun projet à confirmer.",
        );
      cache.setQueryData(["api", "task", domain, selected], fresh);
      setPrepared({
        kind: "plan",
        status: fresh.status,
        task: selected,
        title: fresh.title,
        before: { priority: fresh.priority, due_at: fresh.due_at },
        expires: Date.now() + 300000,
        body: {
          priority,
          due_at,
          reason: why,
          expected_revision: fresh.revision,
          idempotency_key: crypto.randomUUID(),
        },
      });
      setPhase("prepared");
      return notice(
        `Planification de « ${fresh.title} » : priorité ${taskPriorityLabels[priority]}, ${due_at ? "échéance " + new Date(due_at).toLocaleString("fr-FR") : "sans échéance"}. Motif : ${why}. Relisez l’avant/après puis confirmez la tâche.`,
      );
    } catch {
      if (g !== generation.current) return "";
      setAccessError(true);
      setPrepared(undefined);
      setError(
        "Impossible de relire la tâche. Les détails précédents sont masqués.",
      );
      return notice(
        "La tâche n’est pas lisible ; aucune planification préparée.",
      );
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  async function confirm(verifyOnly = false) {
    if (!readable && !verifyOnly)
      return notice(
        "Rétablissez l’accès à la tâche et à son historique avant de confirmer.",
      );
    if (verifyOnly && (!canReceipts || phase !== "uncertain"))
      return notice("Aucune commande inconnue à vérifier.");
    if (active.current || !prepared)
      return notice("Aucun projet de tâche à confirmer.");
    if (phase === "rejected")
      return notice("Relisez la tâche et préparez une nouvelle commande.");
    if (phase !== "uncertain" && Date.now() > prepared.expires) {
      setPrepared(undefined);
      return notice(
        "Le projet a expiré. Relisez et préparez l’action à nouveau.",
      );
    }
    if (!verifyOnly && recoveryScope && canReceipts) {
      try {
        rememberTaskRecovery(recoveryScope, {
          command: prepared.body.idempotency_key,
          domain,
          task: prepared.kind === "create" ? null : prepared.task,
          action:
            prepared.kind === "create"
              ? "create"
              : prepared.kind === "plan"
                ? "plan"
                : prepared.body.action,
          revision:
            prepared.kind === "create"
              ? 1
              : prepared.body.expected_revision + 1,
          started: Date.now(),
        });
        setRecoveryRefresh((n) => n + 1);
      } catch {
        return notice(
          "La référence de récupération ne peut pas être conservée dans cet onglet (stockage indisponible ou 20 actions à vérifier). Aucun envoi effectué. Vérifiez vos actions en attente avant de réessayer.",
        );
      }
    }
    active.current = true;
    setBusy(true);
    setError("");
    setPhase("sending");
    const input = prepared;
    const id = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const record = verifyOnly
        ? validateTaskRecord(
            await api.call(
              "task_receipts.read",
              { domain, command_id: input.body.idempotency_key },
              undefined,
              { signal: controller.signal },
            ),
          )
        : undefined;
      if (
        record &&
        (record.command_id !== input.body.idempotency_key ||
          record.action !==
            (input.kind === "create"
              ? "create"
              : input.kind === "plan"
                ? "plan"
                : input.body.action))
      )
        throw new ApiError(200, "invalid_response");
      const out = record
        ? record.receipt
        : input.kind === "create"
          ? await api.call("tasks.create", { domain }, input.body, {
              signal: controller.signal,
            })
          : input.kind === "plan"
            ? await api.call(
                "tasks.plan",
                { domain, task_id: input.task },
                input.body,
                { signal: controller.signal },
              )
            : await api.call(
                "tasks.command",
                { domain, task_id: input.task },
                input.body,
                { signal: controller.signal },
              );
      if (id !== generation.current) return "";
      if (
        !out ||
        typeof out.event_id !== "string" ||
        !Object.hasOwn(taskStatuses, out.status) ||
        !Number.isSafeInteger(out.revision) ||
        out.revision !==
          (input.kind === "create" ? 1 : input.body.expected_revision + 1) ||
        (input.kind !== "create" && out.task_id !== input.task) ||
        (input.kind === "plan" && out.status !== input.status)
      )
        throw new ApiError(200, "invalid_response");
      settleRecovery(input.body.idempotency_key);
      setPrepared(undefined);
      setPhase("prepared");
      setSelected(
        input.kind === "command" && input.body.action === "decline"
          ? ""
          : out.task_id,
      );
      setAccessError(false);
      const message = `Action enregistrée · ${taskStatuses[out.status]} · révision ${out.revision} · reçu ${out.event_id}. Le savoir publié est inchangé.`;
      void cache.resetQueries({
        queryKey: ["api", "task-receipts", domain],
        exact: true,
      });
      void cache.invalidateQueries({ queryKey: ["api", "tasks", domain] });
      void cache.invalidateQueries({ queryKey: ["api", "work-brief", domain] });
      void cache.invalidateQueries({
        queryKey: ["api", "work-overview", domain],
      });
      void cache.resetQueries({
        queryKey: ["api", "task-notifications", domain],
        exact: true,
      });
      void cache.invalidateQueries({
        queryKey: ["api", "task", domain, out.task_id],
      });
      void cache.invalidateQueries({
        queryKey: ["api", "task-events", domain, out.task_id],
      });
      return notice(message);
    } catch (e) {
      if (id !== generation.current) return "";
      if (verifyOnly) {
        setPhase("uncertain");
        const message =
          "Aucun reçu confirmé par cette lecture. La commande peut encore être en cours ou inaccessible ; son résultat reste inconnu. Aucun nouvel envoi effectué.";
        setError(message);
        return notice(message);
      }
      if (rejected(e)) settleRecovery(input.body.idempotency_key);
      setPhase(rejected(e) ? "rejected" : "uncertain");
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        setAccessError(true);
        setPrepared(undefined);
      }
      const message = rejected(e)
        ? "Commande refusée ou tâche modifiée. Actualisez puis préparez une nouvelle décision."
        : "Résultat inconnu. Réessayez exactement cette commande pour retrouver son reçu ; aucun nouvel envoi automatique.";
      setError(message);
      return notice(message);
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function cancelPreparation() {
    if (held)
      return notice(
        "Le résultat est incertain : vérifiez la même commande avant d’en préparer une autre.",
      );
    setPrepared(undefined);
    setError("");
    return notice("Projet de tâche fermé. Aucune nouvelle action envoyée.");
  }
  useImperativeHandle(ref, () => ({
    act: async (intent) => {
      switch (intent.kind) {
        case "task_proposal_link":
        case "task_proposal_select":
        case "task_opinion_prepare":
        case "task_expert_confirm":
        case "task_expert_cancel":
          return (
            expert.current?.act(intent) ??
            notice(
              "Choisissez une tâche accessible avant de traiter ses propositions et avis.",
            )
          );
        case "task_filter":
          if (held) return notice("Vérifiez d’abord la commande en cours.");
          setActiveOnly(intent.active);
          setMineOnly(intent.mine);
          setSelected("");
          setPrepared(undefined);
          return notice(
            "File de tâches relue avec le périmètre demandé, des plus anciennes aux plus récentes.",
          );
        case "task_notifications":
          setActivityOpen(true);
          return notice(
            "Votre activité interne est ouverte. La lecture reste personnelle.",
          );
        case "task_notification_read":
          setActivityOpen(true);
          return (
            (await activity.current?.read(intent.id)) ??
            notice(
              "Ouvrez et relisez l’activité avant de marquer une notification.",
            )
          );
        case "task_create":
          return prepareCreate(
            intent.title,
            intent.instructions,
            intent.criteria,
            intent.due_at ?? "",
          );
        case "task_select": {
          if (held) return notice("Vérifiez d’abord la commande en cours.");
          const match = resolveWorkName(intent.id, readable ? tasks : []);
          if (match.id) return select(match.id);
          setSelected("");
          setPrepared(undefined);
          setSearch(intent.id);
          return notice(
            match.ambiguous
              ? "Plusieurs tâches portent ce nom. Choisissez la bonne ligne dans le dossier."
              : "Recherche dans les tâches chargées. Affinez le nom ou chargez la suite ; les autres pages ne sont pas recherchées.",
          );
        }
        case "task_receipts":
          if (!canReceipts)
            return notice(
              "La lecture des reçus n’est pas disponible dans cet espace.",
            );
          setReceiptsOpen(true);
          await cache.resetQueries({
            queryKey: ["api", "task-receipts", domain],
            exact: true,
          });
          return notice(
            "Vos actions enregistrées sont relues, sans nouvelle commande.",
          );
        case "task_verify_receipt":
          return prepared
            ? confirm(true)
            : (recovery.current?.verify() ??
                notice("Aucune référence locale à vérifier."));
        case "task_recovery_verify":
          return (
            recovery.current?.verify(intent.id) ??
            notice("Vérifiez d’abord la commande encore ouverte.")
          );
        case "task_recovery_forget":
          return (
            recovery.current?.forget(intent.id) ??
            notice("Aucune référence locale disponible.")
          );
        case "task_plan":
          return preparePlan(intent.priority, intent.due, intent.reason);
        case "task_plan_invalid":
          return notice(
            "Utilisez : planifie la tâche : haute | date ISO ou sans | motif. Rien n’est préparé.",
          );
        case "task_action":
          return prepareAction(
            intent.action,
            intent.reason,
            intent.assignee,
            intent.result_summary,
          );
        case "task_confirm":
          return confirm();
        case "task_cancel_preparation":
          return cancelPreparation();
      }
    },
  }));
  const tasks = list.data?.pages.flatMap((p) => p.items) ?? [];
  const visibleTasks = tasks.filter((t) =>
    workName(t.title).includes(workName(search)),
  );
  async function refresh() {
    if (busy) return;
    if (!held) setPrepared(undefined);
    setError("");
    setAccessError(false);
    await Promise.all([
      cache.resetQueries({
        queryKey: ["api", "tasks", domain, activeOnly, mineOnly],
        exact: true,
      }),
      ...(selected ? [detail.refetch(), history.refetch()] : []),
    ]);
  }
  return (
    <section className="task-workspace" aria-label="Tâches de travail">
      <p>
        {coordinate
          ? "Coordonner le travail du domaine"
          : "Vos affectations et leur historique"}
        . Les conversations et signaux personnels restent privés.
      </p>
      {recoveryScope && canReceipts && !prepared && (
        <TaskRecovery
          ref={recovery}
          api={api}
          domain={domain}
          scope={recoveryScope}
          refresh={recoveryRefresh}
          onNotice={notice}
          onBusy={setRecoveryBusy}
          onResolved={() => setRecoveryRefresh((n) => n + 1)}
        />
      )}
      <div className="task-filters">
        <label>
          Afficher
          <select
            value={activeOnly ? "active" : "all"}
            disabled={held}
            onChange={(e) => {
              setActiveOnly(e.target.value === "active");
              setSelected("");
              setPrepared(undefined);
            }}
          >
            <option value="active">Tâches actives</option>
            <option value="all">Toutes les tâches</option>
          </select>
        </label>
        {coordinate && (
          <label>
            Périmètre
            <select
              value={mineOnly ? "mine" : "domain"}
              disabled={held}
              onChange={(e) => {
                setMineOnly(e.target.value === "mine");
                setSelected("");
                setPrepared(undefined);
              }}
            >
              <option value="domain">Tout le domaine</option>
              <option value="mine">Mes affectations</option>
            </select>
          </label>
        )}
      </div>
      <button disabled={busy} onClick={() => void refresh()}>
        Actualiser les tâches
      </button>
      {list.isPending && <ActivityStatus>Lecture des tâches…</ActivityStatus>}
      {!readable && (
        <p role="alert">
          Tâche ou historique indisponible. Les contenus précédents sont masqués
          ; actualisez pour vérifier vos accès.
        </p>
      )}
      {readable && list.data && (
        <>
          <p>
            {tasks.length} tâches chargées
            {list.data?.pages[0].total !== undefined
              ? ` sur ${list.data.pages[0].total} dans ce périmètre`
              : ""}
            {list.hasNextPage ? " · liste partielle" : ""}.
          </p>
          <p>
            Des plus anciennes aux plus récentes. Une modification pendant la
            pagination demande de recommencer la lecture.
          </p>
          <label>
            Rechercher dans les tâches chargées
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={held}
            />
          </label>
          {search && (
            <p>
              {visibleTasks.length} correspondances parmi {tasks.length} tâches
              chargées. Les autres pages ne sont pas recherchées.
            </p>
          )}
          <ul
            className="task-list work-list-bounded"
            tabIndex={0}
            aria-label="Tâches chargées"
          >
            {visibleTasks.map((t) => (
              <li key={t.id}>
                <button
                  disabled={held}
                  aria-pressed={t.id === selected}
                  onClick={() => select(t.id)}
                >
                  {t.title}
                  <small>
                    {taskStatuses[t.status]} · {t.id.slice(0, 8)} ·{" "}
                    {t.assignee ?? "sans affectataire"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <button
              disabled={list.isFetching || held}
              onClick={() => void list.fetchNextPage()}
            >
              Charger d’autres tâches
            </button>
          )}
        </>
      )}
      {current && (
        <article>
          <h3 ref={heading} tabIndex={-1}>
            {current.title}
          </h3>
          <p>
            {taskStatuses[current.status]} · révision {current.revision}
          </p>
          <p className="task-id">Identifiant : {current.id}</p>
          <p>
            Créée le {new Date(current.created_at).toLocaleString("fr-FR")} ·
            depuis {elapsedLabel(current.created_at, now)}
            {current.due_at
              ? ` · échéance ${new Date(current.due_at).toLocaleString("fr-FR")}`
              : " · sans échéance"}
            .
          </p>
          <p>
            Dernière activité :{" "}
            {new Date(current.updated_at).toLocaleString("fr-FR")} · il y a{" "}
            {elapsedLabel(current.updated_at, now)}.
          </p>
          {current.due_at &&
            now > new Date(current.due_at).getTime() &&
            !["completed", "cancelled"].includes(current.status) && (
              <p>Échéance dépassée · à réexaminer avec le coordinateur.</p>
            )}
          {current.priority && (
            <p>
              Priorité : {taskPriorityLabels[current.priority]}
              {current.priority_reason
                ? ` · motif de planification : ${current.priority_reason}`
                : " · valeur par défaut, sans arbitrage explicite"}
              .
            </p>
          )}
          {current.planning_allowed && (
            <details>
              <summary>Planifier la priorité et l’échéance</summary>
              <fieldset disabled={held}>
                <label>
                  Priorité de la tâche
                  <select
                    value={planPriority}
                    onChange={(e) =>
                      setPlanPriority(
                        e.target.value as TaskPlanInput["priority"],
                      )
                    }
                  >
                    <option value="low">Basse</option>
                    <option value="normal">Normale</option>
                    <option value="high">Haute</option>
                  </select>
                </label>
                <label>
                  Nouvelle échéance
                  <input
                    type="datetime-local"
                    value={planDue}
                    onInput={(e) => setPlanDue(e.currentTarget.value)}
                    onChange={(e) => setPlanDue(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={!planDue}
                  onClick={() => setPlanDue("")}
                >
                  Retirer l’échéance du projet
                </button>
                <p>
                  Champ vide : retirer l’échéance. Fuseau :{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}. La
                  création et l’âge de la tâche restent conservés.
                </p>
                <label>
                  Motif de planification
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button onClick={() => void preparePlan()}>
                  Préparer la planification
                </button>
              </fieldset>
            </details>
          )}
          <h4>Consigne</h4>
          <p className="draft-text">{current.instructions}</p>
          <h4>Critères de réalisation</h4>
          <p className="draft-text">{current.criteria}</p>
          {current.result_summary && (
            <>
              <h4>Résultat remis</h4>
              <p className="draft-text">{current.result_summary}</p>
            </>
          )}
          {current.allowed_actions.length > 0 && (
            <fieldset disabled={held}>
              <legend>Préparer une action</legend>
              <label>
                Motif
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {current.allowed_actions.includes("offer") && (
                <>
                  <label>
                    Destinataire
                    <select
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    >
                      <option value="">Choisir une personne</option>
                      {!candidates.error &&
                        candidates.data?.pages
                          .flatMap((p) => p.items)
                          .map((c) => (
                            <option key={c.subject} value={c.subject}>
                              {c.subject} · {c.role}
                            </option>
                          ))}
                    </select>
                  </label>
                  {candidates.error && (
                    <p role="alert">
                      Annuaire indisponible. Aucun destinataire n’est
                      présélectionné.
                    </p>
                  )}
                  {candidates.hasNextPage && (
                    <button onClick={() => void candidates.fetchNextPage()}>
                      Charger d’autres destinataires
                    </button>
                  )}
                </>
              )}
              {current.allowed_actions.includes("submit") && (
                <label>
                  Résultat de la tâche
                  <textarea
                    value={result}
                    onChange={(e) => setResult(e.target.value)}
                  />
                </label>
              )}
              <div className="task-actions">
                {current.allowed_actions.map((a) => (
                  <button key={a} onClick={() => void prepareAction(a)}>
                    {taskActionLabels[a]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <details>
            <summary>Historique de la tâche</summary>
            {history.isPending ? (
              <ActivityStatus>Lecture de l’historique…</ActivityStatus>
            ) : (
              <ol>
                {history.data?.pages
                  .flatMap((p) => p.items)
                  .map((e) => (
                    <li key={e.id}>
                      <strong>
                        {e.action === "create"
                          ? "Création"
                          : (taskEventLabels[e.action] ?? e.action)}
                      </strong>{" "}
                      · {e.actor} · révision {e.revision} ·{" "}
                      {new Date(e.created_at).toLocaleString("fr-FR")}
                      <p>{e.reason}</p>
                      {e.result_summary && <p>{e.result_summary}</p>}
                      {e.planning && (
                        <p>
                          Priorité{" "}
                          {taskPriorityLabels[e.planning.before.priority]} →{" "}
                          {taskPriorityLabels[e.planning.after.priority]} ·
                          échéance{" "}
                          {e.planning.before.due_at
                            ? new Date(e.planning.before.due_at).toLocaleString(
                                "fr-FR",
                              )
                            : "aucune"}{" "}
                          →{" "}
                          {e.planning.after.due_at
                            ? new Date(e.planning.after.due_at).toLocaleString(
                                "fr-FR",
                              )
                            : "aucune"}
                          .
                        </p>
                      )}
                    </li>
                  ))}
              </ol>
            )}
            {history.hasNextPage && (
              <button
                disabled={history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                Charger la suite de l’historique
              </button>
            )}
          </details>
        </article>
      )}
      {canExpert && selected && detail.data && (
        <TaskProposals
          key={selected}
          ref={expert}
          api={api}
          domain={domain}
          task={detail.data!}
          accessDenied={!readable}
          blocked={busy || phase === "uncertain"}
          onHold={setExpertHeld}
          onNotice={notice}
          onOpenProposal={onOpenProposal}
        />
      )}
      {coordinate && (
        <details>
          <summary>Créer une tâche autonome</summary>
          <fieldset disabled={held}>
            <label>
              Titre de la tâche
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Consigne de la tâche
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label>
              Critères de réalisation
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            <label>
              Échéance facultative
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <p>
              Dates affichées dans votre fuseau :{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            </p>
            <p>
              Ce texte sera visible par les coordinateurs du domaine, puis par
              l’affectataire. Ne recopiez pas une conversation privée.
            </p>
            <button onClick={() => prepareCreate()}>
              Préparer la création
            </button>
          </fieldset>
        </details>
      )}
      {prepared && readable && (
        <section className="task-preparation" aria-label="Projet de tâche">
          <h3>
            {prepared.kind === "create"
              ? "Créer la tâche"
              : prepared.kind === "plan"
                ? "Réviser la planification"
                : taskActionLabels[prepared.body.action]}{" "}
            · {prepared.title}
          </h3>
          {prepared.kind === "plan" ? (
            <>
              <p>
                Avant : priorité {taskPriorityLabels[prepared.before.priority]}{" "}
                ·{" "}
                {prepared.before.due_at
                  ? new Date(prepared.before.due_at).toLocaleString("fr-FR")
                  : "sans échéance"}
                .
              </p>
              <p>
                Après : priorité {taskPriorityLabels[prepared.body.priority]} ·{" "}
                {prepared.body.due_at
                  ? new Date(prepared.body.due_at).toLocaleString("fr-FR")
                  : "sans échéance"}
                .
              </p>
              <p>Motif : {prepared.body.reason}</p>
              <p>
                État et affectation conservés. Aucune publication de savoir.
              </p>
            </>
          ) : prepared.kind === "create" ? (
            <>
              <p>{prepared.body.instructions}</p>
              <p>Critères : {prepared.body.criteria}</p>
              <p>
                Échéance :{" "}
                {prepared.body.due_at
                  ? new Date(prepared.body.due_at).toLocaleString("fr-FR")
                  : "aucune"}
              </p>
              <p>Visible par les coordinateurs, puis par l’affectataire.</p>
            </>
          ) : (
            <>
              <p>Révision attendue : {prepared.body.expected_revision}</p>
              <p>{prepared.body.reason}</p>
              {prepared.body.assignee && (
                <p>Destinataire : {prepared.body.assignee}</p>
              )}
              {prepared.body.result_summary && (
                <p>Résultat : {prepared.body.result_summary}</p>
              )}
            </>
          )}
          <p>
            Aucune approbation ou publication de savoir. Projet valable cinq
            minutes.
          </p>
          {recoveryScope && canReceipts && (
            <p>
              À l’envoi, une référence sans texte ni jeton permet de vérifier le
              reçu dans cet onglet pendant 24 heures, même après rechargement.
              Fermer l’espace efface cette référence.
            </p>
          )}
          <button
            disabled={busy || phase === "rejected"}
            onClick={() => void confirm()}
          >
            {phase === "uncertain"
              ? "Réessayer la même commande"
              : "Confirmer la tâche"}
          </button>
          {phase === "uncertain" && canReceipts && (
            <button disabled={busy} onClick={() => void confirm(true)}>
              Vérifier le reçu sans renvoyer
            </button>
          )}
          <button disabled={held} onClick={cancelPreparation}>
            Annuler le projet de tâche
          </button>
        </section>
      )}
      {canReceipts && (
        <details
          open={receiptsOpen}
          onToggle={(e) => setReceiptsOpen(e.currentTarget.open)}
        >
          <summary>Mes actions enregistrées</summary>
          <TaskReceipts
            api={api}
            domain={domain}
            enabled={receiptsOpen}
            onOpen={(id) => select(id)}
          />
        </details>
      )}
      <details
        open={activityOpen}
        onToggle={(e) => setActivityOpen(e.currentTarget.open)}
      >
        <summary>Activité personnelle des tâches</summary>
        <TaskNotifications
          ref={activity}
          api={api}
          domain={domain}
          enabled={activityOpen}
          showNotice={false}
          onOpen={(id) => select(id)}
          onNotice={notice}
        />
      </details>
      {busy && (
        <ActivityStatus>Vérification de l’action de travail…</ActivityStatus>
      )}
      {error && <p role="alert">{error}</p>}
      {localNotice && localNotice !== error && (
        <p role="status" className="draft-receipt">
          {readable
            ? localNotice
            : "Tâche ou historique inaccessible : actualisez vos accès."}
        </p>
      )}
    </section>
  );
});
