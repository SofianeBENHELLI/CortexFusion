/* Generated from the checked-in wire schema. Do not edit. */

export type WindowStart = string;
export type WindowEnd = string;
export type ConversationId = string | null;
export type SignalCount = number;
export type EpisodeCount = number;
export type ConflictingExplicitEpisodes = number;
export type ThumbsUp = number;
export type ThumbsDown = number;
export type Comment = number;
export type Resolved = number;
export type Reformulation = number;
export type Correction = number;
export type Abandon = number;
export type Resolved1 = number;
export type IterationIndexSamples = number;
export type MaximumDeclaredIteration = number | null;
export type Positive = number;
export type Negative = number;
export type Neutral = number;
export type LegacyFeedbackIncluded = false;
export type Interpretation = string;

export interface FeedbackSummary {
  window_start: WindowStart;
  window_end: WindowEnd;
  conversation_id: ConversationId;
  signal_count: SignalCount;
  episode_count: EpisodeCount;
  conflicting_explicit_episodes: ConflictingExplicitEpisodes;
  explicit: ExplicitFeedbackCounts;
  observed: ObservedFeedbackCounts;
  inferred: InferredFeedbackCounts;
  legacy_feedback_included?: LegacyFeedbackIncluded;
  interpretation: Interpretation;
}
export interface ExplicitFeedbackCounts {
  thumbs_up: ThumbsUp;
  thumbs_down: ThumbsDown;
  comment: Comment;
  resolved: Resolved;
}
export interface ObservedFeedbackCounts {
  reformulation: Reformulation;
  correction: Correction;
  abandon: Abandon;
  resolved: Resolved1;
  iteration_index_samples: IterationIndexSamples;
  maximum_declared_iteration: MaximumDeclaredIteration;
}
export interface InferredFeedbackCounts {
  positive: Positive;
  negative: Negative;
  neutral: Neutral;
}
