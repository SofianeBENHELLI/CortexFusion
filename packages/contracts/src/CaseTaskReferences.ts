/* Generated from the checked-in wire schema. Do not edit. */

export interface CaseTaskReferences {
  case_id: string;
  case_revision: number;
  audience: "declarant" | "team";
  /**
   * @maxItems 20
   */
  items:
    | []
    | [CaseTaskReference]
    | [CaseTaskReference, CaseTaskReference]
    | [CaseTaskReference, CaseTaskReference, CaseTaskReference]
    | [CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference]
    | [CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference]
    | [CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference, CaseTaskReference]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ]
    | [
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference,
        CaseTaskReference
      ];
  linked_count: number;
  max_links: 20;
  can_link: boolean;
  can_unlink: boolean;
  as_of: string;
}
export interface CaseTaskReference {
  task_id: string;
  title: string;
  status: "unassigned" | "offered" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";
  revision: number;
  linked_at: string;
}
