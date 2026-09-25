import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { ReviewHistory } from "./ReviewHistory";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads decisions on demand and hides old history after access denial", async () => {
  const api = new CortexApi(() => null);
  const call = vi
    .spyOn(api, "call")
    .mockResolvedValue({
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
