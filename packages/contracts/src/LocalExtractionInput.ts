/* Generated from the checked-in wire schema. Do not edit. */

export type AllowLocalProcessing = true;
export type IdempotencyKey = string;

export interface LocalExtractionInput {
  allow_local_processing: AllowLocalProcessing;
  idempotency_key: IdempotencyKey;
}
