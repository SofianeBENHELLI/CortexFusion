/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkTaskCommand {
  action:
    | "offer"
    | "accept"
    | "decline"
    | "block"
    | "resume"
    | "submit"
    | "request_changes"
    | "complete"
    | "cancel"
    | "reopen";
  expected_revision: number;
  reason: string;
  assignee?: string;
  result_summary?: string;
  idempotency_key: string;
}
