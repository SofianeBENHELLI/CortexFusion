/* Generated from the checked-in wire schema. Do not edit. */

export type ProcessingDestination = "openrouter";
export type IdempotencyKey = string;

export interface SynthesisInput {
  processing_destination: ProcessingDestination;
  idempotency_key: IdempotencyKey;
}
