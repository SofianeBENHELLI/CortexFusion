/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphTotals {
  concepts: number;
  /**
   * Directed outgoing relations from concepts in this scope, to any currently authorized concept in the domain. Each (from,to,kind) counts once.
   */
  relations: number;
}
