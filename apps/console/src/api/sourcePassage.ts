import type { SourcePassage } from "../../../../packages/contracts/src/SourcePassage";
import { ApiError, type CortexApi } from "./client";
const PAGE = 8192;
type Source = { source_id: string; end?: number };
type Request = {
  offset: number;
  limit: number;
  hash?: string;
  total?: number;
  mode?: "proof" | "full";
};
export function validatePassage(
  v: SourcePassage,
  source: Source,
  request: Request,
) {
  const expected = [
    "source_id",
    "title",
    "location",
    "content_hash",
    "start",
    "end",
    "total_characters",
    "excerpt",
    "next_offset",
    "offset_unit",
  ]
    .sort()
    .join();
  if (
    !v ||
    Object.keys(v).sort().join() !== expected ||
    v.source_id !== source.source_id ||
    typeof v.title !== "string" ||
    Array.from(v.title).length > 200 ||
    typeof v.location !== "string" ||
    Array.from(v.location).length > 1000 ||
    !/^[a-f0-9]{64}$/.test(v.content_hash) ||
    (request.hash && v.content_hash !== request.hash) ||
    !Number.isSafeInteger(v.total_characters) ||
    v.total_characters < 0 ||
    v.total_characters > 2147483647 ||
    (request.total !== undefined && v.total_characters !== request.total) ||
    v.offset_unit !== "unicode_code_point" ||
    v.start !== request.offset ||
    v.start > v.total_characters ||
    v.end !== Math.min(request.offset + request.limit, v.total_characters) ||
    v.next_offset !== (v.end < v.total_characters ? v.end : null) ||
    typeof v.excerpt !== "string" ||
    Array.from(v.excerpt).length !== v.end - v.start ||
    v.end - v.start > PAGE ||
    (source.end !== undefined && source.end > v.total_characters)
  )
    throw new ApiError(200, "invalid_response");
  return v;
}

export async function readSourcePage(
  api: CortexApi,
  domain: string,
  id: string,
  signal: AbortSignal,
  offset = 0,
  hash?: string,
  limit = PAGE,
  total?: number,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 2147483646 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > PAGE
  )
    throw Error("Position de source invalide.");
  const request = { offset, limit, hash, total };
  return validatePassage(
    await api.call("sources.passage", { domain, source_id: id }, undefined, {
      signal,
      query: { offset, limit, ...(hash ? { expected_hash: hash } : {}) },
    }),
    { source_id: id },
    request,
  );
}
/** Verify only a caller-bounded excerpt, never reconstruct the whole source. */
export async function verifySourceExcerpt(
  api: CortexApi,
  domain: string,
  id: string,
  hash: string,
  start: number,
  excerpt: string,
  max: number,
  signal: AbortSignal,
) {
  const count = Array.from(excerpt).length;
  if (
    !excerpt.trim() ||
    excerpt.includes("\0") ||
    count > max ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start + count > 2147483647
  )
    throw Error("Passage ou position invalide ; aucun texte n’est tronqué.");
  let offset = start,
    verified = "",
    total: number | undefined,
    first: SourcePassage | undefined;
  while (offset < start + count) {
    const page = await readSourcePage(
      api,
      domain,
      id,
      signal,
      offset,
      hash,
      Math.min(PAGE, start + count - offset),
      total,
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    first ??= page;
    total = page.total_characters;
    if (page.end <= offset || page.end < Math.min(offset + PAGE, start + count))
      throw Error(
        "La source ne contient pas le passage complet à cette position.",
      );
    verified += page.excerpt;
    offset = page.end;
  }
  if (verified !== excerpt)
    throw Error(
      "Le passage doit reproduire exactement la source à la position indiquée, sans reformulation.",
    );
  return first!;
}

export async function locateSourceExcerpt(
  api: CortexApi,
  domain: string,
  id: string,
  excerpt: string,
  signal: AbortSignal,
  hash?: string,
  start?: number,
) {
  const count = Array.from(excerpt).length;
  if (
    !excerpt.trim() ||
    excerpt.includes("\0") ||
    count > 200000 ||
    (start !== undefined &&
      (!Number.isSafeInteger(start) || start < 0 || start > 2147483646))
  )
    throw Error("Passage ou position invalide ; aucun texte n’est tronqué.");
  const value = await api.call(
    "sources.locate",
    { domain, source_id: id },
    {
      excerpt,
      ...(hash ? { expected_hash: hash } : {}),
      ...(start !== undefined ? { start } : {}),
    },
    { signal },
  );
  const keys = [
    "source_id",
    "title",
    "location",
    "content_hash",
    "start",
    "end",
    "total_characters",
    "offset_unit",
  ]
    .sort()
    .join();
  if (
    !value ||
    Object.keys(value).sort().join() !== keys ||
    value.source_id !== id ||
    typeof value.title !== "string" ||
    Array.from(value.title).length > 200 ||
    typeof value.location !== "string" ||
    Array.from(value.location).length > 1000 ||
    !/^[0-9a-f]{64}$/.test(value.content_hash) ||
    (hash && hash !== value.content_hash) ||
    value.offset_unit !== "unicode_code_point" ||
    !Number.isSafeInteger(value.start) ||
    value.start < 0 ||
    (start !== undefined && value.start !== start) ||
    value.end !== value.start + count ||
    !Number.isSafeInteger(value.total_characters) ||
    value.total_characters > 2147483647 ||
    value.end > value.total_characters
  )
    throw new ApiError(200, "invalid_response");
  return value;
}
