import React, { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
import {
  SharedCaseWorkspace,
  validateCase,
  type SharedCaseActions,
} from "./SharedCaseWorkspace";
import type { SharedCase } from "../../../../packages/contracts/src/SharedCase";
import { chatIntent } from "./workspaceCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  id = "00000000-0000-0000-0000-000000000002",
  preparation = "00000000-0000-0000-0000-000000000003";
const initial: Extract<SharedCase, { audience: "team" }> = {
  audience: "team",
  id,
  title: "Dossier synthétique",
  excerpt: "Extrait volontaire",
  target: "delivered_answer",
  origin: "explicit",
  status: "new",
  qualification: "unclassified",
  public_conclusion: "",
  policy_version: "named-excerpt-v1",
  revision: 1,
  created_at: "2026-10-16T10:00:00Z",
  updated_at: "2026-10-16T10:00:00Z",
  allowed_actions: ["qualify", "close_without_change"],
  declarant: "reader",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(coordinate = true, routeSelection?: string, withTasks = false) {
  const api = new CortexApi(() => null);
  const ref = createRef<SharedCaseActions>();
  let current: SharedCase = { ...initial };
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _args, body, options) => {
      if (op === "cases.list")
        return {
          items: [current],
          next_after: null,
          total: 1,
          as_of: "2026-10-16T12:00:00Z",
          scope: options?.query?.scope ?? "mine",
          permissions_version: 1,
          work_version: 1,
          has_more: false,
          completeness: "complete",
          sort: "created_at_asc_id_asc",
        } as never;
      if (op === "cases.read") return { ...current } as never;
      if (op === "cases.events")
        return {
          case_id: id,
          audience: "team",
          items: [],
          next_after: null,
          total: current.revision,
          as_of: "2026-10-16T12:00:00Z",
        } as never;
      if (op === "cases.recipients")
        return {
          items: [{ subject: "manager", role: "corpus_manager" }],
          next_after: null,
          total: 1,
          as_of: "2026-10-16T12:00:00Z",
          permissions_version: 1,
        } as never;
      if (op === "cases.prepare")
        return {
          preparation_id: preparation,
          expires_at: new Date(Date.now() + 300000).toISOString(),
          content_hash: "hash",
          permissions_version: 1,
          policy_version: "named-excerpt-v1",
          origin: "explicit",
        } as never;
      if (op === "cases.share") {
        const v = body as { content: { title: string; excerpt: string } };
        current = {
          ...initial,
          audience: "declarant",
          title: v.content.title,
          excerpt: v.content.excerpt,
          recipients: ["manager"],
          personal_signal_id: null,
          allowed_actions: ["withdraw"],
        };
        return {
          case_id: id,
          event_id: domain,
          revision: 1,
          status: "new",
        } as never;
      }
      if (op === "cases.command") {
        const b = body as { action: string; expected_revision: number };
        if (b.expected_revision !== current.revision)
          throw new ApiError(409, "CASE_CHANGED");
        current = {
          audience: "withdrawn",
          id,
          status: "withdrawn",
          revision: 2,
          created_at: initial.created_at,
          updated_at: initial.updated_at,
          allowed_actions: [],
        };
        return {
          case_id: id,
          event_id: domain,
          revision: 2,
          status: "withdrawn",
        } as never;
      }
      throw Error("Unexpected operation: " + op);
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const notice = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <SharedCaseWorkspace
        ref={ref}
        routeSelection={routeSelection}
        api={api}
        domain={domain}
        coordinate={coordinate}
        canCaseTasks={withTasks}
        onNotice={notice}
      />
    </QueryClientProvider>,
  );
  return {
    ref,
    call,
    cache,
    notice,
    setCurrent: (v: SharedCase) => {
      current = v;
    },
  };
}
async function prepare(ref: React.RefObject<SharedCaseActions>) {
  await act(async () => {
    await ref.current!.act({
      kind: "case_prepare",
      title: "Titre saisi",
      excerpt: "Uniquement mon extrait",
      target: "delivered_answer",
      recipients: ["manager"],
    });
  });
  await screen.findByRole("region", { name: "Confirmation du dossier" });
}
it("preparation shows exact excerpt and recipients without publishing; button and chat share same operation", async () => {
  const { ref, call } = setup();
  await screen.findByText(/1 dossiers chargés/);
  await prepare(ref);
  const preview = within(
    screen.getByRole("region", { name: "Confirmation du dossier" }),
  );
  expect(preview.getByText("Uniquement mon extrait")).toBeDefined();
  expect(preview.getByText("Uniquement : manager.")).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "cases.share")).toBe(false);
  fireEvent.click(preview.getByText("Confirmer le partage"));
  await screen.findByText(/Dossier enregistré/);
  expect(call.mock.calls.filter(([op]) => op === "cases.share")).toHaveLength(
    1,
  );
  expect(call.mock.calls.some(([op]) => op.includes("publish"))).toBe(false);
});
it("chat cannot confirm a share as a dossier command or replace uncertain content", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "case_confirm", sharing: false });
  });
  expect(call.mock.calls.some(([op]) => op === "cases.share")).toBe(false);
  const original = call.getMockImplementation()!;
  let fail = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "cases.share" && fail) {
      fail = false;
      throw new ApiError(0, "network_error");
    }
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({ kind: "case_confirm", sharing: true });
  });
  await screen.findByText(/Résultat inconnu/);
  await act(async () => {
    await ref.current!.act({ kind: "case_cancel" });
    await ref.current!.act({
      kind: "case_prepare",
      title: "Autre",
      excerpt: "Autre contenu",
      recipients: ["manager"],
      target: "client_behavior",
    });
  });
  fireEvent.click(screen.getByText("Réessayer la même commande de dossier"));
  await screen.findByText(/Dossier enregistré/);
  const shares = call.mock.calls.filter(([op]) => op === "cases.share");
  expect(shares).toHaveLength(2);
  expect(shares[0][2]).toEqual(shares[1][2]);
  expect(
    (shares[0][2] as { content: { excerpt: string } }).content.excerpt,
  ).toBe("Uniquement mon extrait");
});
it("refusal requires new preparation and retained user text; does not auto retry", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "cases.share")
      throw new ApiError(409, "CASE_CONSENT_EXPIRED");
    return original(...args);
  });
  fireEvent.click(screen.getByText("Confirmer le partage"));
  await screen.findByText(/destinataires ou les droits ont changé/);
  expect(
    (screen.getByText("Confirmer le partage") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Extrait à partager") as HTMLTextAreaElement).value,
  ).toBe("Uniquement mon extrait");
  expect(call.mock.calls.filter(([op]) => op === "cases.share")).toHaveLength(
    1,
  );
});
it("expired preparation never sends and preserves entered excerpt", async () => {
  const { ref, call } = setup();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    const v = await original(...args);
    if (args[0] === "cases.prepare")
      return {
        ...(v as object),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      } as never;
    return v;
  });
  await prepare(ref);
  fireEvent.click(screen.getByText("Confirmer le partage"));
  await screen.findByText(/préparation a expiré/);
  expect(call.mock.calls.some(([op]) => op === "cases.share")).toBe(false);
});
it("triage reads fresh revision and withdrawal removes team text; focus reaches dossier", async () => {
  const { ref, call, setCurrent } = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: /Dossier synthétique/ }),
  );
  await screen.findByRole("heading", { name: "Dossier synthétique" });
  await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
  setCurrent({ ...initial, revision: 7 });
  await act(async () => {
    await ref.current!.act({
      kind: "case_action",
      action: "qualify",
      qualification: "unclear",
    });
  });
  expect(
    within(
      screen.getByRole("region", { name: "Confirmation du dossier" }),
    ).getByText(/révision 7/),
  ).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "cases.command")).toBe(false);
  fireEvent.click(screen.getByText("Confirmer le dossier"));
  await screen.findByRole("heading", { name: "Partage retiré" });
  expect(screen.queryByText("Extrait volontaire")).toBeNull();
});
it("current read denial masks cached text and disables decisions", async () => {
  const { call, cache } = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: /Dossier synthétique/ }),
  );
  await screen.findByText("Extrait volontaire");
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "cases.read") throw new ApiError(404, "NOT_FOUND");
    return original(...args);
  });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["api", domain, "shared-case"] });
  });
  await screen.findByRole("alert");
  expect(screen.queryByText("Extrait volontaire")).toBeNull();
  expect(screen.queryByText("Qualifier le dossier")).toBeNull();
});
it("stale page masks the old list and resets the cursor explicitly", async () => {
  const { call, cache } = setup();
  await screen.findByText(/1 dossiers chargés/);
  const original = call.getMockImplementation()!;
  let fail = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "cases.list" && fail)
      throw new ApiError(409, "WORKSPACE_CURSOR_STALE");
    return original(...args);
  });
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["api", domain, "shared-cases"],
    });
  });
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: /Dossier synthétique/ }),
  ).toBeNull();
  fail = false;
  fireEvent.click(screen.getByText("Actualiser les dossiers"));
  await screen.findByText(/1 dossiers chargés/);
});
it("denies team file to contributors and validates strict withdrawn DTO", async () => {
  const { ref, call } = setup(false);
  await act(async () => {
    await ref.current!.act({ kind: "case_list", scope: "team" });
  });
  expect(await screen.findByText(/file d’équipe est réservée/)).toBeDefined();
  expect(
    call.mock.calls
      .filter(([op, , , _o]) => op === "cases.list")
      .every((x) => x[3]?.query?.scope === "mine"),
  ).toBe(true);
  expect(() =>
    validateCase({
      ...initial,
      audience: "withdrawn",
    } as unknown as SharedCase),
  ).toThrow();
  expect(() =>
    validateCase({ ...initial, personal_signal_id: domain } as SharedCase),
  ).toThrow();
});
it("bounded chat commands retain exact excerpt case, recipients and target", () => {
  expect(
    chatIntent(
      "prépare un partage : Mon titre | Texte À Conserver | Alice, Bob | preuves",
    ),
  ).toEqual({
    kind: "case_prepare",
    title: "Mon titre",
    excerpt: "Texte À Conserver",
    recipients: ["Alice", "Bob"],
    target: "retrieved_evidence",
  });
  expect(chatIntent("confirme le partage")).toEqual({
    kind: "case_confirm",
    sharing: true,
  });
  expect(chatIntent("retire mon partage")).toEqual({
    kind: "case_action",
    action: "withdraw",
  });
  expect(chatIntent("qualifie le dossier : ambigu")).toEqual({
    kind: "case_action",
    action: "qualify",
    qualification: "unclear",
  });
});
it("can refresh stale reads while preserving an uncertain command for exact retry", async () => {
  const { ref, call, cache } = setup();
  await prepare(ref);
  const normal = call.getMockImplementation()!;
  let first = true;
  let stale = false;
  call.mockImplementation(async (...args) => {
    if (args[0] === "cases.share" && first) {
      first = false;
      throw new ApiError(0, "network_error");
    }
    if (args[0] === "cases.list" && stale)
      throw new ApiError(409, "WORKSPACE_CURSOR_STALE");
    return normal(...args);
  });
  await act(async () => {
    await ref.current!.act({ kind: "case_confirm", sharing: true });
  });
  await screen.findByText(/Résultat inconnu/);
  stale = true;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["api", domain, "shared-cases"],
    });
  });
  await screen.findByRole("alert");
  stale = false;
  fireEvent.click(screen.getByText("Actualiser les dossiers"));
  await screen.findByRole("button", {
    name: "Réessayer la même commande de dossier",
  });
  fireEvent.click(screen.getByText("Réessayer la même commande de dossier"));
  await screen.findByText(/Dossier enregistré/);
  const sent = call.mock.calls.filter(([op]) => op === "cases.share");
  expect(sent).toHaveLength(2);
  expect(sent[1][2]).toEqual(sent[0][2]);
});

it("restores a shared case from an opaque link with fresh rights and no triage", async () => {
  const { call } = setup(true, id);
  await screen.findByRole("heading", { name: initial.title });
  expect(call.mock.calls.some(([op]) => op === "cases.read")).toBe(true);
  expect(call.mock.calls.some(([op]) => op === "cases.command")).toBe(false);
});
it("opens an exact case name but never searches the withdrawn excerpt", async () => {
  const { ref, setCurrent, cache } = setup();
  await screen.findByText(/1 dossiers chargés/);
  await act(async () => {
    await ref.current!.act({ kind: "case_select", id: "dossier synthetique" });
  });
  await screen.findByRole("heading", { name: initial.title });
  setCurrent({
    audience: "withdrawn",
    id,
    status: "withdrawn",
    revision: 2,
    created_at: initial.created_at,
    updated_at: initial.updated_at,
    allowed_actions: [],
  });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["api", domain] });
  });
  await screen.findByRole("heading", { name: "Partage retiré" });
  await act(async () => {
    await ref.current!.act({ kind: "case_select", id: initial.title });
  });
  expect(
    screen.getByText(/0 correspondances parmi 1 dossiers chargés/),
  ).toBeDefined();
  expect(screen.queryByText(initial.excerpt)).toBeNull();
});

it("does not load task references before a withdrawn case is authorized and masks their controls", async () => {
  const s = setup(true, undefined, true);
  const old = s.call.getMockImplementation()!;
  s.call.mockImplementation(async (op, ...args) =>
    op === "cases.read"
      ? ({
          audience: "withdrawn",
          id,
          status: "withdrawn",
          revision: 2,
          created_at: initial.created_at,
          updated_at: initial.updated_at,
          allowed_actions: [],
        } as never)
      : old(op, ...args),
  );
  await act(async () => {
    await s.ref.current!.act({ kind: "case_select", id });
  });
  await screen.findByRole("heading", { name: "Partage retiré" });
  expect(
    s.call.mock.calls.filter((c) => c[0] === "case_tasks.list"),
  ).toHaveLength(0);
  expect(
    (
      screen.getByRole("button", {
        name: "Relire les tâches liées",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
