/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskPlanInput {
  expected_revision: number;
  priority: "low" | "normal" | "high";
  due_at: string | null;
  reason: string;
  idempotency_key: string;
}
