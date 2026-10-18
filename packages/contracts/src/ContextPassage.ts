/* Generated from the checked-in wire schema. Do not edit. */

export type ConceptId = string;
export type Title = string;
export type Maturity = "emerging" | "observed" | "established" | "reference";
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
export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
export type Sources = SourceRef[];

/**
 * Read-only excerpt of a published concept, never a replacement Concept.
 */
export interface ContextPassage {
  concept_id: ConceptId;
  title: Title;
  maturity: Maturity;
  body_start: BodyStart;
  body_end: BodyEnd;
  body_total_chars: BodyTotalChars;
  text: Text;
  sources: Sources;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
