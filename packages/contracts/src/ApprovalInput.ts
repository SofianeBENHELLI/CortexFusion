/* Generated from the checked-in wire schema. Do not edit. */

export type ExpectedReviewRevision = number;
export type Digest = string;
export type ExpectedVersion = number;
export type Reason = string;
export type IdempotencyKey = string;

export interface ApprovalInput {
  expected_review_revision?: ExpectedReviewRevision;
  digest: Digest;
  expected_version: ExpectedVersion;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
