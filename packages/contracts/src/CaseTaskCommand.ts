/* Generated from the checked-in wire schema. Do not edit. */

export interface CaseTaskCommand {
  action: "link" | "unlink";
  task_id: string;
  expected_case_revision: number;
  expected_task_revision: number;
  idempotency_key: string;
}
