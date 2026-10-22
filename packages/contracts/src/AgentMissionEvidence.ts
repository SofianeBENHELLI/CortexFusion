/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionEvidence {
  source_id: string;
  source_hash: string;
  title: string;
  location: string;
  start: number;
  end: number;
  total_characters: number;
  excerpt: string;
  mission_id: string;
  mission_revision: number;
  index: number;
  read_kind: "human_report_review";
}
