/* Generated from the checked-in wire schema. Do not edit. */

export type SourceId = string;
/**
 * Zero-based Unicode code point offset, inclusive
 */
export type Start = number;
/**
 * Unicode code point offset, exclusive; not UTF-16 units
 */
export type End = number;
export type InputSha256 = string | null;
export type Provider = "ollama" | "openrouter";
export type RequestId = string | null;
export type CostUsd = number | null;
export type Id = string;
export type Id1 = string;
export type BaseVersion = number;
export type Digest = string;
export type Reason = string;
export type Status = "ready" | "approved" | "published" | "rejected" | "deferred" | "changes_requested" | "superseded";
export type Status1 = "passed";
export type SourceSupport = "verbatim_v1";
export type Graph = "acyclic";
export type Policy = "owner_low_risk_v1";
export type Risk = "low";
export type SourceIds = string[];
export type Kind = "put_concept";
export type ConceptId = string;
export type Title = string;
export type Body = string;
export type Maturity = "emerging" | "observed" | "established" | "reference";
/**
 * @minItems 1
 * @maxItems 30
 */
export type Sources = [SourceRef, ...SourceRef[]];
export type TargetId = string;
export type Kind1 = "structural" | "associative";
export type Primary = boolean;
export type Weight = number;
/**
 * @maxItems 100
 */
export type Links = Link[];
export type Kind2 = "retire_concept";
export type ConceptId1 = string;
export type Payload = (PutConcept | RetireConcept)[];
export type ReviewRevision = number;
export type ReplacesId = string | null;
export type Model = string;
export type ModelDigest = string | null;
export type PromptVersion = string;
export type InputTokens = number | null;
export type OutputTokens = number | null;
export type Processing = "local_model_passage_selection" | "openrouter_passage_selection";

export interface LocalExtractionView {
  input_span?: SourceRef | null;
  input_sha256?: InputSha256;
  provider?: Provider;
  request_id?: RequestId;
  cost_usd?: CostUsd;
  id: Id;
  proposal: ProposalView;
  model: Model;
  model_digest: ModelDigest;
  prompt_version: PromptVersion;
  input_tokens: InputTokens;
  output_tokens: OutputTokens;
  processing?: Processing;
}
export interface SourceRef {
  source_id: SourceId;
  start: Start;
  end: End;
}
export interface ProposalView {
  id: Id1;
  base_version: BaseVersion;
  digest: Digest;
  reason: Reason;
  status: Status;
  validation: ProposalValidation;
  payload: Payload;
  review_revision: ReviewRevision;
  replaces_id: ReplacesId;
}
export interface ProposalValidation {
  status: Status1;
  source_support: SourceSupport;
  graph: Graph;
  policy: Policy;
  risk: Risk;
  source_ids: SourceIds;
}
export interface PutConcept {
  kind?: Kind;
  concept: Concept;
}
export interface Concept {
  concept_id: ConceptId;
  title: Title;
  body: Body;
  maturity?: Maturity;
  sources: Sources;
  links?: Links;
}
export interface Link {
  target_id: TargetId;
  kind: Kind1;
  primary?: Primary;
  weight?: Weight;
}
export interface RetireConcept {
  kind?: Kind2;
  concept_id: ConceptId1;
}
