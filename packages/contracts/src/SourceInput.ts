/* Generated from the checked-in wire schema. Do not edit. */

export type Title = string;
export type Location = string;
export type Content = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type AllowedSubjects = [string, ...string[]];
export type Supersedes = string | null;

export interface SourceInput {
  title: Title;
  location: Location;
  content: Content;
  allowed_subjects: AllowedSubjects;
  supersedes?: Supersedes;
}
