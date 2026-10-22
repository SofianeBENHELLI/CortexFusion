/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskNotification {
  event_id: string;
  task_id: string;
  title: string;
  current_status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  action: string;
  actor: string;
  revision: number;
  created_at: string;
  read_at: string | null;
}
