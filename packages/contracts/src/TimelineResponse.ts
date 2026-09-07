/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type AnswerText = string;
export type AnswerKind = "answer" | "abstention" | "clarification";
export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
/**
 * @maxItems 50
 */
export type Citations = SourceRef[];
export type Companion = string;
export type Model = string | null;
export type IdempotencyKey = string;
export type ReferenceValidation = "episode_references_checked" | "no_references";
export type SemanticValidation = "not_performed";
export type CreatedAt = string;

export interface TimelineResponse {
  id: Id;
  response: CompanionResponseInput;
  reference_validation: ReferenceValidation;
  semantic_validation?: SemanticValidation;
  created_at: CreatedAt;
}
export interface CompanionResponseInput {
  answer_text: AnswerText;
  answer_kind: AnswerKind;
  citations?: Citations;
  companion: Companion;
  model?: Model;
  idempotency_key: IdempotencyKey;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
