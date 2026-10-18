import React from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import GovernanceWorkspace from "./GovernanceWorkspace";
import { ApiError, CortexApi } from "./client";

const domain = "00000000-0000-0000-0000-000000000001";
const conversation = "00000000-0000-0000-0000-000000000002";
const episode = "00000000-0000-0000-0000-000000000003";
const result = {
  episode_id: episode,
  answer: "Réponse synthétique publiée",
  served_version: 3,
  status: "evidence_found",
  concepts: [],
  citations: [
    {
      source_id: domain,
      title: "Source synthétique",
      excerpt: "Passage exact",
      start: 0,
      end: 13,
      location: "synthetic://source",
      content_hash: "a".repeat(64),
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function Back() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() =>
        navigate(`?api_domain=${domain}&api_conversation=${episode}`)
      }
    >
      Autre fil
    </button>
  );
}
function setup(
  extraAnswer = false,
  capabilities = [
    "inspect",
    "feedback",
    "personal_issues",
    "read_proposals",
    "personal_history",
  ],
) {
  const api = new CortexApi(() => null);
  const call = vi.spyOn(api, "call").mockImplementation(async (op, args) => {
    if (op === "conversations.list")
      return {
        items: [{ id: conversation, title: "Mon fil" }],
        next_after: null,
      } as never;
    if (op === "conversations.messages")
      return {
        items:
          "ident" in args && args.ident === conversation
            ? [
                { question: "Ma question", result },
                ...(extraAnswer
                  ? [
                      {
                        question: "Autre question",
                        result: { ...result, episode_id: domain },
                      },
                    ]
                  : []),
              ]
            : [],
        next_after: null,
      } as never;
    if (op === "sources.passage") throw new ApiError(403, "forbidden");
    return { items: [], next_after: null } as never;
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[
          `?api_domain=${domain}&api_conversation=${conversation}`,
        ]}
      >
        <GovernanceWorkspace
          api={api}
          domain={domain}
          capabilities={capabilities}
        />
        <Back />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { call, cache };
}
it("loads only the chat initially and preserves the composer across dossier navigation", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  expect(call.mock.calls.map((x) => x[0])).not.toContain("imports.list");
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: "Brouillon conservé" },
  });
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Dossiers du domaine" }),
    ).getByRole("button", { name: "Mes imports" }),
  );
  await waitFor(() =>
    expect(call.mock.calls.map((x) => x[0])).toContain("imports.list"),
  );
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Dossiers du domaine" }),
    ).getByRole("button", { name: /^Conversation$/ }),
  );
  expect(
    (screen.getByLabelText("Votre question") as HTMLTextAreaElement).value,
  ).toBe("Brouillon conservé");
});
it("opens evidence in the contextual dossier without replacing the conversation", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Examiner les preuves (1)" }),
  );
  const dossier = screen.getByRole("complementary", {
    name: "Dossier de travail",
  });
  expect(within(dossier).getByText("Passage exact")).toBeTruthy();
  expect(screen.getByText("Réponse synthétique publiée")).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Espace de travail unifié" }).dataset
      .mobileView,
  ).toBe("dossier");
});
it.each([403, 404])(
  "masks both the answer and its dossier after a fresh source authorization failure %s",
  async (status) => {
    const { call } = setup();
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (...args) => {
      if (args[0] === "sources.passage") throw new ApiError(status, "missing");
      return original(...args);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Examiner les preuves (1)" }),
    );
    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Lire la preuve",
      }),
    );
    await screen.findByText(
      "Les preuves sont masquées. Rétablissez l’accès puis relisez la conversation.",
    );
    expect(screen.queryByText("Passage exact")).toBeNull();
    expect(screen.queryByText("Réponse synthétique publiée")).toBeNull();
  },
);

it("uses numbered chat source commands on the inspected answer without submitting a new question", async () => {
  const { call } = setup();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if (args[0] === "sources.passage")
      return {
        source_id: domain,
        title: "Source synthétique",
        location: "synthetic://source",
        content_hash: "a".repeat(64),
        start: 0,
        end: 13,
        total_characters: 13,
        next_offset: null,
        offset_unit: "unicode_code_point",
        excerpt: "Passage exact",
      } as never;
    return original(...args);
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Examiner les preuves (1)" }),
  );
  compose("Lis la preuve : 1");
  expect(
    (await screen.findByRole("region", { name: "Texte de la preuve" }))
      .textContent,
  ).toBe("Passage exact");
  compose("Lis la source : 1");
  expect(
    (await screen.findByRole("region", { name: "Texte de la source" }))
      .textContent,
  ).toBe("Passage exact");
  compose("Ferme la lecture source : 1");
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Texte de la source" }),
    ).toBeNull(),
  );
  expect(call.mock.calls.some(([op]) => op === "conversations.query")).toBe(
    false,
  );
  expect(
    call.mock.calls.filter(([op]) => op === "sources.passage"),
  ).toHaveLength(2);
});
it("does not retain evidence from a previous conversation", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Examiner les preuves (1)" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Autre fil" }));
  await waitFor(() => expect(screen.queryByText("Passage exact")).toBeNull());
  expect(screen.queryByText("Réponse synthétique publiée")).toBeNull();
});
it("a membership-list failure hides existing answers and evidence", async () => {
  const { call, cache } = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Examiner les preuves (1)" }),
  );
  call.mockImplementation(async (op) => {
    if (op === "conversations.list") throw new ApiError(403, "forbidden");
    return { items: [], next_after: null } as never;
  });
  await cache.invalidateQueries({ queryKey: ["api", "conversations", domain] });
  await waitFor(() => expect(screen.queryByText("Passage exact")).toBeNull());
  expect(screen.queryByText("Réponse synthétique publiée")).toBeNull();
});

function compose(text: string) {
  fireEvent.change(screen.getByLabelText("Votre question"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
}
it("chat and button feedback use the same prepared operation and receipt", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  fireEvent.change(screen.getByLabelText("Commentaire sur cette réponse"), {
    target: { value: "Même commentaire" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^À améliorer$/ }));
  expect(call.mock.calls.some((c) => c[0] === "episodes.feedback")).toBe(false);
  expect(
    screen.getByRole("region", { name: "Projet de retour personnel" })
      .textContent,
  ).toContain("Même commentaire");
  fireEvent.click(screen.getByRole("button", { name: "Annuler le retour" }));
  compose("cette réponse est à améliorer : Même commentaire");
  expect(
    screen.getByRole("region", { name: "Projet de retour personnel" })
      .textContent,
  ).toContain("Même commentaire");
  call.mockResolvedValueOnce({ feedback_id: "receipt-1" } as never);
  compose("confirme le retour");
  await waitFor(() =>
    expect(
      call.mock.calls.filter((c) => c[0] === "episodes.feedback"),
    ).toHaveLength(1),
  );
  expect(
    call.mock.calls.find((c) => c[0] === "episodes.feedback")?.slice(1, 3),
  ).toEqual([
    { domain, episode_id: episode },
    {
      rating: "unhelpful",
      explanation: "Même commentaire",
      idempotency_key: expect.any(String),
    },
  ]);
  await waitFor(() =>
    expect(
      screen.getAllByText("Retour enregistré · receipt-1").length,
    ).toBeGreaterThan(0),
  );
});
it("does not execute ambiguous feedback or interpret a bare yes as confirmation", async () => {
  const { call } = setup(true);
  await screen.findByRole("heading", { name: "Autre question" });
  compose("cette réponse est utile");
  expect(
    (screen.getByLabelText("Réponse ciblée") as HTMLSelectElement).value,
  ).toBe("");
  expect(
    (
      screen.getByRole("button", {
        name: "Confirmer le retour",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  compose("oui");
  await screen.findByText(/Pour confirmer le projet affiché/);
  expect(
    call.mock.calls.some((c) =>
      ["episodes.feedback", "conversations.query"].includes(c[0]),
    ),
  ).toBe(false);
});
it("pins an uncertain feedback payload and idempotency key across retry", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  compose("cette réponse est utile : Retour initial");
  call.mockRejectedValueOnce(new TypeError("network unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Confirmer le retour" }));
  await screen.findByRole("button", { name: "Vérifier le même retour" });
  compose("cette réponse est à améliorer : Remplacement interdit");
  await screen.findByText(/Vérifiez d’abord le retour/);
  call.mockResolvedValueOnce({ feedback_id: "receipt-retry" } as never);
  compose("confirme le retour");
  await waitFor(() =>
    expect(
      call.mock.calls.filter((c) => c[0] === "episodes.feedback"),
    ).toHaveLength(2),
  );
  const requests = call.mock.calls.filter((c) => c[0] === "episodes.feedback");
  expect(requests[1][2]).toEqual(requests[0][2]);
});
it("expires an unsubmitted feedback project and cancels it on conversation change", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  compose("cette réponse est utile");
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 300001);
  fireEvent.click(screen.getByRole("button", { name: "Confirmer le retour" }));
  await screen.findByText(/Ce projet de retour a expiré/);
  expect(call.mock.calls.some((c) => c[0] === "episodes.feedback")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Autre fil" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Projet de retour personnel" }),
    ).toBeNull(),
  );
});
it("chat navigation opens the same dossier and never creates a query", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  compose("montre mes signalements");
  await waitFor(() =>
    expect(call.mock.calls.some((c) => c[0] === "issues.list")).toBe(true),
  );
  expect(call.mock.calls.some((c) => c[0] === "conversations.query")).toBe(
    false,
  );
});
it("a feedback permission denial masks the answer, evidence and prepared card", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  compose("cette réponse est utile");
  call.mockRejectedValueOnce(new ApiError(403, "forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Confirmer le retour" }));
  await waitFor(() =>
    expect(screen.queryByText("Réponse synthétique publiée")).toBeNull(),
  );
  expect(
    screen.queryByRole("region", { name: "Projet de retour personnel" }),
  ).toBeNull();
});

it("does not offer or load dossiers absent from server capabilities, including chat", async () => {
  const { call } = setup(false, ["inspect", "personal_history"]);
  await screen.findByText("Réponse synthétique publiée");
  expect(screen.queryByRole("button", { name: "Propositions" })).toBeNull();
  compose("ouvre les propositions");
  await screen.findByText(
    "Ce dossier n’est pas disponible avec vos accès actuels.",
  );
  expect(call.mock.calls.some((c) => c[0] === "proposals.list")).toBe(false);
  compose("cette réponse est utile");
  expect(
    screen.queryByRole("region", { name: "Projet de retour personnel" }),
  ).toBeNull();
  expect(call.mock.calls.some((c) => c[0] === "episodes.feedback")).toBe(false);
});

it("opens a proposal by chat identifier with the same bounded reader and no corpus question", async () => {
  const { call } = setup();
  await screen.findByText("Réponse synthétique publiée");
  fireEvent.change(screen.getByRole("textbox", { name: "Votre question" }), {
    target: { value: `montre les avis de la proposition : ${episode}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await waitFor(() =>
    expect(
      call.mock.calls.some(
        ([op, args]) =>
          op === "proposals.read" &&
          "proposal_id" in args &&
          args.proposal_id === episode,
      ),
    ).toBe(true),
  );
  expect(
    call.mock.calls.some(
      ([op]) => op === "conversations.query" || op === "proposals.create",
    ),
  ).toBe(false);
});
