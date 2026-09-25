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
import { CortexApi, ApiError } from "./client";
import { ConversationWorkspace, validateAnswer } from "./ConversationWorkspace";
const domain = "00000000-0000-0000-0000-000000000001",
  conversation = "00000000-0000-0000-0000-000000000002",
  episode = "00000000-0000-0000-0000-000000000003";
const answer = {
  episode_id: episode,
  answer: "Une preuve synthétique.",
  served_version: 2,
  status: "evidence_found" as const,
  concepts: [],
  citations: [
    {
      source_id: domain,
      title: "Source de test",
      location: "synthetic://test/page/1",
      content_hash: "test",
      start: 0,
      end: 23,
      excerpt: "Une preuve synthétique.",
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(fail = false) {
  const api = new CortexApi(() => null);
  let queries = 0;
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list" || op === "conversations.messages")
      return { items: [], next_after: null };
    if (op === "conversations.create")
      return {
        id: conversation,
        title: "Essai",
        archived: false,
        revision: 1,
        created_at: "2026-01-01",
      };
    if (op === "conversations.query") {
      if (fail && queries++ === 0) throw new ApiError(0, "network_error");
      return answer;
    }
    if (op === "episodes.feedback") return { feedback_id: "receipt-test" };
    throw Error(op);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationWorkspace api={api} domain={domain} />
    </QueryClientProvider>,
  );
  return call;
}
function ask() {
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Question synthétique" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Poser la question" }));
}
it("renders the served version, opens the citation, and binds feedback to the episode", async () => {
  const call = setup();
  ask();
  await screen.findByText("Réponse extractive sourcée");
  expect(screen.getByText(/version 2/)).toBeTruthy();
  fireEvent.click(screen.getByText("Source 1 : Source de test"));
  expect(screen.getByText("synthetic://test/page/1")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: "Préciser le périmètre" },
  });
  fireEvent.click(screen.getByRole("button", { name: "À améliorer" }));
  await screen.findByText(/Retour enregistré/);
  expect(
    call.mock.calls.find((c) => c[0] === "episodes.feedback")?.slice(0, 3),
  ).toEqual([
    "episodes.feedback",
    { domain, episode_id: episode },
    expect.objectContaining({
      rating: "unhelpful",
      explanation: "Préciser le périmètre",
    }),
  ]);
});
it("retains the same intention and idempotency key after uncertain query failure", async () => {
  const call = setup(true);
  ask();
  await screen.findByRole("button", { name: "Réessayer la même demande" });
  expect(
    call.mock.calls.filter((c) => c[0] === "conversations.query"),
  ).toHaveLength(1);
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).value,
  ).toBe("Question synthétique");
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer la même demande" }),
  );
  await screen.findByText("Réponse extractive sourcée");
  const queries = call.mock.calls.filter((c) => c[0] === "conversations.query");
  expect(queries).toHaveLength(2);
  expect(queries[0][2]).toEqual(queries[1][2]);
  expect(
    call.mock.calls.filter((c) => c[0] === "conversations.create"),
  ).toHaveLength(1);
});
it("rejects a sourced-answer status without citations", () => {
  expect(() => validateAnswer({ ...answer, citations: [] })).toThrow(ApiError);
  expect(
    validateAnswer({ ...answer, status: "knowledge_gap", citations: [] }),
  ).toMatchObject({ status: "knowledge_gap" });
});
it("forwards the conversation cursor when loading another page", async () => {
  const api = new CortexApi(() => null);
  const call = vi
    .spyOn(api, "call")
    .mockResolvedValueOnce({
      items: [
        {
          id: conversation,
          title: "Première",
          archived: false,
          revision: 1,
          created_at: "2026-01-01",
        },
      ],
      next_after: conversation,
    })
    .mockResolvedValueOnce({ items: [], next_after: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationWorkspace api={api} domain={domain} />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Plus de conversations" }),
  );
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(call.mock.calls[1][3]?.query).toEqual({ after: conversation });
});
