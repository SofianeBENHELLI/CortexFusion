/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkReferenceReviewOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary, WorkReferenceReviewSummary]
    | [
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary,
        WorkReferenceReviewSummary
      ];
  has_more: boolean;
  sort: "created_at_asc_id_asc";
}
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
