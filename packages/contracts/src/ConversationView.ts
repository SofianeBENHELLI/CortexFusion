/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Title = string;
export type Archived = boolean;
export type Revision = number;
export type CreatedAt = string;

export interface ConversationView {
  id: Id;
  title: Title;
  archived: Archived;
  revision: Revision;
  created_at: CreatedAt;
}
