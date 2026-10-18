/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceReviewReceiptRecord {
  command_id: string;
  receipt: ReferenceReviewReceipt;
}
export interface ReferenceReviewReceipt {
  review_id: string;
  event_id: string;
  revision: number;
  status: "awaiting_review" | "changes_requested" | "ready_for_owner" | "withdrawn";
}
