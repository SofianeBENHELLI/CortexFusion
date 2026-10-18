import { CompanionGuides, type GuideActions } from "./CompanionGuides";
import { WorkActivity, type WorkActivityActions } from "./WorkActivity";
import {
  AgentMissionWorkspace,
  type MissionActions,
} from "./AgentMissionWorkspace";
import {
  ReferenceReviewWorkspace,
  type ReferenceReviewActions,
} from "./ReferenceReviewWorkspace";
import {
  ReferenceWorkspace,
  type ReferenceActions,
} from "./ReferenceWorkspace";
import type { RecoveryScope } from "./taskRecoveryStore";
import type { ReviewCommandHandle } from "./ReviewCommand";
import {
  SourceContribution,
  type SourceContributionHandle,
} from "./SourceContribution";
import { ImportActions, type ImportActionsHandle } from "./ImportActions";
import { useQueryClient } from "@tanstack/react-query";
import {
  SharedCaseWorkspace,
  type SharedCaseActions,
} from "./SharedCaseWorkspace";
import { TaskWorkspace, type TaskWorkspaceActions } from "./TaskWorkspace";
import { lazy, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CortexApi } from "./client";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { AsyncWorkspace } from "../AsyncWorkspace";
import { workspaceCommands } from "./workspaceCommands";

const IssueWorkspace = lazy(() =>
  import("./IssueWorkspace").then((m) => ({ default: m.IssueWorkspace })),
);
const ProposalWorkspace = lazy(() =>
  import("./ProposalWorkspace").then((m) => ({ default: m.ProposalWorkspace })),
);
const ImportWorkspace = lazy(() =>
  import("./ImportWorkspace").then((m) => ({ default: m.ImportWorkspace })),
);
const dossiers = {
  activity: workspaceCommands.activity.label,
  missions: workspaceCommands.missions.label,
  referenceReviews: workspaceCommands.referenceReviews.label,
  references: workspaceCommands.references.label,
  cases: workspaceCommands.cases.label,
  tasks: workspaceCommands.tasks.label,
  sources: workspaceCommands.sources.label,
  issues: workspaceCommands.issues.label,
  proposals: workspaceCommands.proposals.label,
  imports: workspaceCommands.imports.label,
  guides: workspaceCommands.guides.label,
} as const;
type Dossier = keyof typeof dossiers;
function selection(params: URLSearchParams): Dossier {
  const value = params.get("api_dossier");
  if (value && Object.hasOwn(dossiers, value)) return value as Dossier;
  return params.has("api_proposal")
    ? "proposals"
    : params.has("api_task")
      ? "tasks"
      : params.has("api_case")
        ? "cases"
        : "sources";
}

/** One stable conversation; opening a dossier never replaces the active chat. */
export default function GovernanceWorkspace({
  api,
  domain,
  onReconnect,
  capabilities = [],
  recoveryScope,
}: {
  api: CortexApi;
  domain: string;
  onReconnect?: () => void;
  capabilities?: readonly string[];
  recoveryScope?: RecoveryScope;
}) {
  const cache = useQueryClient();
  const guides = useRef<GuideActions>(null);
  const [guideNotice, setGuideNotice] = useState("");
  const activity = useRef<WorkActivityActions>(null);
  const [activityNotice, setActivityNotice] = useState("");
  const missions = useRef<MissionActions>(null);
  const [missionNotice, setMissionNotice] = useState("");
  const referenceReviews = useRef<ReferenceReviewActions>(null);
  const [reviewNotice, setReviewNotice] = useState("");
  const references = useRef<ReferenceActions>(null);
  const [referenceNotice, setReferenceNotice] = useState("");
  const decisions = useRef<ReviewCommandHandle>(null);
  const [decisionNotice, setDecisionNotice] = useState("");
  const contribution = useRef<SourceContributionHandle>(null);
  const [contributionNotice, setContributionNotice] = useState("");
  const imports = useRef<ImportActionsHandle>(null);
  const [importNotice, setImportNotice] = useState("");
  const cases = useRef<SharedCaseActions>(null);
  const tasks = useRef<TaskWorkspaceActions>(null);
  const [taskNotice, setTaskNotice] = useState("");
  const [caseNotice, setCaseNotice] = useState("");
  const [params, setParams] = useSearchParams();
  const dossier = selection(params);
  useEffect(() => setDecisionNotice(""), [domain, params.get("api_proposal")]);
  const allowed = (key: Dossier) =>
    capabilities.includes(workspaceCommands[key].capability);
  useEffect(() => {
    if (!capabilities.includes("work_tasks")) setTaskNotice("");
  }, [capabilities]);
  const [opened, setOpened] = useState<Set<Dossier>>(() => new Set([dossier]));
  const [mobile, setMobile] = useState<"chat" | "dossier">(() =>
    ["api_proposal", "api_task", "api_case"].some((key) => params.has(key))
      ? "dossier"
      : "chat",
  );
  const [collapsed, setCollapsed] = useState(false);
  const [evidenceTarget, setEvidenceTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const dossierHeading = useRef<HTMLHeadingElement>(null);
  const chatPanel = useRef<HTMLDivElement>(null);
  const previousProposal = useRef(params.get("api_proposal"));
  useEffect(() => {
    setOpened((current) =>
      current.has(dossier) ? current : new Set([...current, dossier]),
    );
  }, [dossier]);
  useEffect(() => {
    const proposal = params.get("api_proposal");
    if (proposal && proposal !== previousProposal.current) {
      const next = new URLSearchParams(params);
      next.set("api_dossier", "proposals");
      setParams(next, { replace: true });
      setCollapsed(false);
      setMobile("dossier");
    }
    previousProposal.current = proposal;
  }, [params, setParams]);
  function selectProposal(id: string) {
    if (!allowed("proposals")) return false;
    setTaskNotice("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("api_proposal", id);
      next.set("api_dossier", "proposals");
      return next;
    });
    setOpened((current) => new Set([...current, "proposals"]));
    setCollapsed(false);
    setMobile("dossier");
    return true;
  }
  function selectWork(kind: "task" | "case", id: string, replace = false) {
    setTaskNotice("");
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set(`api_${kind}`, id);
        else next.delete(`api_${kind}`);
        next.set("api_dossier", kind === "task" ? "tasks" : "cases");
        return next;
      },
      { replace },
    );
    setCollapsed(false);
    setMobile("dossier");
  }
  function open(nextDossier: Dossier) {
    if (!allowed(nextDossier)) return false;
    setOpened((current) => new Set([...current, nextDossier]));
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("api_dossier", nextDossier);
      return next;
    });
    setCollapsed(false);
    setMobile("dossier");
    requestAnimationFrame(() => dossierHeading.current?.focus());
    return true;
  }
  return (
    <section
      className={`unified-workspace ${collapsed ? "dossier-collapsed" : ""}`}
      data-mobile-view={mobile}
      aria-label="Espace de travail unifié"
    >
      <nav className="unified-navigation" aria-label="Dossiers du domaine">
        <p className="kicker">Votre espace</p>
        <button
          onClick={() => {
            setMobile("chat");
            requestAnimationFrame(() => chatPanel.current?.focus());
          }}
        >
          Conversation
        </button>
        {Object.entries(dossiers)
          .filter(([key]) => allowed(key as Dossier))
          .map(([key, label]) => (
            <button
              key={key}
              aria-pressed={dossier === key && !collapsed}
              onClick={() => open(key as Dossier)}
            >
              {label}
            </button>
          ))}
        <p className="unified-nav-note">
          Vos signalements restent personnels. Une proposition suit son propre
          cycle de revue.
        </p>
      </nav>
      <div className="unified-stage">
        <div className="unified-heading">
          <div>
            <p className="kicker">Savoir publié · preuves et suivi</p>
            <h2>Votre conversation, votre travail</h2>
          </div>
          <button
            className="unified-collapse"
            aria-expanded={!collapsed}
            aria-controls="unified-dossier"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "Ouvrir le dossier" : "Masquer le dossier"}
          </button>
        </div>
        <div
          className="unified-mobile-switch"
          aria-label="Affichage du travail"
        >
          <button
            aria-pressed={mobile === "chat"}
            onClick={() => setMobile("chat")}
          >
            Conversation
          </button>
          <button
            aria-pressed={mobile === "dossier"}
            onClick={() => {
              setCollapsed(false);
              setMobile("dossier");
            }}
          >
            Dossier
          </button>
        </div>
        <div className="unified-content">
          <div
            className="unified-chat"
            ref={chatPanel}
            tabIndex={-1}
            aria-label="Conversation active"
          >
            <ConversationWorkspace
              api={api}
              domain={domain}
              onReconnect={onReconnect}
              evidenceTarget={allowed("sources") ? evidenceTarget : null}
              canFeedback={capabilities.includes("feedback")}
              canDraft={capabilities.includes("personal_drafts")}
              canBrief={capabilities.includes("work_brief")}
              canOverview={capabilities.includes("work_overview")}
              coordinate={capabilities.includes("coordinate_tasks")}
              onTaskIntent={async (intent) => {
                if (!open("tasks") || !tasks.current) {
                  const message =
                    "Les tâches ne sont pas disponibles avec vos accès actuels.";
                  setTaskNotice(message);
                  return message;
                }
                return tasks.current.act(intent);
              }}
              onCaseIntent={async (intent) => {
                if (!open("cases") || !cases.current) {
                  const text =
                    "Les dossiers partagés ne sont pas disponibles avec vos accès actuels.";
                  setCaseNotice(text);
                  return text;
                }
                return cases.current.act(intent);
              }}
              onImportIntent={async (intent) => {
                if (!open("imports") || !imports.current)
                  return "Les imports ne sont pas disponibles avec vos accès actuels.";
                return imports.current.act(intent);
              }}
              onGuideIntent={
                allowed("guides")
                  ? async (intent) => {
                      if (!open("guides") || !guides.current)
                        return "Guides indisponibles.";
                      return guides.current.act(intent);
                    }
                  : undefined
              }
              onActivityIntent={
                allowed("activity")
                  ? async (intent) => {
                      if (!open("activity") || !activity.current)
                        return "La boîte de réception n’est pas disponible avec vos accès.";
                      return activity.current.act(intent);
                    }
                  : undefined
              }
              onMissionIntent={
                allowed("missions")
                  ? async (intent) => {
                      if (!open("missions") || !missions.current)
                        return "Les missions ne sont pas disponibles avec vos accès actuels.";
                      return missions.current.act(intent);
                    }
                  : undefined
              }
              onReferenceReviewIntent={
                allowed("referenceReviews")
                  ? async (intent) => {
                      if (
                        !open("referenceReviews") ||
                        !referenceReviews.current
                      )
                        return "Les revues ne sont pas disponibles avec vos accès actuels.";
                      return referenceReviews.current.act(intent);
                    }
                  : undefined
              }
              onReferenceIntent={
                allowed("references")
                  ? async (intent) => {
                      if (!open("references") || !references.current)
                        return "Les références ne sont pas disponibles avec vos accès actuels.";
                      return references.current.act(intent);
                    }
                  : undefined
              }
              onContributionIntent={async (intent) => {
                if (!open("proposals") || !contribution.current)
                  return "La contribution n’est pas disponible avec vos accès actuels.";
                return contribution.current.act(intent);
              }}
              onDecisionIntent={
                capabilities.some((c) =>
                  ["review", "approve", "publish"].includes(c),
                )
                  ? async (intent) => {
                      open("proposals");
                      return decisions.current
                        ? decisions.current.act(intent)
                        : "Ouvrez une proposition et attendez sa comparaison avant de préparer une décision.";
                    }
                  : undefined
              }
              onSelectProposal={selectProposal}
              taskNotice={
                dossier === "guides"
                  ? guideNotice
                  : dossier === "activity"
                    ? activityNotice
                    : dossier === "missions"
                      ? missionNotice
                      : dossier === "referenceReviews"
                        ? reviewNotice
                        : dossier === "references"
                          ? referenceNotice
                          : dossier === "tasks"
                            ? taskNotice
                            : dossier === "cases"
                              ? caseNotice
                              : dossier === "imports"
                                ? importNotice
                                : dossier === "proposals"
                                  ? [contributionNotice, decisionNotice]
                                      .filter(Boolean)
                                      .join(" ")
                                  : ""
              }
              onWorkspaceAction={open}
              onInspectEvidence={() => open("sources")}
            />
          </div>
          <aside
            id="unified-dossier"
            className="unified-dossier"
            aria-label="Dossier de travail"
          >
            <h2 tabIndex={-1} ref={dossierHeading}>
              {dossiers[dossier]}
            </h2>
            {!allowed(dossier) && (
              <p role="alert">
                Ce dossier n’est pas disponible avec vos accès actuels.
              </p>
            )}
            <div
              hidden={dossier !== "sources" || !allowed("sources")}
              ref={setEvidenceTarget}
            />
            {allowed("guides") && (
              <div hidden={dossier !== "guides"}>
                <CompanionGuides
                  ref={guides}
                  api={api}
                  domain={domain}
                  scope={recoveryScope}
                  onNotice={setGuideNotice}
                />
              </div>
            )}
            {allowed("activity") && (
              <div hidden={dossier !== "activity"}>
                <WorkActivity
                  ref={activity}
                  api={api}
                  domain={domain}
                  scope={recoveryScope}
                  onNotice={setActivityNotice}
                  onOpen={async (item) => {
                    if (item.kind === "shared_case") {
                      if (!open("cases") || !cases.current)
                        return "Dossier partagé indisponible.";
                      return cases.current.act({
                        kind: "case_select",
                        id: item.target_id,
                      });
                    }
                    if (item.kind === "task") {
                      selectWork("task", item.target_id);
                      return "Tâche ouverte, événement non marqué comme lu.";
                    }
                    if (item.kind === "reference_review") {
                      if (
                        !open("referenceReviews") ||
                        !referenceReviews.current
                      )
                        return "Revue indisponible.";
                      return referenceReviews.current.act({
                        kind: "reference_review_open",
                        value: item.target_id,
                      });
                    }
                    if (!open("missions") || !missions.current)
                      return "Mission indisponible.";
                    return missions.current.act({
                      kind: item.content_available
                        ? "mission_open"
                        : "mission_control",
                      value: item.target_id,
                    });
                  }}
                />
              </div>
            )}
            {allowed("missions") && (
              <div hidden={dossier !== "missions"}>
                <AgentMissionWorkspace
                  api={api}
                  domain={domain}
                  ref={missions}
                  recoveryScope={recoveryScope}
                  canCoordinate={capabilities.includes("coordinate_missions")}
                  onChanged={() => {
                    void cache.invalidateQueries({
                      queryKey: ["api", "work-overview", domain],
                    });
                  }}
                  onNotice={setMissionNotice}
                />
              </div>
            )}
            {allowed("referenceReviews") && (
              <div hidden={dossier !== "referenceReviews"}>
                <ReferenceReviewWorkspace
                  onEditQuestion={
                    allowed("references")
                      ? async (id, reviewedRevision) => {
                          if (!open("references") || !references.current)
                            return "La question privée n’est pas disponible avec vos accès actuels.";
                          return references.current.act({
                            kind: "reference_open",
                            value: id,
                            reviewedRevision,
                          });
                        }
                      : undefined
                  }
                  onChanged={() => {
                    void cache.invalidateQueries({
                      queryKey: ["api", "work-overview", domain],
                    });
                  }}
                  recoveryScope={recoveryScope}
                  ref={referenceReviews}
                  api={api}
                  domain={domain}
                  onNotice={setReviewNotice}
                />
              </div>
            )}
            {allowed("references") && (
              <div hidden={dossier !== "references"}>
                <ReferenceWorkspace
                  ref={references}
                  recoveryScope={recoveryScope}
                  api={api}
                  domain={domain}
                  onNotice={setReferenceNotice}
                />
              </div>
            )}
            {allowed("cases") && (
              <div hidden={dossier !== "cases"}>
                <SharedCaseWorkspace
                  canCaseTasks={capabilities.includes("case_tasks")}
                  onOpenTask={(id) => {
                    selectWork("task", id);
                  }}
                  ref={cases}
                  routeSelection={params.get("api_case") ?? ""}
                  onSelection={(id, replace) => selectWork("case", id, replace)}
                  api={api}
                  domain={domain}
                  coordinate={capabilities.includes("coordinate_tasks")}
                  onNotice={setCaseNotice}
                />
              </div>
            )}
            {allowed("tasks") && (
              <div hidden={dossier !== "tasks"}>
                <TaskWorkspace
                  recoveryScope={recoveryScope}
                  ref={tasks}
                  canExpert={capabilities.includes("expert_reviews")}
                  canReceipts={capabilities.includes("task_receipts")}
                  onOpenProposal={selectProposal}
                  routeSelection={params.get("api_task") ?? ""}
                  onSelection={(id, replace) => selectWork("task", id, replace)}
                  api={api}
                  domain={domain}
                  coordinate={capabilities.includes("coordinate_tasks")}
                  onNotice={setTaskNotice}
                />
              </div>
            )}
            {allowed("proposals") && (
              <div hidden={dossier !== "proposals"}>
                <SourceContribution
                  ref={contribution}
                  api={api}
                  domain={domain}
                  canPropose={capabilities.includes("propose")}
                  canDraft={capabilities.includes("contribution_drafts")}
                  onNotice={setContributionNotice}
                  onOpen={selectProposal}
                />
              </div>
            )}
            {allowed("imports") && (
              <div hidden={dossier !== "imports"}>
                <ImportActions
                  ref={imports}
                  api={api}
                  domain={domain}
                  selected={params.get("api_import") ?? ""}
                  canManage={capabilities.includes("import_commands")}
                  onNotice={setImportNotice}
                  onSelect={(id) => {
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set("api_import", id);
                      next.set("api_dossier", "imports");
                      return next;
                    });
                    setOpened((current) => new Set([...current, "imports"]));
                    setMobile("dossier");
                    setCollapsed(false);
                  }}
                  onRefresh={async () => {
                    await Promise.all([
                      cache.invalidateQueries({
                        queryKey: ["api", "imports", domain],
                      }),
                      cache.invalidateQueries({
                        queryKey: ["api", "import", domain],
                      }),
                      cache.invalidateQueries({
                        queryKey: ["api", "import-collection", domain],
                      }),
                    ]);
                  }}
                />
              </div>
            )}
            {(["issues", "proposals", "imports"] as const).map(
              (item) =>
                opened.has(item) &&
                allowed(item) && (
                  <div key={item} hidden={dossier !== item}>
                    <AsyncWorkspace
                      name={dossiers[item]}
                      resetKey={`${domain}:${item}`}
                    >
                      {item === "issues" ? (
                        <IssueWorkspace api={api} domain={domain} />
                      ) : item === "proposals" ? (
                        <ProposalWorkspace
                          decisionRef={decisions}
                          capabilities={capabilities}
                          onDecisionNotice={setDecisionNotice}
                          canExpert={capabilities.includes("expert_reviews")}
                          onOpenTask={(id) => selectWork("task", id)}
                          api={api}
                          domain={domain}
                          onReconnect={onReconnect}
                        />
                      ) : (
                        <ImportWorkspace
                          onProposeSource={
                            capabilities.includes("propose")
                              ? (id) => {
                                  open("proposals");
                                  void contribution.current?.act({
                                    kind: "contribution_load",
                                    source: id,
                                  });
                                }
                              : undefined
                          }
                          canManage={capabilities.includes("import_commands")}
                          api={api}
                          domain={domain}
                          onReconnect={onReconnect}
                        />
                      )}
                    </AsyncWorkspace>
                  </div>
                ),
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
