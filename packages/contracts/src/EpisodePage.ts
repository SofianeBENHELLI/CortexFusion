/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Question = string;
export type EpisodeId = string;
export type Answer = string;
export type Status = "evidence_found" | "knowledge_gap" | "context_limited";
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
/**
 * Complete selected concepts only; long selections are in context_passages. Read the concept endpoint for the full published body.
 */
export type Concepts = Concept[];
export type ConceptId1 = string;
export type Title1 = string;
export type Maturity1 = "emerging" | "observed" | "established" | "reference";
/**
 * Inclusive Unicode offset in the published body
 */
export type BodyStart = number;
/**
 * Exclusive Unicode offset in the published body
 */
export type BodyEnd = number;
export type BodyTotalChars = number;
export type Text = string;
export type Sources1 = SourceRef[];
/**
 * Bounded, source-backed context selections; empty for legacy episodes. Unicode text lengths plus answer separators fit max_chars.
 */
export type ContextPassages = ContextPassage[];
export type SourceId1 = string;
export type Title2 = string;
export type Location = string;
export type ContentHash = string;
export type Start1 = number;
export type End1 = number;
export type Excerpt = string;
export type Citations = Citation[];
export type Processing = "local_no_model";
export type ServedVersion1 = number;
export type CreatedAt = string;
export type Items = EpisodeHistoryItem[];
export type NextAfter = string | null;

export interface EpisodePage {
  items: Items;
  next_after: NextAfter;
}
export interface EpisodeHistoryItem {
  id: Id;
  question: Question;
  result: QueryResult;
  served_version: ServedVersion1;
  created_at: CreatedAt;
}
export interface QueryResult {
  episode_id: EpisodeId;
  answer: Answer;
  status: Status;
  mode?: Mode;
  served_version: ServedVersion;
  concepts: Concepts;
  context_passages?: ContextPassages;
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
/**
 * Read-only excerpt of a published concept, never a replacement Concept.
 */
export interface ContextPassage {
  concept_id: ConceptId1;
  title: Title1;
  maturity: Maturity1;
  body_start: BodyStart;
  body_end: BodyEnd;
  body_total_chars: BodyTotalChars;
  text: Text;
  sources: Sources1;
}
export interface Citation {
  source_id: SourceId1;
  title: Title2;
  location: Location;
  content_hash: ContentHash;
  start: Start1;
  end: End1;
  excerpt: Excerpt;
}
