/* Generated from the checked-in wire schema. Do not edit. */

export interface ContributionDraft {
  revision: number;
  updated_at: string | null;
  state: "empty" | "available" | "source_unavailable" | "source_changed";
  content: ContributionDraftContent | null;
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
