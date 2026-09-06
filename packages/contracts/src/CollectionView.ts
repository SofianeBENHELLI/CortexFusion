/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Name = string;
export type Description = string;
export type AllowedSubjects = string[];

export interface CollectionView {
  id: Id;
  name: Name;
  description: Description;
  allowed_subjects: AllowedSubjects;
}
