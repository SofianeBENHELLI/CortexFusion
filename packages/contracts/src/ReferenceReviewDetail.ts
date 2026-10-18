/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewDetail {
  id: string;
  author: string;
  reviewer: string;
  draft_revision: number;
  revision: number;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner" | "withdrawn";
  updated_at: string;
  question_id: string;
  content: ReferenceDraftContent | null;
  review_note: string;
  created_at: string;
  actions: ("withdraw" | "request_changes" | "ready_for_owner")[];
}
export interface ReferenceDraftContent {
  theme: string;
  question: string;
  criteria: string;
  source_id: string;
  source_hash: string;
  excerpt: string;
  selection: {
    start: number;
    end: number;
  };
}
