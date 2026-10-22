/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionPreparation {
  preparation_id: string;
  mandate: AgentMissionMandate;
  source: {
    id: string;
    title: string;
    content_hash: string;
    characters: number;
  };
  expires_at: string;
  provider: "none";
  execution: "client_managed";
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
