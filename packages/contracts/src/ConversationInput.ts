/* Generated from the checked-in wire schema. Do not edit. */

export type Title = string;
export type IdempotencyKey = string;

export interface ConversationInput {
  title?: Title;
  idempotency_key: IdempotencyKey;
}
