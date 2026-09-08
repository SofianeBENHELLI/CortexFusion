/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphImportAttemptPage {
  target_version: number;
  published_version: number;
  manifest_registered: boolean;
  digest: string;
  count: number;
  projection_matches_journal: boolean | null;
  active_attempt: GraphImportAttempt | null;
  items: GraphImportAttempt[];
  next_after: number | null;
}
export interface GraphImportAttempt {
  id: string;
  generation: number;
  predecessor_id: string | null;
  subject: string;
  reason: string;
  created_at: string;
  active: boolean;
  status: "preparing" | "uncertain" | "ready" | "stale" | "superseded";
  base_version: number;
  digest: string | null;
  count: number | null;
  intent_sealed: boolean;
}
