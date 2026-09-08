/* Generated from the checked-in wire schema. Do not edit. */

export type DomainId = string;
export type AcceptedVersion = number;
export type PublishedVersion = number;

export interface DomainVersion {
  domain_id: DomainId;
  accepted_version: AcceptedVersion;
  published_version: PublishedVersion;
}
