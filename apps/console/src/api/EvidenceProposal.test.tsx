import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { EvidenceProposal } from "./EvidenceProposal";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("preserves source offsets, ticket reference and the same intention on retry", async () => {
  const api = new CortexApi(() => null);
  let attempts = 0;
  const proposal: ProposalView = {
    id: "proposal",
    base_version: 3,
    digest: "digest",
    reason: "reason",
    status: "ready",
    payload: [],
    review_revision: 0,
    replaces_id: null,
    validation: {
      status: "passed",
      source_support: "verbatim_v1",
      graph: "acyclic",
      policy: "owner_low_risk_v1",
      risk: "low",
      source_ids: [],
    },
  };
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "domain.version")
      return { domain_id: "domain", accepted_version: 3, published_version: 3 };
    if (op === "proposals.create") {
      if (attempts++ === 0) throw new ApiError(0, "network_error");
      return proposal;
    }
    throw Error(op);
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvidenceProposal
        api={api}
        domain="domain"
        issueId="ticket"
        citations={[
          {
            source_id: "source",
            title: "Preuve",
            location: "synthetic://test",
            content_hash: "test",
            start: 12,
            end: 17,
            excerpt: "Texte",
          },
        ]}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Titre du concept proposé"), {
    target: { value: "Précision" },
  });
  fireEvent.change(screen.getByLabelText("Motif de la proposition"), {
    target: { value: "Clarifier le périmètre" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Créer la proposition à examiner",
      hidden: true,
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Réessayer la même proposition",
      hidden: true,
    }),
  );
  await screen.findByText(/Proposition prête à examiner/);
  const bodies = call.mock.calls
    .filter((c) => c[0] === "proposals.create")
    .map((c) => c[2]);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({
    base_version: 3,
    reason: "Ticket ticket : Clarifier le périmètre",
    changes: [
      {
        concept: {
          body: "Texte",
          sources: [{ source_id: "source", start: 12, end: 17 }],
        },
      },
    ],
  });
  expect(call.mock.calls.filter((c) => c[0] === "domain.version")).toHaveLength(
    1,
  );
});
