/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphRelationSummary {
  from: string;
  to: string;
  kind: "structural" | "associative";
  weight: number;
  primary: boolean;
}
