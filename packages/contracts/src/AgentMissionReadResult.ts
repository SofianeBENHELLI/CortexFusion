/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionReadResult {
  receipt: AgentMissionReceipt;
  source_id: string;
  source_hash: string;
  title: string;
  location: string;
  start: number;
  end: number;
  total_characters: number;
  excerpt: string;
}
export interface AgentMissionReceipt {
  mission_id: string;
  event_id: string;
  revision: number;
  status: "queued" | "running" | "stopped" | "completed";
  reads_used: number;
  chars_used: number;
  lease_id: string | null;
  lease_expires_at: string | null;
}
