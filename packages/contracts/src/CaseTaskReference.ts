/* Generated from the checked-in wire schema. Do not edit. */

export interface CaseTaskReference {
  task_id: string;
  title: string;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  revision: number;
  linked_at: string;
}
