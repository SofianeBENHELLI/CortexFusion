import {
  readReviewRecovery,
  rememberReviewRecovery,
  recoveryKey,
} from "./reviewRecoveryStore";
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
  ReferenceReviewWorkspace,
  type ReferenceReviewActions,
} from "./ReferenceReviewWorkspace";
import { ApiError, type CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
import type { ReferenceReviewIntent } from "./referenceReviewCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  qid = "00000000-0000-0000-0000-000000000002",
  rid = "00000000-0000-0000-0000-000000000003",
  pid = "00000000-0000-0000-0000-000000000004",
  eid = "00000000-0000-0000-0000-000000000005";
const content = {
  theme: "Délai",
  question: "Quelle durée ?",
  criteria: "Citer cinq jours.",
  excerpt: "Cinq jours.",
  source_id: domain,
  source_hash: "a".repeat(64),
  selection: { start: 0, end: 11 },
};
const draft = {
  id: qid,
  content,
  revision: 2,
  updated_at: "2026-10-17T10:00:00Z",
  status: "draft",
  visibility: "personal",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function setup() {
  const state = {
    denied: false,
    error: undefined as unknown,
    receiptError: undefined as unknown,
    historyError: undefined as unknown,
    malformedHistory: false,
    malformed: false,
    expiry: Date.now() + 300000,
    acted: [] as { op: string; body: any }[],
    review: {
      id: rid,
      author: "reader",
      reviewer: "alice",
      question_id: qid,
      draft_revision: 2,
      revision: 1,
      status: "awaiting_review",
      content,
      review_note: "",
      created_at: draft.updated_at,
      updated_at: draft.updated_at,
      actions: ["withdraw"],
    } as any,
  };
  const call = vi.fn(
    async (op: string, params: any, body: any): Promise<unknown> => {
      if (op === "identity.read")
        return {
          domains: [
            {
              id: domain,
              capabilities: state.denied ? [] : ["reference_reviews"],
            },
          ],
        };
      if (op === "reference_drafts.list")
        return {
          items: [{ ...draft, question: content.question }],
          next_after: null,
        };
      if (op === "reference_drafts.read") return draft;
      if (op === "reference_reviewers.list")
        return {
          items: [{ subject: "alice", role: "owner" }],
          next_after: null,
        };
      if (op === "reference_reviews.prepare")
        return {
          preparation_id: pid,
          ...body,
          content,
          expires_at: new Date(state.expiry).toISOString(),
        };
      if (op === "reference_reviews.list")
        return { items: [state.review], next_after: null, scope: "mine" };
      if (op === "reference_reviews.read") {
        if (state.denied) throw new ApiError(404, "denied");
        return state.review;
      }
      if (
        op === "reference_reviews.submit" ||
        op === "reference_reviews.command"
      ) {
        state.acted.push({ op, body });
        if (state.error) throw state.error;
        return {
          review_id: state.malformed ? domain : rid,
          event_id: eid,
          revision: op.endsWith("submit") ? 1 : body.expected_revision + 1,
          status: op.endsWith("submit")
            ? "awaiting_review"
            : body.action === "withdraw"
              ? "withdrawn"
              : body.action === "request_changes"
                ? "changes_requested"
                : "ready_for_owner",
        };
      }
      if (op === "reference_reviews.events") {
        if (state.historyError) throw state.historyError;
        const withheld = state.review.status === "withdrawn";
        const records = [
          {
            id: eid,
            actor: "reader",
            action: "submit",
            revision: 1,
            status: "awaiting_review",
            note: "",
            created_at: draft.updated_at,
          },
        ];
        if (state.review.revision >= 2)
          records.push({
            id: pid,
            actor: "alice",
            action: "request_changes",
            revision: 2,
            status: "changes_requested",
            note: "Préciser le délai",
            created_at: draft.updated_at,
          });
        if (state.review.revision >= 3)
          records.push({
            id: qid,
            actor: "reader",
            action: "withdraw",
            revision: 3,
            status: "withdrawn",
            note: "Retrait privé",
            created_at: draft.updated_at,
          });
        return {
          review_id: rid,
          review_revision: state.review.revision,
          status: state.review.status,
          content_withheld: withheld,
          total: state.review.revision,
          items: records.map((e) => ({
            ...e,
            note: withheld && !state.malformedHistory ? null : e.note,
          })),
          next_after: null,
        };
      }
      if (op === "reference_review_receipts.read") {
        if (state.receiptError) throw state.receiptError;
        return {
          command_id: params.command_id,
          receipt: {
            review_id: rid,
            event_id: eid,
            revision: 1,
            status: "awaiting_review",
          },
        };
      }
      throw Error(op);
    },
  );
  const edit = vi.fn(async () => "Question privée actuelle restaurée.");
  const ref = createRef<ReferenceReviewActions>();
  const view = render(
    <ReferenceReviewWorkspace
      onEditQuestion={edit}
      recoveryScope={{ tenant: domain, subject: "reader" }}
      api={{ call } as unknown as CortexApi}
      ref={ref}
      domain={domain}
      onNotice={() => {}}
    />,
  );
  const action = async (i: ReferenceReviewIntent) => {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(i);
    });
    return result;
  };
  return { state, call, action, view, edit };
}
async function prepared(s: ReturnType<typeof setup>) {
  await s.action({ kind: "reference_review_questions" });
  await s.action({ kind: "reference_review_question", value: "1" });
  await s.action({ kind: "reference_review_recipient", value: "1" });
  await s.action({ kind: "reference_review_prepare" });
}
it("uses the same chat/UI preview and explicit send; recipients and snapshot remain exact", async () => {
  const s = setup();
  await prepared(s);
  expect(s.state.acted).toEqual([]);
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "Action de revue à confirmer" }),
  );
  expect(
    screen.getByRole("region", { name: "Action de revue à confirmer" })
      .textContent,
  ).toContain("alice");
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer l’action de revue" }),
  );
  await screen.findByText(/Action enregistrée/);
  expect(s.state.acted).toHaveLength(1);
  expect(s.state.acted[0].body).toMatchObject({
    question_id: qid,
    draft_revision: 2,
    reviewer: "alice",
    preparation_id: pid,
  });
  expect(
    screen.queryByRole("region", { name: "Action de revue à confirmer" }),
  ).toBeNull();
});
it("refuses an expired preparation before POST and permits a new preview", async () => {
  const s = setup();
  await prepared(s);
  vi.spyOn(Date, "now").mockReturnValue(s.state.expiry + 1);
  expect(await s.action({ kind: "reference_review_confirm" })).toMatch(
    /expirée/,
  );
  expect(s.state.acted).toHaveLength(0);
});
it("never resends after a lost response or missing receipt; retries only exact original body/key", async () => {
  const s = setup();
  await prepared(s);
  s.state.error = new ApiError(502, "lost");
  await s.action({ kind: "reference_review_confirm" });
  expect(await s.action({ kind: "reference_review_questions" })).toMatch(
    /Résultat inconnu/,
  );
  expect(await s.action({ kind: "reference_review_cancel" })).toMatch(
    /inconnu/,
  );
  s.state.receiptError = new ApiError(503, "down");
  await s.action({ kind: "reference_review_verify" });
  expect(s.state.acted).toHaveLength(1);
  s.state.error = undefined;
  await s.action({ kind: "reference_review_retry" });
  expect(s.state.acted).toHaveLength(2);
  expect(s.state.acted[1].body).toEqual(s.state.acted[0].body);
});
it("keeps only a receipt target after an unknown outcome followed by a refusal", async () => {
  const s = setup();
  await prepared(s);
  s.state.error = new ApiError(502, "lost");
  await s.action({ kind: "reference_review_confirm" });
  s.state.error = new ApiError(404, "denied");
  await s.action({ kind: "reference_review_retry" });
  expect(screen.queryByText(content.excerpt)).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Action de revue à confirmer" }),
  ).toBeNull();
  s.state.receiptError = new ApiError(404, "missing");
  await s.action({ kind: "reference_review_verify" });
  expect(
    screen.getByRole("region", { name: "Résultat de revue inconnu" }),
  ).toBeDefined();
  s.state.receiptError = undefined;
  expect(await s.action({ kind: "reference_review_verify" })).toMatch(
    /Action enregistrée/,
  );
  expect(s.state.acted).toHaveLength(2);
});
it("rechecks capability before confirming and sends nothing after revocation", async () => {
  const s = setup();
  await prepared(s);
  s.state.denied = true;
  await s.action({ kind: "reference_review_confirm" });
  expect(s.state.acted).toHaveLength(0);
  expect(screen.queryByText(content.excerpt)).toBeNull();
});
it("uses server actions and current review revision for motivated owner-ready opinion, never approval", async () => {
  const s = setup();
  s.state.review.actions = ["request_changes", "ready_for_owner"];
  await s.action({ kind: "reference_review_list", scope: "mine" });
  await s.action({ kind: "reference_review_open", value: "1" });
  expect(
    await s.action({ kind: "reference_review_action", action: "withdraw" }),
  ).toMatch(/pas disponible/);
  expect(
    await s.action({
      kind: "reference_review_action",
      action: "ready_for_owner",
    }),
  ).toMatch(/motif/);
  await s.action({ kind: "reference_review_note", value: "Version relue." });
  await s.action({
    kind: "reference_review_action",
    action: "ready_for_owner",
  });
  expect(s.state.acted).toHaveLength(0);
  await s.action({ kind: "reference_review_confirm" });
  expect(s.state.acted[0]).toMatchObject({
    op: "reference_reviews.command",
    body: {
      expected_revision: 1,
      action: "ready_for_owner",
      note: "Version relue.",
    },
  });
  expect(screen.getByText(/Action enregistrée/).textContent).toContain(
    "Aucun savoir approuvé",
  );
});
it("clears a definitively rejected first command and requires a new preview", async () => {
  const s = setup();
  await prepared(s);
  s.state.error = new ApiError(409, "changed");
  await s.action({ kind: "reference_review_confirm" });
  expect(await s.action({ kind: "reference_review_confirm" })).toMatch(
    /Préparez/,
  );
  expect(s.state.acted).toHaveLength(1);
  expect(
    screen.queryByRole("region", { name: "Résultat de revue inconnu" }),
  ).toBeNull();
});
it("does not expose content from a withdrawn response that violates the tombstone contract", async () => {
  const s = setup();
  s.state.review.status = "withdrawn";
  await s.action({ kind: "reference_review_list", scope: "mine" });
  await s.action({ kind: "reference_review_open", value: "1" });
  expect(
    screen.queryByRole("region", { name: "Version de référence en revue" }),
  ).toBeNull();
});
it("rejects a receipt for a different review as unknown instead of confirming success", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_list", scope: "mine" });
  await s.action({ kind: "reference_review_open", value: "1" });
  await s.action({ kind: "reference_review_note", value: "Retrait voulu." });
  await s.action({ kind: "reference_review_action", action: "withdraw" });
  s.state.malformed = true;
  await s.action({ kind: "reference_review_confirm" });
  expect(
    screen.getByRole("region", { name: "Résultat de revue inconnu" }),
  ).toBeDefined();
});
it("routes explicit review commands before private-reference commands and leaves questions untouched", () => {
  expect(chatIntent("prépare l’envoi en revue")).toEqual({
    kind: "reference_review_prepare",
  });
  expect(chatIntent("responsable de la revue : alice")).toEqual({
    kind: "reference_review_recipient",
    value: "alice",
  });
  expect(chatIntent("confirme l’action de revue")).toEqual({
    kind: "reference_review_confirm",
  });
  expect(chatIntent("Pourquoi cette revue a-t-elle changé ?")).toEqual({
    kind: "question",
  });
});

it("restores metadata only after reload and verifies by GET without replay", async () => {
  const s = setup();
  await prepared(s);
  s.state.error = new ApiError(502, "lost");
  await s.action({ kind: "reference_review_confirm" });
  const entries = readReviewRecovery({
    tenant: domain,
    subject: "reader",
  }).entries;
  expect(entries).toHaveLength(1);
  expect(sessionStorage.getItem(recoveryKey)).not.toContain(content.question);
  s.view.unmount();
  const resumed = setup();
  expect(await resumed.action({ kind: "reference_review_questions" })).toMatch(
    /inconnu/,
  );
  expect(
    screen.queryByRole("region", { name: "Action de revue à confirmer" }),
  ).toBeNull();
  resumed.state.receiptError = new ApiError(404, "missing");
  await resumed.action({
    kind: "reference_review_verify",
    value: entries[0].command,
  });
  expect(
    readReviewRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toHaveLength(1);
  resumed.state.receiptError = undefined;
  await resumed.action({
    kind: "reference_review_verify",
    value: entries[0].command,
  });
  expect(resumed.state.acted).toHaveLength(0);
  expect(
    readReviewRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toEqual([]);
});
it("refuses POST when recovery metadata cannot be stored", async () => {
  const s = setup();
  await prepared(s);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("denied");
  });
  expect(await s.action({ kind: "reference_review_confirm" })).toMatch(
    /Aucun envoi/,
  );
  expect(s.state.acted).toHaveLength(0);
});
it("explicitly forgets a recovered reference without claiming server cancellation", async () => {
  rememberReviewRecovery(
    { tenant: domain, subject: "reader" },
    {
      command: eid,
      domain,
      review: rid,
      status: "withdrawn",
      revision: 2,
      started: Date.now(),
    },
  );
  const s = setup();
  expect(
    await s.action({ kind: "reference_review_forget", value: eid }),
  ).toMatch(/n’annule aucune action/);
  expect(s.state.acted).toHaveLength(0);
  expect(
    readReviewRecovery({ tenant: domain, subject: "reader" }).entries,
  ).toEqual([]);
});
it("validates both known review targets and submission receipts without a guessed review id", () => {
  const scope = { tenant: domain, subject: "reader" };
  rememberReviewRecovery(scope, {
    command: eid,
    domain,
    review: null,
    status: "awaiting_review",
    revision: 1,
    started: Date.now(),
  });
  expect(readReviewRecovery(scope).entries[0].review).toBeNull();
  expect(() =>
    rememberReviewRecovery(scope, {
      command: pid,
      domain,
      review: null,
      status: "withdrawn",
      revision: 2,
      started: Date.now(),
    }),
  ).toThrow();
  expect(chatIntent(`vérifie le reçu de revue : ${eid}`)).toEqual({
    kind: "reference_review_verify",
    value: eid,
  });
});

it("opens an exact review from the brief without requiring a prior list, with fresh authority and no mutation", async () => {
  const s = setup();
  expect(await s.action({ kind: "reference_review_open", value: rid })).toMatch(
    /Version de revue relue/,
  );
  expect(s.call.mock.calls.map((c) => c[0])).toEqual([
    "identity.read",
    "reference_reviews.read",
  ]);
  expect(
    screen.getByRole("region", { name: "Version de référence en revue" }),
  ).toBeTruthy();
  expect(s.state.acted).toHaveLength(0);
  s.state.denied = true;
  await s.action({ kind: "reference_review_open", value: rid });
  expect(
    screen.queryByRole("region", { name: "Version de référence en revue" }),
  ).toBeNull();
});

it("reads history by UI and chat with a fixed current revision, without POST or changing the note", async () => {
  const s = setup();
  s.state.review.revision = 2;
  s.state.review.status = "changes_requested";
  await s.action({ kind: "reference_review_open", value: rid });
  await s.action({
    kind: "reference_review_note",
    value: "Saisie non envoyée",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Lire l’historique de la revue" }),
  );
  const history = await screen.findByRole("region", {
    name: "Historique de la revue",
  });
  expect(history.textContent).toContain("Préciser le délai");
  expect(document.activeElement).toBe(history);
  expect(screen.getByLabelText("Motif de revue")).toHaveProperty(
    "value",
    "Saisie non envoyée",
  );
  expect(await s.action({ kind: "reference_review_history" })).toMatch(
    /Historique relu/,
  );
  expect(s.state.acted).toHaveLength(0);
  expect(chatIntent("historique de la revue")).toEqual({
    kind: "reference_review_history",
  });
  expect(chatIntent("historique de revue suivant")).toEqual({
    kind: "reference_review_history",
    next: true,
  });
});
it("withholds every historical motive for a withdrawn copy and rejects a leaking history response", async () => {
  const s = setup();
  Object.assign(s.state.review, {
    revision: 3,
    status: "withdrawn",
    content: null,
    review_note: "",
    actions: [],
  });
  await s.action({ kind: "reference_review_open", value: rid });
  await s.action({ kind: "reference_review_history" });
  expect(
    screen.getByText(/tous les motifs historiques sont masqués/),
  ).toBeTruthy();
  expect(screen.queryByText("Préciser le délai")).toBeNull();
  s.state.malformedHistory = true;
  await s.action({ kind: "reference_review_history" });
  expect(
    screen.queryByRole("region", { name: "Historique de la revue" }),
  ).toBeNull();
});
it.each([403, 409])(
  "purges old history after current rights or revision changes (%s)",
  async (status) => {
    const s = setup();
    await s.action({ kind: "reference_review_open", value: rid });
    await s.action({ kind: "reference_review_history" });
    expect(
      screen.getByRole("region", { name: "Historique de la revue" }),
    ).toBeTruthy();
    s.state.historyError = new ApiError(status, "changed");
    await s.action({ kind: "reference_review_history" });
    expect(
      screen.queryByRole("region", { name: "Historique de la revue" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Version de référence en revue" }),
    ).toBeNull();
  },
);

it("opens only the current author's private question through the same UI/chat read with no copied text", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_open", value: rid });
  fireEvent.click(
    screen.getByRole("button", { name: "Reprendre ma question privée" }),
  );
  await screen.findByText("Question privée actuelle restaurée.");
  expect(s.edit).toHaveBeenLastCalledWith(qid, 2);
  expect(chatIntent("Reprends ma question privée")).toEqual({
    kind: "reference_review_edit",
  });
  await s.action({ kind: "reference_review_edit" });
  expect(s.edit).toHaveBeenCalledTimes(2);
  expect(
    s.call.mock.calls.filter(([op]) => op === "reference_reviews.read"),
  ).toHaveLength(3);
  expect(s.state.acted).toHaveLength(0);
});
it("does not bridge a recipient to someone else's private question", async () => {
  const s = setup();
  s.state.review.author = "alice";
  await s.action({ kind: "reference_review_open", value: rid });
  expect(
    screen.queryByRole("button", { name: "Reprendre ma question privée" }),
  ).toBeNull();
  expect(await s.action({ kind: "reference_review_edit" })).toMatch(
    /Seul l’auteur/,
  );
  expect(s.edit).not.toHaveBeenCalled();
});
it("rechecks source access and revision before opening the private editor", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_open", value: rid });
  s.state.review = { ...s.state.review, revision: 2 };
  expect(await s.action({ kind: "reference_review_edit" })).toMatch(/changé/);
  expect(s.edit).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("region", { name: "Version de référence en revue" }),
  ).toBeNull();
  await s.action({ kind: "reference_review_open", value: rid });
  s.state.denied = true;
  expect(await s.action({ kind: "reference_review_edit" })).toMatch(/refusée/);
  expect(s.edit).not.toHaveBeenCalled();
});
it("keeps a prepared action or unknown result ahead of the private-editor bridge", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_open", value: rid });
  await s.action({
    kind: "reference_review_note",
    value: "Retirer après correction.",
  });
  await s.action({ kind: "reference_review_action", action: "withdraw" });
  expect(await s.action({ kind: "reference_review_edit" })).toMatch(
    /Confirmez ou annulez/,
  );
  s.state.error = new ApiError(503, "lost");
  await s.action({ kind: "reference_review_confirm" });
  expect(await s.action({ kind: "reference_review_edit" })).toMatch(
    /Résultat inconnu/,
  );
  expect(s.edit).not.toHaveBeenCalled();
});

it("preserves an unsent review note before replacing or refreshing a copy and clears it only explicitly", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_open", value: rid });
  fireEvent.change(screen.getByLabelText("Motif de revue"), {
    target: { value: "Précision non envoyée" },
  });
  for (const intent of [
    { kind: "reference_review_open", value: rid },
    { kind: "reference_review_list", scope: "mine" },
    { kind: "reference_review_questions" },
  ] as ReferenceReviewIntent[]) {
    const before = s.call.mock.calls.length;
    expect(await s.action(intent)).toMatch(/motif non envoyé/);
    expect(s.call.mock.calls).toHaveLength(before);
    expect(
      (screen.getByLabelText("Motif de revue") as HTMLTextAreaElement).value,
    ).toBe("Précision non envoyée");
  }
  await s.action({ kind: "reference_review_history" });
  expect(
    (screen.getByLabelText("Motif de revue") as HTMLTextAreaElement).value,
  ).toBe("Précision non envoyée");
  expect(chatIntent("Efface mon motif de revue")).toEqual({
    kind: "reference_review_discard_note",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Effacer mon motif non envoyé" }),
  );
  await screen.findByText(/Motif non envoyé effacé/);
  expect(
    (screen.getByLabelText("Motif de revue") as HTMLTextAreaElement).value,
  ).toBe("");
  await s.action({ kind: "reference_review_list", scope: "mine" });
  expect(s.state.acted).toHaveLength(0);
});
it("does not discard a prepared or uncertain review note", async () => {
  const s = setup();
  await s.action({ kind: "reference_review_open", value: rid });
  await s.action({ kind: "reference_review_note", value: "Motif à conserver" });
  await s.action({ kind: "reference_review_action", action: "withdraw" });
  expect(await s.action({ kind: "reference_review_discard_note" })).toMatch(
    /Confirmez ou annulez/,
  );
  s.state.error = new ApiError(503, "lost");
  await s.action({ kind: "reference_review_confirm" });
  expect(await s.action({ kind: "reference_review_discard_note" })).toMatch(
    /Résultat inconnu/,
  );
  expect(
    (screen.getByLabelText("Motif de revue") as HTMLTextAreaElement).value,
  ).toBe("Motif à conserver");
});
