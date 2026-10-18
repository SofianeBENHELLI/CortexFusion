/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkTask {
  id: string;
  title: string;
  instructions: string;
  criteria: string;
  creator: string;
  assignee: string | null;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  revision: number;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  offered_at: string | null;
  accepted_at: string | null;
  result_summary: string;
  allowed_actions: (
    | "offer"
    | "accept"
    | "decline"
    | "block"
    | "resume"
    | "submit"
    | "request_changes"
    | "complete"
    | "cancel"
    | "reopen"
  )[];
  priority?: "low" | "normal" | "high";
  priority_reason?: string;
  planning_allowed?: boolean;
}
