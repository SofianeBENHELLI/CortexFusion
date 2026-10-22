import { recoveryKey as missionRecoveryKey } from "./missionRecoveryStore";
import { recoveryKey as reviewRecoveryKey } from "./reviewRecoveryStore";
import { recoveryKey as referenceRecoveryKey } from "./referenceRecoveryStore";
import { recoveryKey } from "./taskRecoveryStore";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserConnection } from "./BrowserConnection";
import type { CortexApi } from "./client";

vi.mock("../brain/SpatialBrainWorkspace", () => ({
  SpatialBrainWorkspace: () => <p>Carte synthétique chargée</p>,
}));

vi.mock("./GovernanceWorkspace", () => ({
  default: function DraftFixture({ api }: { api: CortexApi }) {
    const [draft, setDraft] = React.useState("");
    return (
      <>
        <label>
          Brouillon synthétique
          <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button
          onClick={() =>
            void api
              .call(
                "conversations.create",
                { domain: "00000000-0000-0000-0000-000000000001" },
                {
                  title: "Synthetic mutation",
                  idempotency_key: "00000000-0000-0000-0000-000000000002",
                },
              )
              .catch(() => {})
          }
        >
          Mutation synthétique
        </button>
      </>
    );
  },
}));

const id = "00000000-0000-0000-0000-000000000001";
const csrf = "c".repeat(43);
const identity = (subject = "reader", domains: unknown[] = []) => ({
  subject,
  tenant_id: id,
  domains,
});
const session = (value = identity(), seconds = 60) => ({
  authenticated: true,
  identity: value,
  csrf_token: csrf,
  expires_at: Date.now() / 1000 + seconds,
});
const fresh = (value: unknown) => Response.json(value);
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function mount(entry = "/", strict = false, localAccess = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  cache.setQueryData(["api", "old-private"], "old data");
  const app = (
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <BrowserConnection
          localAccess={localAccess}
          defaultDomain={localAccess ? id : undefined}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(
    strict ? <React.StrictMode>{app}</React.StrictMode> : app,
  );
  return { cache, ...view };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it("opens the authorized local conversation workspace from the bare URL and can close/reopen without credentials", async () => {
  const me = identity("reader", [
    { id, name: "Synthetic", role: "viewer", capabilities: [] },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/auth/logout"
        ? new Response(null, { status: 204 })
        : fresh(
            url === "/auth/session"
              ? session(me)
              : url.endsWith("/version")
                ? { domain_id: id, accepted_version: 1, published_version: 1 }
                : me,
          ),
    ),
  );
  mount("/", false, true);
  await screen.findByLabelText("Brouillon synthétique");
  expect(screen.getByTestId("location").textContent).toContain(
    `api_domain=${id}`,
  );
  expect(screen.getByTestId("location").textContent).toContain("api_view=work");
  expect(screen.queryByLabelText("Jeton d’accès Open BrAIn")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fermer l’espace" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Ouvrir ma base de connaissances",
    }),
  );
  await screen.findByLabelText("Brouillon synthétique");
});

it("does not select a local domain absent from fresh memberships", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      fresh(url === "/auth/session" ? session() : identity()),
    ),
  );
  mount("/", false, true);
  await screen.findByText("Aucun domaine accessible avec cette identité.");
  expect(screen.getByTestId("location").textContent).toBe("");
});

it("renews local access at expiry without a login form", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: string) =>
    fresh(url === "/auth/session" ? session(identity(), 10) : identity()),
  );
  vi.stubGlobal("fetch", fetcher);
  mount("/", false, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(screen.getByText("Connecté en tant que reader")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10100);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/auth/session"),
  ).toHaveLength(2);
  expect(screen.getByText("Connecté en tant que reader")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Se reconnecter" })).toBeNull();
});

it("restores a session on mount without asking for tenant/token and reads current identity", async () => {
  const fetcher = vi.fn(async (url: string) =>
    fresh(url === "/auth/session" ? session() : identity()),
  );
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount();
  await screen.findByText("Connecté en tant que reader");
  expect(screen.queryByLabelText("Identifiant du tenant")).toBeNull();
  expect(screen.queryByLabelText("Jeton d’accès Open BrAIn")).toBeNull();
  expect(cache.getQueryData(["api", "old-private"])).toBeUndefined();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/auth/session",
    "/api/v1/me",
  ]);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it("returns an unauthenticated link with only reviewed return context and no automatic redirect", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  mount(
    `/?api_domain=${id}&api_conversation=${id}&question=private&token=secret`,
  );
  const href = (
    await screen.findByRole("link", { name: "Se connecter" })
  ).getAttribute("href")!;
  expect(href).toContain("%2F%3Fapi_domain");
  expect(href).not.toMatch(/private|secret|question|token/);
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(["network", "html", "malformed"])(
  "shows a recoverable closed boundary on %s without manual fallback",
  async (kind) => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() =>
        kind === "network"
          ? Promise.reject(new Error("sensitive"))
          : Promise.resolve(
              kind === "html"
                ? new Response("<html>")
                : fresh({ authenticated: true }),
            ),
      )
      .mockImplementation(async (url: string) =>
        fresh(url === "/auth/session" ? session() : identity()),
      );
    vi.stubGlobal("fetch", fetcher);
    mount();
    expect((await screen.findByRole("alert")).textContent).not.toContain(
      "sensitive",
    );
    expect(screen.queryByLabelText("Jeton d’accès Open BrAIn")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Réessayer la connexion" }),
    );
    await screen.findByText("Connecté en tant que reader");
  },
);
it("masks all workspace data on a nested 401, preserves navigation and never retries the operation", async () => {
  const me = identity("reader", [
    { id, name: "Synthetic domain", role: "viewer", capabilities: [] },
  ]);
  const fetcher = vi.fn(async (url: string) =>
    url === "/auth/session"
      ? fresh(session(me))
      : url === "/api/v1/me"
        ? fresh(me)
        : new Response(null, { status: 401 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount(
    `/?api_domain=${id}&api_view=brain&api_conversation=${id}`,
  );
  await screen.findByRole("link", { name: "Se reconnecter" });
  expect(screen.queryByText("Connecté en tant que reader")).toBeNull();
  expect(cache.getQueriesData({ queryKey: ["api"] })).toEqual([]);
  expect(screen.getByTestId("location").textContent).toContain(
    `api_conversation=${id}`,
  );
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/version")),
  ).toHaveLength(1);
});
it("purges local data before logout completes and clears URL only after confirmation", async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) =>
    url === "/auth/logout"
      ? new Promise<Response>((r) => {
          complete = r;
        })
      : fresh(url === "/auth/session" ? session() : identity()),
  );
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount(`/?api_domain=${id}`);
  await screen.findByText("Connecté en tant que reader");
  sessionStorage.setItem(recoveryKey, "synthetic recovery reference");
  sessionStorage.setItem(missionRecoveryKey, "synthetic mission reference");
  sessionStorage.setItem(reviewRecoveryKey, "synthetic review reference");
  sessionStorage.setItem(referenceRecoveryKey, "synthetic reference receipt");
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
  expect(sessionStorage.getItem(reviewRecoveryKey)).toBeNull();
  expect(sessionStorage.getItem(missionRecoveryKey)).toBeNull();
  expect(sessionStorage.getItem(referenceRecoveryKey)).toBeNull();
  expect(screen.getByText("Déconnexion en cours…")).toBeTruthy();
  expect(screen.queryByText("Connecté en tant que reader")).toBeNull();
  expect(cache.getQueriesData({ queryKey: ["api"] })).toEqual([]);
  expect(screen.getByTestId("location").textContent).toContain(id);
  await act(async () => complete(new Response(null, { status: 204 })));
  await screen.findByRole("link", { name: "Se connecter" });
  expect(screen.getByTestId("location").textContent).toBe("");
});
it("does not claim logout after a lost response; explicit retry can confirm an absent session", async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/auth/logout") {
      if (++attempts === 1) throw new Error("network");
      return new Response(null, { status: 401 });
    }
    return fresh(url === "/auth/session" ? session() : identity());
  });
  vi.stubGlobal("fetch", fetcher);
  mount();
  await screen.findByText("Connecté en tant que reader");
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "peut rester active",
  );
  expect(attempts).toBe(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer la déconnexion" }),
  );
  await screen.findByRole("link", { name: "Se connecter" });
  expect(attempts).toBe(2);
});
it("expires locally at the server deadline and clears identity/cache without a network action", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: string) =>
    fresh(url === "/auth/session" ? session(identity(), 10) : identity()),
  );
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount(`/?api_conversation=${id}&api_domain=${id}`);
  // React commits the auth boundary before QueryClient schedules its notification.
  for (let step = 0; step < 4; step++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  expect(screen.getByText("Connecté en tant que reader")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000);
  });
  expect(screen.getByRole("link", { name: "Se reconnecter" })).toBeTruthy();
  expect(screen.queryByText("Connecté en tant que reader")).toBeNull();
  expect(cache.getQueryData(["api", "identity"])).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rechecks another tab's identity on focus while keeping former data masked", async () => {
  let reads = 0;
  let complete!: (value: Response) => void;
  let subject = "reader";
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/auth/session" && ++reads === 2)
      return new Promise<Response>((r) => {
        complete = r;
      });
    return fresh(
      url === "/auth/session" ? session(identity(subject)) : identity(subject),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount(`/?api_domain=${id}`);
  await screen.findByText("Connecté en tant que reader");
  fireEvent(window, new Event("focus"));
  expect(
    screen.getByText("Connecté en tant que reader").closest("[hidden]"),
  ).not.toBeNull();
  subject = "other-reader";
  await act(async () => complete(fresh(session(identity(subject)))));
  await screen.findByText("Connecté en tant que other-reader");
  expect(screen.queryByText("Connecté en tant que reader")).toBeNull();
  expect(cache.getQueryData(["api", "identity"])).toMatchObject({
    subject: "other-reader",
  });
  expect(
    screen.getByText("Ce domaine n’est plus accessible avec cette identité."),
  ).toBeTruthy();
});
it("preserves an unsent draft across focus validation of the same unchanged session", async () => {
  const me = identity("reader", [
    { id, name: "Domain", role: "viewer", capabilities: [] },
  ]);
  const stableSession = session(me);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      fresh(
        url === "/auth/session"
          ? stableSession
          : url === "/api/v1/me"
            ? me
            : { domain_id: id, accepted_version: 1, published_version: 1 },
      ),
    ),
  );
  mount(`/?api_domain=${id}`);
  const editor = await screen.findByLabelText("Brouillon synthétique");
  fireEvent.change(editor, { target: { value: "unsent local text" } });
  fireEvent(window, new Event("focus"));
  expect(editor.closest("[hidden]")).not.toBeNull();
  await waitFor(() => expect(editor.closest("[hidden]")).toBeNull());
  expect(
    (screen.getByLabelText("Brouillon synthétique") as HTMLInputElement).value,
  ).toBe("unsent local text");
});
it("masks a document leaving into history and revalidates a persisted pageshow", async () => {
  let active = true;
  const fetcher = vi.fn(async (url: string) =>
    !active
      ? new Response(null, { status: 401 })
      : fresh(url === "/auth/session" ? session() : identity()),
  );
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount();
  await screen.findByText("Connecté en tant que reader");
  fireEvent(window, new Event("pagehide"));
  expect(screen.queryByText("Connecté en tant que reader")).toBeNull();
  expect(cache.getQueryData(["api", "identity"])).toBeUndefined();
  active = false;
  fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
  await screen.findByRole("link", { name: "Se connecter" });
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/auth/session"),
  ).toHaveLength(2);
});
it("ignores a late restoration after unmount and tolerates StrictMode effect replay", async () => {
  let complete!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          complete = r;
        }),
    )
    .mockImplementation(async (url: string) =>
      fresh(url === "/auth/session" ? session() : identity()),
    );
  vi.stubGlobal("fetch", fetcher);
  const { cache, unmount } = mount("/", true);
  await screen.findByText("Connecté en tant que reader");
  unmount();
  await act(async () => complete(fresh(session(identity("old-reader")))));
  expect(cache.getQueriesData({ queryKey: ["api"] })).toEqual([]);
  expect(screen.queryByText("old-reader")).toBeNull();
});

it("recovers a local request-expiry race once without replaying the mutation", async () => {
  const me = identity("reader", [
    { id, name: "Synthetic", role: "contributor", capabilities: ["query"] },
  ]);
  let sessions = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/auth/session")
      return fresh({
        ...session(me),
        csrf_token: (++sessions === 1 ? "c" : "d").repeat(43),
      });
    if (init?.method === "POST") return new Response(null, { status: 401 });
    if (url.endsWith("/version"))
      return fresh({
        domain_id: id,
        accepted_version: 1,
        published_version: 1,
      });
    return fresh(me);
  });
  vi.stubGlobal("fetch", fetcher);
  mount("/", false, true);
  await screen.findByLabelText("Brouillon synthétique");
  fireEvent.click(screen.getByRole("button", { name: "Mutation synthétique" }));
  await waitFor(() => expect(sessions).toBe(2));
  await screen.findByLabelText("Brouillon synthétique");
  expect(
    fetcher.mock.calls.filter(([, i]) => i?.method === "POST"),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Ouvrir ma base de connaissances" }),
  ).toBeNull();
  // A second immediate failure is bounded, not an endless authentication loop.
  fireEvent.click(screen.getByRole("button", { name: "Mutation synthétique" }));
  await screen.findByRole("button", {
    name: "Ouvrir ma base de connaissances",
  });
  expect(sessions).toBe(2);
});

it("keeps local unsent text through expiry with rotated credentials, then uses the new CSRF without replay", async () => {
  vi.useFakeTimers();
  const me = identity("reader", [
    {
      id,
      name: "Synthetic",
      role: "contributor",
      roles: ["contributor"],
      membership_revision: 1,
      capabilities: ["query"],
    },
  ]);
  let sessions = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/auth/session")
      return fresh({
        ...session(me, 10),
        csrf_token: (++sessions === 1 ? "c" : "d").repeat(43),
      });
    if (init?.method === "POST") return fresh({ id });
    if (url.endsWith("/version"))
      return fresh({
        domain_id: id,
        accepted_version: 1,
        published_version: 1,
      });
    return fresh(me);
  });
  vi.stubGlobal("fetch", fetcher);
  mount("/", false, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Brouillon synthétique")).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("Brouillon synthétique"), {
    target: { value: "Saisie locale avant renouvellement" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10100);
  });
  expect(sessions).toBe(2);
  expect(
    (screen.getByLabelText("Brouillon synthétique") as HTMLInputElement).value,
  ).toBe("Saisie locale avant renouvellement");
  expect(
    fetcher.mock.calls.filter(([, i]) => i?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Mutation synthétique" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  const posts = fetcher.mock.calls.filter(([, i]) => i?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(new Headers(posts[0][1]?.headers).get("X-Cortex-CSRF")).toBe(
    "d".repeat(43),
  );
});

it.each([
  "role",
  "revision",
  "capability",
  "subject",
  "failure",
  "remote-rotation",
])("purges unsent text when renewed session has %s", async (kind) => {
  let me = identity("reader", [
    {
      id,
      name: "Synthetic",
      role: "contributor",
      roles: ["contributor"],
      membership_revision: 1,
      capabilities: ["query"],
    },
  ]);
  let sessions = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/auth/session") {
      sessions++;
      if (sessions > 1 && kind === "failure")
        return new Response(null, { status: 503 });
      if (sessions > 1 && kind === "subject")
        me = { ...me, subject: "different-reader" };
      if (sessions > 1 && (kind === "revision" || kind === "capability"))
        me = {
          ...me,
          domains: [
            {
              id,
              name: "Synthetic",
              role: "contributor",
              roles: ["contributor"],
              membership_revision: kind === "revision" ? 2 : 1,
              capabilities: kind === "capability" ? [] : ["query"],
            },
          ],
        };
      if (sessions > 1 && kind === "role")
        me = {
          ...me,
          domains: [
            {
              id,
              name: "Synthetic",
              role: "viewer",
              roles: ["viewer"],
              membership_revision: 2,
              capabilities: ["query"],
            },
          ],
        };
      return fresh({
        ...session(me),
        csrf_token: (sessions === 1 ? "c" : "d").repeat(43),
      });
    }
    return fresh(
      url.endsWith("/version")
        ? { domain_id: id, accepted_version: 1, published_version: 1 }
        : me,
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const { cache } = mount(
    `/?api_domain=${id}`,
    false,
    kind !== "remote-rotation",
  );
  const editor = await screen.findByLabelText("Brouillon synthétique");
  fireEvent.change(editor, { target: { value: "Must disappear" } });
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(sessions).toBe(2));
  await waitFor(() => expect(document.contains(editor)).toBe(false));
  expect(screen.queryByDisplayValue("Must disappear")).toBeNull();
  if (kind === "failure")
    expect(cache.getQueriesData({ queryKey: ["api"] })).toEqual([]);
});

it("does not abort and restart a slow renewal at an already expired timestamp", async () => {
  vi.useFakeTimers();
  let sessions = 0;
  let finish: (() => void) | undefined;
  let renewalSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/auth/session") {
        sessions++;
        if (sessions === 2) {
          renewalSignal = init?.signal ?? undefined;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
        return fresh(session(identity(), 10));
      }
      return fresh(identity());
    }),
  );
  mount("/", false, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10100);
  });
  expect(sessions).toBe(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(sessions).toBe(2);
  expect(renewalSignal?.aborted).toBe(false);
  expect(screen.getByText("Vérification de votre connexion…")).toBeTruthy();
  await act(async () => {
    finish?.();
  });
  expect(screen.getByText("Connecté en tant que reader")).toBeTruthy();
});

it("refreshes same-person local work after a token-free notice from another tab", async () => {
  const channels: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  class Channel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const me = identity("reader", [
    {
      id,
      name: "Synthetic",
      role: "contributor",
      capabilities: ["personal_drafts"],
    },
  ]);
  let generation = 0;
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
    fresh(
      url === "/auth/session"
        ? {
            ...session(me, 300),
            csrf_token: (generation ? "d" : "c").repeat(43),
          }
        : url === "/api/v1/me"
          ? me
          : url.includes("/version")
            ? { domain_id: id, accepted_version: 1, published_version: 1 }
            : url.includes("conversation-drafts")
              ? { text: "", revision: 0 }
              : { items: [], next_after: null },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  mount(`/?api_domain=${id}&api_view=work`, false, true);
  await screen.findByLabelText("Brouillon synthétique");
  fireEvent.change(screen.getByLabelText("Brouillon synthétique"), {
    target: { value: "Saisie à conserver" },
  });
  generation = 1;
  await act(async () => {
    channels[0].onmessage?.({ data: { type: "changed" } } as MessageEvent);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Brouillon synthétique")).toHaveProperty(
      "value",
      "Saisie à conserver",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mutation synthétique" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some((c) => c[0].endsWith("/conversations")),
    ).toBe(true),
  );
  const sent = fetcher.mock.calls.find(([url]) =>
    url.endsWith("/conversations"),
  );
  expect(new Headers(sent?.[1]?.headers).get("X-Cortex-CSRF")).toBe(
    "d".repeat(43),
  );
  // Broadcasts are invalidation hints; never credentials, identities or drafts.
  expect(
    channels[0].postMessage.mock.calls.every(
      ([v]) => JSON.stringify(v) === '{"type":"changed"}',
    ),
  ).toBe(true);
});
it("closes other tabs immediately without repeating logout or exposing their in-memory work", async () => {
  let channel:
    | {
        onmessage: ((e: MessageEvent) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
      }
    | undefined;
  class Channel {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    constructor() {
      channel = this;
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const me = identity("reader", [
    { id, name: "Synthetic", role: "viewer", capabilities: [] },
  ]);
  const fetcher = vi.fn(async (url: string) =>
    fresh(
      url === "/auth/session"
        ? session(me, 300)
        : url === "/api/v1/me"
          ? me
          : url.includes("/version")
            ? { domain_id: id, accepted_version: 1, published_version: 1 }
            : { items: [], next_after: null },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  mount(`/?api_domain=${id}&api_view=work`, false, true);
  await screen.findByLabelText("Brouillon synthétique");
  sessionStorage.setItem(missionRecoveryKey, "synthetic mission reference");
  sessionStorage.setItem(reviewRecoveryKey, "synthetic reference");
  await act(async () => {
    channel!.onmessage?.({
      data: { type: "closed", token: "invalid extra field" },
    } as MessageEvent);
  });
  expect(screen.getByLabelText("Brouillon synthétique")).toBeDefined();
  await act(async () => {
    channel!.onmessage?.({ data: { type: "closed" } } as MessageEvent);
  });
  expect(screen.queryByLabelText("Brouillon synthétique")).toBeNull();
  expect(sessionStorage.getItem(reviewRecoveryKey)).toBeNull();
  expect(sessionStorage.getItem(missionRecoveryKey)).toBeNull();
  expect(fetcher.mock.calls.some((c) => c[0] === "/auth/logout")).toBe(false);
});
