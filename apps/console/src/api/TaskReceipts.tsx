import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityStatus } from "../ActivityStatus";
import type { TaskCommandRecord } from "../../../../packages/contracts/src/TaskCommandRecord";
import type { TaskCommandRecordPage } from "../../../../packages/contracts/src/TaskCommandRecordPage";
import { ApiError, type CortexApi } from "./client";
import { taskEventLabels, taskStatuses } from "./taskCommands";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function validateTaskRecord(r: TaskCommandRecord) {
  if (
    !r ||
    !uuid.test(r.command_id) ||
    r.outcome !== "recorded" ||
    !Object.hasOwn(taskEventLabels, r.action) ||
    !Number.isFinite(Date.parse(r.recorded_at)) ||
    !r.receipt ||
    !uuid.test(r.receipt.task_id) ||
    !uuid.test(r.receipt.event_id) ||
    !Number.isSafeInteger(r.receipt.revision) ||
    r.receipt.revision < 1 ||
    !Object.hasOwn(taskStatuses, r.receipt.status) ||
    !(
      r.task_title === null ||
      (typeof r.task_title === "string" && r.task_title.length <= 200)
    ) ||
    (r.task_title === null
      ? r.current_revision !== null || r.current_status !== null
      : !Number.isSafeInteger(r.current_revision) ||
        r.current_revision! < r.receipt.revision ||
        !Object.hasOwn(taskStatuses, r.current_status!))
  )
    throw new ApiError(200, "invalid_response");
  return r;
}
function validatePage(p: TaskCommandRecordPage) {
  if (
    !p ||
    !Array.isArray(p.items) ||
    p.items.length > 50 ||
    !Number.isSafeInteger(p.total) ||
    p.total < p.items.length ||
    p.scope !== "personal" ||
    !Number.isFinite(Date.parse(p.as_of)) ||
    !Number.isSafeInteger(p.work_version) ||
    p.work_version < 0 ||
    !Number.isSafeInteger(p.permissions_version) ||
    p.permissions_version < 0 ||
    p.sort !== "created_at_desc_id_desc" ||
    !(p.next_after === null || uuid.test(p.next_after)) ||
    p.has_more !== (p.next_after !== null) ||
    p.completeness !== (p.has_more ? "partial" : "complete") ||
    new Set(p.items.map((r) => r.command_id)).size !== p.items.length
  )
    throw new ApiError(200, "invalid_response");
  p.items.forEach(validateTaskRecord);
  return p;
}
export function TaskReceipts({
  api,
  domain,
  enabled,
  onOpen,
}: {
  api: CortexApi;
  domain: string;
  enabled: boolean;
  onOpen: (id: string) => void;
}) {
  const cache = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["api", "task-receipts", domain],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) =>
      validatePage(
        await api.call("task_receipts.list", { domain }, undefined, {
          signal,
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        }),
      ),
    getNextPageParam: (p) => p.next_after ?? undefined,
  });
  const visible = enabled && !query.error && !query.isRefetching;
  const summary = visible ? query.data?.pages[0] : undefined;
  const items = summary ? query.data!.pages.flatMap((p) => p.items) : [];
  return (
    <section aria-label="Mes actions enregistrées">
      <p>
        Vos reçus durables de tâches. Ils prouvent une action enregistrée, pas
        son état actuel. Une action absente peut être encore en cours ou
        inaccessible : vérifiez son reçu avant de la relancer.
      </p>
      <button
        disabled={query.isFetching}
        onClick={() =>
          void cache.resetQueries({
            queryKey: ["api", "task-receipts", domain],
            exact: true,
          })
        }
      >
        Relire mes actions enregistrées
      </button>
      {enabled && query.isFetching && (
        <ActivityStatus>Lecture de vos reçus…</ActivityStatus>
      )}
      {enabled && query.error && (
        <p role="alert">
          Reçus indisponibles ou liste modifiée. Les anciens résultats sont
          masqués ; recommencez la lecture.
        </p>
      )}
      {summary && (
        <p>
          {items.length} reçus chargés sur {summary.total} actions enregistrées
          · lecture du {new Date(summary.as_of).toLocaleString("fr-FR")}.
        </p>
      )}
      {summary && summary.total === 0 && (
        <p>
          Aucun reçu visible pour votre compte dans ce domaine. Ce résultat ne
          prouve pas qu’une commande en attente a échoué.
        </p>
      )}
      <ol className="task-notifications" aria-label="Reçus des commandes">
        {items.map((r) => (
          <li key={r.command_id}>
            <strong>
              {taskEventLabels[r.action]}
              {r.task_title
                ? ` · ${r.task_title}`
                : " · tâche désormais inaccessible"}
            </strong>
            <p>
              Enregistrée le {new Date(r.recorded_at).toLocaleString("fr-FR")} ·
              résultat : {taskStatuses[r.receipt.status]} · révision{" "}
              {r.receipt.revision}.
            </p>
            {r.current_status && (
              <p>
                État actuel : {taskStatuses[r.current_status]} · révision{" "}
                {r.current_revision}.
              </p>
            )}
            <details>
              <summary>Références de cette action</summary>
              <small className="task-id">Commande : {r.command_id}</small>
              <small className="task-id">Reçu : {r.receipt.event_id}</small>
            </details>
            {r.task_title !== null && (
              <button onClick={() => onOpen(r.receipt.task_id)}>
                Ouvrir la tâche actuelle
              </button>
            )}
          </li>
        ))}
      </ol>
      {visible && query.hasNextPage && (
        <button
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          Charger d’autres reçus
        </button>
      )}
    </section>
  );
}
