/* Generated from the checked-in wire schema. Do not edit. */

export interface MapLink {
  from: string;
  to: string;
  kind: "reference" | "structural" | "associative";
  weight: number | null;
}
