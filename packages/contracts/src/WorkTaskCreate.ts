/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkTaskCreate {
  title: string;
  instructions: string;
  criteria: string;
  due_at?: string | null;
  idempotency_key: string;
}
