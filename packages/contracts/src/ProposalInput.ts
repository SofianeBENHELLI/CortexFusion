/* Generated from the checked-in wire schema. Do not edit. */

export type BaseVersion = number;
/**
 * @minItems 1
 * @maxItems 50
 */
export type Changes = [PutConcept | RetireConcept, ...(PutConcept | RetireConcept)[]];
export type Kind = "put_concept";
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
export type Kind1 = "structural" | "associative";
export type Primary = boolean;
export type Weight = number;
/**
 * @maxItems 100
 */
export type Links = Link[];
export type Kind2 = "retire_concept";
export type ConceptId1 = string;
export type Reason = string;
export type IdempotencyKey = string;

export interface ProposalInput {
  base_version: BaseVersion;
  changes: Changes;
  reason: Reason;
  idempotency_key: IdempotencyKey;
}
export interface PutConcept {
  kind?: Kind;
  concept: Concept;
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
  kind: Kind1;
  primary?: Primary;
  weight?: Weight;
}
export interface RetireConcept {
  kind?: Kind2;
  concept_id: ConceptId1;
}
