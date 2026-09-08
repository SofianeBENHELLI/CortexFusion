/* Generated from the checked-in wire schema. Do not edit. */

export type SourceId = string;
export type AllowedSubjects = string[];

export interface AccessReceipt {
  source_id: SourceId;
  allowed_subjects: AllowedSubjects;
}
