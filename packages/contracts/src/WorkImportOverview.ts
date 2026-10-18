/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkImportOverview {
  total: number;
  /**
   * @maxItems 5
   */
  items:
    | []
    | [WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary]
    | [WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary, WorkImportSummary];
  has_more: boolean;
  sort: "failed_first_created_at_asc_id_asc";
  pending_jobs: number;
  failed_jobs: number;
}
export interface WorkImportSummary {
  id: string;
  collection_id: string;
  collection_name: string;
  pending: number;
  failed: number;
  created_at: string;
}
