import React, { createRef } from "react";
import { webcrypto } from "node:crypto";
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  ContributionDraft,
  type ContributionDraftHandle,
  validateContributionDraft,
} from "./ContributionDraft";
import { CortexApi, ApiError } from "./client";
import { chatIntent } from "./workspaceCommands";
import type {
  ContributionDraft as Draft,
  ContributionDraftContent,
} from "../../../../packages/contracts/src/ContributionDraft";
import type { ContributionDraftInput } from "../../../../packages/contracts/src/ContributionDraftInput";
const domain = "00000000-0000-0000-0000-000000000001",
  source = "00000000-0000-0000-0000-000000000002",
  receipt = "00000000-0000-0000-0000-000000000003";
const content: ContributionDraftContent = {
  source_id: source,
  source_hash: "a".repeat(64),
  title: "Titre synthétique",
  excerpt: "Passage 🧠",
  reason: "",
  selection: null,
};
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(
  initial: Draft = {
    revision: 0,
    state: "empty",
    content: null,
    updated_at: null,
  },
) {
  const api = new CortexApi(() => null),
    ref = createRef<ContributionDraftHandle>(),
    onRestore = vi.fn().mockResolvedValue(true),
    onNotice = vi.fn();
  let remote = initial;
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _params, body) => {
      if (op === "contribution_drafts.read")
        return structuredClone(remote) as never;
      if (op === "contribution_drafts.save") {
        const b = body as ContributionDraftInput;
        if (b.expected_revision !== remote.revision)
          throw new ApiError(409, "DRAFT_REVISION_CONFLICT");
        remote = {
          content: b.content,
          state: b.content ? "available" : "empty",
          revision: remote.revision + 1,
          updated_at: "2026-10-16T22:00:00Z",
        };
        return { receipt_id: receipt, revision: remote.revision } as never;
      }
      throw Error(op);
    });
  const ui = (
    value: ContributionDraftContent | null = content,
    enabled = true,
    disabled = false,
  ) => (
    <ContributionDraft
      ref={ref}
      api={api}
      domain={domain}
      value={value}
      enabled={enabled}
      disabled={disabled}
      onRestore={onRestore}
      onNotice={onNotice}
    />
  );
  const rendered = render(ui());
  await screen.findByText(/État courant : révision/);
  return {
    ...rendered,
    api,
    ref,
    call,
    onRestore,
    onNotice,
    ui,
    setRemote: (v: Draft) => {
      remote = v;
    },
  };
}
it("saves incomplete fields only explicitly and restores only after inspection and a fresh read", async () => {
  const t = await setup();
  expect(t.call.mock.calls.map((x) => x[0])).toEqual([
    "contribution_drafts.read",
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: "Enregistrer le brouillon d’ajout" }),
  );
  await screen.findByText(/Sauvegarde privée confirmée/);
  expect(t.onRestore).not.toHaveBeenCalled();
  await act(() => t.ref.current!.act("restore"));
  expect(t.onRestore).not.toHaveBeenCalled();
  await act(() => t.ref.current!.act("inspect"));
  await act(() => t.ref.current!.act("restore"));
  expect(t.onRestore).toHaveBeenCalledWith(content);
  expect(
    t.call.mock.calls.filter((x) => x[0] === "contribution_drafts.save"),
  ).toHaveLength(1);
  expect(t.call.mock.calls.some((x) => x[0] === "proposals.create")).toBe(
    false,
  );
});
it("preserves exact pending save across edits and unknown response, without submitting a proposal", async () => {
  const t = await setup();
  let lost: ContributionDraftInput | undefined;
  const base = t.call.getMockImplementation()!;
  let first = true;
  t.call.mockImplementation(async (op, p, b, o) => {
    if (op === "contribution_drafts.save" && first) {
      first = false;
      lost = structuredClone(b as ContributionDraftInput);
      await base(op, p, b, o);
      throw new ApiError(0, "network");
    }
    if (op === "contribution_drafts.save")
      return { receipt_id: receipt, revision: 1 } as never;
    return base(op, p, b, o);
  });
  await act(() => t.ref.current!.act("save"));
  await screen.findByText(/Résultat de sauvegarde inconnu/);
  t.rerender(t.ui({ ...content, title: "New unsaved title" }));
  await act(() => t.ref.current!.act("save"));
  expect(
    t.call.mock.calls.filter((x) => x[0] === "contribution_drafts.save"),
  ).toHaveLength(1);
  await act(() => t.ref.current!.act("recover"));
  const bodies = t.call.mock.calls
    .filter((x) => x[0] === "contribution_drafts.save")
    .map((x) => x[2]);
  expect(bodies).toEqual([lost, lost]);
  expect(t.onRestore).not.toHaveBeenCalled();
});
it("keeps an uncertain key when recovery is forbidden and never auto retries", async () => {
  const t = await setup();
  const base = t.call.getMockImplementation()!;
  let fail: Error = new ApiError(0, "network");
  t.call.mockImplementation(async (op, p, b, o) => {
    if (op === "contribution_drafts.save") throw fail;
    return base(op, p, b, o);
  });
  await act(() => t.ref.current!.act("save"));
  fail = new ApiError(403, "forbidden");
  await act(() => t.ref.current!.act("recover"));
  expect(
    screen.getByRole("button", {
      name: "Vérifier la sauvegarde du brouillon d’ajout",
    }),
  ).toBeTruthy();
  expect(
    t.call.mock.calls.filter((x) => x[0] === "contribution_drafts.save"),
  ).toHaveLength(2);
});
it("does not overwrite a concurrent draft and requires a new inspection", async () => {
  const t = await setup();
  t.setRemote({
    revision: 1,
    content: { ...content, title: "Other tab" },
    state: "available",
    updated_at: null,
  });
  await act(() => t.ref.current!.act("save"));
  expect(screen.getByText(/Les données ont changé/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Enregistrer le brouillon d’ajout" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(() => t.ref.current!.act("inspect"));
  expect(screen.getByRole("heading", { name: "Other tab" })).toBeTruthy();
  expect(t.onRestore).not.toHaveBeenCalled();
});
it("rechecks remote revision and source visibility before restoring; hides formerly visible text", async () => {
  const t = await setup({
    revision: 1,
    content,
    state: "available",
    updated_at: null,
  });
  await act(() => t.ref.current!.act("inspect"));
  t.setRemote({
    revision: 1,
    content: null,
    state: "source_unavailable",
    updated_at: null,
  });
  await act(() => t.ref.current!.act("restore"));
  expect(t.onRestore).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: content.title })).toBeNull();
  expect(screen.queryByText(content.excerpt)).toBeNull();
});
it("separates a confirmed save from a failed post-save read and allows explicit clearing", async () => {
  const t = await setup();
  const base = t.call.getMockImplementation()!;
  let saved = false;
  t.call.mockImplementation(async (op, p, b, o) => {
    if (op === "contribution_drafts.read" && saved)
      throw new ApiError(503, "offline");
    const out = await base(op, p, b, o);
    if (op === "contribution_drafts.save") saved = true;
    return out;
  });
  await act(() => t.ref.current!.act("save"));
  expect(
    screen.getByText(/Sauvegarde confirmée ; relecture indisponible/),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: "Vérifier la sauvegarde du brouillon d’ajout",
    }),
  ).toBeNull();
  t.call.mockImplementation(base);
  await act(() => t.ref.current!.act("inspect"));
  await act(() => t.ref.current!.act("clear"));
  expect(
    t.call.mock.calls
      .filter((x) => x[0] === "contribution_drafts.save")
      .at(-1)?.[2],
  ).toMatchObject({ content: null, expected_revision: 1 });
});
it("discards late draft content when capability disappears", async () => {
  const t = await setup();
  let finish!: (v: never) => void;
  t.call.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  let pending!: Promise<string>;
  act(() => {
    pending = t.ref.current!.act("inspect");
  });
  t.rerender(t.ui(content, false));
  await act(async () => {
    finish({
      revision: 3,
      content,
      state: "available",
      updated_at: null,
    } as never);
    await pending;
  });
  expect(
    screen.queryByRole("region", { name: "Brouillon privé de contribution" }),
  ).toBeNull();
  expect(t.onRestore).not.toHaveBeenCalled();
});
it("rejects malformed hidden-content responses and maps all explicit chat draft actions", () => {
  expect(() =>
    validateContributionDraft({
      revision: 1,
      state: "source_unavailable",
      content,
      updated_at: null,
    }),
  ).toThrow();
  for (const [verb, action] of [
    ["enregistre", "save"],
    ["montre", "inspect"],
    ["utilise", "restore"],
    ["vérifie", "recover"],
    ["efface", "clear"],
  ])
    expect(chatIntent(`${verb} mon brouillon d’ajout`)).toEqual({
      kind: "contribution_draft",
      action,
    });
  expect(chatIntent("utilise mon brouillon d’ajout : et publie")).toEqual({
    kind: "contribution_invalid",
  });
});

it("hides the inspected content if the final source validation refuses restoration", async () => {
  const t = await setup({
    revision: 1,
    state: "available",
    content,
    updated_at: null,
  });
  await act(() => t.ref.current!.act("inspect"));
  t.onRestore.mockResolvedValue(false);
  await act(() => t.ref.current!.act("restore"));
  expect(screen.queryByText(content.excerpt)).toBeNull();
  expect(screen.queryByRole("heading", { name: content.title })).toBeNull();
});
