/* Generated from the checked-in wire schema. Do not edit. */

export type PublishedVersion = number;
export type ConceptCount = number;
export type StateHash = string;

export interface ReplayReceipt {
  published_version: PublishedVersion;
  concept_count: ConceptCount;
  state_hash: StateHash;
}
