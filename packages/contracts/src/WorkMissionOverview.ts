/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkMissionOverview {
  total: number;
  waiting: number;
  claimed: number;
  expired: number;
  reports: number;
  withheld: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary]
    | [WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary, WorkMissionSummary];
  has_more: boolean;
  sort: "expired_report_created_id";
}
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
