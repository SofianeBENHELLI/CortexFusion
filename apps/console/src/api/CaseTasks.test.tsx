import React, { createRef } from "react";
import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CaseTasks,
  type CaseTaskActions,
  validateCaseTasks,
} from "./CaseTasks";
import { ApiError, CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  cid = "00000000-0000-0000-0000-000000000002",
  tid = "00000000-0000-0000-0000-000000000003",
  event = "00000000-0000-0000-0000-000000000004";
const task = {
  id: tid,
  title: "Revoir la règle",
  instructions: "Mission indépendante",
  criteria: "Preuve",
  creator: "manager",
  assignee: null,
  status: "unassigned",
  revision: 1,
  created_at: "2026-10-16T22:00:00Z",
  updated_at: "2026-10-16T22:00:00Z",
  due_at: null,
  offered_at: null,
  accepted_at: null,
  result_summary: "",
  allowed_actions: ["offer", "cancel"],
};
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(author = false, strict = false) {
  const api = new CortexApi(() => null),
    ref = createRef<CaseTaskActions>(),
    notice = vi.fn(),
    hold = vi.fn(),
    denied = vi.fn(),
    open = vi.fn();
  let revision = 1,
    linked = false,
    taskRevision = 1,
    failRead = false,
    mode = "ok",
    lastBody: unknown,
    receipt: unknown;
  const current = () => ({
    case_id: cid,
    case_revision: revision,
    audience: author ? "declarant" : "team",
    items:
      linked && !author
        ? [
            {
              task_id: tid,
              title: task.title,
              status: task.status,
              revision: taskRevision,
              linked_at: task.created_at,
            },
          ]
        : [],
    linked_count: linked ? 1 : 0,
    max_links: 20,
    can_link: !author,
    can_unlink: !author,
    as_of: task.created_at,
  });
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _p, body, options) => {
      if (op === "case_tasks.list") {
        if (failRead) throw new ApiError(404, "NOT_FOUND");
        return current() as never;
      }
      if (op === "tasks.read")
        return { ...task, revision: taskRevision } as never;
      if (op === "tasks.list") {
        expect(options?.query).not.toHaveProperty("scope");
        return {
          items: [task],
          total: 1,
          has_more: false,
          next_after: null,
        } as never;
      }
      if (op === "case_tasks.command") {
        if (mode === "denied") throw new ApiError(404, "NOT_FOUND");
        if (lastBody && JSON.stringify(body) === JSON.stringify(lastBody))
          return receipt as never;
        lastBody = body;
        const b = body as { action: string; expected_case_revision: number };
        expect(b.expected_case_revision).toBe(revision);
        linked = b.action === "link";
        revision++;
        receipt = {
          case_id: cid,
          event_id: event,
          revision,
          status: "qualified",
        };
        if (mode === "lost") {
          mode = "ok";
          throw new Error("response lost");
        }
        if (mode === "readfails") failRead = true;
        if (mode === "malformed") return {} as never;
        return receipt as never;
      }
      throw Error(op);
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (accessDenied = false) => (
    <QueryClientProvider client={cache}>
      <CaseTasks
        api={api}
        domain={domain}
        caseId={cid}
        ref={ref}
        blocked={false}
        accessDenied={accessDenied}
        onHold={hold}
        onNotice={notice}
        onDenied={denied}
        onOpenTask={open}
      />
    </QueryClientProvider>
  );
  const rendered = render(
    strict ? <React.StrictMode>{ui()}</React.StrictMode> : ui(),
  );
  await screen.findByText(/0 tâche\(s\) liée/);
  async function action(v: Parameters<CaseTaskActions["act"]>[0]) {
    await act(async () => {
      await ref.current!.act(v);
    });
  }
  return {
    ...rendered,
    api,
    call,
    action,
    current,
    ui,
    denied,
    hold,
    open,
    setMode: (v: string) => (mode = v),
    setFailRead: (v: boolean) => (failRead = v),
    changeTask: () => taskRevision++,
    sent: () => call.mock.calls.filter((c) => c[0] === "case_tasks.command"),
  };
}
it("prepares through picker and confirms through chat, then unlinks without modifying task", async () => {
  const s = await setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Choisir une tâche à lier" }),
  );
  await screen.findByRole("button", { name: /Revoir la règle ·/ });
  fireEvent.click(screen.getByRole("button", { name: /Revoir la règle ·/ }));
  await screen.findByText("Vérifier l’association");
  expect(s.sent()).toHaveLength(0);
  await s.action({ kind: "case_tasks_confirm" });
  expect(s.sent()).toHaveLength(1);
  expect(s.current().linked_count).toBe(1);
  await s.action({ kind: "case_tasks_prepare", action: "unlink", task: tid });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer l’association" }),
  );
  await waitFor(() => expect(s.current().linked_count).toBe(0));
  expect(s.call.mock.calls.some((c) => c[0] === "tasks.command")).toBe(false);
});
it("recovery never sends an unconfirmed preparation and expiry requires fresh preparation", async () => {
  const s = await setup();
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  await s.action({ kind: "case_tasks_recover" });
  expect(s.sent()).toHaveLength(0);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 300001);
  await s.action({ kind: "case_tasks_confirm" });
  expect(s.sent()).toHaveLength(0);
  expect(screen.queryByText("Vérifier l’association")).toBeNull();
});
it("lost response recovers exactly once, holds navigation and preserves command on denied recovery", async () => {
  const s = await setup();
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  s.setMode("lost");
  await s.action({ kind: "case_tasks_confirm" });
  expect(s.hold).toHaveBeenLastCalledWith(true);
  const body = s.sent()[0][2];
  await s.action({ kind: "case_tasks_prepare", action: "unlink", task: tid });
  s.setMode("denied");
  await s.action({ kind: "case_tasks_recover" });
  expect(s.denied).toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Vérifier l’association envoyée" }),
  ).toBeTruthy();
  s.setMode("ok");
  await s.action({ kind: "case_tasks_recover" });
  expect(s.sent().map((c) => c[2])).toEqual([body, body, body]);
  expect(s.current().linked_count).toBe(1);
});
it("changed task between preparation and confirmation prevents sending", async () => {
  const s = await setup();
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  s.changeTask();
  await s.action({ kind: "case_tasks_confirm" });
  expect(s.sent()).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toMatch(/a changé/);
});
it("a valid receipt stays confirmed even when following read fails; private title is hidden", async () => {
  const s = await setup();
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  s.setMode("readfails");
  await s.action({ kind: "case_tasks_confirm" });
  expect(s.denied).toHaveBeenCalled();
  expect(screen.queryByText(/Revoir la règle/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Vérifier l’association envoyée" }),
  ).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/enregistrée/);
});
it("declarant sees count only and cannot prepare association", async () => {
  const s = await setup(true);
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  expect(s.call.mock.calls.filter((c) => c[0] === "tasks.read")).toHaveLength(
    0,
  );
  expect(
    screen.queryByRole("button", { name: "Choisir une tâche à lier" }),
  ).toBeNull();
  expect(() =>
    validateCaseTasks(
      { ...s.current(), items: [{ task_id: tid }] } as never,
      cid,
    ),
  ).toThrow();
});
it("current source denial masks prepared title and candidate rows, malformed receipt remains unknown", async () => {
  const s = await setup();
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  s.setMode("malformed");
  await s.action({ kind: "case_tasks_confirm" });
  expect(
    screen.getByRole("button", { name: "Vérifier l’association envoyée" }),
  ).toBeTruthy();
  s.rerender(s.ui(true));
  await waitFor(() => expect(screen.queryByText(/Revoir la règle/)).toBeNull());
  expect(
    screen.getByRole("button", { name: "Vérifier l’association envoyée" }),
  ).toBeTruthy();
});
it("chat grammar keeps preparation, confirmation, recovery and cancellation separate", () => {
  expect(chatIntent("lie une tâche au dossier : Revoir la règle")).toEqual({
    kind: "case_tasks_prepare",
    action: "link",
    task: "Revoir la règle",
  });
  expect(chatIntent("délie la tâche du dossier : " + tid)).toEqual({
    kind: "case_tasks_prepare",
    action: "unlink",
    task: tid,
  });
  expect(chatIntent("confirme l’association")).toEqual({
    kind: "case_tasks_confirm",
  });
  expect(chatIntent("vérifie l'association")).toEqual({
    kind: "case_tasks_recover",
  });
  expect(chatIntent("annule l'association")).toEqual({
    kind: "case_tasks_cancel",
  });
  expect(chatIntent("lie une tâche au dossier")).toEqual({
    kind: "unsupported",
  });
});

it("survives StrictMode effect cancellation without leaving the reading state busy", async () => {
  const s = await setup(false, true);
  await waitFor(() =>
    expect(
      screen.queryByText("Vérification du dossier et du travail autorisé…"),
    ).toBeNull(),
  );
  await s.action({ kind: "case_tasks_prepare", action: "link", task: tid });
  expect(screen.getByText("Vérifier l’association")).toBeTruthy();
});
