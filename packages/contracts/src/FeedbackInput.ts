/* Generated from the checked-in wire schema. Do not edit. */

export type Rating = "helpful" | "unhelpful";
export type Explanation = string;
export type IdempotencyKey = string;

export interface FeedbackInput {
  rating: Rating;
  explanation?: Explanation;
  idempotency_key: IdempotencyKey;
}
