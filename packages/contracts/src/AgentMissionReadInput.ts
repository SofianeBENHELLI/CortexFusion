/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionReadInput {
  expected_revision: number;
  idempotency_key: string;
  lease_id: string;
  start: number;
  end: number;
}
