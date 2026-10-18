import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { WorkBrief, validateBrief } from "./WorkBrief";
import { CortexApi, ApiError } from "./client";
import type { WorkBrief as Brief } from "../../../../packages/contracts/src/WorkBrief";
const domain = "00000000-0000-0000-0000-000000000001";
function fixture(active = 1): Brief {
  return {
    scope: "assigned",
    role: "contributor",
    as_of: "2026-10-16T22:00:00Z",
    permissions_version: 1,
    work_version: 2,
    coverage: "active_tasks_only",
    sort: "overdue_review_offer_blocked_unassigned_progress_due_created_id",
    counts: {
      active,
      overdue: active,
      offered: active,
      review: 0,
      blocked: 0,
      unassigned: 0,
      in_progress: 0,
    },
    has_more: active > 5,
    items: Array.from({ length: Math.min(5, active) }, (_, i) => ({
      overdue: true,
      task: {
        id: `00000000-0000-0000-0000-${String(i + 2).padStart(12, "0")}`,
        title: `Revue synthétique ${i}`,
        instructions: "Consigne",
        criteria: "Preuve",
        creator: "alice",
        assignee: "reader",
        status: "offered",
        revision: 2,
        created_at: "2026-10-15T00:00:00Z",
        updated_at: "2026-10-15T00:00:00Z",
        due_at: "2026-10-16T20:00:00Z",
        offered_at: "2026-10-15T00:00:00Z",
        accepted_at: null,
        result_summary: "",
        allowed_actions: ["accept", "decline"],
      },
    })),
  } as Brief;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(value = fixture(), coordinate = false) {
  const api = new CortexApi(() => null);
  const call = vi.spyOn(api, "call").mockResolvedValue(value as never);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpen = vi.fn(),
    onAll = vi.fn(),
    onScope = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <WorkBrief
        api={api}
        domain={domain}
        scope="assigned"
        coordinate={coordinate}
        onOpen={onOpen}
        onAll={onAll}
        onScope={onScope}
        refresh={0}
      />
    </QueryClientProvider>,
  );
  return { api, call, cache, onOpen, onAll, onScope };
}
it("shows exact denominator and opens work without accepting it", async () => {
  const { call, onOpen, onAll } = setup(fixture(8));
  await screen.findByText(/5 tâches présentées sur 8 actives/);
  expect(screen.getAllByText(/Décider d’accepter/)).toHaveLength(5);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Ouvrir la tâche : Revue synthétique 0",
    }),
  );
  expect(onOpen).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000002");
  fireEvent.click(screen.getByRole("button", { name: "Voir toute la file" }));
  expect(onAll).toHaveBeenCalledOnce();
  expect(call.mock.calls.every((c) => c[0] === "tasks.brief")).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Travail du domaine" }),
  ).toBeNull();
});
it("coordinates only via explicit scope selection", async () => {
  const { onScope } = setup({ ...fixture(), role: "corpus_manager" }, true);
  await screen.findByText(/Responsable de corpus/);
  fireEvent.click(screen.getByRole("button", { name: "Travail du domaine" }));
  expect(onScope).toHaveBeenCalledWith("domain");
});
it("does not present an empty task scope as a complete corpus", async () => {
  setup(fixture(0));
  await screen.findByText(/Aucune tâche active dans ce périmètre/);
  expect(screen.getByText(/Cela ne signifie pas/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Voir toute la file" }),
  ).toBeNull();
});
it("masks cached private tasks while rereading and on authorization failure, then recovers", async () => {
  const { call } = setup();
  await screen.findByText("Revue synthétique 0");
  let reject: (e: Error) => void = () => {};
  call.mockImplementationOnce(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await waitFor(() =>
    expect(screen.queryByText("Revue synthétique 0")).toBeNull(),
  );
  await act(async () => reject(new ApiError(403, "NOT_AUTHORIZED")));
  await screen.findByRole("alert");
  expect(screen.queryByText("Revue synthétique 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await screen.findByText("Revue synthétique 0");
});
it("rejects wrong scopes, inconsistent counts, overdue claims and duplicate task rows", () => {
  const original = fixture();
  expect(validateBrief(original, "assigned")).toEqual(original);
  for (const bad of [
    { ...original, scope: "domain" },
    { ...original, counts: { ...original.counts, active: 2 } },
    { ...original, items: [{ ...original.items[0], overdue: false }] },
    { ...original, has_more: true },
    { ...original, as_of: "nonsense" },
    { ...fixture(2), items: [original.items[0], original.items[0]] },
  ])
    expect(() => validateBrief(bad as Brief, "assigned")).toThrow();
});
