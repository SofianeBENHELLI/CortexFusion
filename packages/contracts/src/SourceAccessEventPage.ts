/* Generated from the checked-in wire schema. Do not edit. */

export interface SourceAccessEventPage {
  source_id: string;
  /**
   * @minItems 1
   */
  current_allowed_subjects: [string, ...string[]];
  history_scope: "changes_since_audit_migration";
  items: SourceAccessEvent[];
  next_after: string | null;
}
export interface SourceAccessEvent {
  id: string;
  actor: string | null;
  actor_source: "runtime_context" | "unattributed";
  /**
   * @minItems 1
   */
  previous_allowed_subjects: [string, ...string[]];
  /**
   * @minItems 1
   */
  allowed_subjects: [string, ...string[]];
  created_at: string;
}
