/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Name = string;
export type Description = string;
export type AllowedSubjects = string[];
export type Items = CollectionView[];
export type NextAfter = string | null;

export interface CollectionPage {
  items: Items;
  next_after: NextAfter;
}
export interface CollectionView {
  id: Id;
  name: Name;
  description: Description;
  allowed_subjects: AllowedSubjects;
}
