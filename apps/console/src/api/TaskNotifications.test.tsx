import React, { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
import {
  TaskNotifications,
  type TaskNotificationsActions,
} from "./TaskNotifications";
const domain = "00000000-0000-0000-0000-000000000001";
const event = "00000000-0000-0000-0000-000000000002";
const task = "00000000-0000-0000-0000-000000000003";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const api = new CortexApi(() => null);
  const ref = createRef<TaskNotificationsActions>();
  const onOpen = vi.fn();
  const onNotice = vi.fn();
  let read = false;
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _p, body) => {
      if (op === "task_notifications.list")
        return {
          items: [
            {
              event_id: event,
              task_id: task,
              title: "Revue synthétique assignée",
              actor: "manager",
              action: "offer",
              revision: 2,
              current_status: "offered",
              created_at: "2026-10-16T20:00:00Z",
              read_at: read ? "2026-10-16T20:01:00Z" : null,
            },
          ],
          next_after: null,
          total: 1,
          unread: read ? 0 : 1,
          scope: "personal",
          as_of: "2026-10-16T20:00:00Z",
        } as never;
      if (op === "task_notifications.read") {
        read = true;
        return { event_id: event, read_at: "2026-10-16T20:01:00Z" } as never;
      }
      throw Error("Unexpected operation");
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TaskNotifications
        ref={ref}
        api={api}
        domain={domain}
        enabled
        onOpen={onOpen}
        onNotice={onNotice}
      />
    </QueryClientProvider>,
  );
  return { ref, call, onOpen, onNotice, cache };
}
it("opening does not mark read; explicit button uses the personal operation and refreshes count", async () => {
  const { call, onOpen } = setup();
  await screen.findByText("Revue synthétique assignée");
  fireEvent.click(screen.getByText("Ouvrir la tâche"));
  expect(onOpen).toHaveBeenCalledWith(task);
  expect(call.mock.calls.some(([op]) => op === "task_notifications.read")).toBe(
    false,
  );
  fireEvent.click(screen.getByText("Marquer comme lue"));
  await screen.findByText(/0 non lues sur 1/);
  expect(
    call.mock.calls.filter(([op]) => op === "task_notifications.read"),
  ).toHaveLength(1);
});
it("chat uses the same operation and does not accept an unseen target", async () => {
  const { ref, call } = setup();
  await screen.findByText("Revue synthétique assignée");
  await act(async () => {
    await ref.current!.read(domain);
  });
  expect(call.mock.calls.some(([op]) => op === "task_notifications.read")).toBe(
    false,
  );
  await act(async () => {
    await ref.current!.read(event);
  });
  await screen.findByText(/0 non lues/);
  expect(
    call.mock.calls.filter(([op]) => op === "task_notifications.read"),
  ).toHaveLength(1);
});
it("unknown outcome retains the exact key and rejects target substitution", async () => {
  const { ref, call } = setup();
  await screen.findByText("Revue synthétique assignée");
  const normal = call.getMockImplementation()!;
  let failed = false;
  call.mockImplementation(async (...args) => {
    if (args[0] === "task_notifications.read" && !failed) {
      failed = true;
      throw new ApiError(0, "network_error");
    }
    return normal(...args);
  });
  fireEvent.click(screen.getByText("Marquer comme lue"));
  await screen.findByText(/Résultat de lecture inconnu/);
  await act(async () => {
    await ref.current!.read(domain);
  });
  fireEvent.click(screen.getByText("Réessayer le même reçu de lecture"));
  await screen.findByText(/0 non lues/);
  const calls = call.mock.calls.filter(
    ([op]) => op === "task_notifications.read",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][2]).toEqual(calls[1][2]);
});
it("fresh denial masks cached notification and clears content from the notice", async () => {
  const { call, onNotice } = setup();
  await screen.findByText("Revue synthétique assignée");
  const normal = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "task_notifications.read")
      throw new ApiError(404, "NOT_FOUND");
    return normal(...args);
  });
  fireEvent.click(screen.getByText("Marquer comme lue"));
  await screen.findByText(/Lecture refusée/);
  expect(screen.queryByText("Revue synthétique assignée")).toBeNull();
  expect(screen.queryByText(/1 non lues/)).toBeNull();
  expect(onNotice).toHaveBeenLastCalledWith(
    expect.stringContaining("Lecture refusée"),
  );
});
it("expired pagination masks the old page and restart requests the first page", async () => {
  const { call, cache } = setup();
  await screen.findByText("Revue synthétique assignée");
  const normal = call.getMockImplementation()!;
  let fail = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "task_notifications.list" && fail)
      throw new ApiError(409, "WORKSPACE_CURSOR_STALE");
    return normal(...args);
  });
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["api", "task-notifications", domain],
    });
  });
  await screen.findByText(/anciens éléments sont masqués/);
  expect(screen.queryByText("Revue synthétique assignée")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByText("Recommencer la lecture de l’activité"));
  await screen.findByText("Revue synthétique assignée");
  const calls = call.mock.calls.filter(
    ([op]) => op === "task_notifications.list",
  );
  expect(calls.at(-1)?.[3]?.query).toEqual({ limit: 20 });
});
