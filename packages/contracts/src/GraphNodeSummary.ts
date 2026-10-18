/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphNodeSummary {
  concept_id: string;
  title: string;
  maturity: "emerging" | "observed" | "established" | "reference";
  source_count: number;
  outgoing_relations: number;
  incoming_relations: number;
}
