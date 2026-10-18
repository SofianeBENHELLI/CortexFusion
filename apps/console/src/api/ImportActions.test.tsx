import React, { createRef } from "react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ImportActions,
  type ImportActionsHandle,
  checkImportItems,
} from "./ImportActions";
import { CortexApi, ApiError } from "./client";
import { importChatIntent } from "./importCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  collection = "00000000-0000-0000-0000-000000000002",
  ident = "00000000-0000-0000-0000-000000000003";
const job = {
  id: ident,
  collection_id: collection,
  status: "pending",
  processing: "local_text_only",
  items: [
    {
      position: 0,
      filename: "test.md",
      status: "pending",
      source_id: null,
      error_code: null,
      attempts: 0,
    },
  ],
};
const col = {
  id: collection,
  name: "Collection synthétique",
  description: "",
  allowed_subjects: ["manager"],
};
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const api = new CortexApi(() => null),
    ref = createRef<ImportActionsHandle>(),
    onSelect = vi.fn(),
    onRefresh = vi.fn(async () => {}),
    onNotice = vi.fn();
  const call = vi.spyOn(api, "call").mockImplementation(async (op, _p, b) => {
    if (op === "identity.read")
      return {
        subject: "manager",
        domains: [{ id: domain, capabilities: ["import_commands"] }],
      } as never;
    if (op === "collections.list")
      return { items: [col], next_after: null } as never;
    if (op === "collections.create")
      return { ...col, name: (b as { name: string }).name } as never;
    if (op === "collections.read") return col as never;
    if (op === "imports.create") return job as never;
    if (op === "imports.command_state")
      return {
        job,
        digest: "a".repeat(64),
        allowed_actions: ["process", "cancel"],
      } as never;
    if (op === "imports.command") {
      const body = b as { action: string; idempotency_key: string };
      return {
        import_id: ident,
        action: body.action,
        before_digest: "a".repeat(64),
        after_digest: "b".repeat(64),
        affected_items: 1,
        status: "succeeded",
        idempotency_key: body.idempotency_key,
      } as never;
    }
    throw new Error(`Unexpected ${op}`);
  });
  const props = {
    api,
    domain,
    selected: ident,
    onSelect,
    onRefresh,
    onNotice,
    canManage: true,
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <ImportActions ref={ref} {...props} />
    </QueryClientProvider>,
  );
  return { call, ref, onSelect, onRefresh, onNotice, view, props, cache };
}
async function prepare(ref: React.RefObject<ImportActionsHandle>) {
  await act(async () => {
    await ref.current!.act({
      kind: "import_text",
      collection,
      filename: "test.md",
      content: "Une source synthétique.",
    });
  });
}
it("prepares exact private text from chat and only sends after explicit button confirmation", async () => {
  const { ref, call, onSelect } = setup();
  await prepare(ref);
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
  fireEvent.click(screen.getByText("Relire le texte exact"));
  expect(screen.getByText("Une source synthétique.")).toBeDefined();
  expect(document.activeElement?.textContent).not.toBe("Confirmer l’import");
  await act(async () => {
    fireEvent.click(screen.getByText("Confirmer l’import"));
  });
  const sent = call.mock.calls.find(([op]) => op === "imports.create")!;
  expect(sent[2]).toMatchObject({
    items: [
      {
        filename: "test.md",
        content: "Une source synthétique.",
        allowed_subjects: ["manager"],
      },
    ],
  });
  expect(onSelect).toHaveBeenCalledWith(ident);
  expect(call.mock.calls.some(([op]) => String(op).includes("publish"))).toBe(
    false,
  );
});
it("recovery intent never sends an unconfirmed preparation or bypasses expiry", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "import_recover" });
  });
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
  const future = Date.now() + 301000;
  vi.spyOn(Date, "now").mockReturnValue(future);
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(screen.getByText(/Ce projet a expiré/)).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
});
it("keeps the exact key, payload and original target after a lost response and selection change", async () => {
  const { ref, call, view, props, cache } = setup();
  const original = call.getMockImplementation()!;
  let first = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "imports.command" && first) {
      first = false;
      throw new ApiError(0, "timeout");
    }
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "import_action",
      id: ident,
      action: "process",
      limit: 1,
    });
    await ref.current!.act({ kind: "import_recover" });
  });
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  await screen.findByText(/Résultat non confirmé/);
  view.rerender(
    <QueryClientProvider client={cache}>
      <ImportActions ref={ref} {...props} selected={collection} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await ref.current!.act({ kind: "import_discard" });
  });
  expect(screen.getByRole("region", { name: "Projet d’import" })).toBeDefined();
  await act(async () => {
    await ref.current!.act({ kind: "import_recover" });
  });
  const sends = call.mock.calls.filter(([op]) => op === "imports.command");
  expect(sends).toHaveLength(2);
  expect(sends[1].slice(1)).toEqual(sends[0].slice(1));
  expect(sends[1][1]).toEqual({ domain, import_id: ident });
});
it("does not turn a confirmed write into an uncertain one when follow-up read fails", async () => {
  const { ref, onRefresh, call } = setup();
  onRefresh.mockRejectedValueOnce(new Error("read failed"));
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(
    screen.getByText(/Commande enregistrée, mais suivi non relu/),
  ).toBeDefined();
  expect(screen.queryByRole("region", { name: "Projet d’import" })).toBeNull();
  await act(async () => {
    await ref.current!.act({ kind: "import_recover" });
  });
  expect(
    call.mock.calls.filter(([op]) => op === "imports.create"),
  ).toHaveLength(1);
});
it("masks the exact preparation on authorization refusal and does not retry automatically", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "imports.create") throw new ApiError(403, "forbidden");
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(screen.queryByText("Une source synthétique.")).toBeNull();
  expect(screen.getByText(/Les détails sont masqués/)).toBeDefined();
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(
    call.mock.calls.filter(([op]) => op === "imports.create"),
  ).toHaveLength(1);
});
it("prepares collection from form and confirms by chat with a fresh personal reader", async () => {
  const { ref, call } = setup();
  fireEvent.change(screen.getByLabelText("Nom de la collection"), {
    target: { value: "Ma nouvelle collection" },
  });
  fireEvent.click(screen.getByText("Préparer la collection"));
  await screen.findByText(/Créer la collection/);
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(
    call.mock.calls.find(([op]) => op === "collections.create")?.[2],
  ).toMatchObject({
    name: "Ma nouvelle collection",
    allowed_subjects: ["manager"],
  });
});
it("reads current state before preparing and refuses unavailable retry", async () => {
  const { ref, call } = setup();
  await act(async () => {
    await ref.current!.act({
      kind: "import_action",
      id: ident,
      action: "retry",
      limit: 1,
    });
  });
  expect(screen.getByText(/Aucun élément éligible/)).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "imports.command")).toBe(false);
});
it("does not truncate unicode, unsupported input, or duplicate names", () => {
  expect(() =>
    checkImportItems([{ filename: "test.md", content: "🧠".repeat(30000) }]),
  ).not.toThrow();
  expect(() =>
    checkImportItems([{ filename: "test.md", content: "🧠".repeat(30001) }]),
  ).toThrow(/30 000/);
  expect(() =>
    checkImportItems([{ filename: "test.pdf", content: "text" }]),
  ).toThrow(/Formats/);
  expect(() =>
    checkImportItems([{ filename: "test.md", content: "a\0b" }]),
  ).toThrow(/nul/);
  expect(() =>
    checkImportItems([
      { filename: "test.md", content: "a" },
      { filename: "test.md", content: "b" },
    ]),
  ).toThrow(/même nom/);
});
it("parses guided commands without forwarding malformed import requests to retrieval", () => {
  expect(
    importChatIntent(`prépare le traitement de l’import : ${ident} | 2`),
  ).toEqual({ kind: "import_action", id: ident, action: "process", limit: 2 });
  expect(importChatIntent("confirme l’import")).toEqual({
    kind: "import_confirm",
  });
  expect(
    importChatIntent(
      `prépare un import : ${collection} | test.md | https://example.test:a|b`,
    ),
  ).toMatchObject({ content: "https://example.test:a|b" });
  expect(
    importChatIntent(`prépare la reprise de l'import : ${ident} | 3`),
  ).toEqual({ kind: "import_invalid" });
  expect(importChatIntent("prépare un import : mauvais identifiant")).toEqual({
    kind: "import_invalid",
  });
  expect(importChatIntent("que dit le corpus ?")).toBeUndefined();
});

it("loads selected UTF-8 files locally and only sends the reviewed batch", async () => {
  const { ref, call } = setup();
  await screen.findByRole("option", { name: "Collection synthétique" });
  fireEvent.change(screen.getByLabelText("Collection"), {
    target: { value: collection },
  });
  const files = ["one.md", "two.txt"].map((name) => ({
    name,
    size: 12,
    arrayBuffer: async () => new TextEncoder().encode("Texte local.").buffer,
  }));
  fireEvent.change(screen.getByLabelText("Fichiers texte"), {
    target: { files },
  });
  await screen.findByText(/2 fichier\(s\) lus localement/);
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
  await act(async () => {
    await ref.current!.act({ kind: "import_files" });
  });
  expect(screen.getByText("one.md")).toBeDefined();
  expect(screen.getByText("two.txt")).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
});
it("rejects invalid UTF-8 file data without sending or silently replacing bytes", async () => {
  const { call } = setup();
  fireEvent.change(screen.getByLabelText("Fichiers texte"), {
    target: {
      files: [
        {
          name: "bad.md",
          size: 2,
          arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
        },
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toMatch(
      /encoded data|UTF-8|encoding/i,
    ),
  );
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
  expect(
    (
      screen.getByText(
        "Préparer les fichiers sélectionnés",
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("masks an already prepared import when current management capability disappears", async () => {
  const { ref, call, view, props, cache } = setup();
  await prepare(ref);
  view.rerender(
    <QueryClientProvider client={cache}>
      <ImportActions ref={ref} {...props} canManage={false} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Une source synthétique.")).toBeNull();
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(call.mock.calls.some(([op]) => op === "imports.create")).toBe(false);
});
it("treats a mismatched creation receipt as unknown and preserves the same command for recovery", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) =>
    args[0] === "imports.create"
      ? ({ ...job, collection_id: domain } as never)
      : original(...args),
  );
  await act(async () => {
    await ref.current!.act({ kind: "import_confirm" });
  });
  expect(screen.getByText(/Résultat non confirmé/)).toBeDefined();
  expect(screen.getByRole("region", { name: "Projet d’import" })).toBeDefined();
  call.mockImplementation(original);
  await act(async () => {
    await ref.current!.act({ kind: "import_recover" });
  });
  const sends = call.mock.calls.filter(([op]) => op === "imports.create");
  expect(sends).toHaveLength(2);
  expect(sends[0][2]).toEqual(sends[1][2]);
});
