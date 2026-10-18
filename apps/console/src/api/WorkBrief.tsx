import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkBrief as Brief } from "../../../../packages/contracts/src/WorkBrief";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { validateTask } from "./TaskWorkspace";
import { taskStatuses, taskPriorityLabels } from "./taskCommands";
export type BriefScope = "assigned" | "domain";
const sort = "overdue_review_offer_blocked_unassigned_progress_due_created_id";
const roles = {
  owner: "Responsable de domaine",
  corpus_manager: "Responsable de corpus",
  contributor: "Contributeur",
};
export function validateBrief(v: Brief, scope: BriefScope): Brief {
  if (
    !v ||
    v.scope !== scope ||
    !Object.hasOwn(roles, v.role) ||
    (scope === "domain" && v.role === "contributor") ||
    !Number.isFinite(Date.parse(v.as_of)) ||
    ![
      sort,
      "overdue_priority_review_offer_blocked_unassigned_progress_due_created_id",
    ].includes(v.sort) ||
    v.coverage !== "active_tasks_only" ||
    !Number.isSafeInteger(v.permissions_version) ||
    v.permissions_version < 0 ||
    !Number.isSafeInteger(v.work_version) ||
    v.work_version < 0 ||
    !v.counts ||
    Object.values(v.counts).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Array.isArray(v.items) ||
    v.items.length > 5
  )
    throw new ApiError(200, "invalid_response");
  const c = v.counts;
  if (
    c.active !==
      c.offered + c.review + c.blocked + c.unassigned + c.in_progress ||
    c.overdue > c.active ||
    v.items.length !== Math.min(5, c.active) ||
    v.has_more !== c.active > 5 ||
    (scope === "assigned" && c.unassigned !== 0) ||
    new Set(v.items.map((i) => i.task?.id)).size !== v.items.length
  )
    throw new ApiError(200, "invalid_response");
  for (const item of v.items) {
    validateTask(item.task);
    if (
      ["completed", "cancelled"].includes(item.task.status) ||
      typeof item.overdue !== "boolean" ||
      (item.task.due_at !== null &&
        !Number.isFinite(Date.parse(item.task.due_at))) ||
      item.overdue !==
        (item.task.due_at !== null &&
          Date.parse(item.task.due_at) < Date.parse(v.as_of))
    )
      throw new ApiError(200, "invalid_response");
  }
  return v;
}
function nextStep(task: WorkTask): string {
  const allowed: readonly string[] = task.allowed_actions;
  if (allowed.includes("accept"))
    return "Décider d’accepter ou de refuser l’affectation.";
  if (allowed.includes("complete"))
    return "Relire le résultat et décider de la suite.";
  if (allowed.includes("resume"))
    return "Vérifier le blocage avant de reprendre.";
  if (allowed.includes("offer"))
    return "Choisir la personne à qui proposer cette tâche.";
  if (allowed.includes("submit"))
    return "Préparer votre résultat et ses preuves.";
  return task.status === "review"
    ? "Suivre la revue du responsable."
    : task.status === "offered"
      ? "Suivre la réponse à l’affectation."
      : task.status === "blocked"
        ? "Comprendre le blocage avec la personne affectée."
        : "Suivre le travail de la personne affectée.";
}
export function WorkBrief({
  api,
  domain,
  scope,
  coordinate,
  onScope,
  onOpen,
  onAll,
  refresh,
  focus = false,
}: {
  api: CortexApi;
  domain: string;
  scope: BriefScope;
  coordinate: boolean;
  onScope: (scope: BriefScope) => void;
  onOpen: (id: string) => void;
  onAll: () => void;
  refresh: number;
  focus?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: ["api", "work-brief", domain, scope],
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 60000,
    queryFn: async ({ signal }) =>
      validateBrief(
        await api.call("tasks.brief", { domain }, undefined, {
          signal,
          query: { scope },
        }),
        scope,
      ),
  });
  const seen = useRef(refresh);
  useEffect(() => {
    if (seen.current !== refresh) {
      seen.current = refresh;
      void query.refetch();
    }
    if (focus) heading.current?.focus();
  }, [refresh, focus]);
  const brief = !query.isFetching && !query.error ? query.data : undefined;
  return (
    <section className="work-brief" aria-label="Votre prochain pas">
      <div className="work-brief-heading">
        <div>
          <p className="kicker">Votre travail réel</p>
          <h3 tabIndex={-1} ref={heading}>
            Votre prochain pas
          </h3>
        </div>
        <button
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Actualiser le brief
        </button>
      </div>
      <div className="work-brief-scopes" aria-label="Périmètre du brief">
        <button
          aria-pressed={scope === "assigned"}
          onClick={() => onScope("assigned")}
        >
          Mes tâches
        </button>
        {coordinate && (
          <button
            aria-pressed={scope === "domain"}
            onClick={() => onScope("domain")}
          >
            Travail du domaine
          </button>
        )}
      </div>
      {query.isFetching && (
        <ActivityStatus>Lecture du travail autorisé…</ActivityStatus>
      )}
      {query.error && (
        <p role="alert">
          Brief indisponible. Actualisez pour revérifier vos droits et le
          travail actuel.
        </p>
      )}
      {brief && (
        <WorkBriefContent
          brief={brief}
          scope={scope}
          onOpen={onOpen}
          onAll={onAll}
        />
      )}
    </section>
  );
}

export function WorkBriefContent({
  brief,
  scope,
  onOpen,
  onAll,
}: {
  brief: Brief;
  scope: BriefScope;
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <>
      <p>
        {roles[brief.role]} ·{" "}
        {scope === "assigned"
          ? "Tâches qui vous sont affectées"
          : "Tâches actives du domaine"}
      </p>
      <dl className="work-brief-counts">
        <div>
          <dt>Actives</dt>
          <dd>{brief.counts.active}</dd>
        </div>
        <div>
          <dt>Échéance dépassée</dt>
          <dd>{brief.counts.overdue}</dd>
        </div>
        <div>
          <dt>En revue</dt>
          <dd>{brief.counts.review}</dd>
        </div>
        <div>
          <dt>Bloquées</dt>
          <dd>{brief.counts.blocked}</dd>
        </div>
      </dl>
      {!brief.counts.active && (
        <p>
          Aucune tâche active dans ce périmètre. Vous pouvez interroger le
          savoir publié ou consulter vos dossiers partagés. Cela ne signifie pas
          que le corpus ne nécessite aucune amélioration.
        </p>
      )}
      <ol className="work-brief-list">
        {brief.items.map(({ task, overdue }) => (
          <li key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <span>
                {taskStatuses[task.status]}
                {task.priority
                  ? ` · Priorité ${taskPriorityLabels[task.priority]}`
                  : ""}
                {overdue ? " · Échéance dépassée" : ""}
              </span>
            </div>
            <p>{nextStep(task)}</p>
            <p className="work-brief-meta">
              {task.assignee
                ? `Affectée à ${task.assignee}`
                : "Sans affectataire"}{" "}
              ·{" "}
              {task.due_at
                ? `Échéance ${new Date(task.due_at).toLocaleString("fr-FR")}`
                : "Sans échéance"}
            </p>
            <button onClick={() => onOpen(task.id)}>
              Ouvrir la tâche : {task.title}
            </button>
          </li>
        ))}
      </ol>
      {brief.counts.active > 0 && (
        <p>
          {brief.items.length} tâches présentées sur {brief.counts.active}{" "}
          actives dans ce périmètre.{" "}
          <button onClick={onAll}>Voir toute la file</button>
        </p>
      )}
      <details>
        <summary>Comprendre ce brief</summary>
        <p>
          Comptage complet des tâches actives autorisées, au{" "}
          {new Date(brief.as_of).toLocaleString("fr-FR")}. Une tâche en retard
          peut aussi être bloquée ou en revue : ces compteurs se recoupent.
        </p>
        <p>
          Ordre : échéance dépassée,{" "}
          {brief.sort.includes("priority") ? "priorité explicite, " : ""}revue à
          décider, affectation personnelle à accepter, blocage, tâche à
          affecter, travail en cours, attente. À égalité : échéance la plus
          proche, puis création et identifiant.
        </p>
        <p>
          Ce brief ne mesure ni la qualité ni la couverture du savoir. Les
          signalements personnels, dossiers partagés, imports et décisions de
          publication ont leur propre suivi. Ouvrir une tâche ne change pas son
          état.
        </p>
      </details>
    </>
  );
}
