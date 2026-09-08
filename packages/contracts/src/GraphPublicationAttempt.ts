/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphPublicationAttempt {
  id: string;
  generation: number;
  predecessor_id: string | null;
  subject: string;
  reason: string;
  created_at: string;
  active: boolean;
  status: "preparing" | "uncertain" | "ready" | "stale" | "superseded";
  base_version: number;
  digest: string;
  count: number;
}
