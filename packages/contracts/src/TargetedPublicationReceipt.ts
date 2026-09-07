/* Generated from the checked-in wire schema. Do not edit. */

export type PublishedVersion = number;
export type Changed = boolean;
export type ProposalId = string;
export type TargetVersion = number;

export interface TargetedPublicationReceipt {
  published_version: PublishedVersion;
  changed: Changed;
  proposal_id: ProposalId;
  target_version: TargetVersion;
}
