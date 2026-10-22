/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceDraftReceiptRecord {
  command_id: string;
  receipt: ReferenceDraftReceipt;
}
export interface ReferenceDraftReceipt {
  receipt_id: string;
  question_id: string;
  revision: number;
}
