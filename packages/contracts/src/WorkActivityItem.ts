/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkActivityItem {
  kind: "task" | "reference_review" | "mission" | "shared_case";
  event_id: string;
  target_id: string;
  title: string | null;
  current_status: string;
  current_revision: number;
  action: string;
  actor: string | null;
  event_revision: number;
  created_at: string;
  read_at: string | null;
  content_available: boolean;
}
