/* Generated from the checked-in wire schema. Do not edit. */

export interface ImportCommandReceipt {
  import_id: string;
  action: "process" | "retry" | "cancel";
  before_digest: string;
  after_digest: string;
  status: "pending" | "partial" | "succeeded" | "failed" | "cancelled";
  affected_items: number;
  idempotency_key: string;
}
