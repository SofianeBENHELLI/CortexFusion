/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Title = string;
export type Archived = boolean;
export type Revision = number;
export type CreatedAt = string;
export type Items = ConversationView[];
export type NextAfter = string | null;

export interface ConversationPage {
  items: Items;
  next_after: NextAfter;
}
export interface ConversationView {
  id: Id;
  title: Title;
  archived: Archived;
  revision: Revision;
  created_at: CreatedAt;
}
