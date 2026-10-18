import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "../api/client";
import { SpatialBrainWorkspace } from "./SpatialBrainWorkspace";
vi.mock("./SpatialCanvas", () => ({
  SpatialCanvas: ({ focus }: { focus?: { ids: string[] } }) => (
    <div data-testid="canvas" data-focus={JSON.stringify(focus?.ids)}>
      Carte test
    </div>
  ),
}));
afterEach(cleanup);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function setup(entry = "/") {
  let denied = false;
  let version = 1;
  let sourceFailure: ApiError | null = null;
  let mapDelay: Promise<void> | null = null;
  let bodyDelay: Promise<void> | null = null;
  const reconnect = vi.fn();
  const nodes = ["Alpha", "Beta"].map((title, i) => ({
    id: id(i + 1),
    title,
    maturity: "emerging",
    group: "Group",
    territory: "One",
  }));
  const call = vi.fn(async (op: string, params: { concept_id?: string }) => {
    if (denied) throw new ApiError(403, "forbidden");
    if (op === "graph.map") {
      if (mapDelay) await mapDelay;
      return {
        domain_id: id(0),
        at_version: version,
        nodes: version === 1 ? nodes : [...nodes].reverse(),
        edges:
          version === 1
            ? [[0, 1, "reference", null]]
            : [[1, 0, "reference", null]],
        published_relations: 0,
        documentary_references: 1,
      };
    }
    if (op === "sources.passage") {
      if (sourceFailure) throw sourceFailure;
      return {
        source_id: id(5),
        start: 0,
        end: 10,
        total_characters: 14,
        next_offset: 10,
        offset_unit: "unicode_code_point",
        excerpt: "Evidence t",
        title: "Synthetic",
        location: "fixture",
        content_hash: "a".repeat(64),
      };
    }
    if (op === "domain.version") return { published_version: version };
    if (op === "concepts.read") {
      if (bodyDelay) await bodyDelay;
      return {
        concept_id: params.concept_id,
        title: params.concept_id === id(1) ? "Alpha" : "Beta",
        maturity: "emerging",
        body:
          params.concept_id === id(1)
            ? "# Alpha\n\n[Beta](private.md)"
            : "# Beta\n\nPublished evidence.",
        sources: [{ source_id: id(5), start: 0, end: 10 }],
        links: [],
      };
    }
    throw Error(op);
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <SpatialBrainWorkspace
          api={{ call } as unknown as CortexApi}
          domain={id(0)}
          name="Synthetic"
          owner={false}
          onReconnect={reconnect}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    call,
    reconnect,
    deny: () => (denied = true),
    advance: () => version++,
    refuseSource: (error: ApiError) => {
      sourceFailure = error;
    },
    delayMap: (pending: Promise<void>) => {
      mapDelay = pending;
    },
    delayBody: (pending: Promise<void>) => {
      bodyDelay = pending;
    },
  };
}
it.each([401, 403, 409, 404])(
  "handles proof refusal %s without exposing stale authorized content",
  async (status) => {
    const s = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
    await screen.findByRole("region", { name: "Contenu publié du concept" });
    fireEvent.click(screen.getByText("1 preuve(s) du contenu publié"));
    s.refuseSource(new ApiError(status, "proof-refused"));
    fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
    await screen.findByRole("alert");
    await screen.findByText("Lecture interrompue");
    expect(screen.queryByTestId("canvas")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Contenu publié du concept" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Texte de la preuve" }),
    ).toBeNull();
    if (status === 401) {
      fireEvent.click(screen.getByRole("button", { name: "Se reconnecter" }));
      expect(s.reconnect).toHaveBeenCalledOnce();
    } else
      expect(
        screen.queryByRole("button", { name: "Se reconnecter" }),
      ).toBeNull();
  },
);
it("keeps the map masked during recovery and rereads the selected body even at the same version", async () => {
  const s = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  await screen.findByRole("region", { name: "Contenu publié du concept" });
  fireEvent.click(screen.getByText("1 preuve(s) du contenu publié"));
  s.refuseSource(new ApiError(403, "forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  await screen.findByText("Lecture interrompue");
  let releaseMap!: () => void;
  let releaseBody!: () => void;
  s.delayMap(
    new Promise<void>((resolve) => {
      releaseMap = resolve;
    }),
  );
  s.delayBody(
    new Promise<void>((resolve) => {
      releaseBody = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  expect(screen.queryByTestId("canvas")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Contenu publié du concept" }),
  ).toBeNull();
  releaseMap();
  await screen.findByTestId("canvas");
  expect(
    screen.queryByRole("region", { name: "Contenu publié du concept" }),
  ).toBeNull();
  releaseBody();
  await screen.findByRole("region", { name: "Contenu publié du concept" });
  expect(
    s.call.mock.calls.filter(([op]) => op === "concepts.read"),
  ).toHaveLength(2);
});
it("keeps the selected identity and focus IDs across a differently ordered publication", async () => {
  const state = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  await screen.findByRole("region", { name: "Contenu publié du concept" });
  state.advance();
  fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await waitFor(() => expect(screen.getByText(/Version 2/)).toBeTruthy());
  await screen.findByRole("region", { name: "Contenu publié du concept" });
  expect(screen.getByRole("heading", { name: "Alpha", level: 2 })).toBeTruthy();
  expect(
    JSON.parse(screen.getByTestId("canvas").getAttribute("data-focus")!),
  ).toEqual([id(1), id(2)]);
  fireEvent.click(
    screen.getByRole("button", { name: "→ Beta Référence documentaire" }),
  );
  await screen.findByText("Published evidence.");
});
it("recovers from a missing deep-linked concept without leaving an empty inspector", async () => {
  setup(`/?map_node=${id(99)}`);
  await screen.findByText("Concept indisponible dans cette carte");
  fireEvent.click(screen.getByRole("button", { name: "Revenir aux concepts" }));
  await screen.findByRole("button", { name: /Alpha Group/ });
});
it("opens published content and follows a documentary reference without converting it into a Cortex relationship", async () => {
  const { call } = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  await screen.findByRole("region", { name: "Contenu publié du concept" });
  expect(screen.getByText("1 liens entrants / sortants")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "→ Beta Référence documentaire" }),
  );
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "concepts.read",
      { domain: id(0), concept_id: id(2) },
      undefined,
      expect.anything(),
    ),
  );
  await screen.findByText("Published evidence.");
  expect(
    screen.getByText("0", { selector: ".spatial-summary strong" }),
  ).toBeTruthy();
});
it("masks the previous topology when a refresh is refused", async () => {
  const state = setup();
  await screen.findByRole("button", { name: /Alpha Group/ });
  state.deny();
  fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Carte test")).toBeNull();
  expect(screen.queryByRole("button", { name: /Alpha Group/ })).toBeNull();
});
it("brings relation details into keyboard focus and returns to their trigger on Escape", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  const trigger = await screen.findByRole("button", {
    name: "Détail du lien avec Beta",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const relation = await screen.findByRole("region", {
    name: "Détail du lien",
  });
  expect(document.activeElement).toBe(relation);
  fireEvent.keyDown(relation, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Détail du lien" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("reports an empty search without hiding published totals", async () => {
  setup();
  await screen.findByRole("button", { name: /Alpha Group/ });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Rechercher un concept" }),
    { target: { value: "does-not-exist" } },
  );
  expect(
    screen.getByText("Aucun concept ne correspond à cette recherche."),
  ).toBeTruthy();
  expect(
    screen.getByText("2", { selector: ".spatial-summary strong" }),
  ).toBeTruthy();
});
