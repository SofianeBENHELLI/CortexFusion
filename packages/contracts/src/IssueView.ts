/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type EpisodeId = string;
export type Kind = "knowledge_gap" | "disputed_answer";
export type Reason = string;
export type Status = "open" | "in_progress" | "resolved" | "dismissed";
export type Revision = number;
export type CreatedAt = string;

export interface IssueView {
  id: Id;
  episode_id: EpisodeId;
  kind: Kind;
  reason: Reason;
  status: Status;
  revision: Revision;
  created_at: CreatedAt;
}
