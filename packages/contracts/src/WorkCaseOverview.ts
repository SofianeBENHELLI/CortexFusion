/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkCaseOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary]
    | [WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary, WorkCaseSummary];
  has_more: boolean;
  sort: "created_at_asc_id_asc";
}
export interface WorkCaseSummary {
  id: string;
  title: string;
  status: "new" | "qualified";
  created_at: string;
}
