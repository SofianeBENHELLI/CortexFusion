/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type IssueId = string;
export type Author = string;
export type PreviousStatus = "open" | "in_progress" | "resolved" | "dismissed";
export type Status = "open" | "in_progress" | "resolved" | "dismissed";
export type Revision = number;
export type Reason = string;
export type CreatedAt = string;

export interface IssueEvent {
  id: Id;
  issue_id: IssueId;
  author: Author;
  previous_status: PreviousStatus;
  status: Status;
  revision: Revision;
  reason: Reason;
  created_at: CreatedAt;
}
