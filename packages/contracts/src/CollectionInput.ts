/* Generated from the checked-in wire schema. Do not edit. */

export type Name = string;
export type Description = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type AllowedSubjects = [string, ...string[]];
export type IdempotencyKey = string;

export interface CollectionInput {
  name: Name;
  description?: Description;
  allowed_subjects: AllowedSubjects;
  idempotency_key: IdempotencyKey;
}
