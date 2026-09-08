/* Generated from the checked-in wire schema. Do not edit. */

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
