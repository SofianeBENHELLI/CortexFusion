import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type {
  ProposalDifference,
  Concept,
} from "../../../../packages/contracts/src/ProposalDifference";
import { ProposalWorkspace, SourceEvidence } from "./ProposalWorkspace";
const domain = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";
const second = "00000000-0000-0000-0000-000000000003";
const proposal: ProposalView = {
  digest: "synthetic",
  validation: {
    status: "passed",
    source_support: "verbatim_v1",
    graph: "acyclic",
    policy: "owner_low_risk_v1",
    risk: "low",
    source_ids: [domain],
  },
  id,
  status: "approved",
  reason: "Correction synthétique",
  base_version: 1,
  review_revision: 2,
  payload: [],
  replaces_id: null,
};
const concept: Concept = {
  concept_id: id,
  title: "Concept synthétique",
  body: "Preuve synthétique",
  sources: [{ source_id: domain, start: 0, end: 17 }],
  links: [],
};
const difference: ProposalDifference = {
  proposal_id: id,
  base_version: 1,
  published_version: 1,
  comparison: "accepted_before_state",
  stale_base: true,
  items: [{ concept_id: id, before: null, after: concept }],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const api = new CortexApi(() => null);
  let denied = false;
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, params, _body, options) => {
      if (denied) throw new ApiError(403, "forbidden");
      if (op === "proposals.list")
        return options?.query?.after
          ? {
              items: [{ ...proposal, id: second, reason: "Autre proposition" }],
              next_after: null,
            }
          : { items: [proposal], next_after: id };
      if (op === "proposals.read") {
        if ((params as { proposal_id: string }).proposal_id === second)
          throw new ApiError(404, "missing");
        return proposal;
      }
      if (op === "proposals.diff") return difference;
      throw Error(op);
    });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <ProposalWorkspace api={api} domain={domain} />
    </QueryClientProvider>,
  );
  return {
    call,
    deny: () => {
      denied = true;
    },
  };
}
it("shows approval separately from publication and exposes before/after with source offsets", async () => {
  const { call } = setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText("Preuve synthétique");
  expect(screen.getByText(/La base a évolué/)).toBeTruthy();
  expect(screen.getByText(/Source .*0–17/)).toBeTruthy();
  expect(screen.getByText(/précédant l’approbation/)).toBeTruthy();
  expect(
    call.mock.calls.every(([op]) =>
      ["proposals.list", "proposals.read", "proposals.diff"].includes(op),
    ),
  ).toBe(true);
});
it("paginates and removes prior detail when another proposal cannot be read", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText("Preuve synthétique");
  fireEvent.click(
    screen.getByRole("button", { name: "Charger d’autres propositions" }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Autre proposition",
    }),
  );
  await screen.findByText("Élément absent ou inaccessible.");
  expect(screen.queryByText("Preuve synthétique")).toBeNull();
});
it("hides cached private detail when access is denied on refresh", async () => {
  const { deny } = setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText("Preuve synthétique");
  deny();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les propositions" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Preuve synthétique")).toBeNull(),
  );
  expect(screen.getByRole("alert").textContent).toContain("Votre rôle");
});

it("slices source evidence by Unicode code points rather than UTF-16 units", async () => {
  const api = new CortexApi(() => null);
  vi.spyOn(api, "call").mockResolvedValue({
    id: domain,
    title: "Unicode source",
    location: "synthetic://unicode",
    content_hash: "test",
    content: "A🧠B",
    allowed_subjects: [],
    supersedes: null,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceEvidence
        api={api}
        domain={domain}
        source={{ source_id: domain, start: 1, end: 2 }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  expect(await screen.findByText("🧠")).toBeTruthy();
  expect(screen.queryByText("A🧠B")).toBeNull();
});
