/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkOverview {
  scope: "assigned" | "domain";
  role: "owner" | "corpus_manager" | "contributor" | "viewer";
  as_of: string;
  permissions_version: number;
  work_version: number;
  tasks: WorkBrief | null;
  received_cases: WorkCaseOverview | null;
  my_cases: WorkCaseOverview;
  imports: WorkImportOverview | null;
  coverage: "authorized_active_work_only";
  received_reference_reviews: WorkReferenceReviewOverview | null;
  my_reference_reviews: WorkReferenceReviewOverview | null;
  my_missions: WorkMissionOverview | null;
}
export interface WorkBrief {
  scope: "assigned" | "domain";
  role: "owner" | "corpus_manager" | "contributor";
  as_of: string;
  permissions_version: number;
  work_version: number;
  counts: {
    active: number;
    overdue: number;
    offered: number;
    review: number;
    blocked: number;
    unassigned: number;
    in_progress: number;
  };
  /**
   * @maxItems 5
   */
  items:
    | []
    | [
        {
          task: WorkTask;
          overdue: boolean;
        }
      ]
    | [
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        }
      ]
    | [
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        }
      ]
    | [
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        }
      ]
    | [
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        },
        {
          task: WorkTask;
          overdue: boolean;
        }
      ];
  has_more: boolean;
  sort:
    | "overdue_review_offer_blocked_unassigned_progress_due_created_id"
    | "overdue_priority_review_offer_blocked_unassigned_progress_due_created_id";
  coverage: "active_tasks_only";
}
export interface WorkTask {
  id: string;
  title: string;
  instructions: string;
  criteria: string;
  creator: string;
  assignee: string | null;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  revision: number;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  offered_at: string | null;
  accepted_at: string | null;
  result_summary: string;
  allowed_actions: (
    | "offer"
    | "accept"
    | "decline"
    | "block"
    | "resume"
    | "submit"
    | "request_changes"
    | "complete"
    | "cancel"
    | "reopen"
  )[];
  priority?: "low" | "normal" | "high";
  priority_reason?: string;
  planning_allowed?: boolean;
}
export interface WorkCaseOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary];
  has_more: boolean;
  sort: "created_at_asc_id_asc";
}
export interface WorkCaseSummary {
  id: string;
  title: string;
  status: "new" | "qualified";
  created_at: string;
}
export interface WorkImportOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary];
  has_more: boolean;
  sort: "failed_first_created_at_asc_id_asc";
  pending_jobs: number;
  failed_jobs: number;
}
export interface WorkImportSummary {
  id: string;
  collection_id: string;
  collection_name: string;
  pending: number;
  failed: number;
  created_at: string;
}
export interface WorkReferenceReviewOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary
      ];
  has_more: boolean;
  sort: "created_at_asc_id_asc";
}
export interface WorkReferenceReviewSummary {
  id: string;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner";
  created_at: string;
  question: string;
  author: string;
  reviewer: string;
  updated_at: string;
  revision: number;
}
export interface WorkMissionOverview {
  total: number;
  waiting: number;
  claimed: number;
  expired: number;
  reports: number;
  withheld: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary];
  has_more: boolean;
  sort: "expired_report_created_id";
}
export interface WorkMissionSummary {
  id: string;
  status: "queued" | "running" | "completed";
  revision: number;
  created_at: string;
  expires_at: string;
  expired: boolean;
  content_available: boolean;
  title: string | null;
  reads_used: number;
  chars_used: number;
  max_reads: number;
  max_chars: number;
}
