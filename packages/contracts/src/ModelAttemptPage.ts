/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type SourceId = string;
export type Provider = "openrouter" | "ollama";
export type RequestedModel = string;
export type SourceId1 = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
export type InputSha256 = string;
export type IdempotencyKey = string;
export type CreatedAt = string;
export type Status = "unresolved" | "succeeded" | "failed";
export type FinishedAt = string | null;
export type ErrorCode = string | null;
export type ExtractionId = string | null;
export type Items = ModelAttemptView[];
export type NextAfter = string | null;

export interface ModelAttemptPage {
  items: Items;
  next_after: NextAfter;
}
export interface ModelAttemptView {
  id: Id;
  source_id: SourceId;
  provider: Provider;
  requested_model: RequestedModel;
  input_span: SourceRef;
  input_sha256: InputSha256;
  idempotency_key: IdempotencyKey;
  created_at: CreatedAt;
  status: Status;
  finished_at: FinishedAt;
  error_code: ErrorCode;
  extraction_id: ExtractionId;
}
export interface SourceRef {
  source_id: SourceId1;
  start: Start;
  end: End;
}
