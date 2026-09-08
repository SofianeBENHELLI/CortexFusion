/* Generated from the checked-in wire schema. Do not edit. */

export type Question = string;
export type MaxChars = number;
export type Limit = number;
export type IdempotencyKey = string;

export interface ConversationQueryInput {
  question: Question;
  max_chars?: MaxChars;
  limit?: Limit;
  idempotency_key: IdempotencyKey;
}
