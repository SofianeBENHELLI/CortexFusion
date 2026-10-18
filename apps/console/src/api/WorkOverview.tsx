import { MissionOverview, validateMissionOverview } from "./MissionOverview";
import type { WorkReferenceReviewOverview } from "../../../../packages/contracts/src/WorkReferenceReviewOverview";
import { useEffect, useRef, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkOverview as Overview } from "../../../../packages/contracts/src/WorkOverview";
import type { WorkCaseOverview } from "../../../../packages/contracts/src/WorkCaseOverview";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { WorkBriefContent, validateBrief, type BriefScope } from "./WorkBrief";
import { caseStatuses } from "./caseCommands";
import { workId } from "./workSelection";
export type OverviewSection =
  | "auto"
  | "tasks"
  | "received"
  | "imports"
  | "mine"
  | "reviews"
  | "sentReviews"
  | "missions";
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
const date = (s: string) =>
  typeof s === "string" && Number.isFinite(Date.parse(s));
const label = (s: string) =>
  typeof s === "string" && s.trim().length > 0 && Array.from(s).length <= 200;
function bad(): never {
  throw new ApiError(200, "invalid_response");
}
export function validateOverview(v: Overview, scope: BriefScope): Overview {
  if (
    !v ||
    !v.my_cases ||
    v.scope !== scope ||
    !["owner", "corpus_manager", "contributor", "viewer"].includes(v.role) ||
    !date(v.as_of) ||
    !integer(v.work_version) ||
    !integer(v.permissions_version) ||
    v.coverage !== "authorized_active_work_only"
  )
    bad();
  const coordinator = ["owner", "corpus_manager"].includes(v.role);
  if (
    (scope === "domain" && !coordinator) ||
    (v.tasks === null) !== (v.role === "viewer") ||
    (v.received_cases !== null) !== coordinator ||
    (v.imports !== null) !== coordinator ||
    (v.received_reference_reviews !== null) !== coordinator ||
    (v.my_reference_reviews === null) !== (v.role === "viewer") ||
    (v.my_missions !== null) !== coordinator
  )
    bad();
  if (v.tasks) {
    validateBrief(v.tasks, scope);
    if (
      v.tasks.role !== v.role ||
      v.tasks.as_of !== v.as_of ||
      v.tasks.work_version !== v.work_version ||
      v.tasks.permissions_version !== v.permissions_version
    )
      bad();
  }
  for (const group of [
    v.my_cases,
    v.received_cases,
    v.imports,
    v.received_reference_reviews,
    v.my_reference_reviews,
  ]) {
    if (group === null) continue;
    if (
      !group ||
      !integer(group.total) ||
      !Array.isArray(group.items) ||
      group.items.length !== Math.min(5, group.total) ||
      group.has_more !== group.total > 5 ||
      new Set(group.items.map((i) => i?.id)).size !== group.items.length
    )
      bad();
    if (
      group.items.some(
        (i) =>
          !i ||
          !workId(i.id) ||
          !date(i.created_at) ||
          Date.parse(i.created_at) > Date.parse(v.as_of),
      )
    )
      bad();
  }
  for (const group of [v.my_cases, v.received_cases]) {
    if (group === null) continue;
    if (
      group.sort !== "created_at_asc_id_asc" ||
      group.items.some(
        (i) => !label(i.title) || !["new", "qualified"].includes(i.status),
      )
    )
      bad();
  }
  for (const group of [v.received_reference_reviews, v.my_reference_reviews]) {
    if (group === null) continue;
    if (
      group.sort !== "created_at_asc_id_asc" ||
      group.items.some(
        (i) =>
          typeof i.question !== "string" ||
          !i.question.trim() ||
          Array.from(i.question).length > 2000 ||
          !label(i.author) ||
          !label(i.reviewer) ||
          i.author === i.reviewer ||
          !integer(i.revision) ||
          i.revision < 1 ||
          !date(i.updated_at) ||
          Date.parse(i.updated_at) < Date.parse(i.created_at) ||
          Date.parse(i.updated_at) > Date.parse(v.as_of) ||
          !["awaiting_review", "changes_requested", "ready_for_owner"].includes(
            i.status,
          ) ||
          (group === v.received_reference_reviews &&
            i.status !== "awaiting_review"),
      )
    )
      bad();
  }
  if (v.imports) {
    const g = v.imports;
    if (
      g.sort !== "failed_first_created_at_asc_id_asc" ||
      !integer(g.pending_jobs) ||
      !integer(g.failed_jobs) ||
      g.pending_jobs > g.total ||
      g.failed_jobs > g.total ||
      g.pending_jobs + g.failed_jobs < g.total ||
      g.items.some(
        (i) =>
          !workId(i.collection_id) ||
          !label(i.collection_name) ||
          !integer(i.pending) ||
          !integer(i.failed) ||
          i.pending + i.failed === 0,
      )
    )
      bad();
  }
  if (v.my_missions) validateMissionOverview(v.my_missions, v.as_of);
  return v;
}
export function WorkOverview({
  api,
  domain,
  scope,
  coordinate,
  onScope,
  section,
  onSection,
  refresh,
  focus = false,
  onTask,
  onAllTasks,
  onCase,
  onAllCases,
  onImport,
  onAllImports,
  onReview,
  onAllReviews,
  onMission,
  onAllMissions,
}: {
  api: CortexApi;
  domain: string;
  scope: BriefScope;
  coordinate: boolean;
  onScope: (s: BriefScope) => void;
  section: OverviewSection;
  onSection: (s: OverviewSection) => void;
  refresh: number;
  focus?: boolean;
  onMission: (id: string, controlOnly: boolean) => void;
  onAllMissions: () => void;
  onTask: (id: string) => void;
  onAllTasks: () => void;
  onCase: (id: string) => void;
  onAllCases: (scope: "mine" | "team") => void;
  onImport: (id: string) => void;
  onAllImports: () => void;
  onReview: (id: string) => void;
  onAllReviews: (scope: "mine" | "assigned") => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    panelId = useId();
  const query = useQuery({
    queryKey: ["api", "work-overview", domain, scope],
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 60000,
    queryFn: async ({ signal }) =>
      validateOverview(
        await api.call("work_overview.read", { domain }, undefined, {
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
  const data = !query.isFetching && !query.error ? query.data : undefined;
  const selected = data?.role === "viewer" ? "mine" : section;
  const entries: { id: OverviewSection; label: string; count: number }[] = data
    ? [
        ...(data.tasks
          ? [
              {
                id: "tasks" as const,
                label: "Tâches",
                count: data.tasks.counts.active,
              },
            ]
          : []),
        ...(data.received_cases
          ? [
              {
                id: "received" as const,
                label: "Dossiers reçus",
                count: data.received_cases.total,
              },
            ]
          : []),
        ...(data.received_reference_reviews
          ? [
              {
                id: "reviews" as const,
                label: "Références à relire",
                count: data.received_reference_reviews.total,
              },
            ]
          : []),
        ...(data.my_reference_reviews
          ? [
              {
                id: "sentReviews" as const,
                label: "Mes revues à suivre",
                count: data.my_reference_reviews.total,
              },
            ]
          : []),
        ...(data.my_missions
          ? [
              {
                id: "missions" as const,
                label: "Mes missions à suivre",
                count: data.my_missions.total,
              },
            ]
          : []),
        ...(data.imports
          ? [
              {
                id: "imports" as const,
                label: "Mes imports",
                count: data.imports.total,
              },
            ]
          : []),
        {
          id: "mine",
          label: "Mes partages à suivre",
          count: data.my_cases.total,
        },
      ]
    : [];
  const effective =
    selected === "auto"
      ? (entries.find((e) => e.count > 0) ?? entries[0])?.id
      : entries.some((e) => e.id === selected)
        ? selected
        : entries[0]?.id;
  function cases(group: WorkCaseOverview, received: boolean) {
    return (
      <>
        <h4>
          {received
            ? "Dossiers qui vous sont adressés"
            : "Suivi de vos partages"}
        </h4>
        <p>
          {received
            ? "Relisez l’extrait consenti, qualifiez le problème et décidez de la suite avec une tâche explicite."
            : "Suivez la réponse des destinataires. Un dossier ouvert ne vous affecte pas automatiquement une tâche."}
        </p>
        {!group.total && (
          <p>
            {received
              ? "Aucun dossier ouvert ne vous est actuellement adressé."
              : "Vous n’avez aucun partage ouvert à suivre."}
          </p>
        )}
        <ol className="work-brief-list">
          {group.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{caseStatuses[item.status]}</span>
              </div>
              <p className="work-brief-meta">
                Ouvert le {new Date(item.created_at).toLocaleString("fr-FR")}
              </p>
              <button onClick={() => onCase(item.id)}>
                Ouvrir le dossier : {item.title}
              </button>
            </li>
          ))}
        </ol>
        <p>
          {group.items.length} dossiers présentés sur {group.total} ouverts
          autorisés. Les plus anciens d’abord.{" "}
          <button onClick={() => onAllCases(received ? "team" : "mine")}>
            Voir tous les dossiers {received ? "reçus" : "partagés"}
          </button>
        </p>
      </>
    );
  }
  function reviews(group: WorkReferenceReviewOverview, received: boolean) {
    const next = {
      awaiting_review: received
        ? "Lire la copie et préparer un avis motivé."
        : "Attendre l’avis du responsable nommé ou relire l’envoi.",
      changes_requested:
        "Lire le motif et préparer une nouvelle version privée.",
      ready_for_owner:
        "Préparer la présentation à l’owner ; aucune approbation acquise.",
    };
    const statuses = {
      awaiting_review: "Avis attendu",
      changes_requested: "Modifications demandées",
      ready_for_owner: "Prête à présenter à l’owner",
    };
    return (
      <>
        <h4>
          {received ? "Vos avis à préparer" : "Le suivi de vos envois en revue"}
        </h4>
        <p>
          {received
            ? "Seules les copies qui vous sont nommément adressées et attendent votre avis sont comptées."
            : "Copies encore partagées, y compris après un avis. Un avis favorable ne publie ni n’approuve la question."}
        </p>
        {!group.total && (
          <p>
            {received
              ? "Aucune référence autorisée n’attend votre avis."
              : "Aucune de vos revues autorisées n’est encore partagée."}
          </p>
        )}
        <ol className="work-brief-list">
          {group.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.question}</strong>
                <span>{statuses[item.status]}</span>
              </div>
              <p>{next[item.status]}</p>
              <p className="work-brief-meta">
                De {item.author} · pour {item.reviewer} · version de revue{" "}
                {item.revision}
              </p>
              <p className="work-brief-meta">
                Envoyée le {new Date(item.created_at).toLocaleString("fr-FR")} ·
                dernier état le{" "}
                {new Date(item.updated_at).toLocaleString("fr-FR")}
              </p>
              <button onClick={() => onReview(item.id)}>
                Ouvrir la revue : {item.question}
              </button>
            </li>
          ))}
        </ol>
        <p>
          {group.items.length} revues présentées sur {group.total}{" "}
          {received
            ? "avis attendus autorisés"
            : "envois encore partagés autorisés"}
          . Les plus anciennes d’abord.{" "}
          <button onClick={() => onAllReviews(received ? "assigned" : "mine")}>
            Voir l’historique des revues {received ? "reçues" : "envoyées"}
          </button>
        </p>
      </>
    );
  }
  return (
    <section className="work-brief" aria-label="Votre travail et son suivi">
      <div className="work-brief-heading">
        <div>
          <p className="kicker">Votre travail réel</p>
          <h3 ref={heading} tabIndex={-1}>
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
      {query.isFetching && (
        <ActivityStatus>Lecture de votre travail autorisé…</ActivityStatus>
      )}
      {query.error && (
        <p role="alert">
          Accueil indisponible. Actualisez pour revérifier vos droits et le
          travail actuel.
        </p>
      )}
      {data && (
        <>
          <div className="work-brief-scopes" aria-label="Catégories du travail">
            {entries.map((e) => (
              <button
                key={e.id}
                aria-pressed={effective === e.id}
                aria-controls={panelId}
                onClick={() => onSection(e.id)}
              >
                {e.label} · {e.count}
              </button>
            ))}
          </div>
          <div id={panelId}>
            {effective === "tasks" && data.tasks && (
              <>
                <div
                  className="work-brief-scopes"
                  aria-label="Périmètre des tâches"
                >
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
                <WorkBriefContent
                  brief={data.tasks}
                  scope={scope}
                  onOpen={onTask}
                  onAll={onAllTasks}
                />
              </>
            )}
            {effective === "received" &&
              data.received_cases &&
              cases(data.received_cases, true)}
            {effective === "mine" && cases(data.my_cases, false)}
            {effective === "reviews" &&
              data.received_reference_reviews &&
              reviews(data.received_reference_reviews, true)}
            {effective === "sentReviews" &&
              data.my_reference_reviews &&
              reviews(data.my_reference_reviews, false)}
            {effective === "missions" && data.my_missions && (
              <MissionOverview
                group={data.my_missions}
                onOpen={(id, control) => onMission(id, control)}
                onAll={() => onAllMissions()}
              />
            )}
            {effective === "imports" && data.imports && (
              <>
                <h4>Vos imports à reprendre</h4>
                <p>
                  {data.imports.pending_jobs} imports contiennent des éléments
                  en attente ; {data.imports.failed_jobs} des éléments en échec.
                  Un import peut être compté dans les deux catégories.
                </p>
                {!data.imports.total && (
                  <p>
                    Aucun de vos imports autorisés n’a d’élément en attente ou
                    en échec.
                  </p>
                )}
                <ol className="work-brief-list">
                  {data.imports.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.collection_name}</strong>
                        <span>
                          {item.pending} en attente · {item.failed} en échec
                        </span>
                      </div>
                      <p>
                        {item.failed
                          ? "Examiner les échecs avant de préparer une reprise."
                          : "Examiner les éléments et préparer leur traitement local."}
                      </p>
                      <p className="work-brief-meta">
                        Créé le{" "}
                        {new Date(item.created_at).toLocaleString("fr-FR")} ·{" "}
                        {item.id}
                      </p>
                      <button onClick={() => onImport(item.id)}>
                        Ouvrir l’import : {item.collection_name}
                      </button>
                    </li>
                  ))}
                </ol>
                <p>
                  {data.imports.items.length} imports présentés sur{" "}
                  {data.imports.total} à reprendre. Échecs d’abord, puis les
                  plus anciens.{" "}
                  <button onClick={onAllImports}>Voir tous mes imports</button>
                </p>
              </>
            )}
          </div>
          <p className="work-brief-meta">
            État relu le {new Date(data.as_of).toLocaleString("fr-FR")}. Le
            périmètre « domaine » ne concerne que les tâches.
          </p>
          <details>
            <summary>Ce que cet accueil couvre</summary>
            <p>
              Compteurs complets des objets actifs autorisés, cinq éléments au
              plus par catégorie. Dossiers reçus uniquement par partage
              nominatif actuel ; imports personnels uniquement avec accès à la
              collection et à chaque élément. Les revues exigent l’accès actuel
              à leur source exacte ; un avis émis quitte les avis à préparer,
              tandis que l’auteur suit sa copie jusqu’au retrait. Les dossiers
              clos ou retirés et les imports terminés ou arrêtés restent dans
              leur historique.
            </p>
            <p>
              Vos missions non arrêtées sont comptées sous votre seul contrôle personnel ; leurs titres exigent les accès actuels au mandat. Les rapports remis restent visibles sans présumer leur lecture ou approbation. Les signalements personnels et décisions de publication ne sont pas comptés ici. Aucun score de qualité ou de
              couverture du corpus. Ouvrir un élément ne le modifie pas.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
