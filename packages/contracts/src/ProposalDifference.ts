/* Generated from the checked-in wire schema. Do not edit. */

export type ProposalId = string;
export type BaseVersion = number;
export type PublishedVersion = number;
export type Comparison = "accepted_before_state" | "current_published_state";
export type StaleBase = boolean;
export type ConceptId = string;
export type ConceptId1 = string;
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
export type Items = ConceptDifference[];

export interface ProposalDifference {
  proposal_id: ProposalId;
  base_version: BaseVersion;
  published_version: PublishedVersion;
  comparison: Comparison;
  stale_base: StaleBase;
  items: Items;
}
export interface ConceptDifference {
  concept_id: ConceptId;
  before: Concept | null;
  after: Concept | null;
}
export interface Concept {
  concept_id: ConceptId1;
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
