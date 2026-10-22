/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseRecipients {
  /**
   * @maxItems 50
   */
  items: {
    subject: string;
    role: "owner" | "corpus_manager";
  }[];
  next_after: string | null;
  total: number;
  as_of: string;
  permissions_version: number;
}
