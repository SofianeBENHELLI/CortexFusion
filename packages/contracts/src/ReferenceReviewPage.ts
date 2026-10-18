/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewPage {
  items: ReferenceReviewSummary[];
  next_after: string | null;
  scope: "mine" | "assigned";
}
export interface ReferenceReviewSummary {
  id: string;
  author: string;
  reviewer: string;
  draft_revision: number;
  revision: number;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner" | "withdrawn";
  updated_at: string;
  question: string | null;
}
