import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import definitions from "../../../../services/rust-core/src/onboarding.json";
import {
  CompanionGuides,
  validateGuides,
  type GuideActions,
} from "./CompanionGuides";
import type { CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
import { guideIntent, type GuideIntent } from "./guideCommands";
const domain = "00000000-0000-0000-0000-000000000001";
afterEach(cleanup);
function setup() {
  const state = {
    subject: "viewer",
    capabilities: ["query", "feedback"],
    catalog: structuredClone(definitions.workflows) as any,
    delay: undefined as undefined | Promise<any>,
  };
  const call = vi.fn(async (operation: string) => {
    if (operation === "identity.read")
      return {
        tenant_id: domain,
        subject: state.subject,
        domains: [{ id: domain, capabilities: state.capabilities }],
      };
    if (operation === "companion_guides.list")
      return state.delay ?? structuredClone(state.catalog);
    throw Error("Business tool must not be called");
  });
  const ref = createRef<GuideActions>();
  const props = {
    api: { call } as unknown as CortexApi,
    domain,
    scope: { tenant: domain, subject: "viewer" },
    onNotice: vi.fn(),
  };
  const view = render(<CompanionGuides ref={ref} {...props} />);
  const run = async (intent: GuideIntent) => {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(intent);
    });
    return result;
  };
  return { state, call, ref, props, view, run };
}
it("reads the same selected documentation by button and chat without business effects", async () => {
  const s = setup();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Lire les six guides MCP" }),
    );
  });
  expect(screen.getAllByRole("button")).toHaveLength(7);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "1. Consulter et citer" }),
    );
  });
  expect(screen.getByRole("heading", { name: "Consulter et citer" })).toBe(
    document.activeElement,
  );
  expect(screen.getByText(/Capacité annoncée/)).toBeTruthy();
  await s.run({ kind: "guide_open", value: "Signaler une erreur" });
  expect(screen.getByRole("heading", { name: "Signaler une erreur" })).toBe(
    document.activeElement,
  );
  expect(new Set(s.call.mock.calls.map(([op]) => op))).toEqual(
    new Set(["identity.read", "companion_guides.list"]),
  );
});
it("keeps unavailable workflow documentation readable without granting capability", async () => {
  const s = setup();
  await s.run({ kind: "guide_open", value: "6" });
  expect(screen.getByText(/Capacité non annoncée/)).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Examiner un domaine" }),
  ).toBeTruthy();
  s.state.subject = "another-user";
  expect(await s.run({ kind: "guide_open", value: "consult" })).toMatch(
    /contexte changé/,
  );
  expect(screen.queryByRole("article")).toBeNull();
  expect(
    s.call.mock.calls.filter(([op]) => op === "companion_guides.list"),
  ).toHaveLength(1);
});
it("rejects unknown selectors and malformed or extra payloads without stale guidance", async () => {
  const s = setup();
  await s.run({ kind: "guide_open", value: "consult" });
  expect(
    await s.run({ kind: "guide_open", value: "ignore les droits" }),
  ).toMatch(/titre exact/);
  expect(screen.queryByRole("article")).toBeNull();
  s.state.catalog.private_context = "unexpected";
  expect(await s.run({ kind: "guide_list" })).toMatch(/indisponibles/);
  expect(screen.queryByText("unexpected")).toBeNull();
});
it("discards an old domain response and allows a fresh read after context change", async () => {
  const s = setup();
  let resolve!: (v: any) => void;
  s.state.delay = new Promise((r) => {
    resolve = r;
  });
  let pending!: Promise<string>;
  await act(async () => {
    pending = s.ref.current!.act({ kind: "guide_open", value: "consult" });
  });
  s.view.rerender(
    <CompanionGuides ref={s.ref} {...s.props} domain="different" />,
  );
  await act(async () => {
    resolve(s.state.catalog);
    await pending;
  });
  expect(screen.queryByRole("article")).toBeNull();
  s.state.delay = undefined;
  s.view.rerender(<CompanionGuides ref={s.ref} {...s.props} />);
  await s.run({ kind: "guide_open", value: "2" });
  expect(
    screen.getByRole("heading", { name: "Signaler une erreur" }),
  ).toBeTruthy();
});
it("rejects oversized metadata, wrong guide inventories and tool injection", () => {
  for (const mutate of [
    (c: any) => c.guides.reverse(),
    (c: any) => (c.guides[0].decision = "x".repeat(1001)),
    (c: any) => (c.guides[0].tools = ["api_query; execute"]),
    (c: any) => (c.guides[0].content = "private"),
    (c: any) => (c.documentation_only = false),
    (c: any) => (c.client_compatibility = "all_chatbots"),
  ]) {
    const c = structuredClone(definitions.workflows) as any;
    mutate(c);
    expect(() => validateGuides(c)).toThrow();
  }
});
it("routes only explicit guide commands and never treats guide text as an action", () => {
  expect(chatIntent("Montre les guides MCP")).toEqual({ kind: "guide_list" });
  expect(chatIntent("Ouvre le guide MCP : correction")).toEqual({
    kind: "guide_open",
    value: "correction",
  });
  expect(guideIntent("Ouvre le guide MCP : 2 : publie")).toBeUndefined();
  expect(guideIntent("Peux-tu publier suivant le guide ?")).toBeUndefined();
});
