import React, { lazy } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AsyncWorkspace } from "./AsyncWorkspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferredWorkspace() {
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  let reject!: (error: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<{ default: () => React.JSX.Element }>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  return {
    Workspace: lazy(load),
    load,
    resolve: (component: () => React.JSX.Element) =>
      resolve({ default: component }),
    reject: (error: Error) => reject(error),
  };
}

it("announces loading while surrounding navigation stays usable, then renders the workspace", async () => {
  const next = deferredWorkspace();
  render(
    <>
      <button>Se déconnecter</button>
      <AsyncWorkspace name="BrainMap" resetKey="brain">
        <next.Workspace />
      </AsyncWorkspace>
    </>,
  );
  expect(screen.getByRole("status").textContent).toBe("Ouverture de BrainMap…");
  expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
  await act(async () => next.resolve(() => <h1>Carte chargée</h1>));
  expect(screen.getByRole("heading", { name: "Carte chargée" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(next.load).toHaveBeenCalledTimes(1);
});

it("contains a rejected module without exposing its error and lets a different workspace open", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const next = deferredWorkspace();
  const view = render(
    <AsyncWorkspace name="BrainMap" resetKey="brain">
      <next.Workspace />
    </AsyncWorkspace>,
  );
  await act(async () => next.reject(new Error("private module error detail")));
  expect(screen.getByRole("alert").textContent).toContain(
    "Impossible d’ouvrir BrainMap",
  );
  expect(screen.queryByText(/private module error/)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Recharger la page" }),
  ).toBeTruthy();
  expect(next.load).toHaveBeenCalledTimes(1);
  view.rerender(
    <AsyncWorkspace name="Vue d’ensemble" resetKey="overview">
      <h1>Domaines accessibles</h1>
    </AsyncWorkspace>,
  );
  expect(
    screen.getByRole("heading", { name: "Domaines accessibles" }),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not mount a late workspace after the connected shell is removed", async () => {
  const next = deferredWorkspace();
  const mounted = vi.fn(() => <h1>Données connectées</h1>);
  const view = render(
    <AsyncWorkspace name="BrainMap" resetKey="brain">
      <next.Workspace />
    </AsyncWorkspace>,
  );
  view.rerender(<h1>Se connecter</h1>);
  await act(async () => next.resolve(mounted));
  expect(mounted).not.toHaveBeenCalled();
  expect(screen.queryByText("Données connectées")).toBeNull();
});
