/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCasePreparation {
  preparation_id: string;
  content_hash: string;
  expires_at: string;
  permissions_version: number;
  policy_version: "named-excerpt-v1";
  origin: "explicit" | "observed" | "inferred";
}
