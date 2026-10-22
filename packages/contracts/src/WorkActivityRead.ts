/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkActivityRead {
  kind: "task" | "reference_review" | "mission" | "shared_case";
  idempotency_key: string;
}
