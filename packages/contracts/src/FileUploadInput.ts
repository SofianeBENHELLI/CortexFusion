/* Generated from the checked-in wire schema. Do not edit. */

export type Filename = string;
export type ContentBase64 = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type AllowedSubjects = [string, ...string[]];
export type IdempotencyKey = string;

export interface FileUploadInput {
  filename: Filename;
  content_base64: ContentBase64;
  allowed_subjects: AllowedSubjects;
  idempotency_key: IdempotencyKey;
}
