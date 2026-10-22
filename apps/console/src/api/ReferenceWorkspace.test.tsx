import { readReferenceRecovery, recoveryKey } from "./referenceRecoveryStore";
import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ReferenceWorkspace,
  type ReferenceActions,
  referenceContent,
} from "./ReferenceWorkspace";
import { ApiError, type CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
import type { ReferenceIntent } from "./referenceCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  sourceId = "00000000-0000-0000-0000-000000000002",
  qid = "00000000-0000-0000-0000-000000000003",
  rid = "00000000-0000-0000-0000-000000000004";
const source = {
  id: sourceId,
  title: "Règle Unicode",
  location: "synthetic://reference",
  content_hash: "a".repeat(64),
  content: "Préface 🧠. Cinq jours. Fin.",
  allowed_subjects: ["reader"],
  supersedes: null,
};
const content = {
  theme: "Revue",
  question: "Quelle durée ?",
  criteria: "Citer cinq jours.",
  excerpt: "Cinq jours.",
  source_id: sourceId,
  source_hash: source.content_hash,
  selection: { start: 11, end: 22 },
};
const draft = {
  id: qid,
  content,
  revision: 1,
  updated_at: "2026-10-17T00:00:00Z",
  status: "draft",
  visibility: "personal",
};
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function setup() {
  const state = {
    revision: 1,
    denied: false,
    saveError: undefined as unknown,
    saved: [] as unknown[],
    text: source.content,
    content,
    passageError: undefined as unknown,
  };
  const call = vi.fn(
    async (
      op: string,
      params: unknown,
      body: unknown,
      options?: { query?: { offset?: number; limit?: number } },
    ): Promise<unknown> => {
      if (op === "identity.read")
        return {
          domains: [
            {
              id: domain,
              capabilities: state.denied ? [] : ["reference_drafts"],
            },
          ],
        };
      if (op === "sources.list") return { items: [source], next_after: null };
      if (op === "sources.locate") {
        if (state.passageError) throw state.passageError;
        const input = body as {
          excerpt: string;
          start?: number;
          expected_hash?: string;
        };
        const at =
          input.start ??
          Array.from(state.text.slice(0, state.text.indexOf(input.excerpt)))
            .length;
        const chars = Array.from(state.text),
          end = at + Array.from(input.excerpt).length;
        if (chars.slice(at, end).join("") !== input.excerpt)
          throw new ApiError(422, "invalid");
        if (
          input.start === undefined &&
          state.text.indexOf(
            input.excerpt,
            state.text.indexOf(input.excerpt) + 1,
          ) >= 0
        )
          throw new ApiError(422, "AMBIGUOUS_EXCERPT");
        return {
          source_id: sourceId,
          title: source.title,
          location: source.location,
          content_hash: source.content_hash,
          start: at,
          end,
          total_characters: chars.length,
          offset_unit: "unicode_code_point",
        };
      }
      if (op === "sources.passage") {
        if (state.passageError) throw state.passageError;
        const chars = Array.from(state.text),
          start = options?.query?.offset ?? 0,
          end = Math.min(chars.length, start + (options?.query?.limit ?? 8192));
        return {
          source_id: sourceId,
          title: source.title,
          location: source.location,
          content_hash: source.content_hash,
          start,
          end,
          total_characters: chars.length,
          excerpt: chars.slice(start, end).join(""),
          next_offset: end < chars.length ? end : null,
          offset_unit: "unicode_code_point",
        };
      }
      if (op === "reference_drafts.list")
        return {
          items: [
            {
              id: qid,
              question: content.question,
              theme: content.theme,
              revision: state.revision,
              updated_at: draft.updated_at,
            },
          ],
          next_after: null,
        };
      if (op === "reference_drafts.read")
        return { ...draft, content: state.content, revision: state.revision };
      if (op === "reference_drafts.save") {
        state.saved.push(body);
        if (state.saveError) throw state.saveError;
        return {
          receipt_id: rid,
          question_id: (params as { question: string }).question,
          revision:
            (body as { expected_revision: number }).expected_revision + 1,
        };
      }
      throw Error(op);
    },
  );
  const ref = createRef<ReferenceActions>();
  const onNotice = vi.fn();
  const view = render(
    <ReferenceWorkspace
      ref={ref}
      recoveryScope={{ tenant: domain, subject: "reader" }}
      api={{ call } as unknown as CortexApi}
      domain={domain}
      onNotice={onNotice}
    />,
  );
  const action = async (i: ReferenceIntent) => {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(i);
    });
    return result;
  };
  return { state, call, ref, onNotice, view, action };
}
async function fill(s: ReturnType<typeof setup>) {
  await s.action({ kind: "reference_source_search", value: "Règle" });
  await s.action({ kind: "reference_source_select", value: "1" });
  for (const field of ["theme", "question", "criteria", "excerpt"] as const)
    await s.action({ kind: "reference_field", field, value: content[field] });
}
it("shares UI/chat preparation and only saves after confirmation with exact Unicode proof", async () => {
  const s = setup();
  await fill(s);
  expect(s.state.saved).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Préparer la question de référence" }),
  );
  await screen.findByRole("region", {
    name: "Sauvegarde de référence à confirmer",
  });
  expect(s.state.saved).toHaveLength(0);
  await s.action({ kind: "reference_confirm" });
  expect(s.state.saved).toHaveLength(1);
  expect(s.state.saved[0]).toMatchObject({ content, expected_revision: 0 });
  expect(screen.getByText(/Question privée enregistrée/)).toBeDefined();
});
it("retries exactly an unknown save and prevents replacing or abandoning its intent", async () => {
  const s = setup();
  await fill(s);
  await s.action({ kind: "reference_prepare" });
  s.state.saveError = new ApiError(503, "unavailable");
  await s.action({ kind: "reference_confirm" });
  expect(screen.getByText(/Résultat inconnu/)).toBeDefined();
  await s.action({ kind: "reference_new" });
  await s.action({ kind: "reference_cancel" });
  await s.action({ kind: "reference_confirm" });
  expect(s.state.saved).toHaveLength(1);
  s.state.saveError = undefined;
  await s.action({ kind: "reference_retry" });
  expect(s.state.saved).toHaveLength(2);
  expect(s.state.saved[1]).toEqual(s.state.saved[0]);
});
it("keeps dirty fields when choosing another source or question; explicit cancel clears only local fields", async () => {
  const s = setup();
  await fill(s);
  await s.action({ kind: "reference_open", value: qid });
  await s.action({ kind: "reference_source_select", value: "1" });
  expect(
    (screen.getByLabelText("Question de référence") as HTMLTextAreaElement)
      .value,
  ).toBe(content.question);
  await s.action({ kind: "reference_cancel" });
  expect(screen.queryByLabelText("Question de référence")).toBeNull();
  expect(s.state.saved).toHaveLength(0);
});
it("restores a numbered private question, rejects a newer revision without overwriting", async () => {
  const s = setup();
  await s.action({ kind: "reference_list", next: false });
  await s.action({ kind: "reference_open", value: "1" });
  await s.action({
    kind: "reference_field",
    field: "criteria",
    value: "Autre critère",
  });
  s.state.revision = 2;
  expect(await s.action({ kind: "reference_prepare" })).toContain(
    "autre onglet",
  );
  expect(s.state.saved).toHaveLength(0);
  expect(
    screen.queryByRole("region", {
      name: "Sauvegarde de référence à confirmer",
    }),
  ).toBeNull();
});
it("masks fields on denied fresh permission and never prepares a save", async () => {
  const s = setup();
  await fill(s);
  s.state.denied = true;
  await s.action({ kind: "reference_prepare" });
  expect(screen.queryByLabelText("Question de référence")).toBeNull();
  expect(s.state.saved).toHaveLength(0);
});
it("definite conflict ends an intent; malformed receipt remains unknown", async () => {
  const s = setup();
  await fill(s);
  await s.action({ kind: "reference_prepare" });
  s.state.saveError = new ApiError(409, "conflict");
  await s.action({ kind: "reference_confirm" });
  expect(
    screen.queryByRole("region", {
      name: "Sauvegarde de référence à confirmer",
    }),
  ).toBeNull();
  s.state.saveError = undefined;
  await s.action({ kind: "reference_passage", value: "0" });
  await s.action({ kind: "reference_prepare" });
  s.call.mockResolvedValueOnce({
    receipt_id: rid,
    question_id: qid,
    revision: 99,
  });
  await s.action({ kind: "reference_confirm" });
  expect(screen.getByText(/Résultat inconnu/)).toBeDefined();
});
it("does not restore late content after unmount", async () => {
  const s = setup();
  let finish!: (v: unknown) => void;
  s.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve as (v: unknown) => void;
      }),
  );
  let pending!: Promise<string>;
  act(() => {
    pending = s.ref.current!.act({
      kind: "reference_source_search",
      value: "Règle",
    });
  });
  s.view.unmount();
  await act(async () => {
    finish({ items: [source], next_after: null });
    await pending;
  });
  expect(s.onNotice).not.toHaveBeenCalled();
});
it("rejects blank criteria and oversize proof; routes every explicit reference phrase without an LLM", () => {
  expect(() => referenceContent({ ...content, criteria: " " })).toThrow();
  expect(() =>
    referenceContent({ ...content, excerpt: "🧠".repeat(10001) }),
  ).toThrow();
  for (const phrase of [
    "sources de référence suivantes",
    "mes questions de référence",
    "ouvre la question de référence : 1",
    "cherche une source de référence : titre",
    "choisis la source de référence : 1",
    "thème de référence : revue",
    "question de référence : quelle durée ?",
    "critères de référence : cinq jours",
    "preuve de référence : Cinq jours.",
    "prépare la question de référence",
    "confirme la question de référence",
    "reprends la sauvegarde de référence",
    "vérifie le reçu de référence",
    "annule la saisie de référence",
    "nouvelle question de référence",
    "questions de référence suivantes",
  ]) {
    expect(chatIntent(phrase).kind).toMatch(/^reference_/);
  }
});

it.each([403, 404, 409, 422])(
  "keeps first outcome unknown after retry refusal %s, then verifies by GET only",
  async (status) => {
    const s = setup();
    await s.action({ kind: "reference_open", value: qid });
    await s.action({ kind: "reference_prepare" });
    s.state.saveError = new ApiError(502, "lost");
    await s.action({ kind: "reference_confirm" });
    s.state.saveError = new ApiError(status, "retry_refused");
    expect(await s.action({ kind: "reference_retry" })).toContain(
      "premier envoi reste inconnu",
    );
    if ([403, 404].includes(status))
      expect(screen.queryByLabelText("Question de référence")).toBeNull();
    await s.action({ kind: "reference_cancel" });
    await s.action({ kind: "reference_new" });
    expect(s.state.saved).toHaveLength(2);
    expect(s.state.saved[0]).toEqual(s.state.saved[1]);
    const body = s.state.saved[0] as { idempotency_key: string };
    s.call.mockResolvedValueOnce({
      command_id: body.idempotency_key,
      receipt: { receipt_id: rid, question_id: qid, revision: 2 },
    });
    expect(await s.action({ kind: "reference_verify" })).toContain(
      "Sauvegarde retrouvée",
    );
    expect(s.call.mock.calls.at(-1)?.[0]).toBe("reference_draft_receipts.read");
    expect(s.call.mock.calls.at(-1)?.[2]).toBeUndefined();
    expect(s.state.saved).toHaveLength(2);
    expect(
      screen.queryByRole("region", {
        name: "Sauvegarde de référence à vérifier",
      }),
    ).toBeNull();
  },
);
it.each([404, 503, "malformed"])(
  "keeps unknown after unconfirmed receipt %s and never resends",
  async (failure) => {
    const s = setup();
    await fill(s);
    await s.action({ kind: "reference_prepare" });
    s.state.saveError = new ApiError(502, "lost");
    await s.action({ kind: "reference_confirm" });
    if (typeof failure === "number")
      s.call.mockRejectedValueOnce(new ApiError(failure, "missing"));
    else
      s.call.mockResolvedValueOnce({
        command_id: rid,
        receipt: { receipt_id: rid, question_id: qid, revision: 999 },
      });
    expect(await s.action({ kind: "reference_verify" })).toContain(
      "résultat reste inconnu",
    );
    expect(s.state.saved).toHaveLength(1);
    expect(
      screen.getByRole("region", {
        name: "Sauvegarde de référence à vérifier",
      }),
    ).toBeTruthy();
    expect(await s.action({ kind: "reference_new" })).toContain(
      "Résultat inconnu",
    );
  },
);

it("recovers a lost response after remount using only its receipt GET, never its body", async () => {
  const first = setup();
  await first.action({ kind: "reference_open", value: qid });
  await first.action({ kind: "reference_prepare" });
  first.state.saveError = new ApiError(502, "lost");
  await first.action({ kind: "reference_confirm" });
  const entries = readReferenceRecovery({
    tenant: domain,
    subject: "reader",
  }).entries;
  expect(entries).toHaveLength(1);
  expect(sessionStorage.getItem(recoveryKey)).not.toContain(content.question);
  expect(sessionStorage.getItem(recoveryKey)).not.toContain(content.excerpt);
  first.view.unmount();
  const resumed = setup();
  expect(screen.queryByLabelText("Question de référence")).toBeNull();
  expect(
    screen.getByRole("region", {
      name: "Sauvegardes de référence après interruption",
    }),
  ).toBeTruthy();
  expect(await resumed.action({ kind: "reference_new" })).toContain(
    "Résultat inconnu",
  );
  resumed.call.mockRejectedValueOnce(new ApiError(404, "not_yet"));
  expect(await resumed.action({ kind: "reference_verify" })).toContain(
    "reste inconnu",
  );
  expect(resumed.state.saved).toHaveLength(0);
  resumed.call.mockResolvedValueOnce({
    command_id: entries[0].command,
    receipt: { receipt_id: rid, question_id: qid, revision: 2 },
  });
  expect(await resumed.action({ kind: "reference_verify" })).toContain(
    "Sauvegarde retrouvée",
  );
  expect(
    resumed.call.mock.calls.filter(
      (c) => c[0] === "reference_draft_receipts.read",
    ),
  ).toHaveLength(2);
  expect(resumed.state.saved).toHaveLength(0);
  expect(
    readReferenceRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toHaveLength(0);
});
it("never sends when the reference cannot be stored, and clears only a definite first refusal", async () => {
  const s = setup();
  await fill(s);
  await s.action({ kind: "reference_prepare" });
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw Error("denied");
    });
  expect(await s.action({ kind: "reference_confirm" })).toContain(
    "Aucun nouvel envoi",
  );
  expect(s.state.saved).toHaveLength(0);
  storage.mockRestore();
  s.state.saveError = new ApiError(409, "conflict");
  await s.action({ kind: "reference_confirm" });
  expect(
    readReferenceRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toHaveLength(0);
});
it("explicit removal after reload never cancels or resends the original command", async () => {
  const first = setup();
  await fill(first);
  await first.action({ kind: "reference_prepare" });
  first.state.saveError = new ApiError(502, "lost");
  await first.action({ kind: "reference_confirm" });
  const command = readReferenceRecovery({ tenant: domain, subject: "reader" })
    .entries[0].command;
  expect(
    await first.action({ kind: "reference_forget", value: command }),
  ).toContain("Vérifiez");
  first.view.unmount();
  const resumed = setup();
  expect(
    await resumed.action({ kind: "reference_forget", value: command }),
  ).toContain("ne prouve pas son échec");
  expect(resumed.call).not.toHaveBeenCalled();
  expect(
    readReferenceRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toHaveLength(0);
});

it("restores the latest private version by direct id and distinguishes the frozen reviewed version", async () => {
  const s = setup();
  s.state.revision = 4;
  expect(
    await s.action({ kind: "reference_open", value: qid, reviewedRevision: 2 }),
  ).toMatch(/actuelle restaurée en version 4.*figée en version 2/);
  expect(
    (screen.getByLabelText("Question de référence") as HTMLTextAreaElement)
      .value,
  ).toBe(content.question);
  expect(s.call.mock.calls.some(([op]) => op === "reference_drafts.list")).toBe(
    false,
  );
  expect(s.state.saved).toHaveLength(0);
});
it("preserves an existing private edit when arriving from a review", async () => {
  const s = setup();
  await fill(s);
  expect(
    await s.action({ kind: "reference_open", value: qid, reviewedRevision: 2 }),
  ).toMatch(/Enregistrez ou annulez/);
  expect(
    (screen.getByLabelText("Question de référence") as HTMLTextAreaElement)
      .value,
  ).toBe(content.question);
  expect(s.call.mock.calls.some(([op]) => op === "reference_drafts.read")).toBe(
    false,
  );
  expect(s.state.saved).toHaveLength(0);
});

it("pages a long source while preserving fields and validates a cross-page10000character proof with two bounded reads", async () => {
  const s = setup();
  s.state.text = "🧠".repeat(150000) + "fin";
  await fill(s);
  await s.action({ kind: "reference_passage", value: "140000" });
  expect(
    (screen.getByLabelText("Question de référence") as HTMLTextAreaElement)
      .value,
  ).toBe(content.question);
  expect(
    Array.from(
      (
        screen.getByLabelText(
          "Passage source de référence",
        ) as HTMLTextAreaElement
      ).value,
    ),
  ).toHaveLength(8192);
  await s.action({
    kind: "reference_field",
    field: "excerpt",
    value: "🧠".repeat(10000),
  });
  await s.action({ kind: "reference_position", value: "140000" });
  const before = s.call.mock.calls.length;
  await s.action({ kind: "reference_prepare" });
  const reads = s.call.mock.calls
    .slice(before)
    .filter((x) => x[0] === "sources.passage");
  expect(reads.map((x) => x[3]?.query)).toMatchObject([
    { offset: 140000, limit: 8192, expected_hash: source.content_hash },
    { offset: 148192, limit: 1808, expected_hash: source.content_hash },
  ]);
  await s.action({ kind: "reference_confirm" });
  expect(s.state.saved[0]).toMatchObject({
    content: {
      selection: { start: 140000, end: 150000 },
      excerpt: "🧠".repeat(10000),
    },
  });
  expect(s.call.mock.calls.some((x) => x[0] === "sources.read")).toBe(false);
});
it("selects a repeated occurrence in the displayed page using Unicode positions", async () => {
  const s = setup();
  s.state.text = "🧠oui oui";
  await s.action({ kind: "reference_source_search", value: "Règle" });
  await s.action({ kind: "reference_source_select", value: "1" });
  const input = screen.getByLabelText(
    "Passage source de référence",
  ) as HTMLTextAreaElement;
  input.setSelectionRange(6, 9);
  fireEvent.click(
    screen.getByRole("button", { name: "Utiliser la sélection comme preuve" }),
  );
  expect(
    (screen.getByLabelText("Preuve de référence") as HTMLTextAreaElement).value,
  ).toBe("oui");
  expect(
    (
      screen.getByLabelText(
        "Début de la preuve (facultatif)",
      ) as HTMLInputElement
    ).value,
  ).toBe("5");
});
it("masks a denied page and all dependent reference fields, but keeps drafts on transient page errors", async () => {
  const s = setup();
  await fill(s);
  s.state.passageError = new ApiError(503, "unavailable");
  await s.action({ kind: "reference_passage", value: "0" });
  expect(screen.queryByLabelText("Passage source de référence")).toBeNull();
  expect(
    (screen.getByLabelText("Question de référence") as HTMLTextAreaElement)
      .value,
  ).toBe(content.question);
  s.state.passageError = new ApiError(404, "not_found");
  await s.action({ kind: "reference_passage", value: "0" });
  expect(screen.queryByLabelText("Question de référence")).toBeNull();
  expect(s.state.saved).toHaveLength(0);
});
it("refuses wrong occurrence and source changes without preparing or saving", async () => {
  const s = setup();
  await fill(s);
  await s.action({ kind: "reference_position", value: "12" });
  await s.action({ kind: "reference_prepare" });
  expect(
    screen.queryByRole("region", {
      name: "Sauvegarde de référence à confirmer",
    }),
  ).toBeNull();
  await s.action({ kind: "reference_position", value: "11" });
  s.state.passageError = new ApiError(409, "source_changed");
  await s.action({ kind: "reference_prepare" });
  expect(screen.queryByLabelText("Passage source de référence")).toBeNull();
  expect(s.state.saved).toHaveLength(0);
});
it("routes exact source-page and occurrence commands without invoking a question", () => {
  expect(chatIntent("Passage de référence suivant")).toMatchObject({
    kind: "reference_passage",
    value: "next",
  });
  expect(chatIntent("Lis la source de référence à : 140000")).toMatchObject({
    kind: "reference_passage",
    value: "140000",
  });
  expect(chatIntent("Début de preuve de référence : 140000")).toMatchObject({
    kind: "reference_position",
    value: "140000",
  });
});

it("restores an existing10000character proof by two pages and retains the saved occurrence for edits", async () => {
  const s = setup();
  s.state.text = "🧠".repeat(30000);
  s.state.content = {
    ...content,
    excerpt: "🧠".repeat(10000),
    selection: { start: 15000, end: 25000 },
  };
  await s.action({ kind: "reference_open", value: qid });
  expect(
    (screen.getByLabelText("Preuve de référence") as HTMLTextAreaElement).value,
  ).toBe(s.state.content.excerpt);
  expect(
    (
      screen.getByLabelText(
        "Début de la preuve (facultatif)",
      ) as HTMLInputElement
    ).value,
  ).toBe("15000");
  expect(
    Array.from(
      (
        screen.getByLabelText(
          "Passage source de référence",
        ) as HTMLTextAreaElement
      ).value,
    ),
  ).toHaveLength(8192);
  await s.action({
    kind: "reference_field",
    field: "criteria",
    value: "Nouveau critère",
  });
  await s.action({ kind: "reference_prepare" });
  expect(
    screen.getByRole("region", { name: "Sauvegarde de référence à confirmer" }),
  ).toBeDefined();
  expect(s.state.saved).toHaveLength(0);
});
it("does not restore a draft whose stored positions disagree with its excerpt", async () => {
  const s = setup();
  s.state.content = { ...content, selection: { start: 11, end: 23 } };
  await s.action({ kind: "reference_open", value: qid });
  expect(screen.queryByLabelText("Question de référence")).toBeNull();
  expect(
    s.call.mock.calls.filter((x) => x[0] === "sources.passage"),
  ).toHaveLength(0);
});

it("locates a pasted proof outside the displayed page without full source transport", async () => {
  const s = setup();
  s.state.text = "x".repeat(150000) + content.excerpt;
  await fill(s);
  await s.action({ kind: "reference_prepare" });
  await s.action({ kind: "reference_confirm" });
  expect(s.state.saved[0]).toMatchObject({
    content: { selection: { start: 150000, end: 150011 } },
  });
  expect(s.call.mock.calls.some((x) => x[0] === "sources.read")).toBe(false);
});
it("refuses whole-source ambiguity and accepts the explicitly chosen occurrence", async () => {
  const s = setup();
  s.state.text = content.excerpt + "x".repeat(150000) + content.excerpt;
  await fill(s);
  await s.action({ kind: "reference_prepare" });
  expect(
    screen
      .getByText(
        /Ce passage apparaît plusieurs fois. Sélectionnez son occurrence/,
      )
      .getAttribute("role"),
  ).toBe("status");
  expect(
    screen.queryByRole("region", {
      name: "Sauvegarde de référence à confirmer",
    }),
  ).toBeNull();
  expect(s.state.saved).toHaveLength(0);
  await s.action({ kind: "reference_position", value: "150011" });
  await s.action({ kind: "reference_prepare" });
  await s.action({ kind: "reference_confirm" });
  expect(s.state.saved[0]).toMatchObject({
    content: { selection: { start: 150011, end: 150022 } },
  });
});
