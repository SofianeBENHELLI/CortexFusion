/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphPublicationRetryReceipt {
  proposal_id: string;
  target_version: number;
  published_version: number;
  attempt: GraphPublicationAttempt;
  outcome: "published" | "unresolved" | "superseded";
}
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
