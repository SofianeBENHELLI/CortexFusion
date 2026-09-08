/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphPublicationEvent {
  id: string;
  attempt_id: string;
  generation: number;
  subject: string;
  kind: "reserved" | "uncertain" | "ready" | "stale" | "superseded";
  recorded_at: string;
}
