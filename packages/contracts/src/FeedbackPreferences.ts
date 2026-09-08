/* Generated from the checked-in wire schema. Do not edit. */

export type AllowObserved = boolean;
export type AllowInferred = boolean;
export type Revision = number;

export interface FeedbackPreferences {
  allow_observed?: AllowObserved;
  allow_inferred?: AllowInferred;
  revision: Revision;
}
