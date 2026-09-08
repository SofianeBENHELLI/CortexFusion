/* Generated from the checked-in wire schema. Do not edit. */

export type Question = string;
export type MaxChars = number;
export type Limit = number;

export interface QueryInput {
  question: Question;
  max_chars?: MaxChars;
  limit?: Limit;
}
