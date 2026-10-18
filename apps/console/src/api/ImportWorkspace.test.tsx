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
import { MemoryRouter, useLocation } from "react-router-dom";
import { ImportWorkspace } from "./ImportWorkspace";
import { ApiError, type CortexApi } from "./client";
import type { ImportView } from "../../../../packages/contracts/src/ImportView";
import {
  importProgress,
  validateImport,
  validateImportPage,
} from "./import-contract";

const domain = "00000000-0000-0000-0000-000000000001";
const jobId = "00000000-0000-0000-0000-000000000010";
const nextId = "00000000-0000-0000-0000-000000000020";
const collection = "00000000-0000-0000-0000-000000000003";
const source = "00000000-0000-0000-0000-000000000004";
function job(id = jobId): ImportView {
  return {
    id,
    collection_id: collection,
    status: "partial",
    processing: "local_text_only",
    items: [
      {
        position: 0,
        filename: "preuve.md",
        status: "succeeded",
        source_id: source,
        error_code: null,
        attempts: 1,
      },
      {
        position: 1,
        filename: "image.pdf",
        status: "failed",
        source_id: null,
        error_code: "UNSUPPORTED_FORMAT",
        attempts: 1,
      },
      {
        position: 2,
        filename: "suite.txt",
        status: "pending",
        source_id: null,
        error_code: null,
        attempts: 0,
      },
    ],
  };
}
function transport() {
  return vi.fn(async (op: string): Promise<unknown> => {
    if (op === "imports.list") return { items: [job()], next_after: null };
    if (op === "imports.read") return job();
    if (op === "collections.read")
      return {
        id: collection,
        name: "Lot synthétique",
        description: "",
        allowed_subjects: ["alice"],
      };
    if (op === "sources.passage")
      return {
        source_id: source,
        start: 0,
        end: 30,
        total_characters: 30,
        next_offset: null,
        offset_unit: "unicode_code_point",
        excerpt: "Texte entier 🧠\nDernière ligne.",
        title: "Source synthétique",
        location: "synthetic://imports",
        content_hash: "a".repeat(64),
      };
    throw new Error("Unexpected operation");
  });
}
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function mount(
  call: ReturnType<typeof transport>,
  query = "",
  reconnect = vi.fn(),
) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[
          `/?api_domain=${domain}&api_conversation=${nextId}${query}`,
        ]}
      >
        <Location />
        <ImportWorkspace
          api={{ call } as unknown as CortexApi}
          domain={domain}
          onReconnect={reconnect}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, cache, reconnect };
}
afterEach(cleanup);

it("reads a linked import outside the first page, reports real item counts, and reads the whole source without publishing", async () => {
  const call = transport();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op) =>
    op === "imports.list" ? { items: [], next_after: null } : original(op),
  );
  mount(call, `&api_import=${jobId}`);
  const title = await screen.findByRole("heading", { name: `Lot ${jobId}` });
  await waitFor(() => expect(document.activeElement).toBe(title));
  await screen.findByText("Collection : Lot synthétique");
  expect(
    screen.getByText(/1 fichier\(s\) traité\(s\) sur 3/).textContent,
  ).toContain("1 en échec");
  expect(
    screen.queryByRole("button", { name: /publier|reprendre|lancer/i }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Lire la source" }));
  const content = await screen.findByRole("region", {
    name: "Texte de la source",
  });
  expect(content.textContent).toBe("Texte entier 🧠\nDernière ligne.");
  await waitFor(() => expect(document.activeElement).toBe(content));
  fireEvent.keyDown(content, { key: "Escape" });
  expect(
    screen.queryByRole("region", { name: "Texte de la source" }),
  ).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Lire la source" }),
  );
  expect(new Set(call.mock.calls.map(([op]) => op))).toEqual(
    new Set([
      "imports.list",
      "imports.read",
      "collections.read",
      "sources.passage",
    ]),
  );
});

it("selects only an opaque import ID and preserves the conversation context", async () => {
  const call = transport();
  mount(call);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Partiellement traité · preuve.md/,
    }),
  );
  await screen.findByRole("heading", { name: `Lot ${jobId}` });
  const params = new URLSearchParams(
    screen.getByTestId("location").textContent!,
  );
  expect(params.get("api_import")).toBe(jobId);
  expect(params.get("api_conversation")).toBe(nextId);
  expect(params.toString()).not.toMatch(/preuve|source|Texte/);
  fireEvent.click(
    screen.getByRole("button", { name: "Fermer le détail de l’import" }),
  );
  expect(screen.getByTestId("location").textContent).not.toContain(
    "api_import",
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /Partiellement traité · preuve.md/ }),
  );
});

it("paginates without mixing pages or treating the page count as a global total", async () => {
  const call = transport();
  call.mockImplementation(async (_op, ...args: unknown[]) => {
    const after = (args[2] as { query: { after?: string } }).query.after;
    return after
      ? { items: [job(nextId)], next_after: null }
      : { items: [job()], next_after: jobId };
  });
  mount(call);
  await screen.findByText(/Page 1 · 1 lot/);
  fireEvent.click(
    screen.getByRole("button", { name: "Page suivante des imports" }),
  );
  await screen.findByText(/Page 2 · 1 lot/);
  expect(
    screen.getAllByRole("button", { name: /Partiellement traité/ }),
  ).toHaveLength(1);
  expect(
    (
      screen.getByRole("button", {
        name: "Page suivante des imports",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Page précédente des imports" }),
  );
  await screen.findByText(/Page 1 · 1 lot/);
});

it.each(["private", `${jobId}&api_import=${nextId}`])(
  "rejects malformed/ambiguous deep links without a detail request: %s",
  async (value) => {
    const call = transport();
    mount(call, `&api_import=${value}`);
    await screen.findByText(/Ce lien d’import est invalide/);
    await screen.findByRole("button", { name: /Partiellement traité/ });
    expect(call.mock.calls.map(([op]) => op)).toEqual(["imports.list"]);
  },
);

it("hides previous receipts and source content on a source denial, then requires a fresh explicit check", async () => {
  const call = transport();
  const original = call.getMockImplementation()!;
  let denied = true;
  call.mockImplementation(async (op) => {
    if (op === "sources.passage" && denied) throw new ApiError(404, "missing");
    return original(op);
  });
  mount(call, `&api_import=${jobId}`);
  fireEvent.click(
    await screen.findByRole("button", { name: "Lire la source" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("preuve.md")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Partiellement traité/ }),
  ).toBeNull();
  denied = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les imports" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Lire la source" }),
  );
  await screen.findByRole("region", { name: "Texte de la source" });
  expect(
    call.mock.calls.filter(([op]) => op === "imports.read").length,
  ).toBeGreaterThan(1);
});

it("hides stale list data after a failed refresh and offers session recovery", async () => {
  const call = transport();
  const { reconnect } = mount(call);
  await screen.findByRole("button", { name: /Partiellement traité/ });
  call.mockRejectedValue(new ApiError(401, "expired"));
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser les imports" }),
  );
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: /Partiellement traité/ }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Se reconnecter au suivi des imports" }),
  );
  expect(reconnect).toHaveBeenCalledOnce();
});

it("fails closed on a collection refusal instead of displaying cached import names", async () => {
  const call = transport();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op) => {
    if (op === "collections.read") throw new ApiError(404, "missing");
    return original(op);
  });
  mount(call, `&api_import=${jobId}`);
  await screen.findByRole("alert");
  expect(screen.queryByRole("heading", { name: `Lot ${jobId}` })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Partiellement traité/ }),
  ).toBeNull();
});

it.each([401, 403, 404])(
  "hides stale receipts after detail refusal %s and restores only fresh reads",
  async (status) => {
    const call = transport();
    const original = call.getMockImplementation()!;
    const { cache } = mount(call, `&api_import=${jobId}`);
    await screen.findByText("Collection : Lot synthétique");
    call.mockImplementation(async (op) => {
      if (op === "imports.read") throw new ApiError(status, "denied");
      return original(op);
    });
    await cache.refetchQueries({ queryKey: ["api", "import", domain, jobId] });
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /Partiellement traité/ }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: `Lot ${jobId}` })).toBeNull();
    call.mockImplementation(original);
    fireEvent.click(
      screen.getByRole("button", { name: "Actualiser les imports" }),
    );
    await screen.findByText("Collection : Lot synthétique");
    expect(
      screen.getByRole("button", { name: /Partiellement traité/ }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Fermer le détail de l’import" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Mes imports de texte" }),
    );
  },
);

it("rejects inconsistent counts, duplicated identities and cycling cursors", () => {
  expect(() => validateImport({ ...job(), status: "succeeded" })).toThrow(
    ApiError,
  );
  expect(() =>
    validateImport({
      ...job(),
      items: [{ ...job().items[0], source_id: null }],
    }),
  ).toThrow(ApiError);
  expect(() =>
    validateImport({ ...job(), items: [{ ...job().items[0], position: 2 }] }),
  ).toThrow(ApiError);
  expect(() =>
    validateImportPage({ items: [job(), job()], next_after: null }),
  ).toThrow(ApiError);
  expect(() =>
    validateImportPage({ items: [job()], next_after: nextId }),
  ).toThrow(ApiError);
  expect(() =>
    validateImportPage({ items: [job()], next_after: null }, jobId),
  ).toThrow(ApiError);
});

it("does not infer publication from a successful or partially cancelled import", () => {
  const deduplicated = validateImport({
    ...job(),
    status: "succeeded",
    items: [job().items[0], { ...job().items[0], position: 1 }],
  });
  expect(importProgress(deduplicated)).toContain("2 fichier(s) traité(s)");
  expect(importProgress(deduplicated)).not.toContain("2 source");
  expect(
    validateImport({ ...job(), status: "succeeded", items: [job().items[0]] })
      .status,
  ).toBe("succeeded");
  expect(
    validateImport({
      ...job(),
      status: "cancelled",
      items: job().items.map((i) =>
        i.status === "pending" ? { ...i, status: "cancelled" } : i,
      ),
    }).status,
  ).toBe("cancelled");
});
