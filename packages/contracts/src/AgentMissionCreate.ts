/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionCreate {
  mandate: AgentMissionMandate;
  preparation_id: string;
  idempotency_key: string;
}
export interface AgentMissionMandate {
  title: string;
  objective: string;
  criteria: string;
  agent: string;
  source_id: string;
  source_hash: string;
  max_reads: number;
  max_chars: number;
  expires_at: string;
}
