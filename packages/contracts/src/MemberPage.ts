/* Generated from the checked-in wire schema. Do not edit. */

export type Subject = string;
export type Role = string;
export type Roles = string[] | null;
export type Revision = number;
export type Items = MemberView[];
export type NextAfter = string | null;

export interface MemberPage {
  items: Items;
  next_after: NextAfter;
}
export interface MemberView {
  subject: Subject;
  role: Role;
  roles?: Roles;
  revision: Revision;
}
