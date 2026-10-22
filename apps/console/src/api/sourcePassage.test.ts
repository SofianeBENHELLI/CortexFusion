import { describe, expect, it, vi } from "vitest";
import type { CortexApi } from "./client";
import {
  locateSourceExcerpt,
  validatePassage,
  verifySourceExcerpt,
} from "./sourcePassage";

const SOURCE = "00000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
// Code points, not UTF-16 units: the emoji counts as one character.
const TEXT = "Escalade 🧠 vers l’équipe d’astreinte. ".repeat(400);
const chars = Array.from(TEXT);

function passage(offset: number, limit: number) {
  const end = Math.min(offset + limit, chars.length);
  return {
    source_id: SOURCE,
    title: "Procédure",
    location: "synthetic://procedure",
    content_hash: HASH,
    start: offset,
    end,
    total_characters: chars.length,
    excerpt: chars.slice(offset, end).join(""),
    next_offset: end < chars.length ? end : null,
    offset_unit: "unicode_code_point",
  };
}

function engine() {
  const call = vi.fn(
    async (
      _op: string,
      _path: unknown,
      _body: unknown,
      options: { query: { offset: number; limit: number } },
    ) => passage(options.query.offset, options.query.limit),
  );
  return { api: { call } as unknown as CortexApi, call };
}

describe("validatePassage", () => {
  it("accepts an exact page and rejects any field that disagrees with the request", () => {
    const request = { offset: 10, limit: 20, hash: HASH };
    expect(
      validatePassage(passage(10, 20) as never, { source_id: SOURCE }, request),
    ).toBeTruthy();
    for (const change of [
      { start: 11 },
      { end: 31 },
      { content_hash: "b".repeat(64) },
      { offset_unit: "utf16" },
      { excerpt: "x" },
      { next_offset: null },
      { source_id: "00000000-0000-4000-8000-000000000002" },
      { extra: true },
    ])
      expect(() =>
        validatePassage(
          { ...passage(10, 20), ...change } as never,
          { source_id: SOURCE },
          request,
        ),
      ).toThrow();
  });
});

describe("verifySourceExcerpt", () => {
  it("verifies an excerpt spanning pages by code point without loading the whole source", async () => {
    const { api, call } = engine();
    const start = 8000;
    const excerpt = chars.slice(start, start + 500).join("");
    const first = await verifySourceExcerpt(
      api,
      "domain",
      SOURCE,
      HASH,
      start,
      excerpt,
      1000,
      new AbortController().signal,
    );
    expect(first.start).toBe(start);
    const pages = call.mock.calls.map((c) => c[3].query);
    expect(pages).toEqual([{ offset: 8000, limit: 500, expected_hash: HASH }]);
    const long = chars.slice(100, 100 + 9000).join("");
    await verifySourceExcerpt(
      api,
      "domain",
      SOURCE,
      HASH,
      100,
      long,
      10000,
      new AbortController().signal,
    );
    expect(call.mock.calls.slice(1).map((c) => c[3].query)).toEqual([
      { offset: 100, limit: 8192, expected_hash: HASH },
      { offset: 8292, limit: 808, expected_hash: HASH },
    ]);
  });

  it("refuses reworded, oversized, empty or out-of-range excerpts before or after reading", async () => {
    const { api, call } = engine();
    const signal = new AbortController().signal;
    const reworded = chars
      .slice(0, 40)
      .join("")
      .replace("Escalade", "Escalader");
    await expect(
      verifySourceExcerpt(api, "d", SOURCE, HASH, 0, reworded, 1000, signal),
    ).rejects.toThrow(/exactement/);
    for (const [start, excerpt, max] of [
      [0, "   ", 10],
      [0, "a\0b", 10],
      [0, "abcdef", 3],
      [-1, "abc", 10],
    ] as const)
      await expect(
        verifySourceExcerpt(
          api,
          "d",
          SOURCE,
          HASH,
          start,
          excerpt,
          max,
          signal,
        ),
      ).rejects.toThrow(/invalide/);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("locateSourceExcerpt", () => {
  it("accepts only a location whose span matches the excerpt length in code points", async () => {
    const excerpt = "Escalade 🧠";
    const located = {
      source_id: SOURCE,
      title: "Procédure",
      location: "synthetic://procedure",
      content_hash: HASH,
      start: 0,
      end: Array.from(excerpt).length,
      total_characters: chars.length,
      offset_unit: "unicode_code_point",
    };
    const ok = { call: vi.fn(async () => located) } as unknown as CortexApi;
    await expect(
      locateSourceExcerpt(
        ok,
        "d",
        SOURCE,
        excerpt,
        new AbortController().signal,
        HASH,
      ),
    ).resolves.toEqual(located);
    const utf16 = {
      call: vi.fn(async () => ({ ...located, end: excerpt.length })),
    } as unknown as CortexApi;
    await expect(
      locateSourceExcerpt(
        utf16,
        "d",
        SOURCE,
        excerpt,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
