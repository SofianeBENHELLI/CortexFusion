/* Generated from the checked-in wire schema. Do not edit. */

export interface ContributionDraftInput {
  content: ContributionDraftContent | null;
  expected_revision: number;
  idempotency_key: string;
}
export interface ContributionDraftContent {
  source_id: string;
  source_hash: string;
  title: string;
  excerpt: string;
  reason: string;
  selection: {
    start: number;
    end: number;
  } | null;
}
