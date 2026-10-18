/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionControl {
  id: string;
  status: "queued" | "running" | "stopped" | "completed";
  revision: number;
  max_reads: number;
  max_chars: number;
  reads_used: number;
  chars_used: number;
  expires_at: string;
  created_at: string;
  expired: boolean;
  can_stop: boolean;
  content_withheld: true;
}
