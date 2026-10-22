/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkMissionSummary {
  id: string;
  status: "queued" | "running" | "completed";
  revision: number;
  created_at: string;
  expires_at: string;
  expired: boolean;
  content_available: boolean;
  title: string | null;
  reads_used: number;
  chars_used: number;
  max_reads: number;
  max_chars: number;
}
