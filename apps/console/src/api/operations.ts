import type { SourceLocateInput } from "../../../../packages/contracts/src/SourceLocateInput";
import type { SourceLocation } from "../../../../packages/contracts/src/SourceLocation";
import type { SourcePassage } from "../../../../packages/contracts/src/SourcePassage";
import type { CompanionWorkflowCatalog } from "../../../../packages/contracts/src/CompanionWorkflowCatalog";
import type { WorkActivityPage } from "../../../../packages/contracts/src/WorkActivityPage";
import type { WorkActivityRead } from "../../../../packages/contracts/src/WorkActivityRead";
import type { WorkActivityReceipt } from "../../../../packages/contracts/src/WorkActivityReceipt";
import type { AgentMissionEvidence } from "../../../../packages/contracts/src/AgentMissionEvidence";
import type { AgentMissionControl } from "../../../../packages/contracts/src/AgentMissionControl";
import type { AgentMissionControlPage } from "../../../../packages/contracts/src/AgentMissionControlPage";
import type { AgentMissionCandidatePage } from "../../../../packages/contracts/src/AgentMissionCandidatePage";
import type { AgentMissionCommand } from "../../../../packages/contracts/src/AgentMissionCommand";
import type { AgentMissionCreate } from "../../../../packages/contracts/src/AgentMissionCreate";
import type { AgentMissionDetail } from "../../../../packages/contracts/src/AgentMissionDetail";
import type { AgentMissionEventPage } from "../../../../packages/contracts/src/AgentMissionEventPage";
import type { AgentMissionMandate } from "../../../../packages/contracts/src/AgentMissionMandate";
import type { AgentMissionPage } from "../../../../packages/contracts/src/AgentMissionPage";
import type { AgentMissionPreparation } from "../../../../packages/contracts/src/AgentMissionPreparation";
import type { AgentMissionReceipt } from "../../../../packages/contracts/src/AgentMissionReceipt";
import type { AgentMissionReceiptLookup } from "../../../../packages/contracts/src/AgentMissionReceiptLookup";
import type { ReferenceReviewEventPage } from "../../../../packages/contracts/src/ReferenceReviewEventPage";
import type { ReferenceReviewCommandInput } from "../../../../packages/contracts/src/ReferenceReviewCommandInput";
import type { ReferenceReviewDetail } from "../../../../packages/contracts/src/ReferenceReviewDetail";
import type { ReferenceReviewPage } from "../../../../packages/contracts/src/ReferenceReviewPage";
import type { ReferenceReviewPreparation } from "../../../../packages/contracts/src/ReferenceReviewPreparation";
import type { ReferenceReviewReceipt } from "../../../../packages/contracts/src/ReferenceReviewReceipt";
import type { ReferenceReviewReceiptRecord } from "../../../../packages/contracts/src/ReferenceReviewReceiptRecord";
import type { ReferenceReviewSelection } from "../../../../packages/contracts/src/ReferenceReviewSelection";
import type { ReferenceReviewSubmitInput } from "../../../../packages/contracts/src/ReferenceReviewSubmitInput";
import type { ReferenceReviewerPage } from "../../../../packages/contracts/src/ReferenceReviewerPage";
import type { ReferenceDraftReceiptRecord } from "../../../../packages/contracts/src/ReferenceDraftReceiptRecord";
import type { ReferenceDraft } from "../../../../packages/contracts/src/ReferenceDraft";
import type { ReferenceDraftInput } from "../../../../packages/contracts/src/ReferenceDraftInput";
import type { ReferenceDraftReceipt } from "../../../../packages/contracts/src/ReferenceDraftReceipt";
import type { ReferenceDraftPage } from "../../../../packages/contracts/src/ReferenceDraftPage";
import type { SourcePage } from "../../../../packages/contracts/src/SourcePage";
import type { TaskCommandRecord } from "../../../../packages/contracts/src/TaskCommandRecord";
import type { TaskCommandRecordPage } from "../../../../packages/contracts/src/TaskCommandRecordPage";
import type { TaskPlanInput } from "../../../../packages/contracts/src/TaskPlanInput";
import type { WorkOverview } from "../../../../packages/contracts/src/WorkOverview";
import type { CaseTaskCommand } from "../../../../packages/contracts/src/CaseTaskCommand";
import type { CaseTaskReferences } from "../../../../packages/contracts/src/CaseTaskReferences";
import type { ContributionDraft } from "../../../../packages/contracts/src/ContributionDraft";
import type { ContributionDraftInput } from "../../../../packages/contracts/src/ContributionDraftInput";
import type { ContributionDraftReceipt } from "../../../../packages/contracts/src/ContributionDraftReceipt";
import type { WorkBrief } from "../../../../packages/contracts/src/WorkBrief";
import type { ImportCommandState } from "../../../../packages/contracts/src/ImportCommandState";
import type { ImportCommandInput } from "../../../../packages/contracts/src/ImportCommandInput";
import type { ImportCommandReceipt } from "../../../../packages/contracts/src/ImportCommandReceipt";
import type { TextImportInput } from "../../../../packages/contracts/src/TextImportInput";
import type { CollectionInput } from "../../../../packages/contracts/src/CollectionInput";
import type { CollectionPage } from "../../../../packages/contracts/src/CollectionPage";
import type { ProposalExpertReviewPage } from "../../../../packages/contracts/src/ProposalExpertReviewPage";
import type { TaskProposalLinkInput } from "../../../../packages/contracts/src/TaskProposalLinkInput";
import type { TaskProposalReferences } from "../../../../packages/contracts/src/TaskProposalReferences";
import type { ExpertReviewInput } from "../../../../packages/contracts/src/ExpertReviewInput";
import type { ExpertReviewPage } from "../../../../packages/contracts/src/ExpertReviewPage";
import type { ExpertReviewReceipt } from "../../../../packages/contracts/src/ExpertReviewReceipt";
import type { SharedCase } from "../../../../packages/contracts/src/SharedCase";
import type { SharedCaseCommand } from "../../../../packages/contracts/src/SharedCaseCommand";
import type { SharedCaseContent } from "../../../../packages/contracts/src/SharedCaseContent";
import type { SharedCaseEvents } from "../../../../packages/contracts/src/SharedCaseEvents";
import type { SharedCasePage } from "../../../../packages/contracts/src/SharedCasePage";
import type { SharedCasePreparation } from "../../../../packages/contracts/src/SharedCasePreparation";
import type { SharedCaseReceipt } from "../../../../packages/contracts/src/SharedCaseReceipt";
import type { SharedCaseRecipients } from "../../../../packages/contracts/src/SharedCaseRecipients";
import type { SharedCaseShare } from "../../../../packages/contracts/src/SharedCaseShare";
import type { TaskNotificationPage } from "../../../../packages/contracts/src/TaskNotificationPage";
import type { TaskNotificationRead } from "../../../../packages/contracts/src/TaskNotificationRead";
import type { TaskNotificationReceipt } from "../../../../packages/contracts/src/TaskNotificationReceipt";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import type { WorkTaskPage } from "../../../../packages/contracts/src/WorkTaskPage";
import type { WorkTaskEventPage } from "../../../../packages/contracts/src/WorkTaskEventPage";
import type { WorkTaskCreate } from "../../../../packages/contracts/src/WorkTaskCreate";
import type { WorkTaskCommand } from "../../../../packages/contracts/src/WorkTaskCommand";
import type { WorkTaskReceipt } from "../../../../packages/contracts/src/WorkTaskReceipt";
import type { TaskCandidatePage } from "../../../../packages/contracts/src/TaskCandidatePage";
import type { ConversationDraft } from "../../../../packages/contracts/src/ConversationDraft";
import type { ConversationDraftInput } from "../../../../packages/contracts/src/ConversationDraftInput";
import type { ConversationDraftReceipt } from "../../../../packages/contracts/src/ConversationDraftReceipt";
import type { GraphMap } from "../../../../packages/contracts/src/GraphMap";
import type { GraphScene } from "../../../../packages/contracts/src/GraphScene";
import type { MapNodePage } from "../../../../packages/contracts/src/MapNodePage";
import type { ProposalInput } from "../../../../packages/contracts/src/ProposalInput";
import type { IssueDecisionInput } from "../../../../packages/contracts/src/IssueDecisionInput";
import type { IssueEvent } from "../../../../packages/contracts/src/IssueEvent";
import type { IssuePage } from "../../../../packages/contracts/src/IssuePage";
import type { IssueView } from "../../../../packages/contracts/src/IssueView";
import type { ReviewPage } from "../../../../packages/contracts/src/ReviewPage";
import type { SourceDetail } from "../../../../packages/contracts/src/SourceDetail";
import type { ImportPage } from "../../../../packages/contracts/src/ImportPage";
import type { ImportView } from "../../../../packages/contracts/src/ImportView";
import type { CollectionView } from "../../../../packages/contracts/src/CollectionView";
import type { ProposalPage } from "../../../../packages/contracts/src/ProposalPage";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ProposalDifference } from "../../../../packages/contracts/src/ProposalDifference";
import type { ProposalDifferenceSummary } from "../../../../packages/contracts/src/ProposalDifferenceSummary";
// Wire types imported from the checked-in backend contracts. Contract tests guard methods and paths.
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import type { ConversationInput } from "../../../../packages/contracts/src/ConversationInput";
import type { ConversationMessages } from "../../../../packages/contracts/src/ConversationMessages";
import type { ConversationQueryInput } from "../../../../packages/contracts/src/ConversationQueryInput";
import type { ConversationView } from "../../../../packages/contracts/src/ConversationView";
import type { FeedbackInput } from "../../../../packages/contracts/src/FeedbackInput";
import type { FeedbackReceipt } from "../../../../packages/contracts/src/FeedbackReceipt";
import type { IdentityView } from "../../../../packages/contracts/src/IdentityView";
import type { QueryResult } from "../../../../packages/contracts/src/QueryResult";
import type { VersionView } from "../../../../packages/contracts/src/VersionView";

import type { ConversationPage } from "../../../../packages/contracts/src/ConversationPage";
import type { CommitPage } from "../../../../packages/contracts/src/CommitPage";
import type { PublicationWindow } from "../../../../packages/contracts/src/PublicationWindow";
import type { GraphWindow } from "../../../../packages/contracts/src/GraphWindow";
export interface Operations {
  "companion_guides.list": {
    params: {};
    body: undefined;
    response: CompanionWorkflowCatalog;
  };
  "work_activity.list": {
    params: { domain: string };
    body: undefined;
    response: WorkActivityPage;
  };
  "work_activity.read": {
    params: { domain: string; event: string };
    body: WorkActivityRead;
    response: WorkActivityReceipt;
  };
  "agent_missions.evidence": {
    params: { domain: string; mission: string; index: string };
    body: undefined;
    response: AgentMissionEvidence;
  };
  "agent_missions.controls": {
    params: { domain: string };
    body: undefined;
    response: AgentMissionControlPage;
  };
  "agent_missions.control": {
    params: { domain: string; mission: string };
    body: undefined;
    response: AgentMissionControl;
  };
  "agent_missions.list": {
    params: { domain: string };
    body: undefined;
    response: AgentMissionPage;
  };
  "agent_missions.candidates": {
    params: { domain: string };
    body: undefined;
    response: AgentMissionCandidatePage;
  };
  "agent_missions.prepare": {
    params: { domain: string };
    body: AgentMissionMandate;
    response: AgentMissionPreparation;
  };
  "agent_missions.create": {
    params: { domain: string };
    body: AgentMissionCreate;
    response: AgentMissionReceipt;
  };
  "agent_missions.read": {
    params: { domain: string; mission: string };
    body: undefined;
    response: AgentMissionDetail;
  };
  "agent_missions.command": {
    params: { domain: string; mission: string };
    body: AgentMissionCommand;
    response: AgentMissionReceipt;
  };
  "agent_missions.events": {
    params: { domain: string; mission: string };
    body: undefined;
    response: AgentMissionEventPage;
  };
  "agent_missions.receipt": {
    params: { domain: string; command: string };
    body: undefined;
    response: AgentMissionReceiptLookup;
  };

  "reference_reviewers.list": {
    params: { domain: string; question: string };
    body: undefined;
    response: ReferenceReviewerPage;
  };
  "reference_reviews.prepare": {
    params: { domain: string };
    body: ReferenceReviewSelection;
    response: ReferenceReviewPreparation;
  };
  "reference_reviews.submit": {
    params: { domain: string };
    body: ReferenceReviewSubmitInput;
    response: ReferenceReviewReceipt;
  };
  "reference_reviews.list": {
    params: { domain: string };
    body: undefined;
    response: ReferenceReviewPage;
  };
  "reference_reviews.events": {
    params: { domain: string; review: string };
    body: undefined;
    response: ReferenceReviewEventPage;
  };
  "reference_reviews.read": {
    params: { domain: string; review: string };
    body: undefined;
    response: ReferenceReviewDetail;
  };
  "reference_reviews.command": {
    params: { domain: string; review: string };
    body: ReferenceReviewCommandInput;
    response: ReferenceReviewReceipt;
  };
  "reference_review_receipts.read": {
    params: { domain: string; command_id: string };
    body: undefined;
    response: ReferenceReviewReceiptRecord;
  };

  "reference_draft_receipts.read": {
    params: { domain: string; command_id: string };
    body: undefined;
    response: ReferenceDraftReceiptRecord;
  };
  "reference_drafts.list": {
    params: { domain: string };
    body: undefined;
    response: ReferenceDraftPage;
  };
  "reference_drafts.read": {
    params: { domain: string; question: string };
    body: undefined;
    response: ReferenceDraft;
  };
  "reference_drafts.save": {
    params: { domain: string; question: string };
    body: ReferenceDraftInput;
    response: ReferenceDraftReceipt;
  };
  "task_receipts.list": {
    params: { domain: string };
    body: undefined;
    response: TaskCommandRecordPage;
  };
  "task_receipts.read": {
    params: { domain: string; command_id: string };
    body: undefined;
    response: TaskCommandRecord;
  };
  "tasks.plan": {
    params: { domain: string; task_id: string };
    body: TaskPlanInput;
    response: WorkTaskReceipt;
  };
  "work_overview.read": {
    params: { domain: string };
    body: undefined;
    response: WorkOverview;
  };
  "case_tasks.list": {
    params: { domain: string; case_id: string };
    body: undefined;
    response: CaseTaskReferences;
  };
  "case_tasks.command": {
    params: { domain: string; case_id: string };
    body: CaseTaskCommand;
    response: SharedCaseReceipt;
  };
  "contribution_drafts.read": {
    params: { domain: string };
    body: undefined;
    response: ContributionDraft;
  };
  "contribution_drafts.save": {
    params: { domain: string };
    body: ContributionDraftInput;
    response: ContributionDraftReceipt;
  };
  "tasks.brief": {
    params: { domain: string };
    body: undefined;
    response: WorkBrief;
  };
  "imports.command_state": {
    params: { domain: string; import_id: string };
    body: undefined;
    response: ImportCommandState;
  };
  "imports.command": {
    params: { domain: string; import_id: string };
    body: ImportCommandInput;
    response: ImportCommandReceipt;
  };
  "imports.create": {
    params: { domain: string; collection_id: string };
    body: TextImportInput;
    response: ImportView;
  };
  "collections.list": {
    params: { domain: string };
    body: undefined;
    response: CollectionPage;
  };
  "collections.create": {
    params: { domain: string };
    body: CollectionInput;
    response: CollectionView;
  };

  "proposals.expert_reviews": {
    params: { domain: string; proposal_id: string };
    body: undefined;
    response: ProposalExpertReviewPage;
  };
  "task_proposals.list": {
    params: { domain: string; task_id: string };
    body: undefined;
    response: TaskProposalReferences;
  };
  "task_proposals.link": {
    params: { domain: string; task_id: string };
    body: TaskProposalLinkInput;
    response: WorkTaskReceipt;
  };
  "expert_reviews.list": {
    params: { domain: string; task_id: string; proposal_id: string };
    body: undefined;
    response: ExpertReviewPage;
  };
  "expert_reviews.submit": {
    params: { domain: string; task_id: string };
    body: ExpertReviewInput;
    response: ExpertReviewReceipt;
  };

  "cases.list": {
    params: { domain: string };
    body: undefined;
    response: SharedCasePage;
  };
  "cases.recipients": {
    params: { domain: string };
    body: undefined;
    response: SharedCaseRecipients;
  };
  "cases.prepare": {
    params: { domain: string };
    body: SharedCaseContent;
    response: SharedCasePreparation;
  };
  "cases.share": {
    params: { domain: string };
    body: SharedCaseShare;
    response: SharedCaseReceipt;
  };
  "cases.read": {
    params: { domain: string; case_id: string };
    body: undefined;
    response: SharedCase;
  };
  "cases.command": {
    params: { domain: string; case_id: string };
    body: SharedCaseCommand;
    response: SharedCaseReceipt;
  };
  "cases.events": {
    params: { domain: string; case_id: string };
    body: undefined;
    response: SharedCaseEvents;
  };

  "task_notifications.list": {
    params: { domain: string };
    body: undefined;
    response: TaskNotificationPage;
  };
  "task_notifications.read": {
    params: { domain: string; event_id: string };
    body: TaskNotificationRead;
    response: TaskNotificationReceipt;
  };
  "tasks.list": {
    params: { domain: string };
    body: undefined;
    response: WorkTaskPage;
  };
  "tasks.create": {
    params: { domain: string };
    body: WorkTaskCreate;
    response: WorkTaskReceipt;
  };
  "tasks.read": {
    params: { domain: string; task_id: string };
    body: undefined;
    response: WorkTask;
  };
  "tasks.events": {
    params: { domain: string; task_id: string };
    body: undefined;
    response: WorkTaskEventPage;
  };
  "tasks.command": {
    params: { domain: string; task_id: string };
    body: WorkTaskCommand;
    response: WorkTaskReceipt;
  };
  "tasks.candidates": {
    params: { domain: string };
    body: undefined;
    response: TaskCandidatePage;
  };

  "drafts.read": {
    params: { domain: string; draft_key: string };
    body: undefined;
    response: ConversationDraft;
  };
  "drafts.save": {
    params: { domain: string; draft_key: string };
    body: ConversationDraftInput;
    response: ConversationDraftReceipt;
  };
  "imports.list": {
    params: { domain: string };
    body: undefined;
    response: ImportPage;
  };
  "imports.read": {
    params: { domain: string; import_id: string };
    body: undefined;
    response: ImportView;
  };
  "collections.read": {
    params: { domain: string; collection_id: string };
    body: undefined;
    response: CollectionView;
  };
  "graph.scene": {
    params: { domain: string };
    body: undefined;
    response: GraphScene;
  };
  "graph.map_nodes": {
    params: { domain: string };
    body: undefined;
    response: MapNodePage;
  };
  "graph.map": {
    params: { domain: string };
    body: undefined;
    response: GraphMap;
  };
  "proposals.diff_summary": {
    params: { domain: string; proposal_id: string };
    body: undefined;
    response: ProposalDifferenceSummary;
  };
  "graph.window": {
    params: { domain: string };
    body: undefined;
    response: GraphWindow;
  };
  "publications.list": {
    params: { domain: string };
    body: undefined;
    response: PublicationWindow;
  };
  "commits.list": {
    params: { domain: string };
    body: undefined;
    response: CommitPage;
  };
  "proposals.create": {
    params: { domain: string };
    body: ProposalInput;
    response: ProposalView;
  };
  "issues.decide": {
    params: { domain: string; ident: string };
    body: IssueDecisionInput;
    response: IssueEvent;
  };
  "issues.list": {
    params: { domain: string };
    body: undefined;
    response: IssuePage;
  };
  "issues.read": {
    params: { domain: string; ident: string };
    body: undefined;
    response: IssueView;
  };
  "episodes.read": {
    params: { domain: string; episode_id: string };
    body: undefined;
    response: QueryResult;
  };
  "proposals.reviews": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ReviewPage;
  };
  "sources.list": {
    params: { domain: string };
    body: undefined;
    response: SourcePage;
  };
  "sources.locate": {
    params: { domain: string; source_id: string };
    body: SourceLocateInput;
    response: SourceLocation;
  };
  "sources.passage": {
    params: { domain: string; source_id: string };
    body: undefined;
    response: SourcePassage;
  };
  "sources.read": {
    params: { domain: string; source_id: string };
    body: undefined;
    response: SourceDetail;
  };
  "proposals.list": {
    params: { domain: string };
    body: undefined;
    response: ProposalPage;
  };
  "proposals.read": {
    params: { domain: string; proposal_id: string };
    body: undefined;
    response: ProposalView;
  };
  "proposals.diff": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ProposalDifference;
  };
  "conversations.list": {
    params: { domain: string };
    body: undefined;
    response: ConversationPage;
  };
  "conversations.create": {
    params: { domain: string };
    body: ConversationInput;
    response: ConversationView;
  };
  "conversations.messages": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ConversationMessages;
  };
  "conversations.query": {
    params: { domain: string; ident: string };
    body: ConversationQueryInput;
    response: QueryResult;
  };
  "identity.read": { params: {}; body: undefined; response: IdentityView };
  "domain.version": {
    params: { domain: string };
    body: undefined;
    response: VersionView;
  };
  "concepts.read": {
    params: { domain: string; concept_id: string };
    body: undefined;
    response: Concept;
  };
  "concepts.list": {
    params: { domain: string };
    body: undefined;
    response: Concept[];
  };
  "episodes.feedback": {
    params: { domain: string; episode_id: string };
    body: FeedbackInput;
    response: FeedbackReceipt;
  };
}
export const operations = {
  "companion_guides.list": { method: "GET", path: "/v1/companion-guides" },
  "work_activity.list": {
    method: "GET",
    path: "/v1/domains/{domain}/work-activity",
  },
  "work_activity.read": {
    method: "POST",
    path: "/v1/domains/{domain}/work-activity/{event}/read",
  },
  "agent_missions.evidence": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-missions/{mission}/evidence/{index}",
  },
  "agent_missions.controls": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-mission-controls",
  },
  "agent_missions.control": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-mission-controls/{mission}",
  },
  "agent_missions.list": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-missions",
  },
  "agent_missions.candidates": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-missions/candidates",
  },
  "agent_missions.prepare": {
    method: "POST",
    path: "/v1/domains/{domain}/agent-missions/prepare",
  },
  "agent_missions.create": {
    method: "POST",
    path: "/v1/domains/{domain}/agent-missions/create",
  },
  "agent_missions.read": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-missions/{mission}",
  },
  "agent_missions.command": {
    method: "POST",
    path: "/v1/domains/{domain}/agent-missions/{mission}/commands",
  },
  "agent_missions.events": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-missions/{mission}/events",
  },
  "agent_missions.receipt": {
    method: "GET",
    path: "/v1/domains/{domain}/agent-mission-receipts/{command}",
  },

  "reference_reviewers.list": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-drafts/{question}/reviewers",
  },
  "reference_reviews.prepare": {
    method: "POST",
    path: "/v1/domains/{domain}/reference-reviews/prepare",
  },
  "reference_reviews.submit": {
    method: "POST",
    path: "/v1/domains/{domain}/reference-reviews/submit",
  },
  "reference_reviews.list": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-reviews",
  },
  "reference_reviews.events": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-reviews/{review}/events",
  },
  "reference_reviews.read": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-reviews/{review}",
  },
  "reference_reviews.command": {
    method: "POST",
    path: "/v1/domains/{domain}/reference-reviews/{review}/commands",
  },
  "reference_review_receipts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-review-receipts/{command_id}",
  },
  "reference_draft_receipts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-draft-receipts/{command_id}",
  },
  "reference_drafts.list": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-drafts",
  },
  "reference_drafts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/reference-drafts/{question}",
  },
  "reference_drafts.save": {
    method: "POST",
    path: "/v1/domains/{domain}/reference-drafts/{question}",
  },
  "case_tasks.list": {
    method: "GET",
    path: "/v1/domains/{domain}/shared-cases/{case_id}/tasks",
  },
  "case_tasks.command": {
    method: "POST",
    path: "/v1/domains/{domain}/shared-cases/{case_id}/tasks",
  },
  "contribution_drafts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/contribution-draft",
  },
  "contribution_drafts.save": {
    method: "POST",
    path: "/v1/domains/{domain}/contribution-draft",
  },
  "work_overview.read": {
    method: "GET",
    path: "/v1/domains/{domain}/work-overview",
  },
  "task_receipts.list": {
    method: "GET",
    path: "/v1/domains/{domain}/task-command-receipts",
  },
  "task_receipts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/task-command-receipts/{command_id}",
  },
  "tasks.plan": {
    method: "POST",
    path: "/v1/domains/{domain}/tasks/{task_id}/plan",
  },
  "tasks.brief": { method: "GET", path: "/v1/domains/{domain}/work-brief" },
  "imports.command_state": {
    method: "GET",
    path: "/v1/domains/{domain}/imports/{import_id}/command-state",
  },
  "imports.command": {
    method: "POST",
    path: "/v1/domains/{domain}/imports/{import_id}/commands",
  },
  "imports.create": {
    method: "POST",
    path: "/v1/domains/{domain}/collections/{collection_id}/imports",
  },
  "collections.list": {
    method: "GET",
    path: "/v1/domains/{domain}/collections",
  },
  "collections.create": {
    method: "POST",
    path: "/v1/domains/{domain}/collections",
  },

  "proposals.expert_reviews": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{proposal_id}/expert-reviews",
  },
  "task_proposals.list": {
    method: "GET",
    path: "/v1/domains/{domain}/tasks/{task_id}/proposals",
  },
  "task_proposals.link": {
    method: "POST",
    path: "/v1/domains/{domain}/tasks/{task_id}/proposals",
  },
  "expert_reviews.list": {
    method: "GET",
    path: "/v1/domains/{domain}/tasks/{task_id}/proposals/{proposal_id}/expert-reviews",
  },
  "expert_reviews.submit": {
    method: "POST",
    path: "/v1/domains/{domain}/tasks/{task_id}/expert-reviews",
  },
  "cases.list": { method: "GET", path: "/v1/domains/{domain}/shared-cases" },
  "cases.recipients": {
    method: "GET",
    path: "/v1/domains/{domain}/shared-cases/recipients",
  },
  "cases.prepare": {
    method: "POST",
    path: "/v1/domains/{domain}/shared-cases/prepare",
  },
  "cases.share": {
    method: "POST",
    path: "/v1/domains/{domain}/shared-cases/share",
  },
  "cases.read": {
    method: "GET",
    path: "/v1/domains/{domain}/shared-cases/{case_id}",
  },
  "cases.command": {
    method: "POST",
    path: "/v1/domains/{domain}/shared-cases/{case_id}/commands",
  },
  "cases.events": {
    method: "GET",
    path: "/v1/domains/{domain}/shared-cases/{case_id}/events",
  },
  "task_notifications.list": {
    method: "GET",
    path: "/v1/domains/{domain}/task-notifications",
  },
  "task_notifications.read": {
    method: "POST",
    path: "/v1/domains/{domain}/task-notifications/{event_id}/read",
  },
  "tasks.list": { method: "GET", path: "/v1/domains/{domain}/tasks" },
  "tasks.create": { method: "POST", path: "/v1/domains/{domain}/tasks" },
  "tasks.read": { method: "GET", path: "/v1/domains/{domain}/tasks/{task_id}" },
  "tasks.events": {
    method: "GET",
    path: "/v1/domains/{domain}/tasks/{task_id}/events",
  },
  "tasks.command": {
    method: "POST",
    path: "/v1/domains/{domain}/tasks/{task_id}/commands",
  },
  "tasks.candidates": {
    method: "GET",
    path: "/v1/domains/{domain}/tasks/candidates",
  },
  "drafts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/conversation-drafts/{draft_key}",
  },
  "drafts.save": {
    method: "POST",
    path: "/v1/domains/{domain}/conversation-drafts/{draft_key}",
  },
  "imports.list": { method: "GET", path: "/v1/domains/{domain}/imports" },
  "imports.read": {
    method: "GET",
    path: "/v1/domains/{domain}/imports/{import_id}",
  },
  "collections.read": {
    method: "GET",
    path: "/v1/domains/{domain}/collections/{collection_id}",
  },
  "graph.map": { method: "GET", path: "/v1/domains/{domain}/graph/map" },
  "graph.scene": { method: "GET", path: "/v1/domains/{domain}/graph/scene" },
  "graph.map_nodes": {
    method: "GET",
    path: "/v1/domains/{domain}/graph/map/nodes",
  },
  "concepts.read": {
    method: "GET",
    path: "/v1/domains/{domain}/concepts/{concept_id}",
  },
  "graph.window": {
    method: "GET",
    path: "/v1/domains/{domain}/graph/window",
  },
  "publications.list": {
    method: "GET",
    path: "/v1/domains/{domain}/publications",
  },
  "commits.list": { method: "GET", path: "/v1/domains/{domain}/commits" },
  "proposals.create": {
    method: "POST",
    path: "/v1/domains/{domain}/proposals",
  },
  "issues.decide": {
    method: "POST",
    path: "/v1/domains/{domain}/issues/{ident}/decisions",
  },
  "issues.list": { method: "GET", path: "/v1/domains/{domain}/issues" },
  "issues.read": { method: "GET", path: "/v1/domains/{domain}/issues/{ident}" },
  "episodes.read": {
    method: "GET",
    path: "/v1/domains/{domain}/episodes/{episode_id}",
  },
  "proposals.reviews": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{ident}/reviews",
  },
  "sources.list": { method: "GET", path: "/v1/domains/{domain}/sources" },
  "sources.locate": {
    method: "POST",
    path: "/v1/domains/{domain}/sources/{source_id}/locate",
  },
  "sources.passage": {
    method: "GET",
    path: "/v1/domains/{domain}/sources/{source_id}/passage",
  },
  "sources.read": {
    method: "GET",
    path: "/v1/domains/{domain}/sources/{source_id}",
  },
  "proposals.list": { method: "GET", path: "/v1/domains/{domain}/proposals" },
  "proposals.read": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{proposal_id}",
  },
  "proposals.diff": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{ident}/diff",
  },
  "proposals.diff_summary": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{proposal_id}/diff/summary",
  },
  "conversations.list": {
    method: "GET",
    path: "/v1/domains/{domain}/conversations",
  },
  "conversations.create": {
    method: "POST",
    path: "/v1/domains/{domain}/conversations",
  },
  "conversations.messages": {
    method: "GET",
    path: "/v1/domains/{domain}/conversations/{ident}/messages",
  },
  "conversations.query": {
    method: "POST",
    path: "/v1/domains/{domain}/conversations/{ident}/query",
  },
  "identity.read": { method: "GET", path: "/v1/me" },
  "domain.version": { method: "GET", path: "/v1/domains/{domain}/version" },
  "concepts.list": { method: "GET", path: "/v1/domains/{domain}/concepts" },
  "episodes.feedback": {
    method: "POST",
    path: "/v1/domains/{domain}/episodes/{episode_id}/feedback",
  },
} as const;
