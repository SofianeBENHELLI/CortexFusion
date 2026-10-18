import React, { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
import {
  SourcePicker,
  type SourcePickerHandle,
  validateSourcePage,
} from "./SourcePicker";
const domain = "00000000-0000-0000-0000-000000000001",
  id = "00000000-0000-0000-0000-000000000002",
  other = "00000000-0000-0000-0000-000000000003";
const source = {
  id,
  title: "Règle de recette",
  location: "synthetic://proof",
  content_hash: "a".repeat(64),
  allowed_subjects: ["reader"],
  supersedes: null,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const api = new CortexApi(() => null),
    call = vi
      .spyOn(api, "call")
      .mockResolvedValue({ items: [source], next_after: null } as never),
    ref = createRef<SourcePickerHandle>(),
    onChoose = vi.fn(async () => "Source choisie"),
    onNotice = vi.fn();
  const view = render(
    <SourcePicker
      ref={ref}
      api={api}
      domain={domain}
      disabled={false}
      onChoose={onChoose}
      onNotice={onNotice}
    />,
  );
  return { api, call, ref, onChoose, onNotice, view };
}
it("does not query until requested, searches the server and selects a displayed numbered source", async () => {
  const { call, ref, onChoose } = setup();
  expect(call).not.toHaveBeenCalled();
  await act(async () => {
    await ref.current!.search("Règle");
  });
  expect(call.mock.calls[0][3]?.query).toEqual({ q: "Règle", limit: 20 });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Choisir la source 1 · Règle de recette",
    }),
  );
  expect(onChoose).toHaveBeenCalledWith(id);
  expect(call.mock.calls.every(([op]) => op === "sources.list")).toBe(true);
});
it("replaces pages and never resolves a title or index outside the displayed page", async () => {
  const { call, ref, onChoose } = setup();
  call
    .mockResolvedValueOnce({ items: [source], next_after: id } as never)
    .mockResolvedValueOnce({
      items: [{ ...source, id: other, title: "Autre" }],
      next_after: null,
    } as never);
  await act(async () => {
    await ref.current!.search("");
    await ref.current!.select("2");
  });
  expect(onChoose).not.toHaveBeenCalled();
  await act(async () => {
    await ref.current!.next();
  });
  expect(call.mock.calls[1][3]?.query).toEqual({ q: "", limit: 20, after: id });
  expect(
    screen.queryByText("Choisir la source 1 · Règle de recette"),
  ).toBeNull();
  await act(async () => {
    await ref.current!.select("1");
  });
  expect(onChoose).toHaveBeenCalledWith(other);
});
it("masks prior metadata after a failed refreshed search", async () => {
  const { call, ref } = setup();
  await act(async () => {
    await ref.current!.search("");
  });
  call.mockRejectedValueOnce(new ApiError(403, "denied"));
  await act(async () => {
    await ref.current!.search("");
  });
  expect(
    screen.queryByRole("button", { name: /Choisir la source 1/ }),
  ).toBeNull();
  expect(screen.getByText(/anciens résultats sont masqués/)).toBeDefined();
});
it("rejects invalid budgets, duplicate rows and inconsistent next references", () => {
  expect(() =>
    validateSourcePage({ items: [source, source], next_after: null }),
  ).toThrow();
  expect(() =>
    validateSourcePage({ items: [source], next_after: other }),
  ).toThrow();
});
it("ignores a response after clear or unmount", async () => {
  const { call, ref, onNotice, view } = setup();
  let finish!: (v: never) => void;
  call.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<string>;
  act(() => {
    request = ref.current!.search("");
  });
  act(() => {
    ref.current!.clear();
  });
  await act(async () => {
    finish({ items: [source], next_after: null } as never);
    await request;
  });
  expect(onNotice).not.toHaveBeenCalled();
  expect(screen.queryByRole("list")).toBeNull();
  view.unmount();
});
