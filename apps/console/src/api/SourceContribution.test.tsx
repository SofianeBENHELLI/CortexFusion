import React, { createRef } from "react";
import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
import {
  SourceContribution,
  exactPassage,
  type SourceContributionHandle,
} from "./SourceContribution";
import { chatIntent } from "./workspaceCommands";
import type { ProposalInput } from "../../../../packages/contracts/src/ProposalInput";
const domain = "00000000-0000-0000-0000-000000000001",
  source = "00000000-0000-0000-0000-000000000002",
  proposal = "00000000-0000-0000-0000-000000000003";
const text = "Préface 🧠. La revue dure cinq jours. Fin.";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(withDraft = false, sourceText = text) {
  const state = { text: sourceText };
  const api = new CortexApi(() => null);
  const ref = createRef<SourceContributionHandle>();
  const onNotice = vi.fn(),
    onOpen = vi.fn();
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _params, body, options) => {
      if (op === "contribution_drafts.read")
        return {
          revision: 1,
          state: "available",
          updated_at: null,
          content: {
            source_id: source,
            source_hash: "a".repeat(64),
            title: "Brouillon distant",
            excerpt: "La revue dure cinq jours.",
            reason: "Motif du brouillon",
            selection: { start: 11, end: 36 },
          },
        } as never;
      if (op === "identity.read")
        return {
          subject: "reader",
          tenant_id: domain,
          domains: [
            { id: domain, role: "contributor", capabilities: ["propose"] },
          ],
        } as never;
      if (op === "sources.passage" || op === "sources.locate") {
        const chars = Array.from(state.text);
        const request = body as {
          excerpt: string;
          start?: number;
          expected_hash?: string;
        };
        const query = options?.query as
          | { offset?: number; limit?: number; expected_hash?: string }
          | undefined;
        if (
          (query?.expected_hash ?? request?.expected_hash) &&
          (query?.expected_hash ?? request?.expected_hash) !== "a".repeat(64)
        )
          throw new ApiError(409, "SOURCE_CHANGED");
        let start = Number(query?.offset ?? 0),
          end = Math.min(start + Number(query?.limit ?? 8192), chars.length);
        if (op === "sources.locate") {
          const found = state.text.indexOf(request.excerpt);
          if (
            request.start === undefined &&
            found >= 0 &&
            state.text.indexOf(request.excerpt, found + 1) >= 0
          )
            throw new ApiError(422, "AMBIGUOUS_EXCERPT");
          start =
            request.start ?? Array.from(state.text.slice(0, found)).length;
          end = start + Array.from(request.excerpt).length;
          if (found < 0 || chars.slice(start, end).join("") !== request.excerpt)
            throw new ApiError(422, "invalid");
        }
        const result = {
          source_id: (_params as { source_id: string }).source_id,
          title: "Source synthétique",
          location: "synthetic://contribution",
          content_hash: "a".repeat(64),
          start,
          end,
          total_characters: chars.length,
          offset_unit: "unicode_code_point",
        };
        return (
          op === "sources.locate"
            ? result
            : {
                ...result,
                excerpt: chars.slice(start, end).join(""),
                next_offset: end < chars.length ? end : null,
              }
        ) as never;
      }
      if (op === "domain.version")
        return {
          domain_id: domain,
          published_version: 0,
          accepted_version: 0,
        } as never;
      if (op === "proposals.create") {
        const p = body as ProposalInput;
        return {
          id: proposal,
          base_version: p.base_version,
          reason: p.reason,
          payload: p.changes,
          digest: "b".repeat(64),
          review_revision: 0,
          status: "ready",
        } as never;
      }
      throw Error(op);
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (canPropose = true) => (
    <QueryClientProvider client={cache}>
      <SourceContribution
        ref={ref}
        api={api}
        domain={domain}
        canPropose={canPropose}
        canDraft={withDraft}
        onNotice={onNotice}
        onOpen={onOpen}
      />
    </QueryClientProvider>
  );
  const rendered = render(ui());
  return { state, api, ref, call, onNotice, onOpen, cache, ...rendered, ui };
}
const prepared = {
  kind: "contribution_prepare" as const,
  source,
  title: "Règle de revue",
  excerpt: "La revue dure cinq jours.",
  reason: "Passage à examiner",
};
async function prepare(ref: React.RefObject<SourceContributionHandle>) {
  await act(async () => {
    await ref.current!.act(prepared);
  });
}
it("prepares from chat and confirms via UI using a Unicode source span, never publication", async () => {
  const { ref, call, onOpen } = setup();
  await prepare(ref);
  expect(call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(false);
  expect(document.activeElement?.textContent).toContain("Ajout à confirmer");
  fireEvent.click(screen.getByRole("button", { name: "Confirmer l’ajout" }));
  await screen.findByRole("button", {
    name: "Ouvrir la proposition enregistrée",
  });
  const body = call.mock.calls.find(
    (c) => c[0] === "proposals.create",
  )![2] as ProposalInput;
  const concept = body.changes[0];
  if (concept.kind !== "put_concept") throw Error("wrong change");
  expect(concept.concept.sources[0]).toEqual({
    source_id: source,
    start: 11,
    end: 36,
  });
  expect(concept.concept.maturity).toBe("emerging");
  expect(concept.concept.links).toEqual([]);
  fireEvent.click(
    screen.getByRole("button", { name: "Ouvrir la proposition enregistrée" }),
  );
  expect(onOpen).toHaveBeenCalledWith(proposal);
  expect(
    call.mock.calls.every((c) =>
      [
        "identity.read",
        "sources.passage",
        "sources.locate",
        "domain.version",
        "proposals.create",
      ].includes(c[0]),
    ),
  ).toBe(true);
});
it("never sends an unconfirmed preparation as recovery and expires it", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "contribution_recover" });
  });
  expect(
    call.mock.calls.filter((c) => c[0] === "proposals.create"),
  ).toHaveLength(0);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 301000);
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  expect(screen.getByRole("status").textContent).toContain("expiré");
  expect(
    call.mock.calls.filter((c) => c[0] === "proposals.create"),
  ).toHaveLength(0);
});
it("retains the exact key/body after lost response and refuses replacing its source", async () => {
  const { ref, call } = setup();
  const original = call.getMockImplementation()!;
  let attempts = 0;
  call.mockImplementation(async (op, p, b, o) => {
    if (op === "proposals.create" && attempts++ === 0)
      throw new ApiError(0, "network_error");
    return original(op, p, b, o);
  });
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  await screen.findByRole("button", { name: "Vérifier le même ajout" });
  await act(async () => {
    await ref.current!.act({ kind: "contribution_load", source: domain });
  });
  await act(async () => {
    await ref.current!.act({ kind: "contribution_recover" });
  });
  const bodies = call.mock.calls
    .filter((c) => c[0] === "proposals.create")
    .map((c) => c[2]);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(
    screen.getByRole("button", { name: "Ouvrir la proposition enregistrée" }),
  ).toBeTruthy();
});
it("hides source and preview if current access is revoked before confirmation", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, o) => {
    if (op === "sources.locate") throw new ApiError(404, "NOT_FOUND");
    return original(op, p, b, o);
  });
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  expect(
    screen.queryByLabelText("Passage source pour contribution"),
  ).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Projet d’ajout sourcé" }),
  ).toBeNull();
  expect(call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(false);
});
it("rejects changed source state without silently replacing the prepared payload", async () => {
  const { ref, call } = setup();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, o) => {
    if (op === "sources.locate") throw new ApiError(409, "SOURCE_CHANGED");
    return original(op, p, b, o);
  });
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  expect(call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Confirmer l’ajout" }),
  ).toBeNull();
});
it("keeps a mismatched success receipt uncertain rather than claiming creation", async () => {
  const { ref, call } = setup();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, p, b, o) => {
    const result = await original(op, p, b, o);
    return op === "proposals.create"
      ? ({ ...result, reason: "wrong" } as never)
      : result;
  });
  await prepare(ref);
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  expect(
    screen.getByRole("button", { name: "Vérifier le même ajout" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Ouvrir la proposition enregistrée" }),
  ).toBeNull();
});
it("uses an explicitly selected repeated occurrence instead of guessing the first", async () => {
  const { ref, call } = setup(false, "🧠test test");
  await act(async () => {
    await ref.current!.act({ kind: "contribution_load", source });
  });
  const area = screen.getByLabelText(
    "Passage source pour contribution",
  ) as HTMLTextAreaElement;
  area.setSelectionRange(7, 11);
  fireEvent.select(area);
  fireEvent.click(
    screen.getByRole("button", { name: "Utiliser le passage sélectionné" }),
  );
  fireEvent.change(screen.getByLabelText("Motif de l’ajout"), {
    target: { value: "Deuxième occurrence" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Préparer l’ajout" }));
  await screen.findByRole("region", { name: "Projet d’ajout sourcé" });
  await act(async () => {
    await ref.current!.act({ kind: "contribution_confirm" });
  });
  const body = call.mock.calls.find(
    (c) => c[0] === "proposals.create",
  )![2] as ProposalInput;
  expect(
    body.changes[0].kind === "put_concept" &&
      body.changes[0].concept.sources[0],
  ).toEqual({ source_id: source, start: 6, end: 10 });
});
it("masks the editor when capability is withdrawn", async () => {
  const { ref, rerender, ui } = setup();
  await prepare(ref);
  rerender(ui(false));
  expect(screen.queryByText("Source synthétique")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Proposer un ajout sourcé" }),
  ).toBeNull();
});
it("enforces exact passages, Unicode counts, ambiguity and size before creating a proposal", () => {
  expect(exactPassage("🧠début fin", "fin")).toEqual({ start: 7, end: 10 });
  for (const [source, excerpt] of [
    ["abc", "abd"],
    ["abc abc", "abc"],
    ["x", ""],
    ["x".repeat(200001), "x".repeat(200001)],
  ])
    expect(() => exactPassage(source, excerpt)).toThrow();
  expect(
    chatIntent(`prépare un ajout sourcé : ${source} | titre | passage | motif`)
      .kind,
  ).toBe("contribution_prepare");
  expect(chatIntent("confirme l’ajout").kind).toBe("contribution_confirm");
  expect(chatIntent("prépare un ajout sourcé : mauvais").kind).toBe(
    "contribution_invalid",
  );
});

it("restores the saved contribution through chat only after inspection, with fresh source validation and no submission", async () => {
  const t = setup(true);
  await screen.findByText(/État courant : révision 1/);
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "inspect" }),
  );
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "restore" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Titre de l’ajout",
      }) as HTMLInputElement
    ).value,
  ).toBe("Brouillon distant");
  expect(
    (
      screen.getByRole("textbox", {
        name: "Passage exact à proposer",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("La revue dure cinq jours.");
  expect(t.call.mock.calls.some((x) => x[0] === "proposals.create")).toBe(
    false,
  );
  expect(t.call.mock.calls.some((x) => x[0] === "sources.passage")).toBe(true);
});

it("masks both the saved preview and restored source fields when draft reinspection reports lost source access", async () => {
  const t = setup(true);
  await screen.findByText(/État courant : révision 1/);
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "inspect" }),
  );
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "restore" }),
  );
  expect(
    screen.getByRole("textbox", { name: "Passage exact à proposer" }),
  ).toBeTruthy();
  const base = t.call.getMockImplementation()!;
  t.call.mockImplementation(async (op, p, b, o) =>
    op === "contribution_drafts.read"
      ? ({
          revision: 1,
          updated_at: null,
          state: "source_unavailable",
          content: null,
        } as never)
      : base(op, p, b, o),
  );
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "inspect" }),
  );
  expect(
    screen.queryByRole("textbox", { name: "Passage exact à proposer" }),
  ).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "Passage source pour contribution" }),
  ).toBeNull();
  expect(screen.queryByText("La revue dure cinq jours.")).toBeNull();
  expect(screen.getByText(/source inaccessible, contenu masqué/)).toBeTruthy();
});

it("protects entered work before choosing another source and shares replacement confirmation with chat", async () => {
  const { ref, call } = setup();
  await act(async () => {
    await ref.current!.act({ kind: "contribution_load", source });
  });
  fireEvent.change(screen.getByLabelText("Passage exact à proposer"), {
    target: { value: "La revue dure cinq jours." },
  });
  const before = call.mock.calls.filter(
    ([op]) => op === "sources.passage",
  ).length;
  await act(async () => {
    await ref.current!.act({ kind: "contribution_load", source: domain });
  });
  expect(
    call.mock.calls.filter(([op]) => op === "sources.passage"),
  ).toHaveLength(before);
  expect(
    screen.getByRole("region", { name: "Changement de source à confirmer" }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Garder ce travail" }));
  expect(
    (screen.getByLabelText("Passage exact à proposer") as HTMLTextAreaElement)
      .value,
  ).toContain("cinq jours");
  await act(async () => {
    await ref.current!.act({ kind: "contribution_load", source: domain });
    await ref.current!.act({
      kind: "contribution_source_replace",
      confirm: true,
    });
  });
  // Confirmation follows a separate render, just as a separate user action does.
  await act(async () => {
    await ref.current!.act({
      kind: "contribution_source_replace",
      confirm: true,
    });
  });
  expect(
    call.mock.calls.filter(([op]) => op === "sources.passage"),
  ).toHaveLength(before + 1);
  expect(call.mock.calls.some(([op]) => op === "proposals.create")).toBe(false);
});
it("routes title lookup and numbered source selection without pretending a title is an identifier", () => {
  expect(
    chatIntent("ouvre la source pour proposer : Règle de recette"),
  ).toEqual({ kind: "contribution_source_search", query: "Règle de recette" });
  expect(chatIntent("cherche une source : Règle")).toEqual({
    kind: "contribution_source_search",
    query: "Règle",
  });
  expect(chatIntent("choisis la source : 1")).toEqual({
    kind: "contribution_source_select",
    value: "1",
  });
  expect(chatIntent("sources suivantes")).toEqual({
    kind: "contribution_source_next",
  });
});

it("locates a distant unique excerpt without a full read and preserves fields across page navigation", async () => {
  const t = setup(false, "🧠".repeat(150000) + prepared.excerpt);
  await act(() => t.ref.current!.act({ kind: "contribution_load", source }));
  fireEvent.change(screen.getByLabelText("Passage exact à proposer"), {
    target: { value: prepared.excerpt },
  });
  fireEvent.change(screen.getByLabelText("Motif de l’ajout"), {
    target: { value: "Conserver mon motif" },
  });
  await act(() =>
    t.ref.current!.act({ kind: "contribution_passage", value: "next" }),
  );
  expect(
    (screen.getByLabelText("Motif de l’ajout") as HTMLTextAreaElement).value,
  ).toBe("Conserver mon motif");
  expect(
    Array.from(
      (
        screen.getByLabelText(
          "Passage source pour contribution",
        ) as HTMLTextAreaElement
      ).value,
    ),
  ).toHaveLength(8192);
  await act(() => t.ref.current!.act({ kind: "contribution_form" }));
  expect(
    screen.getByRole("region", { name: "Projet d’ajout sourcé" }).textContent,
  ).toContain("150000–150025");
  await act(() => t.ref.current!.act({ kind: "contribution_confirm" }));
  const body = t.call.mock.calls.find(
    (c) => c[0] === "proposals.create",
  )![2] as ProposalInput;
  expect(
    body.changes[0].kind === "put_concept" &&
      body.changes[0].concept.sources[0],
  ).toEqual({ source_id: source, start: 150000, end: 150025 });
  expect(t.call.mock.calls.some((c) => c[0] === "sources.read")).toBe(false);
  expect(
    t.call.mock.calls.filter((c) => c[0] === "sources.locate"),
  ).toHaveLength(2);
});
it("accepts the existing200000Unicode excerpt limit using bounded location and one displayed page", async () => {
  const body = "🧠".repeat(199999) + "z";
  const t = setup(false, "Préface." + body);
  await act(() => t.ref.current!.act({ ...prepared, excerpt: body }));
  expect(
    screen.getByRole("region", { name: "Projet d’ajout sourcé" }).textContent,
  ).toContain("8–200008");
  expect(
    t.call.mock.calls.filter((c) => c[0] === "sources.passage"),
  ).toHaveLength(1);
  expect(
    Array.from(
      (
        screen.getByLabelText(
          "Passage source pour contribution",
        ) as HTMLTextAreaElement
      ).value,
    ),
  ).toHaveLength(8192);
  await act(() => t.ref.current!.act({ kind: "contribution_confirm" }));
  const sent = t.call.mock.calls.find(
    (c) => c[0] === "proposals.create",
  )![2] as ProposalInput;
  expect(
    sent.changes[0].kind === "put_concept" && sent.changes[0].concept.body,
  ).toBe(body);
});
it("keeps fields after a failed page read, hides the page, then clears all content on revoked access", async () => {
  const t = setup(false, "x".repeat(10000));
  await act(() => t.ref.current!.act({ kind: "contribution_load", source }));
  fireEvent.change(screen.getByLabelText("Motif de l’ajout"), {
    target: { value: "Motif à conserver" },
  });
  const original = t.call.getMockImplementation()!;
  let status = 503;
  t.call.mockImplementation(async (op, p, b, o) => {
    if (op === "sources.passage") throw new ApiError(status, "failure");
    return original(op, p, b, o);
  });
  await act(() =>
    t.ref.current!.act({ kind: "contribution_passage", value: "next" }),
  );
  expect(
    screen.queryByLabelText("Passage source pour contribution"),
  ).toBeNull();
  expect(
    (screen.getByLabelText("Motif de l’ajout") as HTMLTextAreaElement).value,
  ).toBe("Motif à conserver");
  status = 404;
  await act(() =>
    t.ref.current!.act({ kind: "contribution_passage", value: "0" }),
  );
  expect(screen.queryByLabelText("Motif de l’ajout")).toBeNull();
  expect(screen.queryByText("Motif à conserver")).toBeNull();
  expect(t.call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(
    false,
  );
});
it("refuses repeated text until its occurrence is explicitly supplied by chat", async () => {
  const t = setup(false, "🧠test test");
  await act(() => t.ref.current!.act({ ...prepared, excerpt: "test" }));
  expect(screen.getByRole("status").textContent).toContain(
    "apparaît plusieurs fois",
  );
  expect(
    screen.queryByRole("region", { name: "Projet d’ajout sourcé" }),
  ).toBeNull();
  await act(() =>
    t.ref.current!.act({ ...prepared, excerpt: "test", start: 6 }),
  );
  expect(
    screen.getByRole("region", { name: "Projet d’ajout sourcé" }).textContent,
  ).toContain("6–10");
  expect(
    chatIntent(
      `prépare un ajout sourcé : ${source} | titre | test | motif | 6`,
    ),
  ).toMatchObject({ kind: "contribution_prepare", start: 6 });
  expect(chatIntent("Passage de contribution suivant")).toEqual({
    kind: "contribution_passage",
    value: "next",
  });
  expect(chatIntent("Lis la source de contribution à : 150000")).toEqual({
    kind: "contribution_passage",
    value: "150000",
  });
  expect(chatIntent("Début du passage à proposer : 6")).toEqual({
    kind: "contribution_position",
    value: "6",
  });
});
it("restores a draft from its distant page without loading its full source", async () => {
  const t = setup(true, "🧠".repeat(150000) + prepared.excerpt);
  const original = t.call.getMockImplementation()!;
  t.call.mockImplementation(async (op, p, b, o) => {
    const result = await original(op, p, b, o);
    return op === "contribution_drafts.read"
      ? ({
          ...result,
          content: {
            ...(result as any).content,
            selection: { start: 150000, end: 150025 },
          },
        } as never)
      : result;
  });
  await screen.findByText(/État courant : révision 1/);
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "inspect" }),
  );
  await act(() =>
    t.ref.current!.act({ kind: "contribution_draft", action: "restore" }),
  );
  expect(
    (
      screen.getByLabelText(
        "Passage source pour contribution",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe(prepared.excerpt);
  expect(
    (
      screen.getByLabelText(
        "Début du passage à proposer (facultatif)",
      ) as HTMLInputElement
    ).value,
  ).toBe("150000");
  expect(t.call.mock.calls.some((c) => c[0] === "sources.read")).toBe(false);
  expect(t.call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(
    false,
  );
});
it("removes neighbouring proposal cache content immediately when a source is denied", async () => {
  const t = setup();
  await act(() => t.ref.current!.act({ kind: "contribution_load", source }));
  t.cache.setQueryData(["api", "proposals", domain], {
    pages: [{ items: [{ reason: "Private reason" }] }],
  });
  t.cache.setQueryData(["api", "proposal-review", domain, proposal], {
    proposal: { reason: "Private reason" },
  });
  t.cache.setQueryData(["api", "proposals", source], { unrelated: true });
  const original = t.call.getMockImplementation()!;
  t.call.mockImplementation(async (op, p, b, o) => {
    if (op === "sources.passage") throw new ApiError(404, "NOT_FOUND");
    return original(op, p, b, o);
  });
  await act(() =>
    t.ref.current!.act({ kind: "contribution_passage", value: "0" }),
  );
  expect(t.cache.getQueryData(["api", "proposals", domain])).toBeUndefined();
  expect(
    t.cache.getQueryData(["api", "proposal-review", domain, proposal]),
  ).toBeUndefined();
  expect(t.cache.getQueryData(["api", "proposals", source])).toEqual({
    unrelated: true,
  });
});
