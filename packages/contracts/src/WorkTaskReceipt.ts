/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkTaskReceipt {
  task_id: string;
  event_id: string;
  revision: number;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
}
