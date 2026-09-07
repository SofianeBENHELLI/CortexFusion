/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type IssueId = string;
export type Author = string;
export type PreviousStatus = "open" | "in_progress" | "resolved" | "dismissed";
export type Status = "open" | "in_progress" | "resolved" | "dismissed";
export type Revision = number;
export type Reason = string;
export type CreatedAt = string;
export type CorrectionProposalId = string | null;
export type CorrectionDigest = string | null;
export type CorrectionPublishedVersion = number | null;
export type Items = IssueEvent[];
export type NextAfter = string | null;

export interface IssueEventPage {
  items: Items;
  next_after: NextAfter;
}
export interface IssueEvent {
  id: Id;
  issue_id: IssueId;
  author: Author;
  previous_status: PreviousStatus;
  status: Status;
  revision: Revision;
  reason: Reason;
  created_at: CreatedAt;
  correction_proposal_id?: CorrectionProposalId;
  correction_digest?: CorrectionDigest;
  correction_published_version?: CorrectionPublishedVersion;
}
