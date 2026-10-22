import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { ReviewHistory } from "./ReviewHistory";
import type { ReviewReceipt } from "../../../../packages/contracts/src/ReviewPage";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads decisions on demand and hides old history after access denial", async () => {
  const api = new CortexApi(() => null);
  const call = vi.spyOn(api, "call").mockResolvedValue({
    items: [
      {
        id: "receipt",
        proposal_id: "proposal",
        author: "reviewer",
        action: "defer",
        reason: "Vérifier le périmètre",
        proposal_digest: "digest",
        review_revision: 1,
        resulting_status: "deferred",
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    next_after: null,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReviewHistory api={api} domain="domain" proposal="proposal" />
    </QueryClientProvider>,
  );
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Consulter les décisions" }),
  );
  await screen.findByText("Vérifier le périmètre");
  expect(screen.getByText("Report")).toBeTruthy();
  call.mockRejectedValue(new ApiError(403, "forbidden"));
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les décisions" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Vérifier le périmètre")).toBeNull();
});

it("orders loaded revisions while explaining incomplete ID-based pages", async () => {
  const api = new CortexApi(() => null);
  const receipt = (revision: number): ReviewReceipt => ({
    id: `receipt-${revision}`,
    proposal_id: "proposal",
    author: "reviewer",
    action: "defer",
    reason: `Motif ${revision}`,
    proposal_digest: "digest",
    review_revision: revision,
    resulting_status: "deferred",
    created_at: "2026-10-03T09:00:00Z",
  });
  const call = vi
    .spyOn(api, "call")
    .mockResolvedValueOnce({
      items: [receipt(1), receipt(3)],
      next_after: "cursor",
    })
    .mockResolvedValueOnce({ items: [receipt(2)], next_after: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewHistory api={api} domain="domain" proposal="proposal" />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Consulter les décisions" }),
  );
  await screen.findByText(/2 décisions chargées · lecture partielle/);
  expect(screen.getByText(/Des décisions peuvent manquer/)).toBeTruthy();
  const reasons = () =>
    screen
      .getAllByRole("listitem")
      .map((item) => within(item).getByText(/^Motif/).textContent);
  expect(reasons()).toEqual(["Motif 3", "Motif 1"]);
  fireEvent.click(screen.getByRole("button", { name: "Décisions suivantes" }));
  await screen.findByText(/3 décisions chargées · toutes les pages/);
  expect(reasons()).toEqual(["Motif 3", "Motif 2", "Motif 1"]);
  expect(screen.queryByText(/Des décisions peuvent manquer/)).toBeNull();
  expect(call.mock.calls[1][3]?.query).toEqual({ limit: 20, after: "cursor" });
});
