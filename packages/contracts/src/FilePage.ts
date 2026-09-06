/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type CollectionId = string;
export type Filename = string;
export type ContentHash = string;
export type SizeBytes = number;
export type Status = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type SourceId = string | null;
export type ErrorCode = string | null;
export type Attempts = number;
export type Spans = {
  [k: string]: number;
}[];
export type Items = FileView[];
export type NextAfter = string | null;

export interface FilePage {
  items: Items;
  next_after: NextAfter;
}
export interface FileView {
  id: Id;
  collection_id: CollectionId;
  filename: Filename;
  content_hash: ContentHash;
  size_bytes: SizeBytes;
  status: Status;
  source_id: SourceId;
  error_code: ErrorCode;
  attempts: Attempts;
  spans: Spans;
}
