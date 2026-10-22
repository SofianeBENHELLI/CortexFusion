import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockApp from "./MockApp";
import { gateway } from "./mock";

vi.mock("./mock", async (original) => {
  const actual = await original<typeof import("./mock")>();
  return {
    ...actual,
    gateway: new actual.MockGateway({
      state: actual.seed(),
      delay: 0,
      storage: false,
    }),
  };
});

let cache: QueryClient;
const scrollDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  sessionStorage.clear();
  gateway.reset();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <MockApp />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Reset through the same control as a user; the conversation store persists
  // independently of the gateway and must not leak between scenarios.
  fireEvent.click(screen.getByRole("button", { name: "Démo locale" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Réinitialiser la démo" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
});
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollDescriptor);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function navigate(name: string) {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", { name }),
  );
}
function history(name: string) {
  const sidebar = screen.getByRole("complementary");
  return within(sidebar)
    .getAllByRole("button", { name })
    .filter((button) => !button.closest("nav"))[0];
}
async function ask() {
  fireEvent.change(screen.getByRole("textbox", { name: "Votre message" }), {
    target: { value: "Combien de lunes autour de Mars ?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Réponse utile",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}

it("stops dictation when navigation changes its conversation context", async () => {
  let recognition: any;
  vi.stubGlobal(
    "SpeechRecognition",
    class {
      onresult: ((event: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      start = vi.fn();
      abort = vi.fn();
      stop = vi.fn();
      constructor() {
        recognition = this;
      }
    },
  );
  await ask();
  fireEvent.click(screen.getByRole("button", { name: "Parler" }));
  const late = recognition.onresult;
  navigate("Mémoire");
  expect(recognition.abort).toHaveBeenCalledTimes(1);
  act(() => late({ results: [[{ transcript: "Une ancienne dictée" }]] }));
  expect(
    (screen.getByRole("textbox", { name: "Votre message" }) as HTMLInputElement)
      .value,
  ).toBe("");
});

it("keeps a late feedback receipt in its initiating conversation after navigation", async () => {
  await ask();
  const next = pending<void>();
  vi.spyOn(gateway, "feedback").mockReturnValue(next.promise);
  fireEvent.click(screen.getByRole("button", { name: "Réponse utile" }));
  navigate("Signaux utilisateurs");
  await act(async () => next.resolve());
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Parler" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(
    screen.queryByText(
      "Merci, votre retour est enregistré dans les signaux utilisateurs.",
    ),
  ).toBeNull();
  fireEvent.click(history("Combien de lunes autour de Mars ?"));
  expect(
    await screen.findByText(
      "Merci, votre retour est enregistré dans les signaux utilisateurs.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Retour enregistré")).toBeTruthy();
});

it("does not redirect a user who leaves while a correction is created; its receipt remains actionable", async () => {
  navigate("Concepts & relations");
  fireEvent.click(
    await screen.findByRole("button", { name: /^SIMULIA .*Publié$/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Proposer une relation" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Cible" }), {
    target: { value: "wave6" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Raison" }), {
    target: { value: "Preuve de recette" },
  });
  const next = pending<void>();
  const original = gateway.correction.bind(gateway);
  vi.spyOn(gateway, "correction").mockImplementation(async (...args) => {
    await next.promise;
    return original(...args);
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Proposer la correction" }),
  );
  navigate("Mémoire");
  await act(async () => next.resolve());
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Mémoire" })).toBeTruthy(),
  );
  expect(
    screen.queryByRole("heading", { name: "SIMULIA — correction proposée" }),
  ).toBeNull();
  fireEvent.click(history("Concepts & relations"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Ouvrir PR-3090" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "SIMULIA — correction proposée",
    }),
  ).toBeTruthy();
  expect(screen.queryByText(/introuvable ou inaccessible/)).toBeNull();
});

it("keeps a late failure out of an unrelated view and offers recovery in the originating conversation", async () => {
  await ask();
  const next = pending<void>();
  vi.spyOn(gateway, "feedback").mockReturnValue(next.promise);
  fireEvent.click(screen.getByRole("button", { name: "Réponse utile" }));
  navigate("Mémoire");
  await act(async () => next.reject(new Error("Échec synthétique du retour")));
  expect(screen.queryByText("Échec synthétique du retour")).toBeNull();
  fireEvent.click(history("Combien de lunes autour de Mars ?"));
  expect(screen.getByText("Échec synthétique du retour")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Revenir à l’action" }),
  ).toBeTruthy();
  expect(screen.queryByText("Retour enregistré")).toBeNull();
});

it("does not resurrect receipts or conversations after changing the simulated identity", async () => {
  await ask();
  const next = pending<void>();
  vi.spyOn(gateway, "feedback").mockReturnValue(next.promise);
  fireEvent.click(screen.getByRole("button", { name: "Réponse utile" }));
  fireEvent.click(screen.getByRole("button", { name: "Démo locale" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Tester avec le rôle" }),
    { target: { value: "viewer" } },
  );
  await act(async () => next.resolve());
  expect(
    screen.queryByText(
      "Merci, votre retour est enregistré dans les signaux utilisateurs.",
    ),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Combien de lunes autour de Mars ?" }),
  ).toBeNull();
  expect(
    screen.getAllByText("Vos échanges apparaîtront ici.").length,
  ).toBeGreaterThan(0);
});

it("keeps a publication receipt in the approving conversation when navigation occurs during submission", async () => {
  navigate("À valider");
  fireEvent.click(
    await screen.findByRole("button", { name: /^SIMULIA — ajouter wave6/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approuver" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Raison de la décision" }),
    { target: { value: "Preuve examinée" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
  fireEvent.click(await screen.findByRole("button", { name: "Publier v42" }));
  const next = pending<void>();
  const original = gateway.publish.bind(gateway);
  vi.spyOn(gateway, "publish").mockImplementation(async (...args) => {
    await next.promise;
    return original(...args);
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
  navigate("Mémoire");
  await act(async () => next.resolve());
  await waitFor(() => expect(gateway.publish).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("PR-3082 : publication en cours…")).toBeNull();
  fireEvent.click(history("À valider"));
  expect(
    await screen.findByText("PR-3082 : publication en cours…"),
  ).toBeTruthy();
});

it("returns keyboard focus to the reopen control after closing the detail panel", async () => {
  navigate("Concepts & relations");
  fireEvent.click(
    await screen.findByRole("button", { name: /^SIMULIA .*Publié$/ }),
  );
  const close = screen.getByRole("button", { name: "Fermer la vue" });
  close.focus();
  fireEvent.click(close);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Afficher la vue" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Afficher la vue" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Fermer la vue" }),
  );
  expect(
    screen.getByRole("region", { name: "Concepts & relations" }),
  ).toBeTruthy();
});

it("explains an unavailable publication instead of offering an invalid confirmation", async () => {
  fireEvent.change(screen.getByRole("textbox", { name: "Votre message" }), {
    target: { value: "Publier PR-3082" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  expect(
    await screen.findByText(
      /PR-3082 doit être approuvée avant de pouvoir être publiée/,
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: /Publier la version/ }),
  ).toBeNull();
  expect((await gateway.get()).version).toBe(41);
});

it("does not invite a repeated decision after a proposal has been rejected", async () => {
  await gateway.decide("PR-3082", "reject", "Déjà examinée", 41);
  fireEvent.change(screen.getByRole("textbox", { name: "Votre message" }), {
    target: { value: "Approuve PR-3082" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  expect(
    await screen.findByText(
      /L’action demandée n’est pas disponible dans cet état/,
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Confirmer l’approbation ?" }),
  ).toBeNull();
  expect(
    (await gateway.get()).proposals.find(
      (proposal) => proposal.id === "PR-3082",
    )?.status,
  ).toBe("rejected");
});
