/* Generated from the checked-in wire schema. Do not edit. */

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
