/* Generated from the checked-in wire schema. Do not edit. */

export type SourceId = string;
export type Algorithm = "unicode-2000-6000-v1";
export type Start = number;
export type End = number;
export type Content = string;
export type Sha256 = string;
export type Items = SourceChunk[];
export type NextOffset = number | null;

export interface SourceChunkPage {
  source_id: SourceId;
  algorithm: Algorithm;
  items: Items;
  next_offset: NextOffset;
}
export interface SourceChunk {
  start: Start;
  end: End;
  content: Content;
  sha256: Sha256;
}
