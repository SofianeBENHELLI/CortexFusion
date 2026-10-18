/* Generated from the checked-in wire schema. Do not edit. */

export interface ImportCommandInput {
  action: "process" | "retry" | "cancel";
  expected_digest: string;
  idempotency_key: string;
  limit: number;
}
