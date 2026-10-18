import React, { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CortexApi, ApiError } from "./client";
import { TaskProposals, type TaskProposalActions } from "./TaskProposals";
import type { WorkTask } from "../../../../packages/contracts/src/WorkTask";
import { chatIntent } from "./workspaceCommands";
const domain = "00000000-0000-0000-0000-000000000001",
  id = "00000000-0000-0000-0000-000000000002",
  proposal = "00000000-0000-0000-0000-000000000003",
  source = "00000000-0000-0000-0000-000000000004";
const task = {
  id,
  title: "Mission synthétique",
  status: "in_progress",
  revision: 1,
} as WorkTask;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(linkedInitially = true) {
  const api = new CortexApi(() => null),
    ref = createRef<TaskProposalActions>(),
    notice = vi.fn(),
    hold = vi.fn();
  let linked = linkedInitially,
    revision = 1,
    canReview = true;
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _args, body) => {
      if (op === "task_proposals.list")
        return {
          task_id: id,
          task_revision: revision,
          items: linked
            ? [
                {
                  proposal_id: proposal,
                  digest: "digest",
                  review_revision: 7,
                  status: "ready",
                  linked_by: "manager",
                  linked_at: "2026-10-16T12:00:00Z",
                  can_review: canReview,
                },
              ]
            : [],
          total: linked ? 1 : 0,
          can_link: true,
          max_links: 20,
          as_of: "2026-10-16T12:00:00Z",
        } as never;
      if (op === "proposals.read")
        return {
          id: proposal,
          reason: "Révision synthétique",
          status: "ready",
          digest: "digest",
          review_revision: 7,
          validation: { source_ids: [source] },
          payload: [],
        } as never;
      if (op === "expert_reviews.list")
        return {
          task_id: id,
          proposal_id: proposal,
          items: [],
          total: 0,
          next_after: null,
          has_more: false,
          permissions_version: 1,
          work_version: 1,
          as_of: "2026-10-16T12:00:00Z",
        } as never;
      if (op === "task_proposals.link" || op === "expert_reviews.submit") {
        linked = true;
        revision =
          (body as { expected_task_revision: number }).expected_task_revision +
          1;
        return {
          task_id: id,
          event_id: domain,
          revision,
          status: "in_progress",
          ...(op === "expert_reviews.submit"
            ? { expert_review_id: source }
            : {}),
        } as never;
      }
      if (op === "proposals.list")
        return { items: [], next_after: null } as never;
      throw Error(`Unexpected operation ${op}`);
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function content(accessDenied = false) {
    return (
      <QueryClientProvider client={cache}>
        <TaskProposals
          ref={ref}
          api={api}
          domain={domain}
          task={task}
          blocked={false}
          accessDenied={accessDenied}
          onNotice={notice}
          onHold={hold}
        />
      </QueryClientProvider>
    );
  }
  const view = render(content());
  return {
    ref,
    call,
    cache,
    notice,
    hold,
    deny: (v: boolean) => view.rerender(content(v)),
    setCanReview: (v: boolean) => {
      canReview = v;
    },
  };
}
async function select(ref: React.RefObject<TaskProposalActions>) {
  await screen.findByText(/1 propositions liées accessibles/);
  await act(async () => {
    await ref.current!.act({ kind: "task_proposal_select", id: proposal });
  });
  await screen.findByRole("heading", { name: "Proposition sélectionnée" });
}
async function prepare(ref: React.RefObject<TaskProposalActions>) {
  await act(async () => {
    await ref.current!.act({
      kind: "task_opinion_prepare",
      opinion: "supports",
      justification: "Avis explicite synthétique",
      sources: [source],
    });
  });
  await screen.findByRole("region", { name: "Projet de lien ou avis" });
}
it("prepares then links through the same operation with an explicit confirmation", async () => {
  const { ref, call } = setup(false);
  await screen.findByText(/0 propositions liées accessibles/);
  await act(async () => {
    await ref.current!.act({ kind: "task_proposal_link", id: proposal });
  });
  expect(call.mock.calls.some(([op]) => op === "task_proposals.link")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmer le lien" }));
  await screen.findByText(/Proposition liée · reçu/);
  expect(
    call.mock.calls.find(([op]) => op === "task_proposals.link")?.[2],
  ).toEqual({
    proposal_id: proposal,
    expected_task_revision: 1,
    idempotency_key: expect.any(String),
  });
});
it("binds a non-decisional opinion to the freshly read proposal and task revisions", async () => {
  const { ref, call } = setup();
  await select(ref);
  await prepare(ref);
  const card = within(
    screen.getByRole("region", { name: "Projet de lien ou avis" }),
  );
  expect(card.getByText("Avis explicite synthétique")).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "expert_reviews.submit")).toBe(
    false,
  );
  fireEvent.click(card.getByRole("button", { name: "Confirmer l’avis" }));
  await screen.findByText(/Avis expert enregistré · reçu/);
  const body = call.mock.calls.find(
    ([op]) => op === "expert_reviews.submit",
  )?.[2];
  expect(body).toMatchObject({
    proposal_id: proposal,
    digest: "digest",
    expected_review_revision: 7,
    expected_task_revision: 1,
    opinion: "supports",
    evidence_source_ids: [source],
  });
  expect(
    call.mock.calls.some(([op]) =>
      ["proposals.approve", "proposals.review", "domains.publish"].includes(op),
    ),
  ).toBe(false);
});
it("pins an uncertain opinion across a parent read failure and retries the exact body", async () => {
  const { ref, call, deny } = setup();
  await select(ref);
  await prepare(ref);
  const original = call.getMockImplementation()!;
  let fail = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "expert_reviews.submit" && fail)
      throw new TypeError("network");
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({ kind: "task_expert_confirm", linking: false });
  });
  await screen.findByText(/Résultat inconnu/);
  deny(true);
  expect(screen.queryByText("Avis explicite synthétique")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Projet de lien ou avis" }),
  ).toBeNull();
  deny(false);
  await screen.findByRole("button", { name: "Vérifier le même envoi" });
  await act(async () => {
    await ref.current!.act({ kind: "task_expert_cancel" });
  });
  expect(
    screen.getByRole("region", { name: "Projet de lien ou avis" }),
  ).toBeDefined();
  fail = false;
  await act(async () => {
    await ref.current!.act({ kind: "task_expert_confirm", linking: false });
  });
  await screen.findByText(/Avis expert enregistré · reçu/);
  const writes = call.mock.calls.filter(
    ([op]) => op === "expert_reviews.submit",
  );
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
});
it("hides private opinion details after a fresh source denial and never submits", async () => {
  const { ref, call } = setup();
  await select(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "proposals.read") throw new ApiError(404, "NOT_FOUND");
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({
      kind: "task_opinion_prepare",
      opinion: "supports",
      justification: "Ne pas envoyer",
      sources: [source],
    });
  });
  await screen.findByRole("alert");
  expect(screen.queryByText("Révision synthétique")).toBeNull();
  expect(call.mock.calls.some(([op]) => op === "expert_reviews.submit")).toBe(
    false,
  );
});
it("rechecks the assignee capability and rejects unrelated sources", async () => {
  const { ref, call, setCanReview } = setup();
  await select(ref);
  await act(async () => {
    await ref.current!.act({
      kind: "task_opinion_prepare",
      opinion: "supports",
      justification: "Ne pas envoyer",
      sources: [domain],
    });
  });
  expect(
    screen.queryByRole("region", { name: "Projet de lien ou avis" }),
  ).toBeNull();
  setCanReview(false);
  await act(async () => {
    await ref.current!.act({
      kind: "task_opinion_prepare",
      opinion: "supports",
      justification: "Refus courant",
      sources: [],
    });
  });
  expect(screen.getByText(/Cet avis requiert/)).toBeDefined();
  expect(call.mock.calls.some(([op]) => op === "expert_reviews.submit")).toBe(
    false,
  );
});
it("expires unsent opinions and keeps stale server rejections non-retryable", async () => {
  const { ref, call } = setup();
  await select(ref);
  await prepare(ref);
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 300001);
  await act(async () => {
    await ref.current!.act({ kind: "task_expert_confirm", linking: false });
  });
  await screen.findByText(/projet a expiré/);
  expect(call.mock.calls.some(([op]) => op === "expert_reviews.submit")).toBe(
    false,
  );
  clock.mockRestore();
  await prepare(ref);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "expert_reviews.submit")
      throw new ApiError(409, "TASK_CHANGED");
    return original(...args);
  });
  await act(async () => {
    await ref.current!.act({ kind: "task_expert_confirm", linking: false });
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Confirmer l’avis",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("routes opinion chat commands without treating malformed actions as knowledge questions", () => {
  expect(
    chatIntent("prépare un avis : favorable | Ma justification | " + source),
  ).toEqual({
    kind: "task_opinion_prepare",
    opinion: "supports",
    justification: "Ma justification",
    sources: [source],
  });
  expect(chatIntent("confirme l'avis")).toEqual({
    kind: "task_expert_confirm",
    linking: false,
  });
  expect(chatIntent("prépare un avis : approuvé | commentaire")).toEqual({
    kind: "unsupported",
  });
});
