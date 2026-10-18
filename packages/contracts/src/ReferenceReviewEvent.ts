/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewEvent {
  id: string;
  actor: string;
  action: "submit" | "request_changes" | "ready_for_owner" | "withdraw";
  revision: number;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner" | "withdrawn";
  note: string | null;
  created_at: string;
}
