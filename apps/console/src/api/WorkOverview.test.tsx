import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import {
  WorkOverview,
  validateOverview,
  type OverviewSection,
} from "./WorkOverview";
import { CortexApi, ApiError } from "./client";
import type { WorkOverview as Overview } from "../../../../packages/contracts/src/WorkOverview";
const id = "00000000-0000-0000-0000-000000000001";
const at = "2026-10-16T23:00:00Z";
function fixture(role: Overview["role"] = "corpus_manager"): Overview {
  const coordinate = ["owner", "corpus_manager"].includes(role);
  const group = {
    total: 1,
    has_more: false,
    sort: "created_at_asc_id_asc",
    items: [
      { id, title: "Dossier synthétique", status: "new", created_at: at },
    ],
  };
  return {
    role,
    scope: "assigned",
    as_of: at,
    permissions_version: 1,
    work_version: 2,
    coverage: "authorized_active_work_only",
    tasks:
      role === "viewer"
        ? null
        : {
            role,
            scope: "assigned",
            as_of: at,
            permissions_version: 1,
            work_version: 2,
            coverage: "active_tasks_only",
            sort: "overdue_review_offer_blocked_unassigned_progress_due_created_id",
            counts: {
              active: 0,
              overdue: 0,
              review: 0,
              blocked: 0,
              offered: 0,
              unassigned: 0,
              in_progress: 0,
            },
            items: [],
            has_more: false,
          },
    my_missions: coordinate
      ? {
          total: 0,
          waiting: 0,
          claimed: 0,
          expired: 0,
          reports: 0,
          withheld: 0,
          items: [],
          has_more: false,
          sort: "expired_report_created_id",
        }
      : null,
    received_cases: coordinate ? group : null,
    my_cases: group,
    received_reference_reviews: coordinate
      ? { total: 0, items: [], has_more: false, sort: "created_at_asc_id_asc" }
      : null,
    my_reference_reviews:
      role !== "viewer"
        ? {
            total: 0,
            items: [],
            has_more: false,
            sort: "created_at_asc_id_asc",
          }
        : null,
    imports: coordinate
      ? {
          total: 1,
          pending_jobs: 1,
          failed_jobs: 1,
          has_more: false,
          sort: "failed_first_created_at_asc_id_asc",
          items: [
            {
              id,
              collection_id: id,
              collection_name: "Collection synthétique",
              pending: 1,
              failed: 1,
              created_at: at,
            },
          ],
        }
      : null,
  } as Overview;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(value = fixture(), section: OverviewSection = "received") {
  const api = new CortexApi(() => null),
    call = vi.spyOn(api, "call").mockResolvedValue(value as never);
  const callbacks = {
    onScope: vi.fn(),
    onSection: vi.fn(),
    onTask: vi.fn(),
    onAllTasks: vi.fn(),
    onCase: vi.fn(),
    onAllCases: vi.fn(),
    onImport: vi.fn(),
    onAllImports: vi.fn(),
    onReview: vi.fn(),
    onAllReviews: vi.fn(),
    onMission: vi.fn(),
    onAllMissions: vi.fn(),
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <React.StrictMode>
      <QueryClientProvider client={cache}>
        <WorkOverview
          api={api}
          domain={id}
          scope="assigned"
          coordinate={value.role === "corpus_manager"}
          section={section}
          refresh={0}
          {...callbacks}
        />
      </QueryClientProvider>
    </React.StrictMode>,
  );
  return { call, ...callbacks };
}
it("opens named cases read-only, with complete denominator and explicit ordering", async () => {
  const { call, onCase, onAllCases, onSection } = setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir le dossier : Dossier synthétique",
    }),
  );
  expect(onCase).toHaveBeenCalledWith(id);
  expect(screen.getByText(/1 dossiers présentés sur 1 ouverts/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Voir tous les dossiers reçus" }),
  );
  expect(onAllCases).toHaveBeenCalledWith("team");
  fireEvent.click(screen.getByRole("button", { name: "Mes imports · 1" }));
  expect(onSection).toHaveBeenCalledWith("imports");
  expect(
    call.mock.calls.every(
      (c) => c[0] === "work_overview.read" && c[2] === undefined,
    ),
  ).toBe(true);
});
it("offers viewer follow-up only without invented task/import zero counts", async () => {
  setup(fixture("viewer"), "tasks");
  expect(
    await screen.findByRole("heading", { name: "Suivi de vos partages" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Tâches ·/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Mes imports ·/ })).toBeNull();
  expect(
    screen.getByText(/ne vous affecte pas automatiquement une tâche/),
  ).toBeTruthy();
});
it("explains overlapping pending/failed jobs and opens the exact import", async () => {
  const { onImport, onAllImports } = setup(fixture(), "imports");
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir l’import : Collection synthétique",
    }),
  );
  expect(onImport).toHaveBeenCalledWith(id);
  expect(
    screen.getByText(/Un import peut être compté dans les deux catégories/),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Voir tous mes imports" }),
  );
  expect(onAllImports).toHaveBeenCalled();
});
it("clears all prior labels during a failed rights reread, then allows recovery", async () => {
  const { call } = setup();
  await screen.findByText("Dossier synthétique");
  call.mockRejectedValueOnce(new ApiError(403, "NOT_AUTHORIZED"));
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Dossier synthétique")).toBeNull();
  expect(screen.queryByRole("button", { name: /Mes imports ·/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await screen.findByText("Dossier synthétique");
});
it("starts in the personal task scope instead of broadening coordinator access", async () => {
  const { call } = setup(fixture(), "tasks");
  await screen.findByText(/Aucune tâche active/);
  expect(call.mock.calls[0][3]?.query).toEqual({ scope: "assigned" });
});
it("rejects inconsistent role permissions, totals, timestamps and metadata", () => {
  const good = fixture();
  expect(validateOverview(good, "assigned")).toBe(good);
  const changes = [
    { my_cases: null },
    { role: "viewer" },
    { scope: "domain" },
    { coverage: "all_work" },
    { imports: { ...good.imports, pending_jobs: 2 } },
    { received_cases: { ...good.received_cases, total: 2 } },
    { tasks: { ...good.tasks, as_of: "2026-10-16T22:00:00Z" } },
    {
      my_cases: {
        ...good.my_cases,
        items: [{ ...good.my_cases.items[0], status: "withdrawn" }],
      },
    },
    {
      imports: {
        ...good.imports,
        items: [{ ...good.imports!.items[0], pending: 0, failed: 0 }],
      },
    },
  ];
  for (const change of changes)
    expect(() =>
      validateOverview({ ...good, ...change } as Overview, "assigned"),
    ).toThrow(ApiError);
});
it("does not count missing capabilities as zero for contributor", async () => {
  setup(fixture("contributor"), "received");
  await waitFor(() =>
    expect(screen.getByText(/Aucune tâche active/)).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: /Dossiers reçus ·/ })).toBeNull();
});

function reviewGroup(
  status:
    | "awaiting_review"
    | "changes_requested"
    | "ready_for_owner" = "awaiting_review",
): NonNullable<Overview["my_reference_reviews"]> {
  return {
    total: 1,
    has_more: false,
    sort: "created_at_asc_id_asc" as const,
    items: [
      {
        id,
        question: "Combien de jours ?",
        author: "reader",
        reviewer: "alice",
        status,
        revision: 1,
        created_at: at,
        updated_at: at,
      },
    ],
  };
}
it("opens a named pending review read-only with its exact count and next action", async () => {
  const data = fixture();
  data.received_reference_reviews = reviewGroup();
  const { onReview, onAllReviews, call } = setup(data, "reviews");
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir la revue : Combien de jours ?",
    }),
  );
  expect(onReview).toHaveBeenCalledWith(id);
  expect(
    screen.getByText(/1 revues présentées sur 1 avis attendus autorisés/),
  ).toBeTruthy();
  expect(
    screen.getByText("Lire la copie et préparer un avis motivé."),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Voir l’historique des revues reçues" }),
  );
  expect(onAllReviews).toHaveBeenCalledWith("assigned");
  expect(call.mock.calls.every((c) => c[0] === "work_overview.read")).toBe(
    true,
  );
});
it.each(["changes_requested", "ready_for_owner"] as const)(
  "keeps author follow-up separate from pending opinions: %s",
  async (status) => {
    const data = fixture("contributor");
    data.my_reference_reviews = reviewGroup(status);
    const { onAllReviews } = setup(data, "sentReviews");
    await screen.findByRole("button", {
      name: "Ouvrir la revue : Combien de jours ?",
    });
    expect(
      screen.queryByRole("button", { name: /Références à relire ·/ }),
    ).toBeNull();
    expect(
      screen.getByText(/Un avis favorable ne publie ni n’approuve/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Voir l’historique des revues envoyées",
      }),
    );
    expect(onAllReviews).toHaveBeenCalledWith("mine");
  },
);
it("rejects a completed recipient queue, withdrawn content and future review metadata", () => {
  const good = fixture();
  good.received_reference_reviews = reviewGroup();
  expect(validateOverview(good, "assigned")).toBe(good);
  for (const change of [
    { status: "ready_for_owner" },
    { status: "withdrawn" },
    { revision: 0 },
    { updated_at: "2099-01-01T00:00:00Z" },
    { author: "alice" },
  ]) {
    const bad = structuredClone(good);
    Object.assign(bad.received_reference_reviews!.items[0]!, change);
    expect(() => validateOverview(bad, "assigned")).toThrow();
  }
  const missing = structuredClone(good);
  delete (missing as any).my_reference_reviews;
  expect(() => validateOverview(missing, "assigned")).toThrow();
});
it("masks a formerly visible question when the overview reread loses rights", async () => {
  const data = fixture();
  data.received_reference_reviews = reviewGroup();
  const { call } = setup(data, "reviews");
  await screen.findByText("Combien de jours ?");
  call.mockRejectedValueOnce(new ApiError(403, "NOT_AUTHORIZED"));
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Combien de jours ?")).toBeNull();
});

it("shows available review work on entry when there are no tasks, while preserving an explicit task choice", async () => {
  const data = fixture();
  data.received_cases = {
    ...data.received_cases!,
    total: 0,
    items: [],
    has_more: false,
  };
  data.received_reference_reviews = reviewGroup();
  setup(data, "auto");
  await screen.findByRole("heading", { name: "Vos avis à préparer" });
  cleanup();
  setup(data, "tasks");
  await screen.findByText(/Aucune tâche active/);
  expect(
    screen.queryByRole("heading", { name: "Vos avis à préparer" }),
  ).toBeNull();
});

function missionFixture(): Overview {
  const value = fixture();
  value.my_missions = {
    total: 1,
    waiting: 0,
    claimed: 0,
    expired: 0,
    reports: 1,
    withheld: 0,
    has_more: false,
    sort: "expired_report_created_id",
    items: [
      {
        id,
        title: "Rapport de lecture synthétique",
        status: "completed",
        revision: 4,
        created_at: at,
        expires_at: "2026-10-17T00:00:00Z",
        expired: false,
        content_available: true,
        reads_used: 1,
        chars_used: 24,
        max_reads: 3,
        max_chars: 100,
      },
    ],
  };
  return value;
}
it("opens an accessible mission from the brief without approving its candidate report", async () => {
  const value = missionFixture();
  const { onMission, onAllMissions } = setup(value, "missions");
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir la mission : Rapport de lecture synthétique",
    }),
  );
  expect(onMission).toHaveBeenCalledWith(id, false);
  expect(screen.getByText(/ni approuvé ni nécessairement non lu/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Voir tous mes contrôles de mission" }),
  );
  expect(onAllMissions).toHaveBeenCalledOnce();
});
it("routes a withheld mission to its content-free control only", async () => {
  const value = missionFixture();
  value.my_missions!.withheld = 1;
  value.my_missions!.items[0]!.content_available = false;
  value.my_missions!.items[0]!.title = null;
  const { onMission } = setup(value, "missions");
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Ouvrir le contrôle sans contenu/,
    }),
  );
  expect(onMission).toHaveBeenCalledWith(id, true);
  expect(screen.queryByText("Rapport de lecture synthétique")).toBeNull();
});
it("rejects a withheld title or an extra source/report field", () => {
  const value = missionFixture();
  value.my_missions!.items[0]!.content_available = false;
  expect(() => validateOverview(value, "assigned")).toThrow();
  value.my_missions!.items[0]!.title = null;
  value.my_missions!.withheld = 1;
  expect(() => validateOverview(value, "assigned")).not.toThrow();
  Object.assign(value.my_missions!.items[0]!, { report: "private" });
  expect(() => validateOverview(value, "assigned")).toThrow();
});
it("rejects inconsistent mission counts, budgets and snapshot expiry", () => {
  for (const mutate of [
    (g: NonNullable<Overview["my_missions"]>) => {
      g.total = 2;
    },
    (g: NonNullable<Overview["my_missions"]>) => {
      g.items[0]!.chars_used = 101;
    },
    (g: NonNullable<Overview["my_missions"]>) => {
      g.items[0]!.expired = true;
    },
    (g: NonNullable<Overview["my_missions"]>) => {
      g.reports = 0;
    },
  ]) {
    const value = missionFixture();
    mutate(value.my_missions!);
    expect(() => validateOverview(value, "assigned")).toThrow();
  }
});
it("does not convert unavailable mission access into a visible zero for contributors", async () => {
  setup(fixture("contributor"), "missions");
  await screen.findByRole("button", { name: "Mes partages à suivre · 1" });
  expect(
    screen.queryByRole("button", { name: /Mes missions à suivre/ }),
  ).toBeNull();
  const value = missionFixture();
  value.my_missions = null;
  expect(() => validateOverview(value, "assigned")).toThrow();
});
it("hides old mission titles during a failed refresh", async () => {
  const { call } = setup(missionFixture(), "missions");
  await screen.findByRole("button", {
    name: "Ouvrir la mission : Rapport de lecture synthétique",
  });
  call.mockRejectedValueOnce(new Error("revoked"));
  fireEvent.click(screen.getByRole("button", { name: "Actualiser le brief" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Rapport de lecture synthétique")).toBeNull();
});
