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
import { MemoryRouter, useLocation } from "react-router-dom";
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
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function setup(query = "", emptyList = false) {
  const api = new CortexApi(() => null);
  let denied = false;
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, params, _body, options) => {
      if (denied) throw new ApiError(403, "forbidden");
      if (op === "proposals.list")
        return emptyList
          ? { items: [], next_after: null }
          : options?.query?.after
            ? {
                items: [
                  { ...proposal, id: second, reason: "Autre proposition" },
                ],
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
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const reconnect = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[`/?api_domain=${domain}${query}`]}>
        <Location />
        <ProposalWorkspace
          api={api}
          domain={domain}
          onReconnect={reconnect}
          capabilities={["review"]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    call,
    cache,
    reconnect,
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

it.each(["sources.passage", "proposals.reviews"])(
  "masks the review after a nested %s refusal",
  async (refused) => {
    const { call } = setup();
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (...args) => {
      if (args[0] === refused) throw new ApiError(404, "missing");
      return original(...args);
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Approuvée · Correction synthétique",
      }),
    );
    await screen.findByText("Preuve synthétique");
    fireEvent.click(
      screen.getByRole("button", {
        name:
          refused === "sources.passage"
            ? "Lire la preuve"
            : "Consulter les décisions",
      }),
    );
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(screen.queryByText("Preuve synthétique")).toBeNull(),
    );
    expect(
      screen.queryByRole("button", {
        name: "Approuvée · Correction synthétique",
      }),
    ).toBeNull();
  },
);

it("hides the old comparison while its explicit refresh is pending", async () => {
  const { call } = setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText("Preuve synthétique");
  call.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les propositions" }),
  );
  expect(screen.queryByText("Preuve synthétique")).toBeNull();
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
    source_id: domain,
    start: 1,
    end: 2,
    total_characters: 3,
    next_offset: 2,
    offset_unit: "unicode_code_point",
    title: "Unicode source",
    location: "synthetic://unicode",
    content_hash: "a".repeat(64),
    excerpt: "🧠",
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

it("opens a direct proposal outside the list and preserves opaque context on close", async () => {
  const { call } = setup(
    `&api_proposal=${id}&api_conversation=${second}`,
    true,
  );
  const title = await screen.findByRole("heading", { name: proposal.reason });
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect(screen.getByTestId("location").textContent).not.toMatch(
    /synthétique|Preuve/,
  );
  expect(
    call.mock.calls.filter(([op]) => op === "proposals.read"),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: "Fermer la proposition" }),
  );
  expect(screen.getByTestId("location").textContent).not.toContain(
    "api_proposal",
  );
  expect(screen.getByTestId("location").textContent).toContain(
    `api_conversation=${second}`,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Propositions de connaissance" }),
  );
});

it.each(["private", `${id}&api_proposal=${second}`, ""])(
  "rejects malformed or duplicate proposal URL %s without detail reads",
  async (value) => {
    const { call } = setup(`&api_proposal=${value}`);
    await screen.findByText(/Ce lien de proposition est invalide/);
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    });
    expect(call.mock.calls.map(([op]) => op)).toEqual(["proposals.list"]);
  },
);

it("refuses a revision changing around the comparison, then rechecks before showing commands", async () => {
  const { call } = setup();
  const original = call.getMockImplementation()!;
  let reads = 0;
  call.mockImplementation(async (...args) => {
    if (args[0] === "proposals.read")
      return {
        ...proposal,
        status: "ready",
        review_revision: ++reads === 1 ? 2 : 3,
      };
    return original(...args);
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText(
    "Les données ont changé. Actualisez avant de décider.",
  );
  expect(screen.queryByText("Preuve synthétique")).toBeNull();
  expect(
    screen.queryByText("Préparer une décision pour l’hôte de confiance"),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les propositions" }),
  );
  await screen.findByText("Preuve synthétique");
  expect(reads).toBe(4);
  expect(screen.getByText(/révision de revue 3/)).toBeTruthy();
  expect(
    screen.getByText("Préparer une décision pour l’hôte de confiance"),
  ).toBeTruthy();
  expect(call.mock.calls.every(([op]) => op !== "proposals.create")).toBe(true);
});

it("hides the review when history exposes a newer revision", async () => {
  const { call } = setup();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "proposals.reviews")
      return {
        items: [
          {
            id: second,
            proposal_id: id,
            author: "alice",
            action: "approve",
            reason: "New revision",
            created_at: "2026-10-06T00:00:00Z",
            resulting_status: "approved",
            review_revision: 3,
            proposal_digest: proposal.digest,
          },
        ],
        next_after: null,
      };
    return original(...args);
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText("Preuve synthétique");
  fireEvent.click(
    screen.getByRole("button", { name: "Consulter les décisions" }),
  );
  await screen.findByText(
    "Les données ont changé. Actualisez avant de décider.",
  );
  await waitFor(() =>
    expect(screen.queryByText("Preuve synthétique")).toBeNull(),
  );
  expect(screen.queryByText("New revision")).toBeNull();
});

it("keeps the proposal URL on an expired source read and requests reconnection", async () => {
  const { call, reconnect } = setup(`&api_proposal=${id}`);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "sources.passage") throw new ApiError(401, "expired");
    return original(...args);
  });
  await screen.findByText("Preuve synthétique");
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Se reconnecter à la revue" }),
  );
  expect(reconnect).toHaveBeenCalledOnce();
  expect(screen.getByTestId("location").textContent).toContain(
    `api_proposal=${id}`,
  );
  expect(screen.queryByText("Preuve synthétique")).toBeNull();
});

it("detects an approval changing status even when the review revision stays unchanged", async () => {
  const { call } = setup();
  const original = call.getMockImplementation()!;
  let reads = 0;
  call.mockImplementation(async (...args) => {
    if (args[0] === "proposals.read")
      return { ...proposal, status: ++reads === 1 ? "ready" : "approved" };
    return original(...args);
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approuvée · Correction synthétique",
    }),
  );
  await screen.findByText(
    "Les données ont changé. Actualisez avant de décider.",
  );
  expect(screen.queryByText("Preuve synthétique")).toBeNull();
  expect(
    screen.queryByText("Préparer une décision pour l’hôte de confiance"),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les propositions" }),
  );
  await screen.findByText("Preuve synthétique");
  expect(screen.getByText(/Approuvée · base v1/)).toBeTruthy();
  expect(
    screen.queryByText("Préparer une décision pour l’hôte de confiance"),
  ).toBeNull();
});
