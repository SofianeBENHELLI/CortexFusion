/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskProposalLinkInput {
  proposal_id: string;
  expected_task_revision: number;
  idempotency_key: string;
}
