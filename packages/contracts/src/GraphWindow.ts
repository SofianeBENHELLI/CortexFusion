/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphWindow {
  domain_id: string;
  at_version: number;
  /**
   * Identity-bound coherence digest of currently visible concept IDs at this version; never grants access.
   */
  visibility: string;
  focus: GraphNodeSummary | null;
  after: string | null;
  limit: number;
  domain_totals: GraphTotals;
  scope_totals: GraphTotals;
  /**
   * @maxItems 50
   */
  nodes: GraphNodeSummary[];
  /**
   * @maxItems 120
   */
  edges: GraphRelationSummary[];
  next_after: string | null;
  internal_relations: number;
  boundary_outgoing_relations: number;
  edges_truncated: boolean;
  before: string | null;
  locate: string | null;
  previous_before: string | null;
  direction: "both" | "outgoing";
  search: string | null;
  scope_ids: string[] | null;
}
export interface GraphNodeSummary {
  concept_id: string;
  title: string;
  maturity: "emerging" | "observed" | "established" | "reference";
  source_count: number;
  outgoing_relations: number;
  incoming_relations: number;
}
export interface GraphTotals {
  concepts: number;
  /**
   * Directed outgoing relations from concepts in this scope, to any currently authorized concept in the domain. Each (from,to,kind) counts once.
   */
  relations: number;
}
export interface GraphRelationSummary {
  from: string;
  to: string;
  kind: "structural" | "associative";
  weight: number;
  primary: boolean;
}
