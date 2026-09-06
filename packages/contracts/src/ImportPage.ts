/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type CollectionId = string;
export type Status = "pending" | "partial" | "succeeded" | "failed" | "cancelled";
export type Processing = "local_text_only";
export type Position = number;
export type Filename = string;
export type Status1 = "pending" | "succeeded" | "failed" | "cancelled";
export type SourceId = string | null;
export type ErrorCode = string | null;
export type Attempts = number;
export type Items1 = ImportItemView[];
export type Items = ImportView[];
export type NextAfter = string | null;

export interface ImportPage {
  items: Items;
  next_after: NextAfter;
}
export interface ImportView {
  id: Id;
  collection_id: CollectionId;
  status: Status;
  processing?: Processing;
  items: Items1;
}
export interface ImportItemView {
  position: Position;
  filename: Filename;
  status: Status1;
  source_id: SourceId;
  error_code: ErrorCode;
  attempts: Attempts;
}
