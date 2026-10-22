/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskProposalReferences {
  task_id: string;
  task_revision: number;
  /**
   * @maxItems 20
   */
  items:
    | []
    | [TaskProposalReference]
    | [TaskProposalReference, TaskProposalReference]
    | [TaskProposalReference, TaskProposalReference, TaskProposalReference]
    | [TaskProposalReference, TaskProposalReference, TaskProposalReference, TaskProposalReference]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ]
    | [
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference,
        TaskProposalReference
      ];
  total: number;
  max_links: 20;
  as_of: string;
  can_link: boolean;
}
export interface TaskProposalReference {
  proposal_id: string;
  digest: string;
  review_revision: number;
  status: string;
  linked_by: string;
  linked_at: string;
  can_review: boolean;
}
