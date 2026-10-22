import React from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiConnection } from "./ApiConnection";
import { graphFixture } from "../brain/api-graph.fixture";
vi.mock("../brain/SpatialCanvas", () => ({
  SpatialCanvas: () => <div>Carte spatiale</div>,
}));
const id = "00000000-0000-0000-0000-000000000001";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
function Navigation() {
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{useLocation().search}</output>
      <button onClick={() => navigate(-1)}>Retour de recette</button>
    </>
  );
}
function mount(entry = "/") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <ApiConnection />
        <Navigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
function connect() {
  fireEvent.change(screen.getByLabelText("Identifiant du tenant"), {
    target: { value: id },
  });
  fireEvent.change(screen.getByLabelText("Jeton d’accès Open BrAIn"), {
    target: { value: "synthetic-test-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
}
it("opens the chosen authorized entry in chat and masks all cards after an access refresh fails", async () => {
  let denied = false;
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, "http://fixture.test");
    if (url.pathname.endsWith("/me"))
      return denied
        ? new Response(null, { status: 503 })
        : Response.json({
            subject: "reader",
            tenant_id: id,
            domains: [
              { id, name: "Procédures", role: "viewer", capabilities: [] },
            ],
          });
    if (url.pathname.endsWith("/version"))
      return Response.json({
        domain_id: id,
        accepted_version: 1,
        published_version: 1,
      });
    if (url.pathname.endsWith("/conversations"))
      return Response.json({ items: [] });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  const cache = mount();
  connect();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir mon espace : Procédures",
    }),
  );
  await screen.findByText("Savoir accepté : v1 · Savoir publié : v1");
  expect(screen.getByTestId("location").textContent).toContain("api_view=work");
  expect(screen.getByText("Lecteur · Mon rôle et mes actions")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Domaine"), { target: { value: "" } });
  await screen.findByRole("button", { name: "Ouvrir mon espace : Procédures" });
  denied = true;
  fireEvent.click(screen.getByRole("button", { name: "Actualiser mes accès" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "Ouvrir mon espace : Procédures" }),
  ).toBeNull();
  denied = false;
  fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
  await screen.findByRole("button", { name: "Ouvrir mon espace : Procédures" });
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  cache.clear();
});
it("notifies the current cookie boundary after its callback/session is replaced", async () => {
  let expired = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      expired
        ? new Response(null, { status: 401 })
        : Response.json({ subject: "reader", tenant_id: id, domains: [] }),
    ),
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const oldExpired = vi.fn(),
    newExpired = vi.fn();
  const tree = (onExpired: () => void) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <ApiConnection
          browserAuth={{
            session: { kind: "cookie", csrfToken: "c".repeat(43) },
            onExpired,
            onLogout: vi.fn(),
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(oldExpired));
  await screen.findByText("Connecté en tant que reader");
  rerender(tree(newExpired));
  expired = true;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["api", "identity"] });
  });
  await waitFor(() => expect(newExpired).toHaveBeenCalledOnce());
  expect(oldExpired).not.toHaveBeenCalled();
});
it("shows real identity and distinct versions, clears session and cache on disconnect", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        subject: "test-user",
        tenant_id: id,
        domains: [{ id, name: "Test", role: "viewer", capabilities: [] }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        domain_id: id,
        accepted_version: 3,
        published_version: 2,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const cache = mount();
  connect();
  await screen.findByText("Connecté en tant que test-user");
  fireEvent.change(screen.getByLabelText("Domaine"), { target: { value: id } });
  await screen.findByText("Savoir accepté : v3 · Savoir publié : v2");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() =>
    expect(cache.getQueryData(["api", "identity"])).toBeUndefined(),
  );
  expect(
    (screen.getByLabelText("Jeton d’accès Open BrAIn") as HTMLInputElement)
      .value,
  ).toBe("");
});
it("opens a domain from the overview and restores the overview with browser Back", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://fixture.test");
      if (url.pathname === "/api/v1/me")
        return Response.json({
          subject: "alice",
          tenant_id: id,
          domains: [
            { id, name: "Navigation", role: "viewer", capabilities: [] },
          ],
        });
      if (url.pathname.endsWith("/version"))
        return Response.json({
          domain_id: id,
          accepted_version: 1,
          published_version: 1,
        });
      if (url.pathname.endsWith("/graph/map"))
        return Response.json({
          domain_id: id,
          at_version: 1,
          nodes: [],
          edges: [],
          published_relations: 0,
          documentary_references: 0,
        });
      if (url.pathname.endsWith("/graph/window"))
        return Response.json(
          graphFixture(id, [], Object.fromEntries(url.searchParams)),
        );
      throw new Error(input);
    }),
  );
  mount();
  connect();
  fireEvent.click(
    await screen.findByRole("button", { name: "Vue d’ensemble BrainMap" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Explorer Navigation" }),
  );
  await screen.findByRole("region", { name: "BrainMap et Chronique" });
  const query = new URLSearchParams(
    screen.getByTestId("location").textContent!,
  );
  expect(query.get("api_domain")).toBe(id);
  expect(query.get("api_view")).toBe("brain");
  fireEvent.click(screen.getByRole("button", { name: "Retour de recette" }));
  await screen.findByRole("button", { name: "Explorer Navigation" });
  expect(screen.getByTestId("location").textContent).toBe("?api_view=overview");
});
it("refuses a deep link to a domain absent from the current identity before reading its version", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ subject: "alice", tenant_id: id, domains: [] }),
    );
  vi.stubGlobal("fetch", fetcher);
  mount(`/?api_domain=${id}&api_view=brain`);
  connect();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "n’est plus accessible",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("restores the selected conversation through BrainMap and reauthentication, and clears it for another domain", async () => {
  const other = "00000000-0000-0000-0000-000000000009";
  const conversation = "00000000-0000-0000-0000-000000000002";
  let expired = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://fixture.test");
      if (url.pathname === "/api/v1/me")
        return Response.json({
          subject: "reader",
          tenant_id: id,
          domains: [id, other].map((domain) => ({
            id: domain,
            name: domain === id ? "Premier" : "Second",
            role: "contributor",
            capabilities: [],
          })),
        });
      const domain = url.pathname.split("/")[4];
      if (url.pathname.endsWith("/version"))
        return Response.json({
          domain_id: domain,
          accepted_version: 1,
          published_version: 1,
        });
      if (url.pathname.endsWith("/messages") && expired)
        return new Response("", { status: 401 });
      if (url.pathname.endsWith("/graph/map"))
        return Response.json({
          domain_id: domain,
          at_version: 1,
          nodes: [],
          edges: [],
          published_relations: 0,
          documentary_references: 0,
        });
      if (url.pathname.endsWith("/graph/window"))
        return Response.json(
          graphFixture(domain, [], Object.fromEntries(url.searchParams)),
        );
      return Response.json({ items: [], next_after: null });
    }),
  );
  const cache = mount(
    `/?api_domain=${id}&api_view=work&api_conversation=${conversation}&time_from=2026-10-05T00%3A00%3A00Z`,
  );
  connect();
  await screen.findByRole("heading", { name: "Conversations du domaine" });
  expect(
    (
      screen.getByRole("combobox", {
        name: "Conversation",
      }) as HTMLSelectElement
    ).value,
  ).toBe(conversation);
  fireEvent.click(screen.getByRole("button", { name: "Cerveau" }));
  await screen.findByRole("region", { name: "BrainMap et Chronique" });
  expect(
    new URLSearchParams(screen.getByTestId("location").textContent!).get(
      "api_conversation",
    ),
  ).toBe(conversation);
  expired = true;
  fireEvent.click(
    screen.getByRole("button", {
      name: "Conversations et gouvernance",
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Se reconnecter à cette conversation",
    }),
  );
  await screen.findByRole("button", { name: "Se connecter" });
  expect(
    (screen.getByLabelText("Jeton d’accès Open BrAIn") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    new URLSearchParams(screen.getByTestId("location").textContent!).get(
      "api_conversation",
    ),
  ).toBe(conversation);
  expired = false;
  connect();
  await screen.findByRole("heading", { name: "Conversations du domaine" });
  expect(
    (
      screen.getByRole("combobox", {
        name: "Conversation",
      }) as HTMLSelectElement
    ).value,
  ).toBe(conversation);
  fireEvent.change(screen.getByRole("combobox", { name: "Domaine" }), {
    target: { value: other },
  });
  await waitFor(() =>
    expect(
      new URLSearchParams(screen.getByTestId("location").textContent!).get(
        "api_domain",
      ),
    ).toBe(other),
  );
  expect(
    new URLSearchParams(screen.getByTestId("location").textContent!).get(
      "api_conversation",
    ),
  ).toBeNull();
  expect(
    new URLSearchParams(screen.getByTestId("location").textContent!).get(
      "time_from",
    ),
  ).toBeNull();
  cache.clear();
});
it("normalizes the overview page when a refreshed synthetic directory has fewer domains", async () => {
  let count = 8;
  const domainId = (n: number) =>
    `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://fixture.test");
      if (url.pathname === "/api/v1/me")
        return Response.json({
          subject: "alice",
          tenant_id: id,
          domains: Array.from({ length: count }, (_, i) => ({
            id: domainId(i + 1),
            name: `Domain ${i + 1}`,
            role: "viewer",
            capabilities: [],
          })),
        });
      const domain = url.pathname.split("/")[4];
      if (url.pathname.endsWith("/version"))
        return Response.json({
          domain_id: domain,
          accepted_version: 1,
          published_version: 1,
        });
      if (url.pathname.endsWith("/graph/window"))
        return Response.json(
          graphFixture(domain, [], Object.fromEntries(url.searchParams)),
        );
      throw new Error(input);
    }),
  );
  mount("/?api_view=overview&domains_page=1");
  connect();
  await screen.findByRole("button", { name: "Explorer Domain 8" });
  count = 6;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les domaines" }),
  );
  await screen.findByRole("button", { name: "Explorer Domain 1" });
  expect(
    screen.queryByRole("button", { name: "Explorer Domain 8" }),
  ).toBeNull();
  expect(screen.getByTestId("location").textContent).toBe("?api_view=overview");
  expect(await screen.findByText("Page 1 / 1")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Explorer Domain 1" }),
  ).toBeTruthy();
});
it("displays authentication failure without mock fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 401 })),
  );
  mount();
  connect();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Session absente ou expirée",
  );
  expect(screen.queryByText("SIMULIA")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Se reconnecter" }));
  await screen.findByRole("button", { name: "Se connecter" });
  expect(
    (screen.getByLabelText("Jeton d’accès Open BrAIn") as HTMLInputElement)
      .value,
  ).toBe("");
});
it("preserves the navigation on reauthentication, clears cached data and rechecks the new identity's domain access", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(
      Response.json({ subject: "fresh-identity", tenant_id: id, domains: [] }),
    );
  vi.stubGlobal("fetch", fetcher);
  const query = `?api_domain=${id}&api_view=brain&map_transport=viewport&map_event=historical-event&map_changes=1&time_from=2026-10-04T00%3A00%3A00Z&time_to=2026-10-05T00%3A00%3A00Z`;
  const cache = mount(`/${query}`);
  cache.setQueryData(["api", "previous-private-read"], { private: "old" });
  connect();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Se reconnecter" }));
  await screen.findByRole("button", { name: "Se connecter" });
  await waitFor(() =>
    expect(
      cache.getQueryData(["api", "previous-private-read"]),
    ).toBeUndefined(),
  );
  expect(screen.getByTestId("location").textContent).toBe(query);
  expect(
    (screen.getByLabelText("Jeton d’accès Open BrAIn") as HTMLInputElement)
      .value,
  ).toBe("");
  connect();
  await screen.findByText("Connecté en tant que fresh-identity");
  expect(
    screen.getByText("Aucun domaine accessible avec cette identité."),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  expect(screen.getByTestId("location").textContent).toBe("");
});
it.each([false, true])(
  "restores keyboard focus after a version retry without stealing a new domain's focus (switch: %s)",
  async (switchDomain) => {
    const other = "00000000-0000-0000-0000-000000000002";
    let attempts = 0;
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://fixture.test");
        if (url.pathname.endsWith("/me"))
          return Response.json({
            subject: "alice",
            tenant_id: id,
            domains: [
              { id, name: "Premier", role: "viewer", capabilities: [] },
              { id: other, name: "Second", role: "viewer", capabilities: [] },
            ],
          });
        const domain = url.pathname.includes(other) ? other : id;
        if (url.pathname.endsWith("/version")) {
          if (domain === id && ++attempts === 1)
            return new Response("", { status: 503 });
          if (domain === id && attempts === 2)
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          return Response.json({
            domain_id: domain,
            accepted_version: domain === id ? 2 : 3,
            published_version: domain === id ? 2 : 3,
          });
        }
        if (url.pathname.endsWith("/graph/window"))
          return Response.json(
            graphFixture(
              domain,
              [],
              Object.fromEntries(url.searchParams),
              domain === id ? 2 : 3,
            ),
          );
        throw new Error(input);
      }),
    );
    mount(`/?api_domain=${id}&api_view=brain`);
    connect();
    fireEvent.click(
      await screen.findByRole("button", { name: "Réessayer le chargement" }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    const selector = screen.getByRole("combobox", { name: "Domaine" });
    if (switchDomain) {
      selector.focus();
      fireEvent.change(selector, { target: { value: other } });
      await screen.findByText("Savoir accepté : v3 · Savoir publié : v3");
    }
    await act(async () => {
      finish!(
        Response.json({
          domain_id: id,
          accepted_version: 2,
          published_version: 2,
        }),
      );
    });
    if (switchDomain) {
      await waitFor(() => expect(document.activeElement).toBe(selector));
      expect(
        screen.queryByText("Savoir accepté : v2 · Savoir publié : v2"),
      ).toBeNull();
    } else {
      const message = await screen.findByText(
        "Savoir accepté : v2 · Savoir publié : v2",
      );
      await waitFor(() => expect(document.activeElement).toBe(message));
    }
  },
);
it("rejects malformed successful identity payloads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ domains: [] })),
  );
  mount();
  connect();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "incompatible",
  );
});
