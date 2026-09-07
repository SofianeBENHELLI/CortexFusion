/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type EpisodeId = string;
export type ServedVersion = number;
export type SourceIds = string[];
export type Origin = "explicit" | "observed" | "inferred";
export type Kind =
  "thumbs_up" | "thumbs_down" | "comment" | "reformulation" | "correction" | "abandon" | "resolved" | "satisfaction";
export type Comment = string;
export type Companion = string;
export type Confidence = number | null;
export type Sentiment = ("positive" | "negative" | "neutral") | null;
export type IterationIndex = number | null;
export type IdempotencyKey = string;
export type CreatedAt = string;
export type Items = FeedbackSignalView[];
export type NextAfter = string | null;

export interface FeedbackSignalPage {
  items: Items;
  next_after: NextAfter;
}
export interface FeedbackSignalView {
  id: Id;
  episode_id: EpisodeId;
  served_version: ServedVersion;
  source_ids: SourceIds;
  signal: FeedbackSignalInput;
  created_at: CreatedAt;
}
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
