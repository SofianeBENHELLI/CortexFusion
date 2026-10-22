/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseCommand {
  action: "withdraw" | "qualify" | "close_without_change" | "reopen";
  expected_revision: number;
  qualification?: "incorrect" | "missing" | "outdated" | "unclear" | "behavior" | "other";
  public_conclusion?: string;
  idempotency_key: string;
}
