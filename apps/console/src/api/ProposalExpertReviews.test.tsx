import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ProposalExpertReviewPage } from "../../../../packages/contracts/src/ProposalExpertReviewPage";
import { CortexApi, ApiError } from "./client";
import {
  ProposalExpertReviews,
  checkExpertPage,
} from "./ProposalExpertReviews";
const pid = "00000000-0000-0000-0000-000000000001",
  tid = "00000000-0000-0000-0000-000000000002",
  rid = "00000000-0000-0000-0000-000000000003",
  cursor = "00000000-0000-0000-0000-000000000004";
const proposal = {
  id: pid,
  digest: "current",
  review_revision: 2,
} as ProposalView;
function page(): ProposalExpertReviewPage {
  return {
    proposal_id: pid,
    proposal_digest: "current",
    proposal_review_revision: 2,
    total: 1,
    next_after: null,
    has_more: false,
    as_of: "2026-10-16T21:00:00Z",
    permissions_version: 1,
    work_version: 5,
    items: [
      {
        id: rid,
        task_id: tid,
        proposal_id: pid,
        author: "expert",
        proposal_digest: "old",
        proposal_review_revision: 1,
        task_revision: 3,
        opinion: "changes_requested",
        justification: "Préciser la preuve synthétique.",
        evidence_source_ids: [],
        created_at: "2026-10-16T20:00:00Z",
        validity: "stale",
      },
    ],
  };
}
function setup(first = page()) {
  const api = new CortexApi(() => null),
    error = vi.fn(),
    openTask = vi.fn(),
    client = new QueryClient();
  const call = vi.spyOn(api, "call").mockResolvedValue(first);
  render(
    <QueryClientProvider client={client}>
      <ProposalExpertReviews
        api={api}
        domain="domain"
        proposal={proposal}
        onReadError={error}
        onOpenTask={openTask}
      />
    </QueryClientProvider>,
  );
  return { call, error, openTask, client };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows scoped count and stale opinion, opens its authorized task without any decision", async () => {
  const { call, openTask } = setup();
  await screen.findByText("Préciser la preuve synthétique.");
  expect(screen.getByText(/À revalider/)).toBeTruthy();
  expect(screen.getByText(/1 avis chargés sur 1 autorisés/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Ouvrir la tâche 00000000" }),
  );
  expect(openTask).toHaveBeenCalledWith(tid);
  expect(call.mock.calls.map((c) => c[0])).toEqual([
    "proposals.expert_reviews",
  ]);
});
it("does not turn an empty authorized scope into a completed review", async () => {
  setup({ ...page(), items: [], total: 0 });
  await screen.findByText(/Cela ne prouve pas qu’une revue/);
});
it("masks previous opinions when next page fails and informs the parent", async () => {
  const { call, error } = setup({
    ...page(),
    total: 2,
    has_more: true,
    next_after: cursor,
  });
  await screen.findByText("Préciser la preuve synthétique.");
  call.mockRejectedValue(new ApiError(403, "denied"));
  fireEvent.click(
    screen.getByRole("button", { name: "Avis experts suivants" }),
  );
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.queryByText("Préciser la preuve synthétique.")).toBeNull();
});
it("rejects mixed snapshots and duplicate rows instead of concatenating misleading history", async () => {
  const { call, error } = setup({
    ...page(),
    total: 2,
    has_more: true,
    next_after: cursor,
  });
  await screen.findByText("Préciser la preuve synthétique.");
  call.mockResolvedValue({ ...page(), total: 2, work_version: 6 });
  fireEvent.click(
    screen.getByRole("button", { name: "Avis experts suivants" }),
  );
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.queryByText("Préciser la preuve synthétique.")).toBeNull();
});
it("requires matching proposal revision, truthful validity and valid references", () => {
  expect(() =>
    checkExpertPage({ ...page(), proposal_digest: "changed" }, proposal),
  ).toThrow();
  expect(() =>
    checkExpertPage({ ...page(), proposal_review_revision: 3 }, proposal),
  ).toThrow();
  const bad = page();
  bad.items[0].validity = "current";
  expect(() => checkExpertPage(bad, proposal)).toThrow();
  const broken = page();
  broken.items[0].task_id = "wrong";
  expect(() => checkExpertPage(broken, proposal)).toThrow();
  expect(() =>
    checkExpertPage({ ...page(), has_more: true }, proposal),
  ).toThrow();
});
