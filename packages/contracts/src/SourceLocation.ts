/* Generated from the checked-in wire schema. Do not edit. */

export interface SourceLocation {
  source_id: string;
  title: string;
  location: string;
  content_hash: string;
  start: number;
  end: number;
  total_characters: number;
  offset_unit: "unicode_code_point";
}
