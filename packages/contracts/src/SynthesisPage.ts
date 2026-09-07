/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type EpisodeId = string;
export type Provider = "openrouter" | "none";
export type RequestedModel = string | null;
export type PromptVersion = string;
export type BudgetReserved = boolean;
export type IdempotencyKey = string;
export type CreatedAt = string;
export type Status = "unresolved" | "succeeded" | "failed";
export type ResponseId = string | null;
export type ErrorCode = string | null;
export type RequestId = string;
export type CostUsd = number;
export type InputTokens = number;
export type OutputTokens = number;
export type FinishedAt = string | null;
export type Items = SynthesisView[];
export type NextAfter = string | null;

export interface SynthesisPage {
  items: Items;
  next_after: NextAfter;
}
export interface SynthesisView {
  id: Id;
  episode_id: EpisodeId;
  provider: Provider;
  requested_model: RequestedModel;
  prompt_version: PromptVersion;
  budget_reserved: BudgetReserved;
  idempotency_key: IdempotencyKey;
  created_at: CreatedAt;
  status: Status;
  response_id: ResponseId;
  error_code: ErrorCode;
  usage: SynthesisUsage | null;
  finished_at: FinishedAt;
}
export interface SynthesisUsage {
  request_id: RequestId;
  cost_usd: CostUsd;
  input_tokens: InputTokens;
  output_tokens: OutputTokens;
}
