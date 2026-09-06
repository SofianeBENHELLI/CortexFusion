/* Generated from the checked-in wire schema. Do not edit. */

export type Sequence = number;
export type ProposalId = string;
export type Author = string;
export type Reason = string;
export type Digest = string;
export type CreatedAt = string;
export type Items = CommitSummary[];
export type NextAfter = number | null;

export interface CommitPage {
  items: Items;
  next_after: NextAfter;
}
export interface CommitSummary {
  sequence: Sequence;
  proposal_id: ProposalId;
  author: Author;
  reason: Reason;
  digest: Digest;
  created_at: CreatedAt;
}
