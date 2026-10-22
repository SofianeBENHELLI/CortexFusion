import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiBrainOverview } from "./ApiBrainOverview";
import { CortexApi, ApiError } from "../api/client";
import { graphFixture } from "./api-graph.fixture";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
it("shows incomplete stocks as unavailable and hides the previous cards after a denied refresh", async () => {
  let expired = false;
  const call = vi.fn(
    async (
      op: string,
      path: Record<string, string>,
      _body: unknown,
      opts: { query?: Record<string, unknown> },
    ) => {
      if (expired) throw new ApiError(401, "expired");
      if (op === "identity.read")
        return {
          tenant_id: id(99),
          subject: "alice",
          domains: [1, 2].map((n) => ({
            id: id(n),
            name: `Domaine ${n}`,
            role: "viewer",
            capabilities: [],
          })),
        };
      if (op === "domain.version")
        return {
          domain_id: path.domain,
          accepted_version: 1,
          published_version: 1,
        };
      if (path.domain === id(2)) throw new ApiError(503, "unavailable");
      return graphFixture(path.domain, [], opts.query);
    },
  );
  const open = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ApiBrainOverview
        api={{ call } as unknown as CortexApi}
        page={0}
        onPage={vi.fn()}
        onDomain={open}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Explorer Domaine 1" });
  const metrics = within(
    screen.getByRole("group", { name: "Stocks des domaines de cette page" }),
  );
  expect(metrics.getAllByText("—")).toHaveLength(2);
  expect(screen.getByText("Lecture indisponible")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Explorer Domaine 1" }));
  expect(open).toHaveBeenCalledWith(id(1));
  expired = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les domaines" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Session absente ou expirée",
  );
  expect(
    screen.queryByRole("button", { name: "Explorer Domaine 1" }),
  ).toBeNull();
});
