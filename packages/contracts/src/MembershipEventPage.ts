/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Author = string;
export type Subject = string;
export type PreviousRole = string | null;
export type NewRole = string | null;
export type ResultingRevision = number | null;
export type Reason = string;
export type CreatedAt = string;
export type Items = MembershipReceipt[];
export type NextAfter = string | null;

export interface MembershipEventPage {
  items: Items;
  next_after: NextAfter;
}
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
