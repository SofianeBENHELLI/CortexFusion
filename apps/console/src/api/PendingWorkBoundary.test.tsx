import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  PendingWorkBoundary,
  changesWorkContext,
  usePendingWork,
  useExitRequest,
} from "./PendingWorkBoundary";
afterEach(cleanup);

// The data router builds a Node Request with an AbortSignal from the test DOM.
// Node 24 rejects a signal from another realm there, so navigation would throw.
// These routes have no loaders or actions, so the router never reads the signal;
// browsers share one realm and are unaffected.
beforeAll(() => {
  vi.stubGlobal(
    "Request",
    new Proxy(globalThis.Request, {
      construct(target, [input, init]: [RequestInfo | URL, RequestInit?]) {
        try {
          return new target(input, init);
        } catch (error) {
          if (!(error instanceof TypeError) || init?.signal == null)
            throw error;
          return new target(input, { ...init, signal: undefined });
        }
      },
    }),
  );
});
afterAll(() => vi.unstubAllGlobals());

function Fixture({ exit }: { exit: () => void }) {
  const [state, setState] = useState<"sending" | "uncertain" | "draft">(
    "uncertain",
  );
  const [resolved, setResolved] = useState(false);
  const [extraDraft, setExtraDraft] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const requestExit = useExitRequest();
  usePendingWork("Commande synthétique", resolved ? undefined : state);
  usePendingWork("Saisie secondaire", extraDraft ? "draft" : undefined);
  return (
    <>
      <output>{location.search}</output>
      <button onClick={() => navigate("?api_domain=b&api_view=work")}>
        Autre domaine
      </button>
      <button
        onClick={() =>
          navigate("?api_domain=a&api_view=work&api_dossier=tasks")
        }
      >
        Autre dossier
      </button>
      <button onClick={() => navigate(-1)}>Historique précédent</button>
      <button onClick={() => requestExit(exit)}>Fermer</button>
      <button onClick={() => setState("draft")}>Saisie fixture</button>
      <button onClick={() => setExtraDraft(true)}>Saisie secondaire</button>
      <button onClick={() => setState("sending")}>Envoyer fixture</button>
      <button onClick={() => setResolved(true)}>Résoudre fixture</button>
    </>
  );
}
function mount(exit = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <PendingWorkBoundary>
            <Fixture exit={exit} />
          </PendingWorkBoundary>
        ),
      },
    ],
    {
      initialEntries: [
        "/?api_domain=b&api_view=work",
        "/?api_domain=a&api_view=work",
      ],
      initialIndex: 1,
    },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return { router, exit };
}
it("blocks changing domain, stays without changing URL, then permits an explicit exit without issuing a command", async () => {
  const { router } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  await screen.findByRole("alertdialog");
  expect(router.state.location.search).toBe("?api_domain=a&api_view=work");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Rester et vérifier" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Rester et vérifier" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Quitter sans vérifier" }),
  );
  await waitFor(() =>
    expect(router.state.location.search).toBe("?api_domain=b&api_view=work"),
  );
});
it("leaves dossier navigation free but catches browser Back across contexts", async () => {
  const { router } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Autre dossier" }));
  expect(router.state.location.search).toContain("api_dossier=tasks");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Historique précédent" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Historique précédent" }));
  await screen.findByRole("alertdialog");
  expect(router.state.location.search).toBe("?api_domain=a&api_view=work");
});
it("requires staying while sending and protects explicit logout and reload", async () => {
  const { exit } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Envoyer fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
  const leave = await screen.findByRole("button", {
    name: "Quitter sans vérifier",
  });
  expect((leave as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(leave);
  expect(exit).not.toHaveBeenCalled();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Rester et vérifier" }));
  fireEvent.click(screen.getByRole("button", { name: "Résoudre fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
  expect(exit).toHaveBeenCalledOnce();
  const resolved = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(resolved);
  expect(resolved.defaultPrevented).toBe(false);
});
it("closing via Escape stays, and completion never auto-navigates to the attempted destination", async () => {
  const { router } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  fireEvent(
    await screen.findByRole("alertdialog"),
    new Event("cancel", { cancelable: true }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "Résoudre fixture" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(router.state.location.search).toBe("?api_domain=a&api_view=work");
  await act(() => router.navigate("?api_domain=b&api_view=work"));
  expect(router.state.location.search).toBe("?api_domain=b&api_view=work");
});
it("defines only the context boundary, including the default work view", () => {
  const at = (search: string) => ({ pathname: "/", search });
  expect(
    changesWorkContext(
      at("?api_domain=a"),
      at("?api_domain=a&api_view=work&api_task=t"),
    ),
  ).toBe(false);
  expect(
    changesWorkContext(at("?api_domain=a"), at("?api_domain=a&api_view=brain")),
  ).toBe(true);
  expect(
    changesWorkContext(at("?api_domain=a"), at("?api_view=overview")),
  ).toBe(true);
});

it("warns before losing an unsaved draft, preserves dossier navigation and stays by default", async () => {
  const { router, exit } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Saisie fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "Autre dossier" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  expect(
    await screen.findByRole("heading", {
      name: "Des saisies ne sont pas enregistrées",
    }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Revenir à ma saisie" }),
  );
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Revenir à ma saisie" }));
  expect(router.state.location.search).toContain("api_domain=a");
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Quitter sans enregistrer" }),
  );
  expect(exit).toHaveBeenCalledOnce();
});
it("shows both unsaved and uncertain work while keeping an in-flight exit disabled", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Saisie secondaire" }));
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("non enregistré");
  expect(dialog.textContent).toContain("résultat inconnu");
  expect(
    screen.getByRole("heading", { name: "Du travail reste à terminer" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rester et vérifier" }));
  fireEvent.click(screen.getByRole("button", { name: "Envoyer fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "Autre domaine" }));
  expect(
    (
      (await screen.findByRole("button", {
        name: "Quitter sans vérifier",
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
