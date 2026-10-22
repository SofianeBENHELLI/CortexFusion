/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewCommandInput {
  action: "withdraw" | "request_changes" | "ready_for_owner";
  expected_revision: number;
  note: string;
  idempotency_key: string;
}
