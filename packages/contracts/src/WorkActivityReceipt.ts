/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkActivityReceipt {
  kind: "task" | "reference_review" | "mission" | "shared_case";
  event_id: string;
  read_at: string;
}
