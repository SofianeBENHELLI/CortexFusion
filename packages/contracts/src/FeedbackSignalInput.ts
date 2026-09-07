/* Generated from the checked-in wire schema. Do not edit. */

export type Origin = "explicit" | "observed" | "inferred";
export type Kind =
  "thumbs_up" | "thumbs_down" | "comment" | "reformulation" | "correction" | "abandon" | "resolved" | "satisfaction";
export type Comment = string;
export type Companion = string;
export type Confidence = number | null;
export type Sentiment = ("positive" | "negative" | "neutral") | null;
export type IterationIndex = number | null;
export type IdempotencyKey = string;

export interface FeedbackSignalInput {
  origin: Origin;
  kind: Kind;
  comment?: Comment;
  companion: Companion;
  confidence?: Confidence;
  sentiment?: Sentiment;
  iteration_index?: IterationIndex;
  idempotency_key: IdempotencyKey;
}
