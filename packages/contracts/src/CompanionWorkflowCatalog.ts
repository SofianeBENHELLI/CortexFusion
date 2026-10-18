/* Generated from the checked-in wire schema. Do not edit. */

export interface CompanionWorkflowCatalog {
  version: string;
  documentation_only: true;
  client_compatibility: "not_qualified";
  /**
   * @minItems 1
   * @maxItems 8
   */
  client_requirements:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  /**
   * @minItems 6
   * @maxItems 6
   */
  guides: [
    CompanionWorkflowGuide,
    CompanionWorkflowGuide,
    CompanionWorkflowGuide,
    CompanionWorkflowGuide,
    CompanionWorkflowGuide,
    CompanionWorkflowGuide
  ];
}
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
