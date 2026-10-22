/* Generated from the checked-in wire schema. Do not edit. */

export interface TaskCandidatePage {
  /**
   * @maxItems 50
   */
  items: TaskCandidate[];
  next_after: string | null;
}
export interface TaskCandidate {
  subject: string;
  role: "owner" | "corpus_manager" | "contributor";
}
