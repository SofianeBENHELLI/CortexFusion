/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseEvents {
  case_id: string;
  audience: "declarant" | "team";
  /**
   * @maxItems 50
   */
  items: {
    id: string;
    action: string;
    revision: number;
    status: "new" | "qualified" | "closed_without_change" | "withdrawn";
    created_at: string;
  }[];
  next_after: string | null;
  total: number;
  as_of: string;
}
