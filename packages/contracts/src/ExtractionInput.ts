/* Generated from the checked-in wire schema. Do not edit. */

export type ProcessingDestination = "ollama" | "openrouter";
export type IdempotencyKey = string;
export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;

export interface ExtractionInput {
  processing_destination: ProcessingDestination;
  idempotency_key: IdempotencyKey;
  span?: SourceRef | null;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
