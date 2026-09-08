/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphPublicationRetryInput {
  expected_published_version: number;
  expected_attempt_id: string;
  expected_generation: number;
  idempotency_key: string;
  /**
   * Motif explicite, non vide après retrait des espaces périphériques.
   */
  reason: string;
}
