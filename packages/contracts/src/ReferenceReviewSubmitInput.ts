/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewSubmitInput {
  question_id: string;
  draft_revision: number;
  reviewer: string;
  preparation_id: string;
  idempotency_key: string;
}
