/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskCommandRecordPage {
  /**
   * @maxItems 50
   */
  items: TaskCommandRecord[];
  next_after: string | null;
  has_more: boolean;
  total: number;
  as_of: string;
  scope: "personal";
  permissions_version: number;
  work_version: number;
  completeness: "partial" | "complete";
  sort: "created_at_desc_id_desc";
}
export interface TaskCommandRecord {
  command_id: string;
  receipt: WorkTaskReceipt;
  action:
    | "create"
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
    | "link_proposal"
    | "expert_review"
    | "plan";
  recorded_at: string;
  task_title: string | null;
  current_revision: number | null;
  current_status: ("unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled") | null;
  outcome: "recorded";
}
export interface WorkTaskReceipt {
  task_id: string;
  event_id: string;
  revision: number;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
}
