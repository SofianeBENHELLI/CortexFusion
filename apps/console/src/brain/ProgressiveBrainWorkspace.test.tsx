import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate, useLocation } from "react-router-dom";
import { ProgressiveBrainWorkspace } from "./ProgressiveBrainWorkspace";
import { CortexApi, ApiError } from "../api/client";
import { id, node, scene, page } from "./scene.fixture";
const readHistory = vi.hoisted(() => vi.fn());
vi.mock("./api-projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-projection")>()),
  readApiBrain: readHistory,
}));
function LocationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>Retour navigateur</button>
      <output aria-label="URL courante">{location.search}</output>
    </>
  );
}
vi.mock("./SceneCanvas", () => ({
  SceneCanvas: ({
    data,
    changes,
    focus,
  }: {
    data: unknown;
    changes?: Map<string, string>;
    focus?: { sequence: number };
  }) => (
    <div
      data-testid="scene"
      data-changes={changes?.size ?? 0}
      data-focus={focus?.sequence}
    >
      Carte autorisée {Boolean(data).toString()}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  readHistory.mockReset();
});
function setup(
  paging?: { wait: Promise<void> },
  entry = "/",
  owner = false,
  graph = scene,
) {
  let refused = false;
  let sourceFailure: ApiError | null = null;
  let nextScene: Promise<unknown> | null = null;
  const call = vi.fn(
    async (
      op: string,
      _params: unknown,
      _body: unknown,
      opts?: {
        query?: {
          focus?: string;
          target?: string;
          search?: string;
          offset?: number;
        };
      },
    ) => {
      if (refused) throw new ApiError(403, "forbidden");
      if (op === "sources.passage" && sourceFailure) throw sourceFailure;
      if (
        op === "graph.map_nodes" &&
        opts?.query?.focus &&
        opts?.query?.offset &&
        paging
      )
        await paging.wait;
      if (op === "graph.scene") {
        const delayed = nextScene;
        nextScene = null;
        return delayed ?? graph;
      }
      if (op === "graph.map_nodes" && opts?.query?.target)
        return {
          ...page,
          selected: {
            ...node,
            id: opts.query.focus!,
            title: opts.query.focus === id(1) ? "Alpha" : "Beta",
          },
          focus_bounds: scene.bounds,
          items: [
            {
              node: { ...node, id: opts.query.target },
              link: {
                from: id(1),
                to: id(2),
                kind: "associative",
                weight: 0.9,
              },
            },
          ],
        };
      if (op === "graph.map_nodes")
        return opts?.query?.focus
          ? {
              ...page,
              selected: node,
              focus_bounds: scene.bounds,
              total: paging ? 17 : 1,
              offset: opts?.query?.offset ?? 0,
              items: Array.from(
                { length: paging && !opts?.query?.offset ? 16 : 1 },
                (_, i) => ({
                  node: {
                    ...node,
                    id: id(2 + i + (opts?.query?.offset ?? 0)),
                    title: `Beta ${i + (opts?.query?.offset ?? 0)}`,
                  },
                  link: {
                    from: id(1),
                    to: id(2 + i + (opts?.query?.offset ?? 0)),
                    kind: "associative",
                    weight: 0.5,
                  },
                }),
              ),
            }
          : opts?.query?.search === "absent"
            ? { ...page, total: 0, items: [] }
            : opts?.query?.search === "Alpha"
              ? {
                  ...page,
                  page_size: 8,
                  total: 19,
                  offset: opts.query.offset ?? 0,
                  items: Array.from(
                    { length: Math.min(8, 19 - (opts.query.offset ?? 0)) },
                    (_, i) => ({
                      node: {
                        ...node,
                        id: id(i + 1 + (opts.query!.offset ?? 0)),
                        title: `Alpha ${i + (opts.query!.offset ?? 0)}`,
                      },
                      link: null,
                    }),
                  ),
                }
              : page;
      if (op === "concepts.read")
        return {
          concept_id: id(1),
          title: "Alpha",
          maturity: "emerging",
          body: "Published source body.",
          sources: [{ source_id: id(9), start: 0, end: 5 }],
          links: [],
        };
      if (op === "domain.version") return { published_version: 2 };
      throw Error(op);
    },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const reconnect = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationControls />
        <ProgressiveBrainWorkspace
          api={{ call } as unknown as CortexApi}
          domain={id(0)}
          name="Test"
          owner={owner}
          onReconnect={reconnect}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    call,
    reconnect,
    delayScene: (promise: Promise<unknown>) => {
      nextScene = promise;
    },
    refuse: () => (refused = true),
    refuseSource: (error: ApiError) => {
      sourceFailure = error;
    },
  };
}

it.each([401, 403, 409, 404])(
  "handles a proof read failure %s consistently with current graph access",
  async (status) => {
    const s = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
    await screen.findByText("Published source body.");
    fireEvent.click(screen.getByText("1 preuve(s) du contenu publié"));
    s.refuseSource(new ApiError(status, "proof-refused"));
    fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
    await screen.findByRole("alert");
    await screen.findByText("Lecture interrompue");
    expect(screen.queryByTestId("scene")).toBeNull();
    expect(screen.queryByText("Published source body.")).toBeNull();
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
it("does not expose a cached map while a recovery read after a proof refusal is pending", async () => {
  const s = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  await screen.findByText("Published source body.");
  fireEvent.click(screen.getByText("1 preuve(s) du contenu publié"));
  s.refuseSource(new ApiError(403, "forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Lire la preuve" }));
  await screen.findByText("Lecture interrompue");
  let release!: (data: unknown) => void;
  s.delayScene(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  expect(screen.queryByTestId("scene")).toBeNull();
  expect(screen.queryByText("Published source body.")).toBeNull();
  release(scene);
  await screen.findByTestId("scene");
});

it("opens before history exists and reads detail without fetching global topology", async () => {
  const { call } = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  await screen.findByText("Published source body.");
  expect(screen.getByText("1 liens entrants / sortants")).toBeTruthy();
  expect(call.mock.calls.some((c) => c[0] === "graph.map")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Chronique" }));
  expect(
    await screen.findByText(
      "Le journal de publication n’est pas disponible pour votre rôle.",
    ),
  ).toBeTruthy();
  expect(call.mock.calls.some((c) => c[0] === "publications.list")).toBe(false);
});

it("opens the latest observed event from a current relation and keeps coverage gaps explicit", async () => {
  const relation = {
    id: "r",
    from: id(1),
    to: id(2),
    kind: "associative",
    weight: 0.8,
    sourceIds: [],
  };
  const event = {
    id: "current-change",
    publicationId: "2",
    time: "2026-10-04T12:00:00Z",
    version: 2,
    kind: "relation_strengthened",
    title: "Historical Alpha → Beta",
    detail: "Poids publié : 0.5 → 0.8.",
    nodeIds: [id(1), id(2)],
    groupIds: [],
    sourceIds: [],
    relation,
  };
  readHistory.mockResolvedValue({
    version: { published_version: 2 },
    observedPublications: 2,
    projection: {
      events: [
        { ...event, id: "older", version: 1, kind: "relation_created" },
        event,
        { ...event, id: "offscreen", relation: { ...relation, to: id(3) } },
      ],
      coverage: { partial: true, detail: "Partielle" },
    },
  });
  setup(undefined, "/?map_changes=1", true, {
    ...scene,
    glyphs: [
      ...scene.glyphs,
      {
        ...scene.glyphs[0],
        id: id(2),
        concept_id: id(2),
        title: "Beta actuelle",
      },
    ],
    links: [
      {
        from: 0,
        to: 1,
        kind: "associative",
        weight: 0.9,
        count: 1,
        aggregate: false,
      },
    ],
  });
  fireEvent.click(
    await screen.findByText("Relations repérées dans la scène (1)"),
  );
  expect(
    screen.getByText(/Relations de l’historique non détaillées ici : 1/),
  ).toBeTruthy();
  expect(screen.getByText(/absence de signal ne signifie pas/)).toBeTruthy();
  const row = screen.getByRole("button", {
    name: /Alpha → Beta actuelle.*ouvrir le dernier, v2/,
  });
  row.focus();
  fireEvent.click(row);
  await screen.findByRole("region", { name: "Détail de l’événement" });
  expect(screen.getByLabelText("URL courante").textContent).toContain(
    "map_event=current-change",
  );
  fireEvent.keyDown(
    screen.getByRole("region", { name: "Détail de l’événement" }),
    { key: "Escape" },
  );
  expect(document.activeElement).toBe(row);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Repérer les changements" }),
  );
  expect(screen.queryByText("Relations repérées dans la scène (1)")).toBeNull();
  expect(screen.getByTestId("scene").getAttribute("data-changes")).toBe("0");
});
it("masks the previous scene and list when access is refused on refresh", async () => {
  const s = setup();
  await screen.findByRole("button", { name: /Alpha Group/ });
  s.refuse();
  fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await screen.findByRole("alert");
  expect(screen.queryByTestId("scene")).toBeNull();
  expect(screen.queryByRole("button", { name: /Alpha Group/ })).toBeNull();
});
it("an empty server search keeps full stock counts visible", async () => {
  setup();
  await screen.findByRole("button", { name: /Alpha Group/ });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Rechercher un concept" }),
    { target: { value: "absent" } },
  );
  await screen.findByText("Aucun concept ne correspond à cette recherche.");
  await waitFor(() =>
    expect(
      screen.getByText(/10\s*000/, { selector: ".spatial-summary strong" }),
    ).toBeTruthy(),
  );
});
it("keeps the same reading region while a fenced link page is loading", async () => {
  let release!: () => void;
  setup({
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  fireEvent.click(await screen.findByRole("button", { name: /Alpha Group/ }));
  const reading = await screen.findByRole("region", {
    name: "Contenu publié du concept",
  });
  reading.scrollTop = 123;
  fireEvent.click(screen.getByRole("button", { name: "Liens suivants" }));
  await screen.findByText("Lecture des liens…");
  expect(
    screen.getByRole("region", { name: "Contenu publié du concept" }),
  ).toBe(reading);
  expect(reading.scrollTop).toBe(123);
  expect(
    (
      screen.getByRole("button", {
        name: "Liens suivants",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByText("1/2")).toBeTruthy();
  release();
  await screen.findByText("2/2");
  expect(
    screen.getByRole("region", { name: "Contenu publié du concept" }),
  ).toBe(reading);
  expect(screen.queryByText("Lecture des liens…")).toBeNull();
  expect(screen.getByRole("button", { name: /→ Beta 16/ })).toBeTruthy();
});

it("navigates eight-result search pages without skipping matches and resets offset on clearing search", async () => {
  const { call } = setup();
  await screen.findByRole("button", { name: /Alpha Group/ });
  const search = screen.getByRole("textbox", { name: "Rechercher un concept" });
  fireEvent.change(search, { target: { value: "Alpha" } });
  await screen.findByRole("button", { name: /Alpha 7 Group/ });
  fireEvent.click(screen.getByRole("button", { name: "Suivants" }));
  await screen.findByRole("button", { name: /Alpha 8 Group/ });
  await screen.findByRole("button", { name: /Alpha 15 Group/ });
  fireEvent.click(screen.getByRole("button", { name: "Suivants" }));
  await screen.findByRole("button", { name: /Alpha 18 Group/ });
  expect(
    (
      screen.getByRole("button", {
        name: "Suivants",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Précédents" }));
  await screen.findByRole("button", { name: /Alpha 8 Group/ });
  fireEvent.change(search, { target: { value: "" } });
  await screen.findByRole("button", { name: /Alpha Group/ });
  const reads = call.mock.calls.filter(
    (c) => c[0] === "graph.map_nodes" && c[3]?.query?.search === "Alpha",
  );
  expect(reads.map((c) => c[3]?.query?.offset)).toEqual([0, 8, 16, 8]);
});

it("shares the exact URL interval with journal reads and removes stale map signals while changing period", async () => {
  const event = (time: string, n: number) => ({
    id: String(n),
    publicationId: String(n),
    nodeIds: [id(n)],
    time,
    kind: "concept_created",
    title: `Création ${n}`,
    version: 2,
  });
  const result = {
    version: { published_version: 2 },
    observedPublications: 3,
    projection: {
      events: [
        event("2026-10-04T01:00:00.000Z", 1),
        event("2026-10-04T02:59:59.999999+00:00", 2),
        event("2026-10-04T03:00:00.000Z", 3),
      ],
      coverage: { partial: true, detail: "Couverture synthétique partielle" },
    },
  };
  readHistory.mockResolvedValue(result);
  setup(
    undefined,
    "/?time_from=2026-10-04T01%3A00%3A00.000Z&time_to=2026-10-04T03%3A00%3A00.000Z&map_changes=1",
    true,
  );
  await waitFor(() =>
    expect(screen.getByTestId("scene").getAttribute("data-changes")).toBe("2"),
  );
  expect(readHistory.mock.calls[0][4]).toMatchObject({
    since: "2026-10-04T01:00:00.000Z",
    until: "2026-10-04T03:00:00.000Z",
    atVersion: 2,
    maxPages: 5,
  });
  fireEvent.click(screen.getByRole("button", { name: "Chronique" }));
  await screen.findByText(/2 événements dans 2 publications/);
  expect(screen.getByText(/total de la période est inconnu/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Création 3/ })).toBeNull();
  let release!: (value: unknown) => void;
  readHistory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "7 jours" }));
  await waitFor(() =>
    expect(screen.getByTestId("scene").getAttribute("data-changes")).toBe("0"),
  );
  expect(screen.queryByRole("button", { name: /Création 1/ })).toBeNull();
  release({
    ...result,
    observedPublications: 0,
    projection: {
      ...result.projection,
      events: [],
      coverage: { partial: false, detail: "Vide" },
    },
  });
  await screen.findByText(/Aucun événement chargé/);
  expect(
    screen.getByText(/10\s*000/, { selector: ".spatial-summary strong" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retour navigateur" }));
  await waitFor(() =>
    expect(readHistory.mock.calls.at(-1)?.[4]).toMatchObject({
      since: "2026-10-04T01:00:00.000Z",
      until: "2026-10-04T03:00:00.000Z",
    }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("scene").getAttribute("data-changes")).toBe("2"),
  );
});

it("opens a historical relation without reading bodies, restores it with browser Back, and clears it on period changes", async () => {
  const event = {
    id: "pair-event",
    publicationId: "pub1",
    time: "2026-10-04T12:00:00Z",
    version: 1,
    kind: "relation_created",
    title: "Alpha → Beta",
    detail: "Création publiée",
    nodeIds: [id(1), id(2)],
    sourceIds: [],
    groupIds: [],
    relation: {
      id: "relation",
      from: id(1),
      to: id(2),
      kind: "associative",
      weight: 0.5,
      sourceIds: [],
    },
  };
  readHistory.mockResolvedValue({
    version: { published_version: 2 },
    observedPublications: 1,
    projection: {
      events: [event],
      coverage: { partial: false, detail: "Complète" },
    },
  });
  const s = setup(undefined, "/", true);
  fireEvent.click(await screen.findByRole("button", { name: "Chronique" }));
  const row = await screen.findByRole("button", { name: /Alpha → Beta/ });
  row.focus();
  fireEvent.click(row);
  await screen.findByText("Relation actuelle associative · poids 0.9.");
  expect(screen.getByLabelText("URL courante").textContent).toContain(
    "map_event=pair-event",
  );
  expect(s.call.mock.calls.some((c) => c[0] === "concepts.read")).toBe(false);
  const initialSequence = Number(
    screen.getByTestId("scene").getAttribute("data-focus"),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Disposition de la carte" }),
    { target: { value: "circle" } },
  );
  await waitFor(() =>
    expect(
      Number(screen.getByTestId("scene").getAttribute("data-focus")),
    ).toBeGreaterThan(initialSequence),
  );

  await waitFor(() =>
    expect(
      s.call.mock.calls.some(
        (c) => c[0] === "graph.scene" && c[3]?.query?.target === id(2),
      ),
    ).toBe(true),
  );
  fireEvent.keyDown(
    screen.getByRole("region", { name: "Détail de l’événement" }),
    { key: "Escape" },
  );
  expect(
    screen.queryByRole("region", { name: "Détail de l’événement" }),
  ).toBeNull();
  expect(document.activeElement).toBe(row);
  fireEvent.click(screen.getByRole("button", { name: "Retour navigateur" }));
  await screen.findByRole("region", { name: "Détail de l’événement" });
  fireEvent.click(screen.getByRole("button", { name: "7 jours" }));
  expect(screen.getByLabelText("URL courante").textContent).not.toContain(
    "map_event",
  );
});
it("restores the event URL on a fresh visit, and does not invent an event outside loaded coverage", async () => {
  readHistory.mockResolvedValue({
    version: { published_version: 2 },
    observedPublications: 0,
    projection: {
      events: [],
      coverage: { partial: true, detail: "Partielle" },
    },
  });
  setup(undefined, "/?map_event=outside", true);
  await screen.findByText(
    "Cet événement n’est pas disponible dans la période ou la couverture chargée.",
  );
  expect(readHistory).toHaveBeenCalled();
  expect(
    screen.queryByRole("region", { name: "Détail de l’événement" }),
  ).toBeNull();
});

it("an event deep link does not eagerly fetch the body or full neighborhood of an old map selection", async () => {
  const event = {
    id: "pair-event",
    publicationId: "pub1",
    time: "2026-10-04T12:00:00Z",
    version: 1,
    kind: "relation_created",
    title: "Alpha → Beta",
    detail: "Création publiée",
    nodeIds: [id(1), id(2)],
    sourceIds: [],
    groupIds: [],
    relation: {
      id: "relation",
      from: id(1),
      to: id(2),
      kind: "associative",
      weight: 0.5,
      sourceIds: [],
    },
  };
  readHistory.mockResolvedValue({
    version: { published_version: 2 },
    observedPublications: 1,
    projection: {
      events: [event],
      coverage: { partial: false, detail: "Complète" },
    },
  });
  const s = setup(undefined, `/?map_event=pair-event&map_node=${id(1)}`, true);
  await screen.findByText("Relation actuelle associative · poids 0.9.");
  expect(s.call.mock.calls.some((c) => c[0] === "concepts.read")).toBe(false);
  expect(
    s.call.mock.calls
      .filter((c) => c[0] === "graph.map_nodes")
      .map((c) => c[3]?.query?.target),
  ).toEqual([id(2), id(1)]);
});
