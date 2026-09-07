/* Generated from the checked-in wire schema. Do not edit. */

export type PublishedVersion = number;
export type Changed = boolean;

export interface PublicationReceipt {
  published_version: PublishedVersion;
  changed: Changed;
}
