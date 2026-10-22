/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseReceipt {
  case_id: string;
  event_id: string;
  revision: number;
  status: "new" | "qualified" | "closed_without_change" | "withdrawn";
}
