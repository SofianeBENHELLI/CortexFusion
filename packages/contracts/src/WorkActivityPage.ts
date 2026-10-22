/* Generated from the checked-in wire schema. Do not edit. */

export interface WorkActivityPage {
  /**
   * @maxItems 20
   */
  items:
    | []
    | [WorkActivityItem]
    | [WorkActivityItem, WorkActivityItem]
    | [WorkActivityItem, WorkActivityItem, WorkActivityItem]
    | [WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem]
    | [WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem]
    | [WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem, WorkActivityItem]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ]
    | [
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem,
        WorkActivityItem
      ];
  next_after: string | null;
  total: number;
  unread: number;
  as_of: string;
  permissions_version: number;
  work_version: number;
  source_access_version: number;
  scope: "personal";
  sort: "created_kind_event_desc";
  coverage: ("task_notifications" | "named_reference_reviews" | "mission_claims_and_reports" | "named_shared_cases")[];
}
export interface WorkActivityItem {
  kind: "task" | "reference_review" | "mission" | "shared_case";
  event_id: string;
  target_id: string;
  title: string | null;
  current_status: string;
  current_revision: number;
  action: string;
  actor: string | null;
  event_revision: number;
  created_at: string;
  read_at: string | null;
  content_available: boolean;
}
