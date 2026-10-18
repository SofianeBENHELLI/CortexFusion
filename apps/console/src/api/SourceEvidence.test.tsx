import React, { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SourceEvidence,
  type SourceEvidenceActions,
  validatePassage,
} from "./SourceEvidence";
import { chatIntent } from "./workspaceCommands";
import { ApiError, type CortexApi } from "./client";
afterEach(cleanup);
it("reads a Unicode source range, focuses it and returns to its trigger on Escape", async () => {
  const call = vi.fn().mockResolvedValue({
    source_id: "source",
    start: 1,
    end: 3,
    total_characters: 4,
    next_offset: 3,
    offset_unit: "unicode_code_point",
    excerpt: "🧠é",
    title: "Source",
    location: "synthetic://test",
    content_hash: "a".repeat(64),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceEvidence
        api={{ call } as unknown as CortexApi}
        domain="domain"
        source={{ source_id: "source", start: 1, end: 3 }}
      />
    </QueryClientProvider>,
  );
  const button = screen.getByRole("button", { name: "Lire la preuve" });
  fireEvent.click(button);
  const reading = await screen.findByRole("region", {
    name: "Texte de la preuve",
  });
  expect(reading.textContent).toBe("🧠é");
  await waitFor(() => expect(document.activeElement).toBe(reading));
  fireEvent.keyDown(reading, { key: "Escape" });
  expect(
    screen.queryByRole("region", { name: "Texte de la preuve" }),
  ).toBeNull();
  expect(document.activeElement).toBe(button);
  call.mockRejectedValueOnce(new ApiError(403, "forbidden"));
  fireEvent.click(button);
  expect(screen.queryByText("🧠é")).toBeNull();
  await screen.findByRole("alert");
  expect(screen.queryByText("🧠é")).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
});

function longSource() {
  const content = "A".repeat(8192) + "🧠é" + "B".repeat(8192) + "FIN";
  const hash = "a".repeat(64);
  const state = {
    denied: false,
    wrongHash: false,
    delay: undefined as Promise<void> | undefined,
  };
  const call = vi.fn(async (op: string, _p: any, _b: any, options: any) => {
    if (op !== "sources.passage") throw Error("Unbounded source request");
    if (state.delay) await state.delay;
    if (state.denied) throw new ApiError(404, "missing");
    const points = Array.from(content),
      start = options.query.offset,
      end = Math.min(start + options.query.limit, points.length);
    return {
      source_id: "source",
      title: "Longue",
      location: "synthetic://long",
      content_hash: state.wrongHash ? "b".repeat(64) : hash,
      start,
      end,
      total_characters: points.length,
      excerpt: points.slice(start, end).join(""),
      next_offset: end < points.length ? end : null,
      offset_unit: "unicode_code_point",
    };
  });
  const ref = createRef<SourceEvidenceActions>(),
    onReadError = vi.fn();
  const api = { call } as unknown as CortexApi;
  const props = {
    api,
    domain: "domain",
    source: { source_id: "source", start: 8192, end: 8194, content_hash: hash },
    onReadError,
  };
  const view = render(<SourceEvidence ref={ref} {...props} />);
  const run = async (action: Parameters<SourceEvidenceActions["act"]>[0]) => {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(action);
    });
    return result;
  };
  return { content, hash, state, call, ref, onReadError, props, view, run };
}
it("reads the exact citation then all pages with one pinned fingerprint and no accumulated body", async () => {
  const s = longSource();
  await s.run("proof");
  expect(
    screen.getByRole("region", { name: "Texte de la preuve" }).textContent,
  ).toBe("🧠é");
  expect(s.call.mock.calls[0][3].query).toEqual({
    offset: 8192,
    limit: 2,
    expected_hash: s.hash,
  });
  await s.run("full");
  let assembled = screen.getByRole("region", {
    name: "Texte de la source",
  }).textContent!;
  await s.run("next");
  assembled += screen.getByRole("region", {
    name: "Texte de la source",
  }).textContent;
  expect(
    Array.from(
      screen.getByRole("region", { name: "Texte de la source" }).textContent!,
    ).length,
  ).toBe(8192);
  await s.run("next");
  assembled += screen.getByRole("region", {
    name: "Texte de la source",
  }).textContent;
  expect(assembled).toBe(s.content);
  expect(
    (
      screen.getByRole("button", {
        name: "Passage suivant",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await s.run("previous");
  expect(
    screen
      .getByRole("region", { name: "Texte de la source" })
      .textContent?.startsWith("🧠é"),
  ).toBe(true);
  await s.run("proof");
  expect(
    screen.getByRole("region", { name: "Texte de la preuve" }).textContent,
  ).toBe("🧠é");
  expect(
    s.call.mock.calls.every((c) => c[3].query.expected_hash === s.hash),
  ).toBe(true);
});
it.each(["denied", "wrongHash"] as const)(
  "masks the previous page on %s without falling back to full source",
  async (fault) => {
    const s = longSource();
    await s.run("full");
    s.state[fault] = true;
    await s.run("next");
    expect(
      screen.queryByRole("region", { name: "Texte de la source" }),
    ).toBeNull();
    expect(s.onReadError).toHaveBeenCalledOnce();
    expect(s.call.mock.calls.every((c) => c[0] === "sources.passage")).toBe(
      true,
    );
    s.state[fault] = false;
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Réessayer la preuve" }),
      );
    });
    expect(
      screen
        .getByRole("region", { name: "Texte de la source" })
        .textContent?.startsWith("🧠é"),
    ).toBe(true);
    expect(s.call.mock.calls.at(-1)?.[3].query).toEqual(
      s.call.mock.calls.at(-2)?.[3].query,
    );
  },
);
it("clears an in-flight page on close and never resurrects its text", async () => {
  const s = longSource();
  let release!: () => void;
  s.state.delay = new Promise((r) => {
    release = r;
  });
  let reading!: Promise<string>;
  await act(async () => {
    reading = s.ref.current!.act("full");
  });
  await s.run("close");
  await act(async () => {
    release();
    await reading;
  });
  expect(
    screen.queryByRole("region", { name: "Texte de la source" }),
  ).toBeNull();
  expect(s.onReadError).not.toHaveBeenCalled();
  s.state.delay = undefined;
  await s.run("proof");
  expect(screen.getByText("🧠é")).toBeTruthy();
});
it("rejects a range shortened by the server and unexplained totals or fields", () => {
  const source = { source_id: "source", start: 0, end: 10 };
  const base = {
    source_id: "source",
    title: "T",
    location: "L",
    content_hash: "a".repeat(64),
    start: 0,
    end: 10,
    total_characters: 10,
    excerpt: "0123456789",
    next_offset: null,
    offset_unit: "unicode_code_point",
  } as const;
  for (const bad of [
    { ...base, total_characters: 5, end: 5, excerpt: "01234" },
    { ...base, next_offset: 10 },
    { ...base, allowed_subjects: ["private"] },
    { ...base, excerpt: "012345678" },
  ])
    expect(() =>
      validatePassage(bad as any, source, {
        mode: "proof",
        offset: 0,
        limit: 10,
      }),
    ).toThrow();
});
it("routes only exact numbered reading commands, without corpus mutation", () => {
  expect(chatIntent("Lis la source : 1")).toEqual({
    kind: "source_read",
    index: 1,
    action: "full",
  });
  expect(chatIntent("Passage source précédent : 2")).toEqual({
    kind: "source_read",
    index: 2,
    action: "previous",
  });
  expect(chatIntent("Lis la source : 0")).toEqual({ kind: "unsupported" });
  expect(chatIntent("Lis la source : 1 : publie")).toEqual({
    kind: "unsupported",
  });
});

it("ignores a cached denial while closed and reports only the fresh explicit read", async () => {
  const client = new QueryClient();
  const key = [
    "api",
    "source-evidence",
    "domain",
    "source",
    undefined,
    undefined,
  ];
  await client
    .fetchQuery({
      queryKey: key,
      retry: false,
      gcTime: Infinity,
      queryFn: async () => {
        throw new ApiError(404, "missing");
      },
    })
    .catch(() => {});
  const onReadError = vi.fn();
  const call = vi.fn().mockResolvedValue({
    source_id: "source",
    start: 0,
    end: 15,
    total_characters: 15,
    next_offset: null,
    offset_unit: "unicode_code_point",
    excerpt: "Restored access",
    title: "Synthetic",
    location: "synthetic://restored",
    content_hash: "a".repeat(64),
  });
  render(
    <QueryClientProvider client={client}>
      <SourceEvidence
        api={{ call } as unknown as CortexApi}
        domain="domain"
        source={{ source_id: "source" }}
        onReadError={onReadError}
      />
    </QueryClientProvider>,
  );
  expect(onReadError).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Lire la source" }));
  expect(
    (await screen.findByRole("region", { name: "Texte de la source" }))
      .textContent,
  ).toBe("Restored access");
  expect(onReadError).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledOnce();
});
