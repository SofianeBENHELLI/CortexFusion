/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskPlanChange {
  before: TaskPlanState;
  after: TaskPlanState;
}
export interface TaskPlanState {
  priority: "low" | "normal" | "high";
  due_at: string | null;
}
