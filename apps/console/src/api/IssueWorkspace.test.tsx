import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { IssueWorkspace } from "./IssueWorkspace";
import type { IssueView } from "../../../../packages/contracts/src/IssueView";
const issue: IssueView = {
  id: "issue",
  episode_id: "episode",
  kind: "disputed_answer",
  reason: "Vérifier la portée",
  status: "open",
  revision: 0,
  created_at: "2026-01-01",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads the exact episode and hides it when ticket access is revoked", async () => {
  const api = new CortexApi(() => null);
  let deny = false;
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (deny) throw new ApiError(403, "forbidden");
    if (op === "issues.list") return { items: [issue], next_after: null };
    if (op === "issues.read") return issue;
    if (op === "episodes.read")
      return {
        episode_id: "episode",
        answer: "Passage synthétique",
        status: "evidence_found",
        served_version: 3,
        concepts: [],
        citations: [
          {
            source_id: "source",
            title: "Preuve de test",
            location: "synthetic://test",
            content_hash: "test",
            start: 0,
            end: 4,
            excerpt: "Test",
          },
        ],
      };
    throw Error(op);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <IssueWorkspace api={api} domain="domain" />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Ouvert · Réponse contestée/ }),
  );
  await screen.findByText("Passage synthétique");
  expect(screen.getByText("Réponse concernée · version 3")).toBeTruthy();
  expect(call).toHaveBeenCalledWith(
    "episodes.read",
    { domain: "domain", episode_id: "episode" },
    undefined,
    expect.any(Object),
  );
  deny = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les tickets" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Passage synthétique")).toBeNull();
});
