/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkTaskEvent {
  id: string;
  task_id: string;
  revision: number;
  actor: string;
  action: string;
  previous_status: string;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  assignee: string | null;
  reason: string;
  result_summary: string;
  created_at: string;
  planning?: TaskPlanChange | null;
}
export interface TaskPlanChange {
  before: TaskPlanState;
  after: TaskPlanState;
}
export interface TaskPlanState {
  priority: "low" | "normal" | "high";
  due_at: string | null;
}
