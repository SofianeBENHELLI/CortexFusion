/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceDraft {
  id: string;
  content: ReferenceDraftContent;
  revision: number;
  updated_at: string;
  status: "draft";
  visibility: "personal";
}
export interface ReferenceDraftContent {
  theme: string;
  question: string;
  criteria: string;
  source_id: string;
  source_hash: string;
  excerpt: string;
  selection: {
    start: number;
    end: number;
  };
}
