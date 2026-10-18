import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { MemoryRouter } from "react-router-dom";
import { ProposalWorkspace } from "./ProposalWorkspace";
import { EvidenceProposal } from "./EvidenceProposal";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(["ready", "published"] as const)(
  "recovers a %s receipt after a lost response and opens its fresh review",
  async (status) => {
    const api = new CortexApi(() => null);
    let attempts = 0;
    const proposal: ProposalView = {
      id: "00000000-0000-0000-0000-000000000002",
      base_version: 3,
      digest: "digest",
      reason: "reason",
      status,
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
        return {
          domain_id: "domain",
          accepted_version: 3,
          published_version: 3,
        };
      if (op === "proposals.create") {
        if (attempts++ === 0) throw new ApiError(0, "network_error");
        return proposal;
      }
      if (op === "proposals.list") return { items: [], next_after: null };
      if (op === "proposals.read") return proposal;
      if (op === "proposals.diff")
        return {
          proposal_id: proposal.id,
          base_version: 3,
          published_version: 3,
          comparison: "current_published_state",
          stale_base: false,
          items: [],
        };
      throw Error(op);
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter
          initialEntries={[
            "/?api_domain=domain&api_view=work&api_conversation=00000000-0000-0000-0000-000000000003",
          ]}
        >
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
          <ProposalWorkspace api={api} domain="domain" />
        </MemoryRouter>
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
    await screen.findByText(/Proposition enregistrée/);
    const link = screen.getByRole("link", {
      name: "Ouvrir la revue de cette proposition",
    });
    expect(link.getAttribute("href")).toContain(`api_proposal=${proposal.id}`);
    expect(link.getAttribute("href")).toContain(
      "api_conversation=00000000-0000-0000-0000-000000000003",
    );
    expect(link.getAttribute("href")).not.toContain("Clarifier");
    expect(screen.getByText(/État au retour/).textContent).toContain(
      status === "ready" ? "À examiner" : "Publiée",
    );
    fireEvent.click(link);
    const heading = await screen.findByRole("heading", {
      name: "reason",
      level: 3,
    });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("alert")).toBeNull();
    const bodies = call.mock.calls
      .filter((c) => c[0] === "proposals.create")
      .map((c) => c[2]);
    expect(bodies).toHaveLength(2);
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
    expect(
      call.mock.calls.filter((c) => c[0] === "domain.version"),
    ).toHaveLength(1);
  },
);
