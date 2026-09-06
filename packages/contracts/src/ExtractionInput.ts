/* Generated from the checked-in wire schema. Do not edit. */

export type ProcessingDestination = "ollama" | "openrouter";
export type IdempotencyKey = string;

export interface ExtractionInput {
  processing_destination: ProcessingDestination;
  idempotency_key: IdempotencyKey;
}
