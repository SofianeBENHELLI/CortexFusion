import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiBrainWorkspace } from "./ApiBrainWorkspace";
import { ApiError, CortexApi } from "../api/client";
import { graphFixture, summaryFixture } from "./api-graph.fixture";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(["button", "escape"])(
  "returns focus to the exact source trigger after closing evidence with %s",
  async (method) => {
    const concept: Concept = {
      concept_id: id(2),
      title: "Repère",
      body: "A🧠B",
      sources: [{ source_id: id(3), start: 0, end: 3 }],
      links: [],
    };
    const call = vi.fn(
      async (
        op: string,
        _path: unknown,
        _body: unknown,
        options: { query?: Record<string, unknown> },
      ) => {
        if (op === "domain.version")
          return {
            domain_id: id(1),
            accepted_version: 1,
            published_version: 1,
          };
        if (op === "graph.window")
          return graphFixture(id(1), [concept], options.query);
        if (op === "concepts.read") return concept;
        if (op === "sources.passage")
          return {
            source_id: id(3),
            start: 0,
            end: 3,
            total_characters: 3,
            next_offset: null,
            offset_unit: "unicode_code_point",
            title: "Preuve",
            location: "synthetic://proof",
            excerpt: "A🧠B",
            content_hash: "a".repeat(64),
          };
        throw new Error(op);
      },
    );
    render(
      <MemoryRouter
        initialEntries={[`/?level=concepts&group=${id(2)}&node=${id(2)}`]}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ApiBrainWorkspace
            api={{ call } as unknown as CortexApi}
            domain={id(1)}
            name="Test"
            owner={false}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const trigger = await screen.findByRole("button", {
      name: "Consulter la source",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const panel = screen.getByRole("region", { name: "Preuves du cerveau" });
    expect(document.activeElement).toBe(panel);
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(panel);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Lire la preuve" }),
    );
    await within(panel).findByText("A🧠B");
    const close = within(panel).getByRole("button", {
      name: "Fermer les preuves",
    });
    close.focus();
    if (method === "escape") fireEvent.keyDown(close, { key: "Escape" });
    else fireEvent.click(close);
    expect(
      screen.queryByRole("region", { name: "Preuves du cerveau" }),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Preuves du cerveau" }),
    );
  },
);
it("extends bounded coverage through the URL and can recover from a read-budget failure by reducing depth", async () => {
  let rejected = false;
  const call = vi.fn(
    async (
      op: string,
      _p: unknown,
      _b: unknown,
      options: { query?: Record<string, unknown> },
    ) => {
      if (op === "domain.version")
        return { domain_id: id(1), accepted_version: 4, published_version: 4 };
      if (op === "graph.window")
        return graphFixture(id(1), [], options.query, 4);
      if (op === "publications.list") {
        if (rejected && options.query?.before)
          throw new ApiError(0, "read_limit");
        return {
          domain_id: id(1),
          at_version: 4,
          since: options.query?.since ?? null,
          until: options.query?.until ?? null,
          items: [],
          next_before: options.query?.before ? null : 3,
          scan_limited: !options.query?.before,
        };
      }
      throw new Error(op);
    },
  );
  function Location() {
    return (
      <output data-testid="history-location">{useLocation().search}</output>
    );
  }
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiBrainWorkspace
          api={{ call } as unknown as CortexApi}
          domain={id(1)}
          name="Test"
          owner
        />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText(/Comptage partiel/);
  fireEvent.change(
    screen.getByRole("combobox", { name: "Profondeur du journal" }),
    { target: { value: "5" } },
  );
  await screen.findByText(/Période accessible entièrement parcourue/);
  expect(screen.getByTestId("history-location").textContent).toContain(
    "history_pages=5",
  );
  expect(
    screen
      .getByRole("button", { name: "Publications plus anciennes" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(
    screen.getByRole("combobox", { name: "Profondeur du journal" }),
    { target: { value: "1" } },
  );
  await screen.findByText(/Comptage partiel/);
  rejected = true;
  fireEvent.change(
    screen.getByRole("combobox", { name: "Profondeur du journal" }),
    { target: { value: "5" } },
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "budget de données",
  );
  expect(
    screen.queryByRole("region", { name: "BrainMap et Chronique" }),
  ).toBeNull();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Profondeur du journal" }),
    { target: { value: "1" } },
  );
  await screen.findByText(/Comptage partiel/);
  expect(screen.getByTestId("history-location").textContent).not.toContain(
    "history_pages",
  );
});
it("recovers a vanished focus on refresh, clears its URL and never retains its detail", async () => {
  let retired = false;
  const focus: Concept = {
    concept_id: id(2),
    title: "Ancien repère",
    body: "Old proof",
    sources: [{ source_id: id(3), start: 0, end: 5 }],
    links: [],
  };
  const call = vi.fn(
    async (
      op: string,
      _path: unknown,
      _body: unknown,
      opts: { query?: Record<string, unknown> },
    ) => {
      if (op === "domain.version")
        return { domain_id: id(1), accepted_version: 1, published_version: 1 };
      if (op === "graph.window")
        return graphFixture(id(1), retired ? [] : [focus], opts.query);
      if (op === "concepts.read") return focus;
      throw new Error(op);
    },
  );
  function Location() {
    return <output data-testid="location">{useLocation().search}</output>;
  }
  render(
    <MemoryRouter
      initialEntries={[`/?level=concepts&group=${id(2)}&node=${id(2)}`]}
    >
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiBrainWorkspace
          api={{ call } as unknown as CortexApi}
          domain={id(1)}
          name="Test"
          owner={false}
        />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText("Old proof");
  retired = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser le cerveau" }),
  );
  await screen.findByText(/Le voisinage sélectionné n’est plus disponible/);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Old proof")).toBeNull();
  expect(
    screen.getByText("Aucun concept publié dans ce périmètre."),
  ).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("?level=groups");
  expect(call.mock.calls.filter(([op]) => op === "concepts.read")).toHaveLength(
    1,
  );
});
it("pages the graph, finds an off-page focus and keeps current neighbors distinct from historical traces", async () => {
  const concepts: Concept[] = Array.from({ length: 30 }, (_, i) => ({
    concept_id: id(i + 10),
    title: `Repère ${String(i).padStart(2, "0")}`,
    body: `Preuve ${i}`,
    sources: [{ source_id: id(99), start: 0, end: 5 }],
    links: [],
  }));
  const focus = concepts[29];
  focus.links = concepts.slice(0, 29).map((c) => ({
    target_id: c.concept_id,
    kind: "associative",
    weight: 0.5,
  }));
  let revoked = false;
  const call = vi.fn(
    async (
      op: string,
      path: Record<string, string>,
      _body: unknown,
      opts: { query?: Record<string, unknown> },
    ) => {
      if (op === "domain.version")
        return { domain_id: id(1), accepted_version: 1, published_version: 1 };
      if (op === "graph.window") {
        if (revoked) throw new ApiError(409, "projection_changed");
        return graphFixture(id(1), concepts, opts.query);
      }
      if (op === "concepts.read")
        return concepts.find((c) => c.concept_id === path.concept_id);
      if (op === "publications.list")
        return {
          domain_id: id(1),
          at_version: 1,
          since: opts.query?.since ?? null,
          until: opts.query?.until ?? null,
          next_before: null,
          scan_limited: false,
          items: [
            {
              sequence: 1,
              proposal_id: id(100),
              author: "owner",
              reason: "Review",
              digest: "a".repeat(64),
              created_at: "2026-10-02T10:00:00Z",
              published: true,
              publication: {
                publisher: "owner",
                recorded_at: "2026-10-02T11:00:00Z",
              },
            },
          ],
        };
      if (op === "proposals.diff_summary")
        return summaryFixture({
          proposal_id: id(100),
          comparison: "accepted_before_state",
          stale_base: false,
          base_version: 0,
          published_version: 1,
          items: concepts.map((c) => ({
            concept_id: c.concept_id,
            before: null,
            after: c,
          })),
        });
      throw new Error(op);
    },
  );
  render(
    <MemoryRouter initialEntries={["/?level=groups"]}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiBrainWorkspace
          api={{ call } as unknown as CortexApi}
          domain={id(1)}
          name="Test"
          owner
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText("24 concepts chargés sur 30 dans ce périmètre.");
  const stock = () =>
    within(screen.getByRole("group", { name: "Indicateurs du périmètre" }))
      .getByText("Concepts publiés")
      .parentElement?.querySelector("strong")?.textContent;
  expect(stock()).toBe("30");
  fireEvent.click(screen.getByRole("button", { name: "Concepts suivants" }));
  await screen.findByRole("button", { name: "Explorer Repère 29" });
  expect(stock()).toBe("30");
  fireEvent.click(screen.getByRole("button", { name: "Concepts précédents" }));
  await screen.findByText("24 concepts chargés sur 30 dans ce périmètre.");
  expect(
    screen.queryByRole("button", { name: "Explorer Repère 29" }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Repère 29" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Repère 29 Concept" }),
  );
  expect(
    (await screen.findByRole("region", { name: "Détail sélectionné" }))
      .textContent,
  ).toContain("Preuve 29");
  expect(screen.getByText("59 événements")).toBeTruthy();
  expect(screen.queryByText("Trace historique")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fermer le détail" }));
  await screen.findByRole("button", { name: "Consulter Repère 29" });
  fireEvent.click(
    screen.getByRole("button", { name: "Page suivante de la carte" }),
  );
  expect(
    screen.getByRole("button", { name: "Consulter Repère 29" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Concepts suivants" }));
  await screen.findByText(/7 concepts chargés sur 30/);
  expect(
    screen.getByRole("button", { name: "Consulter Repère 29" }),
  ).toBeTruthy();
  expect(screen.queryByText("Trace historique")).toBeNull();
  expect(call.mock.calls.filter(([op]) => op === "concepts.read")).toHaveLength(
    1,
  );
  expect(call.mock.calls.some(([op]) => op === "concepts.list")).toBe(false);
  revoked = true;
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Repère 00" },
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Les données ont changé",
  );
  expect(
    screen.queryByRole("region", { name: "BrainMap et Chronique" }),
  ).toBeNull();
});
it("updates the shared version from the verified read without treating approval as publication", async () => {
  let accepted = 1;
  const api = {
    call: vi.fn(
      async (
        op: string,
        _p: unknown,
        _b: unknown,
        opts: { query?: Record<string, unknown> },
      ) =>
        op === "domain.version"
          ? {
              domain_id: id(1),
              accepted_version: accepted,
              published_version: 1,
            }
          : op === "graph.window"
            ? graphFixture(id(1), [], opts.query)
            : Promise.reject(new Error(op)),
    ),
  } as unknown as CortexApi;
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <ApiBrainWorkspace api={api} domain={id(1)} name="Test" owner={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "BrainMap & Chronique" });
  accepted = 2;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser le cerveau" }),
  );
  await waitFor(() =>
    expect(cache.getQueryData(["api", "version", id(1)])).toEqual({
      domain_id: id(1),
      accepted_version: 2,
      published_version: 1,
    }),
  );
  expect(screen.getByText("Test · savoir publié v1")).toBeTruthy();
  expect(screen.queryByText(/savoir publié v2/)).toBeNull();
});
it("hides previously loaded knowledge after a denied refresh and exposes no mock fallback", async () => {
  let denied = false;
  const call = vi.fn(
    async (
      op: string,
      _p: unknown,
      _b: unknown,
      opts: { query?: Record<string, unknown> },
    ) => {
      if (denied) throw new ApiError(403, "denied");
      if (op === "domain.version")
        return { domain_id: id(1), accepted_version: 1, published_version: 1 };
      if (op === "graph.window")
        return graphFixture(
          id(1),
          [
            {
              concept_id: id(2),
              title: "Private Alpha",
              body: "Private knowledge",
              sources: [{ source_id: id(3), start: 0, end: 5 }],
              links: [],
            },
          ],
          opts.query,
        );
      throw new Error(op);
    },
  );
  const api = { call } as unknown as CortexApi;
  render(
    <MemoryRouter initialEntries={["/?level=groups"]}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiBrainWorkspace api={api} domain={id(1)} name="Test" owner={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Explorer Private Alpha" });
  expect(screen.getByText("Indisponible")).toBeTruthy();
  expect(screen.queryByText("0 événements")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Changements" })
      .hasAttribute("disabled"),
  ).toBe(true);
  denied = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser le cerveau" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Votre rôle",
  );
  await waitFor(() => expect(screen.queryByText("Private Alpha")).toBeNull());
  expect(screen.queryByText("SIMULIA")).toBeNull();
});
it("pages backward and forward within one version, resets on period changes and refreshes after a concurrent publication", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-02T18:00:00Z"));
  let version = 3;
  const api = {
    call: vi.fn(
      async (
        op: string,
        _path: unknown,
        _body: unknown,
        opts: { query?: Record<string, unknown> },
      ) => {
        if (op === "domain.version")
          return {
            domain_id: id(1),
            accepted_version: version,
            published_version: version,
          };
        if (op === "graph.window")
          return graphFixture(id(1), [], opts.query, version);
        if (op === "publications.list")
          return {
            domain_id: id(1),
            at_version: version,
            since: opts.query?.since ?? null,
            until: opts.query?.until ?? null,
            items: [],
            next_before: opts.query?.before ? null : 2,
            scan_limited: false,
          };
        throw new Error(op);
      },
    ),
  } as unknown as CortexApi;
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiBrainWorkspace api={api} domain={id(1)} name="Test" owner />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const pages = () =>
    screen.getByRole("navigation", { name: "Pages du journal publié" });
  await screen.findByRole("button", { name: "Publications plus anciennes" });
  fireEvent.click(
    screen.getByRole("button", { name: "Publications plus anciennes" }),
  );
  await waitFor(() => expect(pages().textContent).toContain("Page 2"));
  expect(
    screen
      .getByRole("button", { name: "Publications plus anciennes" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Publications plus récentes" }),
  );
  await waitFor(() => expect(pages().textContent).toContain("Page 1"));
  fireEvent.click(
    screen.getByRole("button", { name: "Publications plus anciennes" }),
  );
  await waitFor(() => expect(pages().textContent).toContain("Page 2"));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Période des événements" }),
    { target: { value: "7" } },
  );
  await waitFor(() => expect(pages().textContent).toContain("Page 1"));
  version = 4;
  fireEvent.click(
    screen.getByRole("button", { name: "Publications plus anciennes" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Les données ont changé",
  );
  expect(
    screen.queryByRole("heading", { name: "BrainMap & Chronique" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser le cerveau" }),
  );
  await waitFor(() => expect(pages().textContent).toContain("Page 1"));
  expect(screen.getByText("Test · savoir publié v4")).toBeTruthy();
});
