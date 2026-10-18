/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkReferenceReviewSummary {
  id: string;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner";
  created_at: string;
  question: string;
  author: string;
  reviewer: string;
  updated_at: string;
  revision: number;
}
