/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type ProposalId = string;
export type Author = string;
export type Action = string;
export type Reason = string;
export type ProposalDigest = string;
export type ReviewRevision = number;
export type ResultingStatus =
  "ready" | "approved" | "published" | "rejected" | "deferred" | "changes_requested" | "superseded";
export type CreatedAt = string;

export interface ReviewReceipt {
  id: Id;
  proposal_id: ProposalId;
  author: Author;
  action: Action;
  reason: Reason;
  proposal_digest: ProposalDigest;
  review_revision: ReviewRevision;
  resulting_status: ResultingStatus;
  created_at: CreatedAt;
}
