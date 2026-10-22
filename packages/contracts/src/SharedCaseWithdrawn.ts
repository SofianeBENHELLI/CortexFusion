/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseWithdrawn {
  audience: "withdrawn";
  id: string;
  status: "new" | "qualified" | "closed_without_change" | "withdrawn";
  revision: number;
  created_at: string;
  updated_at: string;
  /**
   * @maxItems 4
   */
  allowed_actions:
    | []
    | ["withdraw" | "qualify" | "close_without_change" | "reopen"]
    | [
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen"
      ]
    | [
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen"
      ]
    | [
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen",
        "withdraw" | "qualify" | "close_without_change" | "reopen"
      ];
}
