import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import { ApiError } from "./client";

export const proposalLabels: Record<ProposalView["status"], string> = {
  ready: "À examiner",
  approved: "Approuvée",
  published: "Publiée",
  rejected: "Rejetée",
  deferred: "Différée",
  changes_requested: "Correction demandée",
  superseded: "Remplacée",
};
export type ProposalReceipt = Pick<ProposalView, "id" | "status">;

/** An idempotent retry returns the current state, which can already be reviewed. */
export function readProposalReceipt(
  value: ProposalView,
  expectedBase: number,
): ProposalReceipt {
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) ||
    !Object.hasOwn(proposalLabels, value.status) ||
    value.base_version !== expectedBase ||
    typeof value.digest !== "string" ||
    !value.digest ||
    !Number.isSafeInteger(value.review_revision) ||
    value.review_revision < 0
  )
    throw new ApiError(200, "invalid_response");
  return { id: value.id.toLowerCase(), status: value.status };
}
