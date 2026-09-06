/* Generated from the checked-in wire schema. Do not edit. */

export type Action = "reject" | "defer" | "request_changes" | "reopen";
export type Digest = string;
export type ExpectedReviewRevision = number;
export type Reason = string;
export type IdempotencyKey = string;

export interface ReviewInput {
  action: Action;
  digest: Digest;
  expected_review_revision: ExpectedReviewRevision;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
