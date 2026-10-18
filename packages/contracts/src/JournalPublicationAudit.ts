/* Generated from the checked-in wire schema. Do not edit. */

export type Publisher = string;
export type RecordedAt = string;

export interface PublicationAudit {
  publisher: Publisher;
  recorded_at: RecordedAt;
}
