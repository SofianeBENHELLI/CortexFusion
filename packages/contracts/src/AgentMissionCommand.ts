/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionCommand {
  action: "claim" | "renew" | "stop" | "resume";
  expected_revision: number;
  idempotency_key: string;
  lease_id?: string;
  reason?: string;
}
