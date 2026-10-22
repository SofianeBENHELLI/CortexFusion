import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  WorkActivity,
  validateActivity,
  type WorkActivityActions,
} from "./WorkActivity";
import { ApiError, type CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
import type { ActivityIntent } from "./activityCommands";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const domain = id(1),
  date = "2026-10-17T12:00:00Z";
function page(): any {
  return {
    items: [
      {
        kind: "mission",
        event_id: id(2),
        target_id: id(3),
        title: "Rapport du délai",
        current_status: "completed",
        current_revision: 4,
        action: "complete",
        actor: "service",
        event_revision: 4,
        created_at: date,
        read_at: null,
        content_available: true,
      },
      {
        kind: "reference_review",
        event_id: id(4),
        target_id: id(5),
        title: null,
        current_status: "withdrawn",
        current_revision: 2,
        action: "submit",
        actor: null,
        event_revision: 1,
        created_at: date,
        read_at: null,
        content_available: false,
      },
      {
        kind: "task",
        event_id: id(6),
        target_id: id(7),
        title: "Relire le délai",
        current_status: "offered",
        current_revision: 2,
        action: "offer",
        actor: "alice",
        event_revision: 2,
        created_at: date,
        read_at: null,
        content_available: true,
      },
    ],
    next_after: null,
    total: 3,
    unread: 3,
    as_of: date,
    permissions_version: 1,
    work_version: 4,
    source_access_version: 1,
    scope: "personal",
    sort: "created_kind_event_desc",
    coverage: [
      "task_notifications",
      "named_reference_reviews",
      "mission_claims_and_reports",
      "named_shared_cases",
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const state = {
    page: page(),
    denied: false,
    subject: "alice",
    error: undefined as unknown,
    listError: undefined as unknown,
    receiptBad: false,
  };
  const call = vi.fn(async (op: string, p: any, b: any) => {
    if (op === "identity.read")
      return {
        tenant_id: domain,
        subject: state.subject,
        domains: [
          { id: domain, capabilities: state.denied ? [] : ["work_activity"] },
        ],
      };
    if (op === "work_activity.list") {
      if (state.listError) throw state.listError;
      return structuredClone(state.page);
    }
    if (op === "work_activity.read") {
      if (state.error) throw state.error;
      return {
        kind: b.kind,
        event_id: state.receiptBad ? id(99) : p.event,
        read_at: date,
      };
    }
    throw Error(`Unexpected operation ${op}`);
  });
  const ref = createRef<WorkActivityActions>(),
    onOpen = vi.fn(async () => "Objet ouvert"),
    onNotice = vi.fn();
  const view = render(
    <WorkActivity
      ref={ref}
      api={{ call } as unknown as CortexApi}
      domain={domain}
      scope={{ tenant: domain, subject: "alice" }}
      onOpen={onOpen}
      onNotice={onNotice}
    />,
  );
  const run = async (intent: ActivityIntent) => {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(intent);
    });
    return result;
  };
  const posts = () =>
    call.mock.calls.filter(([op]) => op === "work_activity.read");
  return { state, call, run, posts, onOpen, view };
}
it("opens from buttons and chat without marking read or accepting work", async () => {
  const s = setup();
  await s.run({ kind: "activity_list" });
  expect(screen.getByRole("region", { name: "Événements personnels" })).toBe(
    document.activeElement,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Ouvrir l’événement 1" }),
    );
  });
  await s.run({ kind: "activity_open", value: "3" });
  expect(s.onOpen.mock.calls.map(([n]: any) => n.kind)).toEqual([
    "mission",
    "task",
  ]);
  expect(s.posts()).toHaveLength(0);
  expect(screen.getByText(/contenu indisponible/)).toBeTruthy();
});
it("marks only the selected personal event, then refreshes explicitly", async () => {
  const s = setup();
  await s.run({ kind: "activity_list" });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer l’événement 3 comme lu" }),
    );
  });
  expect(s.posts()).toHaveLength(1);
  expect(s.posts()[0][1]).toEqual({ domain, event: id(6) });
  expect(s.posts()[0][2]).toMatchObject({ kind: "task" });
  expect(s.onOpen).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("region", { name: "Événements personnels" }),
  ).toBeNull();
});
it("resolves a lost read response by GET with no automatic resend", async () => {
  const s = setup();
  await s.run({ kind: "activity_list" });
  s.state.error = new Error("Réponse perdue");
  await s.run({ kind: "activity_read", value: "1" });
  expect(s.posts()).toHaveLength(1);
  s.state.page.items[0].read_at = date;
  s.state.page.unread = 2;
  expect(await s.run({ kind: "activity_list" })).toContain("État relu");
  expect(s.posts()).toHaveLength(1);
  expect(
    screen.queryByRole("button", {
      name: "Reprendre le même envoi de lecture",
    }),
  ).toBeNull();
});
it("retries only the same key and target after explicit request", async () => {
  const s = setup();
  await s.run({ kind: "activity_list" });
  s.state.error = new ApiError(502, "lost");
  await s.run({ kind: "activity_read", value: "1" });
  await s.run({ kind: "activity_list" });
  expect(await s.run({ kind: "activity_read", value: "3" })).toContain(
    "Vérifiez d’abord",
  );
  expect(s.posts()).toHaveLength(1);
  s.state.error = undefined;
  await s.run({ kind: "activity_retry" });
  expect(s.posts()).toHaveLength(2);
  expect(s.posts()[1]).toEqual(s.posts()[0]);
});
it.each([401, 403, 404])(
  "hides the previous page after access error %s",
  async (code) => {
    const s = setup();
    await s.run({ kind: "activity_list" });
    s.state.listError = new ApiError(code, "denied");
    await s.run({ kind: "activity_list" });
    expect(screen.queryByText("Rapport du délai")).toBeNull();
    expect(s.posts()).toHaveLength(0);
  },
);
it.each(["role", "identity"])(
  "checks fresh %s before a read marker",
  async (kind) => {
    const s = setup();
    await s.run({ kind: "activity_list" });
    if (kind === "role") s.state.denied = true;
    else s.state.subject = "bob";
    await s.run({ kind: "activity_read", value: "1" });
    expect(s.posts()).toHaveLength(0);
    expect(screen.queryByText("Rapport du délai")).toBeNull();
  },
);
it("keeps a malformed success uncertain instead of claiming read", async () => {
  const s = setup();
  await s.run({ kind: "activity_list" });
  s.state.receiptBad = true;
  await s.run({ kind: "activity_read", value: "1" });
  expect(
    screen.getByRole("button", { name: "Reprendre le même envoi de lecture" }),
  ).toBeTruthy();
});
it("restarts a stale cursor explicitly without replaying a mutation", async () => {
  const s = setup();
  s.state.page.next_after = id(90);
  await s.run({ kind: "activity_list" });
  s.state.listError = new ApiError(409, "stale");
  expect(await s.run({ kind: "activity_list", next: true })).toContain(
    "Actualisez",
  );
  s.state.listError = undefined;
  await s.run({ kind: "activity_list" });
  const calls = s.call.mock.calls.filter(([op]) => op === "work_activity.list");
  expect(calls).toHaveLength(3);
  expect(s.posts()).toHaveLength(0);
});
it.each([
  (p: any) => (p.items[0].report = "private payload"),
  (p: any) => (p.items[1].title = "withdrawn content"),
  (p: any) => (p.items[0].event_revision = 5),
  (p: any) => p.items.push(p.items[0]),
  (p: any) => (p.unread = 4),
  (p: any) => (p.items[0].action = "read_source"),
])("rejects inconsistent or overexposed activity responses", (change) => {
  const p = page();
  change(p);
  expect(() => validateActivity(p)).toThrow();
});
it.each([
  ["Montre ma boîte de réception", { kind: "activity_list" }],
  ["Activité suivante", { kind: "activity_list", next: true }],
  ["Ouvre l’événement : 2", { kind: "activity_open", value: "2" }],
  ["Marque l’événement comme lu : 2", { kind: "activity_read", value: "2" }],
  ["Vérifie la lecture de l’événement", { kind: "activity_list" }],
  ["Reprends la même lecture d’événement", { kind: "activity_retry" }],
])(
  "routes the explicit command %s without asking the corpus",
  (input, intent) => expect(chatIntent(input as string)).toEqual(intent),
);

it("opens a named shared case with no actor or automatic read marker", async () => {
  const s = setup();
  s.state.page.items = [
    {
      ...s.state.page.items[0],
      kind: "shared_case",
      current_status: "qualified",
      action: "qualify",
      actor: null,
      title: "Délai partagé",
    },
  ];
  s.state.page.total = s.state.page.unread = 1;
  await s.run({ kind: "activity_list" });
  await s.run({ kind: "activity_open", value: "1" });
  expect(s.onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "shared_case", actor: null }),
  );
  expect(s.posts()).toHaveLength(0);
});
it("accepts only the masked tombstone of a withdrawn shared case", () => {
  const p = page();
  p.items = [
    {
      ...p.items[0],
      kind: "shared_case",
      current_status: "withdrawn",
      action: "withdraw",
      title: null,
      actor: null,
      content_available: false,
    },
  ];
  p.total = p.unread = 1;
  expect(validateActivity(p)).toBe(p);
  p.items[0].title = "Removed excerpt title";
  expect(() => validateActivity(p)).toThrow();
});
it.each(["actor", "personal_signal_id", "excerpt"])(
  "rejects shared-case metadata with unexpected %s",
  (key) => {
    const p = page();
    p.items = [
      {
        ...p.items[0],
        kind: "shared_case",
        current_status: "qualified",
        action: "qualify",
        actor: null,
      },
    ];
    p.total = p.unread = 1;
    p.items[0][key] = "Private";
    expect(() => validateActivity(p)).toThrow();
  },
);
