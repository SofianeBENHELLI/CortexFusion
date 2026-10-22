/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskNotificationPage {
  /**
   * @maxItems 50
   */
  items: TaskNotification[];
  next_after: string | null;
  has_more: boolean;
  total: number;
  as_of: string;
  scope: "personal";
  permissions_version: number;
  work_version: number;
  completeness: "partial" | "complete";
  sort: "created_at_desc_id_desc";
  unread: number;
}
export interface TaskNotification {
  event_id: string;
  task_id: string;
  title: string;
  current_status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  action: string;
  actor: string;
  revision: number;
  created_at: string;
  read_at: string | null;
}
