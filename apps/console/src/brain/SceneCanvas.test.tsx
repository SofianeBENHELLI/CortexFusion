import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";
import { SceneCanvas, type SceneCameraMemory } from "./SceneCanvas";
import { scene, id } from "./scene.fixture";
import { indexSceneChanges } from "./scene-changes";
let resize: (
  entries: { contentRect: { width: number; height: number } }[],
) => void;
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(cb: typeof resize) {
      resize = cb;
    }
    observe() {
      resize([{ contentRect: { width: 1000, height: 600 } }]);
    }
    disconnect() {}
  },
);
afterEach(cleanup);
it("restores camera after an interrupted read without replaying old focus and still permits new focus or layout", () => {
  const memory = { current: null as SceneCameraMemory | null };
  const props = {
    data: scene,
    layout: "territories" as const,
    selected: id(1),
    loading: false,
    focus: { bounds: scene.bounds, sequence: 1 },
    cameraMemory: memory,
    onView: vi.fn(),
    onSelect: vi.fn(),
    onLink: vi.fn(),
  };
  const first = render(<SceneCanvas {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
  fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowRight" });
  const zoom = screen.getByRole("status", {
    name: "Niveau de zoom",
  }).textContent;
  const before = { ...memory.current!.camera };
  first.unmount();
  const second = render(
    <SceneCanvas {...props} data={{ ...scene, at_version: 3 }} />,
  );
  expect(memory.current!.camera).toEqual(before);
  expect(
    screen.getByRole("status", { name: "Niveau de zoom" }).textContent,
  ).toBe(zoom);
  second.rerender(
    <SceneCanvas {...props} focus={{ ...props.focus, sequence: 2 }} />,
  );
  expect(memory.current!.camera).not.toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
  second.rerender(
    <SceneCanvas
      {...props}
      layout="lines"
      focus={{ ...props.focus, sequence: 2 }}
    />,
  );
  expect(memory.current!.layout).toBe("lines");
  expect(memory.current!.camera).not.toEqual(before);
});

it("keeps an event framing through delayed sizing instead of fitting the whole graph", () => {
  const memory = { current: null as SceneCameraMemory | null };
  const focus = { bounds: { x: -20, y: -20, w: 120, h: 120 }, sequence: 7 };
  render(
    <SceneCanvas
      data={{ ...scene, bounds: { x: -5000, y: -5000, w: 10000, h: 10000 } }}
      layout="territories"
      selected={id(1)}
      focus={focus}
      loading={false}
      cameraMemory={memory}
      onView={vi.fn()}
      onSelect={vi.fn()}
      onLink={vi.fn()}
    />,
  );
  expect(memory.current!.camera.k).toBeGreaterThan(1);
  act(() => resize([{ contentRect: { width: 390, height: 460 } }]));
  expect(memory.current!.camera.k).toBeGreaterThan(1);
  expect(memory.current!.focusSequence).toBe(7);
});

it("accentuates only current exact links with observed history, and removes all accents when the period is unavailable", () => {
  const events = indexSceneChanges([
    {
      id: "strength",
      publicationId: "1",
      version: 1,
      time: "2026-10-04T12:00:00Z",
      kind: "relation_strengthened",
      title: "Alpha → Beta",
      detail: "0.2 → 0.8",
      nodeIds: [id(1), id(2)],
      groupIds: [],
      sourceIds: [],
      relation: {
        id: "r",
        from: id(1),
        to: id(2),
        kind: "associative",
        weight: 0.8,
        sourceIds: [],
      },
    },
  ]);
  const props = {
    data: {
      ...scene,
      glyphs: [
        scene.glyphs[0],
        { ...scene.glyphs[0], id: id(2), concept_id: id(2), title: "Beta" },
      ],
      links: [
        {
          from: 0,
          to: 1,
          kind: "associative" as const,
          count: 1,
          aggregate: false,
          weight: 0.8,
        },
        {
          from: 1,
          to: 0,
          kind: "associative" as const,
          count: 1,
          aggregate: false,
          weight: 0.8,
        },
        {
          from: 0,
          to: 1,
          kind: "reference" as const,
          count: 1,
          aggregate: false,
          weight: null,
        },
        {
          from: 0,
          to: 1,
          kind: "associative" as const,
          count: 9,
          aggregate: true,
          weight: null,
        },
      ],
    },
    layout: "territories" as const,
    selected: null,
    focus: null,
    loading: false,
    cameraMemory: { current: null },
    onView: vi.fn(),
    onSelect: vi.fn(),
    onLink: vi.fn(),
  };
  const view = render(
    <SceneCanvas
      {...props}
      changes={events.nodes}
      relationChanges={events.relations}
    />,
  );
  expect(view.container.querySelectorAll(".scene-changed-link")).toHaveLength(
    1,
  );
  expect(view.container.querySelectorAll(".scene-change-ring")).toHaveLength(2);
  const link = screen.getByRole("button", {
    name: /Lien de Alpha vers Beta · Historique : Relation renforcée/,
  });
  fireEvent.click(link);
  expect(props.onLink).toHaveBeenCalledWith(id(1), id(2), "associative", 0.8);
  view.rerender(
    <SceneCanvas {...props} changes={new Map()} relationChanges={new Map()} />,
  );
  expect(
    view.container.querySelectorAll(".scene-changed-link, .scene-change-ring"),
  ).toHaveLength(0);
});
