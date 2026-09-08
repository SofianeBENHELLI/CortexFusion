/* Generated from the checked-in wire schema. Do not edit. */

export type Id = string;
export type Title = string;
export type Location = string;
export type ContentHash = string;
export type AllowedSubjects = string[];
export type Supersedes = string | null;

export interface SourceSummary {
  id: Id;
  title: Title;
  location: Location;
  content_hash: ContentHash;
  allowed_subjects: AllowedSubjects;
  supersedes: Supersedes;
}
