import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resolveWorkName, useWorkSelection } from "./workSelection";
import { chatIntent } from "./workspaceCommands";
const one = "00000000-0000-0000-0000-000000000001",
  two = "00000000-0000-0000-0000-000000000002";
afterEach(cleanup);
it("resolves accent-insensitive exact names but never chooses a duplicate or partial match", () => {
  const rows = [
    { id: one, title: "Réviser les preuves" },
    { id: two, title: "Réviser le délai" },
  ];
  expect(resolveWorkName("  REVISER  LES PREUVES ", rows)).toEqual({ id: one });
  expect(resolveWorkName("Réviser", rows)).toEqual({ ambiguous: false });
  expect(
    resolveWorkName(rows[0].title, [
      ...rows,
      { id: two, title: rows[0].title },
    ]),
  ).toEqual({ ambiguous: true });
  expect(chatIntent("ouvre la tâche : Réviser les preuves")).toEqual({
    kind: "task_select",
    id: "Réviser les preuves",
  });
  expect(chatIntent("trouve le dossier partagé : Délai")).toEqual({
    kind: "case_select",
    id: "Délai",
  });
  for (const malformed of [
    "prépare un partage : titre | texte | manager | inconnu",
    "crée une tâche : titre | consigne | critère | date | extra",
  ])
    expect(chatIntent(malformed)).toEqual({ kind: "unsupported" });
});
function Fixture({
  locked = false,
  onReset = () => {},
  onBlocked = () => {},
}: {
  locked?: boolean;
  onReset?: () => void;
  onBlocked?: () => void;
}) {
  const [route, navigate] = useState(one);
  const [selected, select] = useWorkSelection({
    requested: route,
    onNavigate: navigate,
    locked,
    onReset,
    onBlocked,
  });
  return (
    <>
      <output aria-label="selected">{selected}</output>
      <output aria-label="route">{route}</output>
      <button onClick={() => select(two)}>Select</button>
      <button onClick={() => navigate(one)}>Back</button>
      <button onClick={() => navigate("invalid")}>Invalid link</button>
    </>
  );
}
it("restores selection from history and invalidates an unsent preparation without writing", async () => {
  const reset = vi.fn();
  render(<Fixture onReset={reset} />);
  fireEvent.click(screen.getByText("Select"));
  expect(screen.getByLabelText("route").textContent).toBe(two);
  fireEvent.click(screen.getByText("Back"));
  await waitFor(() =>
    expect(screen.getByLabelText("selected").textContent).toBe(one),
  );
  expect(reset).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Invalid link"));
  await waitFor(() =>
    expect(screen.getByLabelText("selected").textContent).toBe(""),
  );
});
it("keeps the original target and restores its link during an uncertain command", async () => {
  const reset = vi.fn(),
    blocked = vi.fn();
  const view = render(<Fixture onReset={reset} onBlocked={blocked} />);
  fireEvent.click(screen.getByText("Select"));
  view.rerender(<Fixture locked onReset={reset} onBlocked={blocked} />);
  fireEvent.click(screen.getByText("Back"));
  await waitFor(() =>
    expect(screen.getByLabelText("route").textContent).toBe(two),
  );
  expect(screen.getByLabelText("selected").textContent).toBe(two);
  expect(reset).not.toHaveBeenCalled();
  expect(blocked).toHaveBeenCalledTimes(1);
});
