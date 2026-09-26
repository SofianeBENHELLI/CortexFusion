import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiConnection } from "./ApiConnection";
const id = "00000000-0000-0000-0000-000000000001";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ApiConnection />
    </QueryClientProvider>,
  );
  return cache;
}
function connect() {
  fireEvent.change(screen.getByLabelText("Identifiant du tenant"), {
    target: { value: id },
  });
  fireEvent.change(screen.getByLabelText("Jeton d’accès Cortex"), {
    target: { value: "synthetic-test-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
}
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
    (screen.getByLabelText("Jeton d’accès Cortex") as HTMLInputElement).value,
  ).toBe("");
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
    (screen.getByLabelText("Jeton d’accès Cortex") as HTMLInputElement).value,
  ).toBe("");
});
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
