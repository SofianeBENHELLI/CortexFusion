/* Generated from the checked-in wire schema. Do not edit. */

export type ProposalId = string;
export type BaseVersion = number;
export type PublishedVersion = number;
export type Comparison = "accepted_before_state" | "current_published_state";
export type StaleBase = boolean;
export type ConceptId = string;
export type ConceptId1 = string;
export type Title = string;
export type DifferenceSummaryMaturity = "emerging" | "observed" | "established" | "reference";
/**
 * @minItems 1
 * @maxItems 30
 */
export type Sources = [DifferenceSummarySourceRef, ...DifferenceSummarySourceRef[]];
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
export type Links = DifferenceSummaryLink[];
/**
 * @maxItems 50
 */
export type Items = DifferenceSummaryConceptDifference[];

export interface ProposalDifferenceSummary {
  proposal_id: ProposalId;
  base_version: BaseVersion;
  published_version: PublishedVersion;
  comparison: Comparison;
  stale_base: StaleBase;
  items: Items;
}
export interface DifferenceSummaryConceptDifference {
  concept_id: ConceptId;
  before: DifferenceSummaryConcept | null;
  after: DifferenceSummaryConcept | null;
}
export interface DifferenceSummaryConcept {
  concept_id: ConceptId1;
  title: Title;
  maturity?: DifferenceSummaryMaturity;
  sources: Sources;
  links?: Links;
  /**
   * SHA-256 of the exact UTF-8 concept body; the body is not returned.
   */
  body_sha256: string;
}
export interface DifferenceSummarySourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
export interface DifferenceSummaryLink {
  target_id: TargetId;
  kind: Kind;
  primary?: Primary;
  weight?: Weight;
}
