/* Generated from the checked-in wire schema. Do not edit. */

export type AllowObserved = boolean;
export type AllowInferred = boolean;
export type ExpectedRevision = number;

export interface FeedbackPreferencesInput {
  allow_observed: AllowObserved;
  allow_inferred: AllowInferred;
  expected_revision: ExpectedRevision;
}
