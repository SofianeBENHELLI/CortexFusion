/* Generated from the checked-in wire schema. Do not edit. */

export interface ReferenceDraftInput {
  content: ReferenceDraftContent;
  expected_revision: number;
  idempotency_key: string;
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
