import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { taskEventLabels, taskStatuses } from "./taskCommands";
import { uuid } from "./uuid";
export interface TaskNotificationsActions {
  read: (id: string) => Promise<string>;
}
export const TaskNotifications = forwardRef<
  TaskNotificationsActions,
  {
    api: CortexApi;
    domain: string;
    enabled: boolean;
    showNotice?: boolean;
    onOpen: (id: string) => void;
    onNotice: (text: string) => void;
  }
>(function TaskNotifications(
  { api, domain, enabled, showNotice = true, onOpen, onNotice },
  ref,
) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [pending, setPending] = useState<{ id: string; key: string }>();
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const abort = useRef<AbortController>();
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [api, domain],
  );
  const query = useInfiniteQuery({
    queryKey: ["api", "task-notifications", domain],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const p = await api.call(
        "task_notifications.list",
        { domain },
        undefined,
        {
          signal,
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        },
      );
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 50 ||
        !Number.isSafeInteger(p.total) ||
        !Number.isSafeInteger(p.unread) ||
        p.unread < 0 ||
        p.unread > p.total ||
        p.scope !== "personal" ||
        !(p.next_after === null || typeof p.next_after === "string") ||
        p.items.some(
          (n) =>
            typeof n.title !== "string" ||
            typeof n.event_id !== "string" ||
            typeof n.task_id !== "string" ||
            !Object.hasOwn(taskStatuses, n.current_status),
        )
      )
        throw new ApiError(200, "invalid_response");
      return p;
    },
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  useEffect(() => {
    if (query.error) {
      setMessage("");
      onNotice(
        "Activité indisponible : reprenez la lecture pour vérifier les droits et la version de la liste.",
      );
    }
  }, [query.error, onNotice]);
  async function read(id: string) {
    if (active.current) return "Lecture en cours.";
    if (!uuid.test(id))
      return notice("Indiquez l’identifiant d’une notification chargée.");
    if (pending && pending.id !== id)
      return notice("Vérifiez d’abord le reçu de lecture en attente.");
    if (
      !pending &&
      (denied ||
        query.error ||
        !query.data?.pages.some((p) => p.items.some((n) => n.event_id === id)))
    )
      return notice(
        "Relisez l’activité et choisissez une notification visible.",
      );
    const input = pending ?? { id, key: crypto.randomUUID() };
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    active.current = true;
    setBusy(true);
    try {
      const receipt = await api.call(
        "task_notifications.read",
        { domain, event_id: id },
        { idempotency_key: input.key },
        { signal: controller.signal },
      );
      if (epoch !== generation.current) return "";
      if (receipt.event_id !== id || typeof receipt.read_at !== "string")
        throw new ApiError(200, "invalid_response");
      setPending(undefined);
      // A personal acknowledgement invalidates this traversal. Start at its first page.
      void cache.resetQueries({
        queryKey: ["api", "task-notifications", domain],
        exact: true,
      });
      return notice(
        "Notification marquée comme lue. La tâche conserve son état.",
      );
    } catch (e) {
      if (epoch !== generation.current) return "";
      const refused =
        e instanceof ApiError &&
        [400, 401, 403, 404, 409, 422].includes(e.status);
      setPending(refused ? undefined : input);
      if (refused) {
        setDenied(true);
        cache.removeQueries({
          queryKey: ["api", "task-notifications", domain],
        });
      }
      return notice(
        refused
          ? "Lecture refusée : rétablissez l’accès puis relisez l’activité."
          : "Résultat de lecture inconnu. Réessayez la même notification pour retrouver son reçu.",
      );
    } finally {
      if (epoch === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function notice(value: string) {
    setMessage(value);
    onNotice(value);
    return value;
  }
  useImperativeHandle(ref, () => ({ read }));
  const items =
    denied || query.error
      ? []
      : (query.data?.pages.flatMap((p) => p.items) ?? []);
  const summary = denied || query.error ? undefined : query.data?.pages[0];
  async function refresh() {
    if (busy || pending) return;
    setDenied(false);
    setMessage("");
    await cache.resetQueries({
      queryKey: ["api", "task-notifications", domain],
      exact: true,
    });
    if (
      cache.getQueryState(["api", "task-notifications", domain])?.status ===
      "success"
    )
      notice(
        "Activité actualisée avec vos droits courants. Les compteurs portent sur les notifications visibles.",
      );
  }
  return (
    <section aria-label="Activité personnelle des tâches">
      <p>
        Notifications internes personnelles. Ouvrir une tâche ne marque pas
        automatiquement son activité comme lue.
      </p>
      <button disabled={busy || !!pending} onClick={() => void refresh()}>
        Recommencer la lecture de l’activité
      </button>
      {enabled && query.isPending && (
        <ActivityStatus>Lecture de votre activité…</ActivityStatus>
      )}
      {(denied || query.error) && (
        <p role="alert">
          Activité indisponible ou modifiée. Les anciens éléments sont masqués ;
          recommencez la lecture.
        </p>
      )}
      {summary && (
        <p>
          {summary.unread} non lues sur {summary.total} notifications visibles ·{" "}
          {items.length} chargées · au{" "}
          {new Date(summary.as_of).toLocaleString("fr-FR")}.
        </p>
      )}
      <ul
        className="task-notifications"
        tabIndex={0}
        aria-label="Liste des notifications"
      >
        {items.map((n) => (
          <li key={n.event_id}>
            <strong>{n.title}</strong>
            <p>
              {n.action === "create"
                ? "Création"
                : (taskEventLabels[n.action] ?? n.action)}{" "}
              · {n.actor} · {new Date(n.created_at).toLocaleString("fr-FR")}
            </p>
            <p>
              État actuel : {taskStatuses[n.current_status]} ·{" "}
              {n.read_at ? "Lue" : "Non lue"}
            </p>
            <small className="task-id">Notification : {n.event_id}</small>
            <div className="task-actions">
              <button disabled={busy} onClick={() => onOpen(n.task_id)}>
                Ouvrir la tâche
              </button>
              {!n.read_at && (
                <button
                  disabled={busy || !!pending}
                  onClick={() => void read(n.event_id)}
                >
                  Marquer comme lue
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {query.hasNextPage && !denied && !query.error && (
        <button
          disabled={busy || query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          Charger d’autres notifications
        </button>
      )}
      {pending && (
        <button disabled={busy} onClick={() => void read(pending.id)}>
          Réessayer le même reçu de lecture
        </button>
      )}
      {busy && <ActivityStatus>Enregistrement de la lecture…</ActivityStatus>}
      {showNotice && message && <p role="status">{message}</p>}
    </section>
  );
});
