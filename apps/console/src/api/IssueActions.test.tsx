import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CortexApi, ApiError } from "./client";
import { IssueActions } from "./IssueActions";
const issue = {
  id: "issue",
  episode_id: "episode",
  kind: "disputed_answer" as const,
  reason: "test",
  status: "open" as const,
  revision: 4,
  created_at: "2026-01-01",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("retries the same decision after an uncertain network result", async () => {
  const api = new CortexApi(() => null),
    changed = vi.fn().mockResolvedValue(undefined);
  const call = vi
    .spyOn(api, "call")
    .mockRejectedValueOnce(new ApiError(0, "network_error"))
    .mockResolvedValue({
      id: "receipt",
      issue_id: "issue",
      author: "owner",
      previous_status: "open",
      status: "in_progress",
      revision: 5,
      reason: "test",
      created_at: "2026-01-01",
    });
  render(
    <IssueActions
      api={api}
      domain="domain"
      issue={issue}
      onChanged={changed}
    />,
  );
  fireEvent.change(screen.getByLabelText("Motif du traitement"), {
    target: { value: "Vérification des preuves" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Prendre en charge" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Réessayer le même traitement" }),
  );
  await screen.findByText(/Traitement enregistré/);
  expect(call.mock.calls[0][2]).toEqual(call.mock.calls[1][2]);
  expect(call.mock.calls[1][2]).toMatchObject({
    action: "start",
    expected_revision: 4,
    reason: "Vérification des preuves",
  });
  expect(changed).toHaveBeenCalledTimes(1);
});
it("requires refresh after a stale revision instead of retrying the conflict", async () => {
  const api = new CortexApi(() => null),
    changed = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(api, "call").mockRejectedValue(new ApiError(409, "STALE_ISSUE"));
  render(
    <IssueActions
      api={api}
      domain="domain"
      issue={issue}
      onChanged={changed}
    />,
  );
  fireEvent.change(screen.getByLabelText("Motif du traitement"), {
    target: { value: "Vérifier" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Prendre en charge" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Actualiser avant une nouvelle décision",
    }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "Réessayer le même traitement" }),
  ).toBeNull();
});
