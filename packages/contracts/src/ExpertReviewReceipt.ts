/* Generated from the checked-in wire schema. Do not edit. */

export interface ExpertReviewReceipt {
  task_id: string;
  event_id: string;
  revision: number;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  expert_review_id: string;
}
