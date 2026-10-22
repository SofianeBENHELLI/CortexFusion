/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphMap {
  domain_id: string;
  at_version: number;
  /**
   * @maxItems 10000
   */
  nodes: {
    id: string;
    title: string;
    maturity: string;
    group: string;
    territory: string;
  }[];
  /**
   * Tuples [source node index, target node index, structural|associative|reference, published weight or null].
   *
   * @maxItems 400000
   */
  edges: [
    number | number | string | null,
    number | number | string | null,
    number | number | string | null,
    number | number | string | null
  ][];
  published_relations: number;
  documentary_references: number;
}
