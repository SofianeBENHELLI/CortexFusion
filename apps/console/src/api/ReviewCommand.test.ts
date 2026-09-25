import { expect, it } from "vitest";
import { reviewCommand } from "./ReviewCommand";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
const proposal: ProposalView = {
  id: "proposal",
  base_version: 2,
  digest: "exact-digest",
  reason: "test",
  status: "deferred",
  review_revision: 3,
  replaces_id: null,
  payload: [],
  validation: {
    status: "passed",
    source_support: "verbatim_v1",
    graph: "acyclic",
    policy: "owner_low_risk_v1",
    risk: "low",
    source_ids: [],
  },
};
it("binds a prepared command to the displayed proposal digest and review revision", () => {
  expect(
    reviewCommand("domain", proposal, "reopen", " Relire ", "intent-key"),
  ).toEqual({
    name: "api_proposals_review",
    arguments: {
      path: { domain: "domain", ident: "proposal" },
      body: {
        action: "reopen",
        digest: "exact-digest",
        expected_review_revision: 3,
        reason: "Relire",
        idempotency_key: "intent-key",
      },
    },
  });
});
it("refuses transitions unavailable for the displayed state", () => {
  expect(() =>
    reviewCommand("domain", proposal, "defer", "motif", "key"),
  ).toThrow();
  expect(() =>
    reviewCommand(
      "domain",
      { ...proposal, status: "published" },
      "reject",
      "motif",
      "key",
    ),
  ).toThrow();
});
