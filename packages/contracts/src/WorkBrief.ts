/* Generated from the checked-in wire schema. Do not edit. */

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
