/* Generated from the checked-in wire schema. Do not edit. */

export type EpisodeId = string;
export type Answer = string;
export type Status = "evidence_found" | "knowledge_gap";
export type Mode = "extractive";
export type ServedVersion = number;
export type ConceptId = string;
export type Title = string;
export type Body = string;
export type Maturity = "emerging" | "observed" | "established" | "reference";
/**
 * @minItems 1
 * @maxItems 30
 */
export type Sources = [SourceRef, ...SourceRef[]];
export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
export type TargetId = string;
export type Kind = "structural" | "associative";
export type Primary = boolean;
export type Weight = number;
/**
 * @maxItems 100
 */
export type Links = Link[];
export type Concepts = Concept[];
export type SourceId1 = string;
export type Title1 = string;
export type Location = string;
export type ContentHash = string;
export type Start1 = number;
export type End1 = number;
export type Excerpt = string;
export type Citations = Citation[];
export type Processing = "local_no_model";

export interface QueryResult {
  episode_id: EpisodeId;
  answer: Answer;
  status: Status;
  mode?: Mode;
  served_version: ServedVersion;
  concepts: Concepts;
  citations: Citations;
  processing?: Processing;
}
export interface Concept {
  concept_id: ConceptId;
  title: Title;
  body: Body;
  maturity?: Maturity;
  sources: Sources;
  links?: Links;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
export interface Link {
  target_id: TargetId;
  kind: Kind;
  primary?: Primary;
  weight?: Weight;
}
export interface Citation {
  source_id: SourceId1;
  title: Title1;
  location: Location;
  content_hash: ContentHash;
  start: Start1;
  end: End1;
  excerpt: Excerpt;
}
