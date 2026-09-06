/* Generated from the checked-in wire schema. Do not edit. */

export type ExpectedVersion = number;
export type Reason = string;
export type IdempotencyKey = string;

export interface RollbackInput {
  expected_version: ExpectedVersion;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
