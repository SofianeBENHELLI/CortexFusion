import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
import { TaskReceipts, validateTaskRecord } from "./TaskReceipts";
const id = "00000000-0000-0000-0000-000000000001";
const record = {
  command_id: id,
  action: "create" as const,
  recorded_at: "2026-10-16T10:00:00Z",
  outcome: "recorded" as const,
  receipt: {
    task_id: id,
    event_id: id,
    revision: 1,
    status: "unassigned" as const,
  },
  task_title: "Tâche synthétique",
  current_revision: 3,
  current_status: "in_progress" as const,
};
const page = {
  items: [record],
  total: 1,
  next_after: null,
  has_more: false,
  scope: "personal",
  sort: "created_at_desc_id_desc",
  work_version: 3,
  permissions_version: 1,
  as_of: "2026-10-16T12:00:00Z",
  completeness: "complete",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(value = page) {
  const api = new CortexApi(() => null),
    open = vi.fn(),
    call = vi.spyOn(api, "call").mockResolvedValue(value as never);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TaskReceipts api={api} domain={id} enabled onOpen={open} />
    </QueryClientProvider>,
  );
  return { open, call };
}
it("separates recorded result from current state and opens only the current task", async () => {
  const { open, call } = setup();
  expect(await screen.findByText(/1 reçus chargés sur 1/)).toBeTruthy();
  expect(screen.getByText(/résultat : À affecter · révision 1/)).toBeTruthy();
  expect(screen.getByText(/État actuel : En cours · révision 3/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Ouvrir la tâche actuelle" }),
  );
  expect(open).toHaveBeenCalledWith(id);
  expect(call.mock.calls.every((c) => c[0] === "task_receipts.list")).toBe(
    true,
  );
});
it("does not expose current title or offer open for an inaccessible task", async () => {
  setup({
    ...page,
    items: [
      {
        ...record,
        task_title: null,
        current_revision: null,
        current_status: null,
      },
    ],
  } as never);
  await screen.findByText(/tâche désormais inaccessible/);
  expect(
    screen.queryByRole("button", { name: "Ouvrir la tâche actuelle" }),
  ).toBeNull();
  expect(screen.queryByText(/Tâche synthétique/)).toBeNull();
});
it("masks previous results when the re-read loses access", async () => {
  const { call } = setup();
  await screen.findByText(/1 reçus chargés sur 1/);
  call.mockRejectedValue(new ApiError(404, "NOT_FOUND"));
  fireEvent.click(
    screen.getByRole("button", { name: "Relire mes actions enregistrées" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(/Tâche synthétique/)).toBeNull();
});
it("rejects a receipt carrying inconsistent hidden state or a regressed revision", () => {
  expect(() => validateTaskRecord({ ...record, task_title: null })).toThrow();
  expect(() =>
    validateTaskRecord({ ...record, current_revision: 0 }),
  ).toThrow();
});
it("never treats an empty list as proof that an interrupted command failed", async () => {
  setup({ ...page, items: [], total: 0 });
  await screen.findByText(/Aucun reçu visible/);
  expect(screen.getByText(/Ce résultat ne prouve pas/)).toBeTruthy();
});
