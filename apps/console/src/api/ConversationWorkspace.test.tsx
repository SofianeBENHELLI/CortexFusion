import React from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render as renderTree,
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
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="conversation-location">{location.search}</output>
      <button onClick={() => navigate(-1)}>Retour de recette</button>
      <button
        onClick={() =>
          navigate(`?api_domain=${domain}&api_conversation=${episode}`)
        }
      >
        Autre conversation de recette
      </button>
    </>
  );
}
function render(ui: React.ReactNode, entry = "/") {
  return renderTree(
    <MemoryRouter initialEntries={[entry]}>
      {ui}
      <Navigation />
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(
  fail = false,
  rejected?: "question" | "feedback",
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const api = new CortexApi(() => null);
  let queries = 0;
  let rejections = 0;
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
      if (rejected === "question" && rejections++ === 0)
        throw new ApiError(422, "invalid_input");
      if (fail && queries++ === 0) throw new ApiError(0, "network_error");
      return answer;
    }
    if (op === "episodes.feedback") {
      if (rejected === "feedback" && rejections++ === 0)
        throw new ApiError(422, "invalid_input");
      return { feedback_id: "receipt-test" };
    }
    throw Error(op);
  });
  render(
    <QueryClientProvider client={cache}>
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
it("distinguishes context limits from missing knowledge and does not invalidate issues", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["api", "issues", domain], { items: [] });
  const call = setup(false, undefined, cache);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "conversations.query")
      return {
        ...answer,
        status: "context_limited",
        citations: [],
        context_passages: [],
      };
    return original(op, params, body, options);
  });
  ask();
  await screen.findByText("Passage trop étendu pour cette réponse");
  expect(screen.queryByText("Connaissance insuffisante")).toBeNull();
  expect(screen.getByText(/Aucune lacune de connaissance/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Ouvrir BrainMap" }).getAttribute("href"),
  ).toContain("api_view=brain");
  expect(cache.getQueryState(["api", "issues", domain])?.isInvalidated).toBe(
    false,
  );
  cache.clear();
});
it("loads a conversation linked beyond the directory page and preserves map scope in its answer link", async () => {
  const api = new CortexApi(() => null);
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list") return { items: [], next_after: null };
    if (op === "conversations.messages")
      return {
        items: [
          {
            sequence: 1,
            question: "Question archivée",
            created_at: "2026-10-05T20:00:00Z",
            result: {
              ...answer,
              context_passages: [
                {
                  concept_id: episode,
                  title: "Preuve",
                  maturity: "emerging",
                  text: "test",
                  body_start: 0,
                  body_end: 4,
                  body_total_chars: 5,
                  sources: [],
                },
              ],
            },
          },
        ],
        next_after: null,
      };
    throw Error(op);
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationWorkspace api={api} domain={domain} />
    </QueryClientProvider>,
    `/?api_domain=${domain}&api_view=work&api_conversation=${conversation}&map_transport=viewport&time_from=2026-10-05&map_event=old`,
  );
  await screen.findByText("Question archivée");
  expect(
    (screen.getByLabelText("Conversation") as HTMLSelectElement).value,
  ).toBe(conversation);
  expect(call).toHaveBeenCalledWith(
    "conversations.messages",
    { domain, ident: conversation },
    undefined,
    expect.anything(),
  );
  const href = new URLSearchParams(
    screen
      .getByRole("link", { name: "Ouvrir la fiche actuelle : Preuve" })
      .getAttribute("href")!,
  );
  expect(href.get("api_conversation")).toBe(conversation);
  expect(href.get("map_transport")).toBe("viewport");
  expect(href.get("time_from")).toBe("2026-10-05");
  expect(href.get("map_event")).toBeNull();
});

it("blocks malformed conversation links without issuing a message read or mutation", async () => {
  const api = new CortexApi(() => null);
  const call = vi
    .spyOn(api, "call")
    .mockResolvedValue({ items: [], next_after: null } as any);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationWorkspace api={api} domain={domain} />
    </QueryClientProvider>,
    `/?api_domain=${domain}&api_conversation=not-an-id`,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "lien de conversation est invalide",
  );
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).disabled,
  ).toBe(true);
  expect(call.mock.calls.every(([op]) => op === "conversations.list")).toBe(
    true,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revenir à une nouvelle conversation" }),
  );
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).disabled,
  ).toBe(false);
});

it("records only the conversation identifier in the URL after creating a successful turn", async () => {
  setup();
  ask();
  await screen.findByText("Extraits sourcés retrouvés");
  const search = screen.getByTestId("conversation-location").textContent!;
  expect(new URLSearchParams(search).get("api_conversation")).toBe(
    conversation,
  );
  expect(search).not.toContain("Question");
});

it("does not send a late created conversation's question after navigation changes scope", async () => {
  const call = setup();
  const original = call.getMockImplementation()!;
  let finish: (value: any) => void = () => {};
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "conversations.create")
      return await new Promise((resolve) => {
        finish = resolve;
      });
    return original(op, params, body, options);
  });
  ask();
  fireEvent.click(
    screen.getByRole("button", { name: "Autre conversation de recette" }),
  );
  await act(async () => {
    finish({ id: conversation });
  });
  expect(call.mock.calls.some(([op]) => op === "conversations.query")).toBe(
    false,
  );
  expect(screen.queryByText("Extraits sourcés retrouvés")).toBeNull();
  expect(
    new URLSearchParams(
      screen.getByTestId("conversation-location").textContent!,
    ).get("api_conversation"),
  ).toBe(episode);
});
it("hides previously read messages on a rejected reread and offers reauthentication", async () => {
  const api = new CortexApi(() => null);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const reconnect = vi.fn();
  let expired = false;
  vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list") return { items: [], next_after: null };
    if (op === "conversations.messages") {
      if (expired) throw new ApiError(401, "unauthorized");
      return {
        items: [
          {
            sequence: 1,
            question: "Ancienne preuve",
            created_at: "2026-10-05",
            result: answer,
          },
        ],
        next_after: null,
      };
    }
    throw Error(op);
  });
  render(
    <QueryClientProvider client={cache}>
      <ConversationWorkspace
        api={api}
        domain={domain}
        onReconnect={reconnect}
      />
    </QueryClientProvider>,
    `/?api_domain=${domain}&api_conversation=${conversation}`,
  );
  await screen.findByText("Ancienne preuve");
  expired = true;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["api", "messages", domain, conversation],
    });
  });
  await waitFor(() => expect(screen.queryByText("Ancienne preuve")).toBeNull());
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Se reconnecter à cette conversation",
    }),
  );
  expect(reconnect).toHaveBeenCalledTimes(1);
  expect(
    new URLSearchParams(
      screen.getByTestId("conversation-location").textContent!,
    ).get("api_conversation"),
  ).toBe(conversation);
  cache.clear();
});

it("keeps a late completed answer out of the conversation selected with browser Back", async () => {
  const call = setup();
  const original = call.getMockImplementation()!;
  let finish: (value: any) => void = () => {};
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "conversations.query")
      return await new Promise((resolve) => {
        finish = resolve;
      });
    return original(op, params, body, options);
  });
  ask();
  await waitFor(() =>
    expect(call.mock.calls.some(([op]) => op === "conversations.query")).toBe(
      true,
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Autre conversation de recette" }),
  );
  await act(async () => {
    finish(answer);
  });
  expect(screen.queryByText("Une preuve synthétique.")).toBeNull();
  expect(screen.queryByText("Réessayer la même demande")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retour de recette" }));
  expect(
    new URLSearchParams(
      screen.getByTestId("conversation-location").textContent!,
    ).get("api_conversation"),
  ).toBe(conversation);
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).disabled,
  ).toBe(false);
});
it("labels a partial passage and links to the intact current concept", async () => {
  const call = setup();
  const original = call.getMockImplementation()!;
  const text = "Preuve 🧠 précise.";
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "conversations.query")
      return {
        ...answer,
        answer: text,
        context_passages: [
          {
            concept_id: conversation,
            title: "Dossier long",
            maturity: "emerging",
            text,
            body_start: 100000,
            body_end: 100000 + Array.from(text).length,
            body_total_chars: 200000,
            sources: [],
          },
        ],
      };
    return original(op, params, body, options);
  });
  ask();
  const link = await screen.findByRole("link", {
    name: "Ouvrir la fiche actuelle : Dossier long",
  });
  expect(link.getAttribute("href")).toContain(`map_node=${conversation}`);
  expect(
    screen.getByText(/La réponse présente des passages sélectionnés/),
  ).toBeTruthy();
});
it("rejects invalid passage coordinates while accepting historical episodes without passage metadata", () => {
  expect(validateAnswer(answer as any)).toBeTruthy();
  expect(() =>
    validateAnswer({
      ...answer,
      context_passages: [
        {
          concept_id: domain,
          title: "Test",
          text: "🧠",
          body_start: 0,
          body_end: 2,
          body_total_chars: 3,
        },
      ],
    } as any),
  ).toThrow(ApiError);
});
it("returns keyboard focus to the confirmed feedback receipt", async () => {
  setup();
  ask();
  const button = await screen.findByRole("button", { name: "À améliorer" });
  button.focus();
  fireEvent.click(button);
  const receipt = await screen.findByText("Retour enregistré · receipt-test");
  expect(document.activeElement).toBe(receipt);
});

it("does not steal focus when the user starts another question during feedback", async () => {
  const call = setup();
  ask();
  const button = await screen.findByRole("button", { name: "À améliorer" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "episodes.feedback") await held;
    return original(op, params, body, options);
  });
  button.focus();
  fireEvent.click(button);
  const question = screen.getByLabelText("Votre question");
  question.focus();
  fireEvent.change(question, { target: { value: "Question suivante" } });
  await act(async () => release());
  await screen.findByText("Retour enregistré · receipt-test");
  expect(document.activeElement).toBe(question);
});

it("invalidates only the current domain's tickets after confirmed negative feedback", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["api", "issues", domain], { items: [] });
  cache.setQueryData(["api", "issues", "another-domain"], { items: [] });
  setup(false, undefined, cache);
  ask();
  fireEvent.click(await screen.findByRole("button", { name: "À améliorer" }));
  await screen.findByText("Retour enregistré · receipt-test");
  expect(cache.getQueryState(["api", "issues", domain])?.isInvalidated).toBe(
    true,
  );
  expect(
    cache.getQueryState(["api", "issues", "another-domain"])?.isInvalidated,
  ).toBe(false);
  cache.clear();
});

it("refreshes the ticket list when a question confirms a knowledge gap", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["api", "issues", domain], { items: [] });
  const call = setup(false, undefined, cache);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (op, params, body, options) => {
    if (op === "conversations.query")
      return { ...answer, status: "knowledge_gap", citations: [] };
    return original(op, params, body, options);
  });
  ask();
  await screen.findByText("Connaissance insuffisante");
  expect(cache.getQueryState(["api", "issues", domain])?.isInvalidated).toBe(
    true,
  );
  cache.clear();
});
it("renders the served version, opens the citation, and binds feedback to the episode", async () => {
  const call = setup();
  ask();
  await screen.findByText("Extraits sourcés retrouvés");
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
  await screen.findByText("Extraits sourcés retrouvés");
  const queries = call.mock.calls.filter((c) => c[0] === "conversations.query");
  expect(queries).toHaveLength(2);
  expect(queries[0][2]).toEqual(queries[1][2]);
  expect(
    call.mock.calls.filter((c) => c[0] === "conversations.create"),
  ).toHaveLength(1);
});

it("lets a user correct a definitively rejected question with a new intention", async () => {
  const call = setup(false, "question");
  ask();
  await screen.findByText("Les données envoyées sont invalides.");
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).disabled,
  ).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Réessayer la même demande" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Question corrigée" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Poser la question" }));
  await screen.findByText("Extraits sourcés retrouvés");
  const queries = call.mock.calls.filter((c) => c[0] === "conversations.query");
  expect(queries).toHaveLength(2);
  expect(
    (queries[0][2] as { idempotency_key?: string })?.idempotency_key,
  ).not.toBe((queries[1][2] as { idempotency_key?: string })?.idempotency_key);
  expect(queries[1][2]).toMatchObject({ question: "Question corrigée" });
  expect(
    call.mock.calls.filter((c) => c[0] === "conversations.create"),
  ).toHaveLength(1);
});

it("lets a user correct definitively rejected feedback while retaining its comment", async () => {
  const call = setup(false, "feedback");
  ask();
  await screen.findByText("Extraits sourcés retrouvés");
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: "Commentaire initial" },
  });
  fireEvent.click(screen.getByRole("button", { name: "À améliorer" }));
  await screen.findByText("Les données envoyées sont invalides.");
  expect(
    (
      screen.getByLabelText(
        "Commentaire sur cette réponse",
      ) as HTMLTextAreaElement
    ).disabled,
  ).toBe(false);
  expect(
    (
      screen.getByLabelText(
        "Commentaire sur cette réponse",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("Commentaire initial");
  expect(
    screen.queryByRole("button", { name: "Réessayer le même retour" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: "Commentaire corrigé" },
  });
  fireEvent.click(screen.getByRole("button", { name: "À améliorer" }));
  await screen.findByText("Retour enregistré · receipt-test");
  const attempts = call.mock.calls.filter((c) => c[0] === "episodes.feedback");
  expect(attempts).toHaveLength(2);
  expect(
    (attempts[0][2] as { idempotency_key?: string })?.idempotency_key,
  ).not.toBe((attempts[1][2] as { idempotency_key?: string })?.idempotency_key);
  expect(attempts[1][2]).toMatchObject({ explanation: "Commentaire corrigé" });
});

it("bounds a question before sending, using the backend Unicode character limit", async () => {
  const call = setup();
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "x".repeat(2001) },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Poser la question",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("2 000 caractères");
  fireEvent.submit(screen.getByLabelText("Votre question").closest("form")!);
  expect(
    call.mock.calls.filter((c) => c[0] === "conversations.create"),
  ).toHaveLength(0);
  const unicode = "🧠".repeat(2000);
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: unicode },
  });
  fireEvent.click(screen.getByRole("button", { name: "Poser la question" }));
  await screen.findByText("Extraits sourcés retrouvés");
  expect(
    call.mock.calls.find((c) => c[0] === "conversations.query")?.[2],
  ).toMatchObject({ question: unicode });
});

it("bounds a comment before creating an intent and accepts 2 000 Unicode characters", async () => {
  const call = setup();
  ask();
  await screen.findByText("Extraits sourcés retrouvés");
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: "x".repeat(2001) },
  });
  expect(
    (screen.getByRole("button", { name: "À améliorer" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("2 000 caractères");
  expect(
    call.mock.calls.filter((c) => c[0] === "episodes.feedback"),
  ).toHaveLength(0);
  const unicode = "🧠".repeat(2000);
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: unicode },
  });
  fireEvent.click(screen.getByRole("button", { name: "À améliorer" }));
  await screen.findByText("Retour enregistré · receipt-test");
  expect(
    call.mock.calls.find((c) => c[0] === "episodes.feedback")?.[2],
  ).toMatchObject({ explanation: unicode });
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
it("keeps a feedback receipt when the answer moves to history and the conversation is reopened", async () => {
  const api = new CortexApi(() => null);
  const messages: {
    sequence: number;
    created_at: string;
    question: string;
    result: typeof answer;
  }[] = [];
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list")
      return {
        items: [
          {
            id: conversation,
            title: "Recette",
            archived: false,
            revision: 0,
            created_at: "2026-10-03T08:00:00Z",
          },
        ],
        next_after: null,
      };
    if (op === "conversations.messages")
      return { items: [...messages], next_after: null };
    if (op === "conversations.query") {
      const result = { ...answer, episode_id: `${episode}-${messages.length}` };
      messages.push({
        sequence: messages.length + 1,
        created_at: "2026-10-03T08:00:00Z",
        question: "Question synthétique",
        result,
      });
      return result;
    }
    if (op === "episodes.feedback") return { feedback_id: "saved-receipt" };
    throw new Error(op);
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
  await screen.findByRole("option", { name: "Recette" });
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: conversation },
  });
  ask();
  await screen.findByText("Extraits sourcés retrouvés");
  fireEvent.click(screen.getByRole("button", { name: "Utile" }));
  await screen.findByText("Retour enregistré · saved-receipt");
  ask();
  await waitFor(() =>
    expect(screen.getAllByText("Extraits sourcés retrouvés")).toHaveLength(2),
  );
  expect(screen.getByText("Retour enregistré · saved-receipt")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Utile" })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: "" },
  });
  expect(screen.queryByText("Retour enregistré · saved-receipt")).toBeNull();
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: conversation },
  });
  await screen.findByText("Retour enregistré · saved-receipt");
  expect(
    call.mock.calls.filter((c) => c[0] === "episodes.feedback"),
  ).toHaveLength(1);
});
it("retains uncertain feedback and its key when leaving and returning to a conversation", async () => {
  const api = new CortexApi(() => null);
  let fail = true;
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list")
      return {
        items: [
          {
            id: conversation,
            title: "Recette",
            archived: false,
            revision: 0,
            created_at: "2026-10-03T08:00:00Z",
          },
        ],
        next_after: null,
      };
    if (op === "conversations.messages")
      return {
        items: [
          {
            sequence: 1,
            created_at: "2026-10-03T08:00:00Z",
            question: "Question",
            result: answer,
          },
        ],
        next_after: null,
      };
    if (op === "episodes.feedback") {
      if (fail) {
        fail = false;
        throw new ApiError(0, "network_error");
      }
      return { feedback_id: "retried-receipt" };
    }
    throw new Error(op);
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
  await screen.findByRole("option", { name: "Recette" });
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: conversation },
  });
  fireEvent.click(await screen.findByRole("button", { name: "À améliorer" }));
  await screen.findByRole("button", { name: "Réessayer le même retour" });
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("Conversation"), {
    target: { value: conversation },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Réessayer le même retour" }),
  );
  await screen.findByText("Retour enregistré · retried-receipt");
  const attempts = call.mock.calls.filter((c) => c[0] === "episodes.feedback");
  expect(attempts).toHaveLength(2);
  expect(attempts[0][2]).toEqual(attempts[1][2]);
});

it("reads the personal brief from chat without creating a corpus query and opens the same task action", async () => {
  const api = new CortexApi(() => null);
  const calls = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list")
      return { items: [], next_after: null } as never;
    if (op === "tasks.brief")
      return {
        scope: "assigned",
        role: "contributor",
        as_of: "2026-10-16T22:00:00Z",
        permissions_version: 1,
        work_version: 1,
        counts: {
          active: 0,
          overdue: 0,
          offered: 0,
          review: 0,
          blocked: 0,
          unassigned: 0,
          in_progress: 0,
        },
        items: [],
        has_more: false,
        sort: "overdue_review_offer_blocked_unassigned_progress_due_created_id",
        coverage: "active_tasks_only",
      } as never;
    throw Error(op);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationWorkspace
        api={api}
        domain={domain}
        canBrief
        onWorkspaceAction={() => true}
      />
    </QueryClientProvider>,
  );
  await screen.findByText(/Aucune tâche active/);
  fireEvent.click(screen.getByRole("button", { name: "Masquer mon brief" }));
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Que dois-je faire ?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await screen.findByText(/Aucune tâche active/);
  expect(document.activeElement?.textContent).toBe("Votre prochain pas");
  expect(
    calls.mock.calls.every((c) =>
      ["conversations.list", "tasks.brief"].includes(c[0]),
    ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Montre le brief du domaine" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await screen.findByText(
    "Ce brief n’est pas disponible avec vos accès actuels.",
  );
  expect(
    calls.mock.calls
      .filter((c) => c[0] === "tasks.brief")
      .every((c) => c[3]?.query?.scope === "assigned"),
  ).toBe(true);
});

it("reports a failed chat command and keeps the typed text", async () => {
  const api = new CortexApi(() => null);
  vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list") return { items: [], next_after: null };
    throw Error(op);
  });
  const onGuideIntent = vi.fn().mockRejectedValue(new Error("offline"));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationWorkspace
        api={api}
        domain={domain}
        onWorkspaceAction={() => true}
        onGuideIntent={onGuideIntent}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Montre les guides MCP" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await screen.findByText(/La commande n’a pas abouti/);
  expect(onGuideIntent).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Votre question")).toHaveProperty(
    "value",
    "Montre les guides MCP",
  );
});

it("opens personal sharing follow-up from chat and explicitly refuses unavailable coordinator categories", async () => {
  const api = new CortexApi(() => null);
  const group = {
    total: 0,
    items: [],
    has_more: false,
    sort: "created_at_asc_id_asc",
  };
  const calls = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "conversations.list")
      return { items: [], next_after: null } as never;
    if (op === "work_overview.read")
      return {
        scope: "assigned",
        role: "viewer",
        as_of: "2026-10-16T23:00:00Z",
        permissions_version: 1,
        work_version: 1,
        coverage: "authorized_active_work_only",
        tasks: null,
        received_cases: null,
        received_reference_reviews: null,
        my_reference_reviews: null,
        my_missions: null,
        imports: null,
        my_cases: group,
      } as never;
    throw Error(op);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationWorkspace
        api={api}
        domain={domain}
        canOverview
        onWorkspaceAction={() => true}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Vous n’avez aucun partage ouvert à suivre.");
  fireEvent.click(screen.getByRole("button", { name: "Masquer mon brief" }));
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Montre le suivi de mes partages" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await screen.findByText("Vous n’avez aucun partage ouvert à suivre.");
  expect(document.activeElement?.textContent).toBe("Votre prochain pas");
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Montre mes dossiers à traiter" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await screen.findByText(
    "Cet accueil n’est pas disponible avec vos accès actuels.",
  );
  expect(
    calls.mock.calls.every((c) =>
      ["conversations.list", "work_overview.read"].includes(c[0]),
    ),
  ).toBe(true);
});
