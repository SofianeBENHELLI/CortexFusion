import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { measureBrainRead, useBrainReadPaint } from "./read-measurement";

let callbacks: Map<number, FrameRequestCallback>;
let next: number;
beforeEach(() => {
  callbacks = new Map();
  next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function frame() {
  act(() => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(performance.now()));
  });
}
function outputs(log: ReturnType<typeof vi.spyOn>) {
  return log.mock.calls.map(([message]) =>
    JSON.parse(String(message).replace("[BrainMap measure] ", "")),
  );
}
it("does not change data or log anything in normal builds", async () => {
  vi.stubEnv("VITE_BRAIN_MEASURE", "");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const value = { body: "private source" };
  const result = await measureBrainRead("workspace", async () => value);
  renderHook(() => useBrainReadPaint(result, true));
  expect(result).toBe(value);
  expect(Object.keys(result)).toEqual(["body"]);
  expect(callbacks.size).toBe(0);
  expect(log).not.toHaveBeenCalled();
});
it("measures a committed structurally shared result through two frames without logging content", async () => {
  vi.stubEnv("VITE_BRAIN_MEASURE", "1");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const result = await measureBrainRead("workspace", async () => ({
    body: "SECRET",
    title: "PRIVATE",
  }));
  const copy = { ...result };
  const hook = renderHook(({ ready }) => useBrainReadPaint(copy, ready), {
    initialProps: { ready: false },
  });
  expect(callbacks.size).toBe(0);
  hook.rerender({ ready: true });
  frame();
  expect(outputs(log).filter((e) => e.phase === "frame")).toHaveLength(0);
  frame();
  const event = outputs(log).find((e) => e.phase === "frame");
  expect(event).toMatchObject({
    kind: "workspace",
    visibility: document.visibilityState,
  });
  expect(event.total_ms).toBeGreaterThanOrEqual(event.read_ms);
  expect(
    Math.abs(event.total_ms - event.read_ms - event.after_read_ms),
  ).toBeLessThanOrEqual(0.002);
  hook.rerender({ ready: false });
  hook.rerender({ ready: true });
  frame();
  frame();
  expect(outputs(log).filter((e) => e.phase === "frame")).toHaveLength(1);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /SECRET|PRIVATE|body|title/,
  );
});
it("does not claim a rendering frame after the observed view unmounts", async () => {
  vi.stubEnv("VITE_BRAIN_MEASURE", "1");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const result = await measureBrainRead("search", async () => []);
  const hook = renderHook(() => useBrainReadPaint(result, true));
  frame();
  hook.unmount();
  frame();
  expect(outputs(log).filter((e) => e.phase === "frame")).toHaveLength(0);
  expect(callbacks.size).toBe(0);
});
it.each(["Error", "AbortError"])(
  "preserves %s and reports failure without its message",
  async (name) => {
    vi.stubEnv("VITE_BRAIN_MEASURE", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = new Error("PRIVATE TOKEN");
    error.name = name;
    await expect(
      measureBrainRead("search", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(outputs(log).at(-1)).toMatchObject({
      phase: "failed",
      cancelled: name === "AbortError",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE TOKEN");
  },
);
