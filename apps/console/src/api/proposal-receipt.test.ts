import { expect, it } from "vitest";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import { proposalLabels, readProposalReceipt } from "./proposal-receipt";

const response = {
  id: "00000000-0000-0000-0000-00000000000A",
  base_version: 3,
  digest: "synthetic",
  review_revision: 2,
  status: "ready",
} as ProposalView;

it.each(Object.keys(proposalLabels) as ProposalView["status"][])(
  "recovers the current %s status without inventing a new proposal",
  (status) => {
    expect(readProposalReceipt({ ...response, status }, 3)).toEqual({
      id: response.id.toLowerCase(),
      status,
    });
  },
);

it.each([
  { id: "not-an-identity" },
  { id: "" },
  { status: "constructor" },
  { status: "unknown" },
  { base_version: 4 },
  { digest: "" },
  { review_revision: -1 },
  { review_revision: 1.5 },
])("rejects an unconfirmed receipt %o", (change) => {
  expect(() =>
    readProposalReceipt({ ...response, ...change } as ProposalView, 3),
  ).toThrow();
});
