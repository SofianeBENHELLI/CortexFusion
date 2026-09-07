/* Generated from the checked-in wire schema. Do not edit. */

export type RequestId = string;
export type CostUsd = number;
export type InputTokens = number;
export type OutputTokens = number;

export interface SynthesisUsage {
  request_id: RequestId;
  cost_usd: CostUsd;
  input_tokens: InputTokens;
  output_tokens: OutputTokens;
}
