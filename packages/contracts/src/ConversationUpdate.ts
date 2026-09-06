/* Generated from the checked-in wire schema. Do not edit. */

export type Title = string;
export type Archived = boolean;
export type ExpectedRevision = number;

export interface ConversationUpdate {
  title: Title;
  archived: Archived;
  expected_revision: ExpectedRevision;
}
