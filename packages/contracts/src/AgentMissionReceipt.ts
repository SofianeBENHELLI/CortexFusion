/* Generated from the checked-in wire schema. Do not edit. */

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
