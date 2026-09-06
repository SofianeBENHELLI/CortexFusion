/* Generated from the checked-in wire schema. Do not edit. */

/**
 * @minItems 1
 * @maxItems 100
 */
export type AllowedSubjects = [string, ...string[]];

export interface AccessInput {
  allowed_subjects: AllowedSubjects;
}
