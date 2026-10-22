import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SceneEventDetail } from "./SceneEventDetail";
import type { BrainChange } from "./model";
import { ApiError, CortexApi } from "../api/client";
import { id, node, page, scene } from "./scene.fixture";
afterEach(cleanup);
const event: BrainChange = {
  id: "change",
  publicationId: "publication",
  time: "2026-10-04T12:00:00Z",
  version: 1,
  kind: "relation_strengthened",
  title: "Alpha → Beta",
  detail: "Poids publié : 0.2 → 0.5.",
  nodeIds: [id(1), id(2)],
  groupIds: [],
  sourceIds: [id(9)],
  evidence: [{ source_id: id(9), start: 1, end: 4 }],
  relation: {
    id: "link",
    from: id(1),
    to: id(2),
    kind: "associative",
    weight: 0.5,
    sourceIds: [],
  },
};
function setup(
  mode:
    | "current"
    | "removed"
    | "hidden"
    | "stale"
    | "denied"
    | "proof-denied" = "current",
  selectedEvent: BrainChange = event,
) {
  const onFocus = vi.fn(),
    onFatal = vi.fn(),
    onOpen = vi.fn(),
    onClose = vi.fn();
  const call = vi.fn(
    async (
      op: string,
      _params: unknown,
      _body: unknown,
      opts?: { query?: { focus?: string; target?: string } },
    ) => {
      if (op === "sources.passage" && mode === "proof-denied")
        throw new ApiError(403, "forbidden");
      if (op === "sources.passage")
        return {
          source_id: id(9),
          start: 1,
          end: 4,
          total_characters: 5,
          next_offset: 4,
          offset_unit: "unicode_code_point",
          title: "Source exacte",
          location: "synthetic://proof",
          content_hash: "a".repeat(64),
          excerpt: "🧠AB",
        };
      if (mode === "hidden") throw new ApiError(404, "not_found");
      if (mode === "denied") throw new ApiError(403, "forbidden");
      const origin = opts?.query?.focus === id(1);
      return {
        ...page,
        at_version: mode === "stale" ? 3 : 2,
        selected: {
          ...node,
          id: opts?.query?.focus,
          title: origin ? "Alpha" : "Beta",
        },
        focus_bounds: scene.bounds,
        total: mode === "removed" ? 0 : 1,
        items:
          mode === "removed"
            ? []
            : [
                {
                  node: { ...node, id: origin ? id(2) : id(1) },
                  link: {
                    from: id(1),
                    to: id(2),
                    kind: "associative",
                    weight: 0.9,
                  },
                },
              ],
      };
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SceneEventDetail
        api={{ call } as unknown as CortexApi}
        domain={id(0)}
        event={selectedEvent}
        stamp={{ at_version: 2, visibility: page.visibility }}
        layout="lines"
        {...{ onFocus, onFatal, onOpen, onClose }}
      />
    </QueryClientProvider>,
  );
  return { call, onFocus, onFatal, onOpen, onClose };
}
it("keeps historical weight distinct, frames both current endpoints and reads the exact Unicode evidence range", async () => {
  const s = setup();
  await screen.findByText("Relation actuelle associative · poids 0.9.");
  expect(screen.getByText(/Relation associative · poids 0.5/)).toBeTruthy();
  expect(
    s.call.mock.calls
      .filter((c) => c[0] === "graph.map_nodes")
      .map((c) => c[3]?.query),
  ).toMatchObject([
    { focus: id(1), target: id(2), at_version: 2, visibility: page.visibility },
    { focus: id(2), target: id(1), at_version: 2, visibility: page.visibility },
  ]);
  expect(s.onFocus).toHaveBeenCalledWith(scene.bounds, {
    from: id(1),
    to: id(2),
    kind: "associative",
  });
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "Détail de l’événement" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir Beta ↗" }));
  expect(s.onOpen).toHaveBeenCalledWith(id(2));
  fireEvent.click(screen.getByText("1 extrait(s) source de cette différence"));
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  expect(
    (await screen.findByRole("region", { name: "Texte de la preuve" }))
      .textContent,
  ).toBe("🧠AB");
  fireEvent.keyDown(
    screen.getByRole("region", { name: "Texte de la preuve" }),
    { key: "Escape" },
  );
  expect(s.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(
    screen.getByRole("region", { name: "Détail de l’événement" }),
    { key: "Escape" },
  );
  expect(s.onClose).toHaveBeenCalledTimes(1);
});
it("frames surviving concepts without drawing a historical link as current", async () => {
  const s = setup("removed");
  await screen.findByText(/Aucune relation actuelle/);
  expect(screen.queryByText(/Relation actuelle associative/)).toBeNull();
  expect(s.onFocus).toHaveBeenCalledWith(scene.bounds, {
    from: id(1),
    to: id(2),
    kind: "associative",
  });
});
it("does not navigate to a hidden or retired endpoint", async () => {
  const s = setup("hidden");
  await screen.findByText(/une extrémité n’est plus disponible/);
  expect(s.onFocus).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Cadrer/ })).toBeNull();
});
it.each(["stale", "denied"] as const)(
  "propagates %s reads to mask the previous map",
  async (mode) => {
    const s = setup(mode);
    await waitFor(() => expect(s.onFatal).toHaveBeenCalled());
    expect(s.onFocus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Ouvrir/ })).toBeNull();
  },
);

it("escalates a fresh refusal of historical evidence without displaying the old excerpt", async () => {
  const s = setup("proof-denied");
  await screen.findByText("Relation actuelle associative · poids 0.9.");
  fireEvent.click(screen.getByText("1 extrait(s) source de cette différence"));
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  await waitFor(() => expect(s.onFatal).toHaveBeenCalled());
  expect(
    screen.queryByRole("region", { name: "Texte de la preuve" }),
  ).toBeNull();
});

it("identifies current endpoint names as current when history only contains an identifier", async () => {
  setup("current", {
    ...event,
    title: `Alpha → ${id(2)}`,
    relation: { ...event.relation!, toTitle: id(2) },
  });
  await screen.findByRole("heading", { name: "Alpha → Beta" });
  expect(
    screen.getByText(/Le nom de la cible vient de son état actuel/),
  ).toBeTruthy();
});
