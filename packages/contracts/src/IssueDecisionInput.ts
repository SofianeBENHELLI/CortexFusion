/* Generated from the checked-in wire schema. Do not edit. */

export type Action = "start" | "resolve" | "dismiss" | "reopen";
export type ExpectedRevision = number;
export type Reason = string;
export type IdempotencyKey = string;

export interface IssueDecisionInput {
  action: Action;
  expected_revision: ExpectedRevision;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
