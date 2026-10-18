/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewerPage {
  items: ReferenceReviewerSummary[];
  next_after: string | null;
}
export interface ReferenceReviewerSummary {
  subject: string;
  role: "owner" | "corpus_manager";
}
