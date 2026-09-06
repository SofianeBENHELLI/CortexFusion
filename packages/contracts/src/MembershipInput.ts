/* Generated from the checked-in wire schema. Do not edit. */

export type Subject = string;
export type Role = ("owner" | "corpus_manager" | "contributor" | "agent" | "viewer") | null;
export type ExpectedRevision = number | null;
export type Reason = string;
export type IdempotencyKey = string;

export interface MembershipInput {
  subject: Subject;
  role: Role;
  expected_revision?: ExpectedRevision;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
