/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type EpisodeId = string;
export type ServedVersion = number;
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
export type SourceId1 = string;
export type Title = string;
export type Location = string;
export type ContentHash = string;
export type Start1 = number;
export type End1 = number;
export type Excerpt = string;
export type Citations1 = Citation[];
export type ReferenceValidation = "episode_references_checked" | "no_references";
export type SemanticValidation = "not_performed";
export type CreatedAt = string;

export interface CompanionResponseView {
  id: Id;
  episode_id: EpisodeId;
  served_version: ServedVersion;
  response: CompanionResponseInput;
  citations: Citations1;
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
export interface Citation {
  source_id: SourceId1;
  title: Title;
  location: Location;
  content_hash: ContentHash;
  start: Start1;
  end: End1;
  excerpt: Excerpt;
}
