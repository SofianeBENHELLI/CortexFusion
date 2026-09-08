/* Generated from the checked-in wire schema. Do not edit. */

/**
 * @minItems 1
 * @maxItems 20
 */
export type Items =
  | [TextImportItem]
  | [TextImportItem, TextImportItem]
  | [TextImportItem, TextImportItem, TextImportItem]
  | [TextImportItem, TextImportItem, TextImportItem, TextImportItem]
  | [TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem]
  | [TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem]
  | [TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem, TextImportItem]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ]
  | [
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem,
      TextImportItem
    ];
export type Filename = string;
export type Content = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type AllowedSubjects = [string, ...string[]];
export type IdempotencyKey = string;

export interface TextImportInput {
  items: Items;
  idempotency_key: IdempotencyKey;
}
export interface TextImportItem {
  filename: Filename;
  content: Content;
  allowed_subjects: AllowedSubjects;
}
