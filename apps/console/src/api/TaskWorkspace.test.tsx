import { readTaskRecovery, recoveryKey } from "./taskRecoveryStore";
import React, { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import { ApiError, CortexApi } from "./client";
import { TaskWorkspace, type TaskWorkspaceActions } from "./TaskWorkspace";
const domain = "00000000-0000-0000-0000-000000000001",
  task = "00000000-0000-0000-0000-000000000002";
const initial: WorkTask = {
  id: task,
  title: "Revue synthétique",
  instructions: "Relire la formulation.",
  criteria: "Remettre une justification.",
  creator: "owner",
  assignee: "reader",
  status: "offered",
  revision: 2,
  created_at: "2026-10-16T10:00:00Z",
  updated_at: "2026-10-16T11:00:00Z",
  due_at: null,
  offered_at: "2026-10-16T11:00:00Z",
  accepted_at: null,
  result_summary: "",
  allowed_actions: ["accept", "decline"],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function setup(
  coordinate = false,
  routeSelection?: string,
  canReceipts = false,
  recover = false,
) {
  const api = new CortexApi(() => null);
  const ref = createRef<TaskWorkspaceActions>();
  let current = { ...initial };
  const notice = vi.fn();
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _params, body) => {
      if (op === "tasks.list")
        return {
          items: [current],
          next_after: null,
          total: 1,
          as_of: "2026-10-16T12:00:00Z",
          scope: "domain",
          permissions_version: 1,
          work_version: 1,
          sort: "created_at_asc_id_asc",
          has_more: false,
          completeness: "complete",
        } as never;
      if (op === "tasks.read") return { ...current } as never;
      if (op === "tasks.events" || op === "tasks.candidates")
        return { items: [], next_after: null } as never;
      if (op === "tasks.plan") {
        const b = body as {
          expected_revision: number;
          priority: "low" | "normal" | "high";
          due_at: string | null;
          reason: string;
        };
        if (b.expected_revision !== current.revision)
          throw new ApiError(409, "TASK_CHANGED");
        current = {
          ...current,
          revision: current.revision + 1,
          priority: b.priority,
          priority_reason: b.reason,
          due_at: b.due_at,
        };
        return {
          task_id: task,
          event_id: domain,
          revision: current.revision,
          status: current.status,
        } as never;
      }
      if (op === "tasks.command") {
        const b = body as { action: string; expected_revision: number };
        if (b.expected_revision !== current.revision)
          throw new ApiError(409, "TASK_CHANGED");
        current = {
          ...current,
          status: b.action === "accept" ? "in_progress" : "unassigned",
          revision: current.revision + 1,
          allowed_actions: ["block", "submit"],
        };
        return {
          task_id: task,
          event_id: domain,
          revision: current.revision,
          status: current.status,
        } as never;
      }
      if (op === "tasks.create")
        return {
          task_id: task,
          event_id: domain,
          revision: 1,
          status: "unassigned",
        } as never;
      throw Error("Unexpected operation");
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <TaskWorkspace
        ref={ref}
        routeSelection={routeSelection}
        api={api}
        domain={domain}
        coordinate={coordinate}
        canReceipts={canReceipts}
        recoveryScope={
          recover ? { tenant: domain, subject: "reader" } : undefined
        }
        onNotice={notice}
      />
    </QueryClientProvider>,
  );
  return {
    view,
    api,
    cache,
    call,
    ref,
    notice,
    setCurrent: (v: Partial<WorkTask>) => {
      current = { ...current, ...v };
    },
  };
}
async function select() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Revue synthétique/ }),
  );
  const heading = await screen.findByRole("heading", {
    name: "Revue synthétique",
  });
  await waitFor(() => expect(document.activeElement).toBe(heading));
}
it("prepares from a fresh revision then confirms one command, never publishes", async () => {
  const { call, setCurrent } = setup();
  await select();
  setCurrent({ revision: 3 });
  fireEvent.change(screen.getByLabelText("Motif"), {
    target: { value: "Je prends cette relecture." },
  });
  fireEvent.click(screen.getByText("Accepter la tâche"));
  await screen.findByRole("region", { name: "Projet de tâche" });
  expect(call.mock.calls.filter(([op]) => op === "tasks.command")).toHaveLength(
    0,
  );
  expect(screen.getByText("Révision attendue : 3")).toBeDefined();
  fireEvent.click(screen.getByText("Confirmer la tâche"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Action enregistrée",
    ),
  );
  expect(call.mock.calls.filter(([op]) => op === "tasks.command")).toHaveLength(
    1,
  );
  expect(call.mock.calls.some(([op]) => op.includes("publish"))).toBe(false);
});
it("chat and buttons use the same preparation and explicit confirmation", async () => {
  const { ref, call } = setup();
  await select();
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Je prends la tâche par chat.",
    });
  });
  expect(call.mock.calls.filter(([op]) => op === "tasks.command")).toHaveLength(
    0,
  );
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  expect(call.mock.calls.filter(([op]) => op === "tasks.command")).toHaveLength(
    1,
  );
  await screen.findByRole("status");
});
it("an uncertain command keeps its original key and cannot be replaced or cancelled", async () => {
  const { ref, call } = setup();
  await select();
  const normal = call.getMockImplementation()!;
  let failed = false;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.command" && !failed) {
      failed = true;
      throw new ApiError(0, "network_error");
    }
    return normal(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Motif stable",
    });
  });
  fireEvent.click(screen.getByText("Confirmer la tâche"));
  await screen.findByText(/Résultat inconnu/);
  await act(async () => {
    await ref.current!.act({ kind: "task_cancel_preparation" });
    await ref.current!.act({
      kind: "task_action",
      action: "decline",
      reason: "Remplacement refusé",
    });
  });
  fireEvent.click(screen.getByText("Réessayer la même commande"));
  await screen.findByRole("status");
  const sent = call.mock.calls.filter(([op]) => op === "tasks.command");
  expect(sent[0][2]).toEqual(sent[1][2]);
});
it("fresh history denial hides task title, instruction, command and central notice", async () => {
  const { call, notice } = setup();
  await select();
  const normal = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.events") throw new ApiError(403, "DENIED");
    return normal(...args);
  });
  fireEvent.click(screen.getByText("Actualiser les tâches"));
  await screen.findByText(/Les contenus précédents sont masqués/);
  expect(screen.queryByText(initial.instructions)).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Revue synthétique/ }),
  ).toBeNull();
  expect(notice).toHaveBeenLastCalledWith(
    expect.stringContaining("inaccessible"),
  );
});
it("does not advertise create or assignment controls to a contributor", async () => {
  const { ref, call } = setup();
  await select();
  expect(screen.queryByText("Créer une tâche autonome")).toBeNull();
  await act(async () => {
    await ref.current!.act({
      kind: "task_create",
      title: "x",
      instructions: "y",
      criteria: "z",
    });
  });
  expect(
    call.mock.calls.some(
      ([op]) => op === "tasks.create" || op === "tasks.candidates",
    ),
  ).toBe(false);
});
it("expires preparations and refuses stale actions after a fresh read", async () => {
  const { ref, call, setCurrent } = setup();
  await select();
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Raison",
    });
  });
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 301000);
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  expect(call.mock.calls.some(([op]) => op === "tasks.command")).toBe(false);
  setCurrent({ status: "completed", allowed_actions: [] });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Encore",
    });
  });
  expect(screen.queryByRole("region", { name: "Projet de tâche" })).toBeNull();
});
it("create shares only the explicit task fields after confirmation", async () => {
  const { ref, call } = setup(true);
  await screen.findByText(/1 tâches chargées/);
  await act(async () => {
    await ref.current!.act({
      kind: "task_create",
      title: "Contrôler le texte",
      instructions: "Consigne synthétique",
      criteria: "Critère vérifiable",
    });
  });
  const project = screen.getByRole("region", { name: "Projet de tâche" });
  expect(
    within(project).getByText(/Visible par les coordinateurs/),
  ).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "tasks.create")).toBe(false);
  fireEvent.click(within(project).getByText("Confirmer la tâche"));
  await waitFor(() =>
    expect(call.mock.calls.some(([op]) => op === "tasks.create")).toBe(true),
  );
  const body = call.mock.calls.find(([op]) => op === "tasks.create")![2];
  expect(body).toMatchObject({
    title: "Contrôler le texte",
    instructions: "Consigne synthétique",
    criteria: "Critère vérifiable",
  });
  expect(Object.keys(body!)).toEqual([
    "title",
    "instructions",
    "criteria",
    "idempotency_key",
  ]);
});

it("keeps a denied chat action visible in the dossier without an obsolete receipt", async () => {
  const { ref, setCurrent } = setup();
  await select();
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Prise en charge",
    });
  });
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Action enregistrée",
    ),
  );
  setCurrent({ allowed_actions: [] });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "complete",
      reason: "Non autorisé",
    });
  });
  expect(screen.getByRole("status").textContent).toContain(
    "n’est plus disponible",
  );
  expect(screen.queryByText(/Action enregistrée/)).toBeNull();
});

it("uses the same explicit filters from chat and the controls", async () => {
  const { ref, call } = setup(true);
  await screen.findByRole("button", { name: /Revue synthétique/ });
  await act(async () => {
    await ref.current!.act({ kind: "task_filter", active: false, mine: true });
  });
  await waitFor(() =>
    expect(
      call.mock.calls.filter(([op]) => op === "tasks.list").at(-1)?.[3]?.query,
    ).toEqual({ limit: 20, active_only: false, assigned_to_me: true }),
  );
  expect((screen.getByLabelText("Afficher") as HTMLSelectElement).value).toBe(
    "all",
  );
  expect((screen.getByLabelText("Périmètre") as HTMLSelectElement).value).toBe(
    "mine",
  );
});
it("prepares the exact deadline and refuses a natural-language date", async () => {
  const { ref, call } = setup(true);
  await screen.findByRole("button", { name: /Revue synthétique/ });
  await act(async () => {
    await ref.current!.act({
      kind: "task_create",
      title: "Tâche",
      instructions: "Consigne",
      criteria: "Preuve",
      due_at: "demain",
    });
  });
  expect(screen.queryByRole("region", { name: "Projet de tâche" })).toBeNull();
  await act(async () => {
    await ref.current!.act({
      kind: "task_create",
      title: "Tâche",
      instructions: "Consigne",
      criteria: "Preuve",
      due_at: "2026-11-01T12:30:00+02:00",
    });
  });
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  expect(
    call.mock.calls.find(([op]) => op === "tasks.create")?.[2],
  ).toMatchObject({ due_at: "2026-11-01T10:30:00.000Z" });
});
it("a stale list masks a prepared task and prevents confirmation until restarted", async () => {
  const { ref, call, cache } = setup();
  await select();
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Prendre en charge",
    });
  });
  const normal = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.list")
      throw new ApiError(409, "WORKSPACE_CURSOR_STALE");
    return normal(...args);
  });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["api", "tasks", domain] });
  });
  await screen.findByText(/contenus précédents sont masqués/);
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  expect(call.mock.calls.some(([op]) => op === "tasks.command")).toBe(false);
  expect(screen.queryByRole("region", { name: "Projet de tâche" })).toBeNull();
});

it("restores an opaque task target and revalidates its read without a mutation", async () => {
  const { call } = setup(false, task);
  await screen.findByRole("heading", { name: initial.title });
  expect(call.mock.calls.some(([op]) => op === "tasks.read")).toBe(true);
  expect(call.mock.calls.some(([op]) => op === "tasks.command")).toBe(false);
  expect(document.activeElement?.tagName).toBe("H3");
});
it("selects an exact task name through chat and filters only the loaded list", async () => {
  const { ref, call } = setup();
  await screen.findByText(/1 tâches chargées/);
  await act(async () => {
    await ref.current!.act({ kind: "task_select", id: "revue synthetique" });
  });
  await screen.findByRole("heading", { name: initial.title });
  fireEvent.change(
    screen.getByLabelText("Rechercher dans les tâches chargées"),
    { target: { value: "autre" } },
  );
  expect(
    screen.getByText(/0 correspondances parmi 1 tâches chargées/),
  ).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "tasks.command")).toBe(false);
});

it("clears the previous decision target when name resolution is ambiguous", async () => {
  const { ref, call, cache } = setup();
  await select();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.list") {
      const value = (await original(...args)) as { items: WorkTask[] };
      return {
        ...value,
        items: [initial, { ...initial, id: domain }],
        total: 2,
      } as never;
    }
    return original(...args);
  });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["api", "tasks", domain] });
  });
  await screen.findByText(/2 tâches chargées/);
  await act(async () => {
    await ref.current!.act({ kind: "task_select", id: initial.title });
  });
  expect(screen.queryByRole("heading", { name: initial.title })).toBeNull();
  expect(screen.getByText(/Plusieurs tâches portent ce nom/)).toBeDefined();
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Ne pas cibler la précédente",
    });
  });
  expect(screen.queryByRole("region", { name: "Projet de tâche" })).toBeNull();
});

it("clears the denied target notice when browser navigation selects an authorized task", async () => {
  const denied = "00000000-0000-0000-0000-000000000099";
  const { api, call, cache, notice, view, ref } = setup(false, denied);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "tasks.read" && "task_id" in params && params.task_id === denied)
      throw new ApiError(404, "not_found");
    return original(op, params, body, options);
  });
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["api", "task", domain, denied],
    });
  });
  await screen.findByText(/Tâche ou historique inaccessible/);
  view.rerender(
    <QueryClientProvider client={cache}>
      <TaskWorkspace
        ref={ref}
        routeSelection={task}
        api={api}
        domain={domain}
        coordinate={false}
        onNotice={notice}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Revue synthétique" });
  expect(screen.queryByText(/Tâche ou historique inaccessible/)).toBeNull();
  expect(notice).toHaveBeenLastCalledWith("");
});

it("prepares an explicit plan from chat with before/after then confirms without changing assignment or state", async () => {
  const { ref, call, setCurrent } = setup(true, task);
  setCurrent({
    priority: "normal",
    priority_reason: "",
    planning_allowed: true,
  });
  await screen.findByRole("heading", { name: "Revue synthétique" });
  await act(async () => {
    await ref.current!.act({
      kind: "task_plan",
      priority: "high",
      due: "2026-11-01T12:00:00Z",
      reason: "Échéance de revue convenue",
    });
  });
  expect(
    screen.getByRole("region", { name: "Projet de tâche" }).textContent,
  ).toContain("Avant : priorité Normale");
  expect(
    screen.getByRole("region", { name: "Projet de tâche" }).textContent,
  ).toContain("Après : priorité Haute");
  expect(call.mock.calls.filter((c) => c[0] === "tasks.plan")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirmer la tâche" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Projet de tâche" }),
    ).toBeNull(),
  );
  expect(call.mock.calls.find((c) => c[0] === "tasks.plan")?.[2]).toMatchObject(
    {
      priority: "high",
      due_at: "2026-11-01T12:00:00.000Z",
      expected_revision: 2,
      reason: "Échéance de revue convenue",
    },
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Action enregistrée · Affectation proposée · révision 3",
  );
});
it("keeps the exact planning body after an unknown response", async () => {
  const { ref, call, setCurrent } = setup(true, task);
  setCurrent({
    priority: "normal",
    priority_reason: "",
    planning_allowed: true,
  });
  await screen.findByRole("heading", { name: "Revue synthétique" });
  const original = call.getMockImplementation()!;
  let lost = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.plan" && lost) {
      lost = false;
      throw Error("network");
    }
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "task_plan",
      priority: "high",
      due: "",
      reason: "Ordre explicite",
    });
    await ref.current!.act({ kind: "task_confirm" });
  });
  // Confirm through UI after React commits the prepared state.
  if (screen.queryByRole("button", { name: "Confirmer la tâche" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la tâche" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Réessayer la même commande" }),
  );
  await waitFor(() =>
    expect(call.mock.calls.filter((c) => c[0] === "tasks.plan")).toHaveLength(
      2,
    ),
  );
  const sent = call.mock.calls.filter((c) => c[0] === "tasks.plan");
  expect(sent[0][2]).toEqual(sent[1][2]);
});
it("lets the explicit deadline removal button prepare null without changing assignment", async () => {
  const { call, setCurrent } = setup(true);
  setCurrent({
    priority: "normal",
    priority_reason: "",
    planning_allowed: true,
    due_at: "2026-11-01T12:00:00Z",
  });
  await select();
  fireEvent.click(screen.getByText("Planifier la priorité et l’échéance"));
  fireEvent.click(
    screen.getByRole("button", { name: "Retirer l’échéance du projet" }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Motif de planification" }),
    {
      target: { value: "Date retirée explicitement" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Préparer la planification" }),
  );
  expect(
    (await screen.findByRole("region", { name: "Projet de tâche" }))
      .textContent,
  ).toContain("Après : priorité Normale · sans échéance");
  expect(call.mock.calls.some((c) => c[0] === "tasks.plan")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirmer la tâche" }));
  await waitFor(() =>
    expect(
      call.mock.calls.find((c) => c[0] === "tasks.plan")?.[2],
    ).toMatchObject({ due_at: null, priority: "normal", expected_revision: 2 }),
  );
});
it("refuses plan preparation for an assignee without coordination and for invalid dates", async () => {
  const { ref, call, setCurrent } = setup(false, task);
  setCurrent({
    priority: "normal",
    priority_reason: "",
    planning_allowed: false,
  });
  await screen.findByRole("heading", { name: "Revue synthétique" });
  let message = "";
  await act(async () => {
    message = await ref.current!.act({
      kind: "task_plan",
      priority: "high",
      due: "2026-02-30T12:00",
      reason: "Recette",
    });
  });
  expect(message).toContain("Échéance invalide");
  await act(async () => {
    message = await ref.current!.act({
      kind: "task_plan",
      priority: "high",
      due: "",
      reason: "Recette",
    });
  });
  expect(message).toContain("ne peut pas être replanifiée");
  expect(screen.queryByRole("region", { name: "Projet de tâche" })).toBeNull();
  expect(call.mock.calls.some((c) => c[0] === "tasks.plan")).toBe(false);
});

it("verifies a lost success with GET without repeating the task command", async () => {
  const { ref, call } = setup(false, task, true);
  await screen.findByRole("heading", { name: "Revue synthétique" });
  const original = call.getMockImplementation()!;
  let commandKey = "";
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.command") {
      commandKey = (args[2] as { idempotency_key: string }).idempotency_key;
      await original(...args);
      throw Error("lost response");
    }
    if (args[0] === "task_receipts.read")
      return {
        command_id: commandKey,
        action: "accept",
        recorded_at: "2026-10-16T12:00:00Z",
        outcome: "recorded",
        receipt: {
          task_id: task,
          event_id: domain,
          revision: 3,
          status: "in_progress",
        },
        task_title: "Revue synthétique",
        current_revision: 3,
        current_status: "in_progress",
      } as never;
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Acceptation synthétique",
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmer la tâche" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Vérifier le reçu sans renvoyer",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Projet de tâche" }),
    ).toBeNull(),
  );
  expect(call.mock.calls.filter((c) => c[0] === "tasks.command")).toHaveLength(
    1,
  );
  expect(
    call.mock.calls.filter((c) => c[0] === "task_receipts.read"),
  ).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain(
    "Action enregistrée",
  );
});
it("keeps an unknown command held when its read-only receipt is missing", async () => {
  const { ref, call } = setup(false, task, true);
  await screen.findByRole("heading", { name: "Revue synthétique" });
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "tasks.command") throw Error("unknown");
    if (args[0] === "task_receipts.read") throw new ApiError(404, "NOT_FOUND");
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Acceptation synthétique",
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmer la tâche" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Vérifier le reçu sans renvoyer",
    }),
  );
  await screen.findByText(/Aucun reçu confirmé par cette lecture/);
  expect(
    (
      screen.getByRole("button", {
        name: "Annuler le projet de tâche",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(call.mock.calls.filter((c) => c[0] === "tasks.command")).toHaveLength(
    1,
  );
});

it("retains only recovery metadata before an interrupted send and uses GET after remount", async () => {
  const first = setup(false, task, true, true);
  await screen.findByRole("heading", { name: initial.title });
  const original = first.call.getMockImplementation()!;
  first.call.mockImplementation(async (op, ...args) => {
    if (op === "tasks.command") {
      expect(sessionStorage.getItem(recoveryKey)).not.toContain("motif privé");
      expect(
        readTaskRecovery({ tenant: domain, subject: "reader" }).entries,
      ).toHaveLength(1);
      throw new ApiError(502, "lost");
    }
    return original(op, ...args);
  });
  await act(async () => {
    await first.ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "motif privé",
    });
  });
  await act(async () => {
    await first.ref.current!.act({ kind: "task_confirm" });
  });
  const entry = readTaskRecovery({ tenant: domain, subject: "reader" })
    .entries[0];
  expect(entry.action).toBe("accept");
  first.view.unmount();
  const second = setup(false, task, true, true);
  const secondOriginal = second.call.getMockImplementation()!;
  second.call.mockImplementation(async (op, ...args) =>
    op === "task_receipts.read"
      ? ({
          command_id: entry.command,
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
        } as never)
      : secondOriginal(op, ...args),
  );
  await screen.findByRole("region", {
    name: "Actions à vérifier après interruption",
  });
  await act(async () => {
    await second.ref.current!.act({ kind: "task_verify_receipt" });
  });
  expect(second.call.mock.calls.some(([op]) => op === "tasks.command")).toBe(
    false,
  );
  expect(
    readTaskRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toEqual([]);
});
it("does not send a mutation when the recovery reference cannot be stored", async () => {
  const { call, ref } = setup(false, task, true, true);
  await screen.findByRole("heading", { name: initial.title });
  await act(async () => {
    await ref.current!.act({
      kind: "task_action",
      action: "accept",
      reason: "Relecture",
    });
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("denied");
  });
  await act(async () => {
    await ref.current!.act({ kind: "task_confirm" });
  });
  expect(call.mock.calls.some(([op]) => op === "tasks.command")).toBe(false);
  expect(screen.getByText(/Aucun envoi effectué/)).toBeDefined();
});
