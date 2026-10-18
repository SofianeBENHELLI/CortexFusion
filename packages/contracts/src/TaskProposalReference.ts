/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskProposalReference {
  proposal_id: string;
  digest: string;
  review_revision: number;
  status: string;
  linked_by: string;
  linked_at: string;
  can_review: boolean;
}
