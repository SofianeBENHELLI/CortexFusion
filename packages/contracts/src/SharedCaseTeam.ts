/* Generated from the checked-in wire schema. Do not edit. */

export interface SharedCaseTeam {
  audience: "team";
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
  title: string;
  excerpt: string;
  target: "retrieved_evidence" | "delivered_answer" | "client_behavior";
  origin: "explicit" | "observed" | "inferred";
  qualification: string;
  public_conclusion: string;
  policy_version: "named-excerpt-v1";
  declarant: string;
}
