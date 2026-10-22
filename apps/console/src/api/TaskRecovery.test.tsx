import React, { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TaskRecovery, type TaskRecoveryHandle } from "./TaskRecovery";
import { CortexApi, ApiError } from "./client";
import { readTaskRecovery, rememberTaskRecovery } from "./taskRecoveryStore";
const domain = "00000000-0000-0000-0000-000000000001",
  command = "00000000-0000-0000-0000-000000000002",
  task = "00000000-0000-0000-0000-000000000003";
const scope = { tenant: domain, subject: "alice" };
const record = {
  command_id: command,
  action: "accept",
  outcome: "recorded",
  recorded_at: "2026-10-17T09:00:00Z",
  receipt: {
    task_id: task,
    event_id: domain,
    status: "in_progress",
    revision: 3,
  },
  task_title: null,
  current_revision: null,
  current_status: null,
};
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function setup() {
  rememberTaskRecovery(scope, {
    domain,
    command,
    task,
    action: "accept",
    revision: 3,
    started: Date.now(),
  });
  const api = new CortexApi(() => null),
    call = vi.spyOn(api, "call").mockResolvedValue(record as never),
    ref = createRef<TaskRecoveryHandle>();
  const resolved = vi.fn(),
    notice = vi.fn(),
    onBusy = vi.fn();
  const view = render(
    <TaskRecovery
      ref={ref}
      api={api}
      scope={scope}
      domain={domain}
      refresh={0}
      onNotice={notice}
      onResolved={resolved}
      onBusy={onBusy}
    />,
  );
  return { api, call, ref, resolved, notice, view };
}
it("recovers with one GET only and clears a verified reference even without task access", async () => {
  const { call, resolved } = setup();
  fireEvent.click(screen.getByText("Vérifier le reçu sans renvoyer"));
  await screen.findByText(/Action retrouvée/);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toBe("task_receipts.read");
  expect(resolved).toHaveBeenCalledWith(command);
  expect(readTaskRecovery(scope).entries).toEqual([]);
});
it.each([404, 403, 503])(
  "retains uncertainty on %s without new command",
  async (status) => {
    const { call, ref } = setup();
    call.mockRejectedValue(new ApiError(status, "not_available"));
    await act(async () => {
      await ref.current!.verify(command);
    });
    expect(screen.getByText(/Aucun reçu confirmé/)).toBeDefined();
    expect(readTaskRecovery(scope).entries).toHaveLength(1);
    expect(call.mock.calls.every(([op]) => op === "task_receipts.read")).toBe(
      true,
    );
  },
);
it("rejects a receipt for another revision and permits explicit local forgetting through the same chat handle", async () => {
  const { call, ref } = setup();
  call.mockResolvedValue({
    ...record,
    receipt: { ...record.receipt, revision: 4 },
  } as never);
  await act(async () => {
    await ref.current!.verify();
  });
  expect(readTaskRecovery(scope).entries).toHaveLength(1);
  await act(async () => {
    await ref.current!.forget(command);
  });
  expect(screen.getByText(/Cela n’annule pas l’action/)).toBeDefined();
  expect(readTaskRecovery(scope).entries).toEqual([]);
  expect(call).toHaveBeenCalledTimes(1);
});
it("does not resolve a pending read after unmount", async () => {
  const { call, view, resolved } = setup();
  let finish!: (v: never) => void;
  call.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByText("Vérifier le reçu sans renvoyer"));
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish(record as never));
  expect(resolved).not.toHaveBeenCalled();
  expect(readTaskRecovery(scope).entries).toHaveLength(1);
});
