/* Generated from the checked-in wire schema. Do not edit. */

export type TargetId = string;
export type Kind = "structural" | "associative";
export type Primary = boolean;
export type Weight = number;

export interface DifferenceSummaryLink {
  target_id: TargetId;
  kind: Kind;
  primary?: Primary;
  weight?: Weight;
}
