/* Generated from the checked-in wire schema. Do not edit. */

export type Sequence = number;
export type Question = string;
export type EpisodeId = string;
export type Answer = string;
export type Status = "evidence_found" | "knowledge_gap";
export type Mode = "extractive";
export type ServedVersion = number;
export type ConceptId = string;
export type Title = string;
export type Body = string;
export type Maturity = "emerging" | "observed" | "established" | "reference";
/**
 * @minItems 1
 * @maxItems 30
 */
export type Sources = [SourceRef, ...SourceRef[]];
export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
export type TargetId = string;
export type Kind = "structural" | "associative";
export type Primary = boolean;
export type Weight = number;
/**
 * @maxItems 100
 */
export type Links = Link[];
export type Concepts = Concept[];
export type SourceId1 = string;
export type Title1 = string;
export type Location = string;
export type ContentHash = string;
export type Start1 = number;
export type End1 = number;
export type Excerpt = string;
export type Citations = Citation[];
export type Processing = "local_no_model";
export type CreatedAt = string;
export type Id = string;
export type AnswerText = string;
export type AnswerKind = "answer" | "abstention" | "clarification";
/**
 * @maxItems 50
 */
export type Citations1 = SourceRef[];
export type Companion = string;
export type Model = string | null;
export type IdempotencyKey = string;
export type ReferenceValidation = "episode_references_checked" | "no_references";
export type SemanticValidation = "not_performed";
export type CreatedAt1 = string;
export type Items = TimelineResponse[];
export type NextAfter = string | null;
export type Id1 = string;
export type EpisodeId1 = string;
export type ServedVersion1 = number;
export type SourceIds = string[];
export type CompanionResponseId = string | null;
export type Origin = "explicit" | "observed" | "inferred";
export type Kind1 =
  "thumbs_up" | "thumbs_down" | "comment" | "reformulation" | "correction" | "abandon" | "resolved" | "satisfaction";
export type Comment = string;
export type Companion1 = string;
export type Confidence = number | null;
export type Sentiment = ("positive" | "negative" | "neutral") | null;
export type IterationIndex = number | null;
export type IdempotencyKey1 = string;
export type CreatedAt2 = string;
export type Items1 = FeedbackSignalView[];
export type NextAfter1 = string | null;
export type Id2 = string;
export type EpisodeId2 = string;
export type Kind2 = "knowledge_gap" | "disputed_answer";
export type Reason = string;
export type Status1 = "open" | "in_progress" | "resolved" | "dismissed";
export type Revision = number;
export type CreatedAt3 = string;
export type Items2 = IssueView[];
export type NextAfter2 = string | null;

export interface ConversationTurn {
  sequence: Sequence;
  question: Question;
  result: QueryResult;
  created_at: CreatedAt;
  responses: TimelineResponsePage;
  signals: FeedbackSignalPage;
  issues: IssuePage;
}
export interface QueryResult {
  episode_id: EpisodeId;
  answer: Answer;
  status: Status;
  mode?: Mode;
  served_version: ServedVersion;
  concepts: Concepts;
  citations: Citations;
  processing?: Processing;
}
export interface Concept {
  concept_id: ConceptId;
  title: Title;
  body: Body;
  maturity?: Maturity;
  sources: Sources;
  links?: Links;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
export interface Link {
  target_id: TargetId;
  kind: Kind;
  primary?: Primary;
  weight?: Weight;
}
export interface Citation {
  source_id: SourceId1;
  title: Title1;
  location: Location;
  content_hash: ContentHash;
  start: Start1;
  end: End1;
  excerpt: Excerpt;
}
export interface TimelineResponsePage {
  items: Items;
  next_after: NextAfter;
}
export interface TimelineResponse {
  id: Id;
  response: CompanionResponseInput;
  reference_validation: ReferenceValidation;
  semantic_validation?: SemanticValidation;
  created_at: CreatedAt1;
}
export interface CompanionResponseInput {
  answer_text: AnswerText;
  answer_kind: AnswerKind;
  citations?: Citations1;
  companion: Companion;
  model?: Model;
  idempotency_key: IdempotencyKey;
}
export interface FeedbackSignalPage {
  items: Items1;
  next_after: NextAfter1;
}
export interface FeedbackSignalView {
  id: Id1;
  episode_id: EpisodeId1;
  served_version: ServedVersion1;
  source_ids: SourceIds;
  signal: FeedbackSignalInput;
  created_at: CreatedAt2;
}
export interface FeedbackSignalInput {
  companion_response_id?: CompanionResponseId;
  origin: Origin;
  kind: Kind1;
  comment?: Comment;
  companion: Companion1;
  confidence?: Confidence;
  sentiment?: Sentiment;
  iteration_index?: IterationIndex;
  idempotency_key: IdempotencyKey1;
}
export interface IssuePage {
  items: Items2;
  next_after: NextAfter2;
}
export interface IssueView {
  id: Id2;
  episode_id: EpisodeId2;
  kind: Kind2;
  reason: Reason;
  status: Status1;
  revision: Revision;
  created_at: CreatedAt3;
}
