/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Author = string;
export type Subject = string;
export type PreviousRole = string | null;
export type NewRole = string | null;
export type ResultingRevision = number | null;
export type Reason = string;
export type CreatedAt = string;

export interface MembershipReceipt {
  id: Id;
  author: Author;
  subject: Subject;
  previous_role: PreviousRole;
  new_role: NewRole;
  resulting_revision: ResultingRevision;
  reason: Reason;
  created_at: CreatedAt;
}
