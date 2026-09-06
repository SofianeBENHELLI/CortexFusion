/* Generated from the checked-in wire schema. Do not edit. */

export type Position = number;
export type Filename = string;
export type Status = "pending" | "succeeded" | "failed" | "cancelled";
export type SourceId = string | null;
export type ErrorCode = string | null;
export type Attempts = number;

export interface ImportItemView {
  position: Position;
  filename: Filename;
  status: Status;
  source_id: SourceId;
  error_code: ErrorCode;
  attempts: Attempts;
}
