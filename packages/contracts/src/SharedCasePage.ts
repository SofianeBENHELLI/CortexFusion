/* Generated from the checked-in wire schema. Do not edit. */

export type SharedCase = SharedCaseDeclarant | SharedCaseTeam | SharedCaseWithdrawn;

export interface SharedCasePage {
  /**
   * @maxItems 50
   */
  items: SharedCase[];
  next_after: string | null;
  total: number;
  has_more: boolean;
  as_of: string;
  scope: "mine" | "team";
  permissions_version: number;
  work_version: number;
  completeness: "partial" | "complete";
  sort: "created_at_asc_id_asc";
}
export interface SharedCaseDeclarant {
  audience: "declarant";
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
  /**
   * @maxItems 20
   */
  recipients:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  personal_signal_id: string | null;
}
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
