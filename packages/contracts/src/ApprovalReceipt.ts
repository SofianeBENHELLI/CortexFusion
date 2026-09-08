/* Generated from the checked-in wire schema. Do not edit. */

export type Sequence = number;
export type ProposalId = string;
export type Accepted = true;

export interface ApprovalReceipt {
  sequence: Sequence;
  proposal_id: ProposalId;
  accepted: Accepted;
}
