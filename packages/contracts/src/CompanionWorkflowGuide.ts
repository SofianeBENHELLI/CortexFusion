/* Generated from the checked-in wire schema. Do not edit. */

export interface CompanionWorkflowGuide {
  id: "consult" | "feedback" | "follow-up" | "task" | "correction" | "domain";
  title: string;
  intent: string;
  required_capability: string;
  /**
   * @minItems 1
   * @maxItems 8
   */
  steps:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  /**
   * @minItems 1
   * @maxItems 12
   */
  tools:
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
    | [string, string, string, string, string, string, string, string, string, string, string, string];
  decision: string;
  effect: string;
  recovery: string;
  limits: string;
  example: string;
}
