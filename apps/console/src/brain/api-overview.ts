import type {
  IdentityView,
  AccessibleDomain,
} from "../../../../packages/contracts/src/IdentityView";
import { validateIdentity } from "../api/identity";
import { ApiError, CortexApi } from "../api/client";
import { readGraphWindow } from "./api-graph";

export const DOMAIN_PAGE_SIZE = 6;
export type DomainStock = {
  version: number;
  concepts: number;
  relations: number;
  observedAt: string;
};
export type DomainOverview = { domain: AccessibleDomain } & (
  | { stock: DomainStock; error?: never }
  | { stock?: never; error: string }
);
export interface OverviewPage {
  identity: IdentityView;
  page: number;
  pages: number;
  rows: DomainOverview[];
  totals: { concepts: number; relations: number } | null;
}
const fingerprint = (identity: IdentityView) =>
  JSON.stringify([
    identity.tenant_id,
    identity.subject,
    [...identity.domains]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => [d.id, d.name, d.role, [...d.capabilities].sort()]),
  ]);

/** A bounded page of independent domain observations, never a global snapshot. */
export async function readOverviewPage(
  api: CortexApi,
  requestedPage: number,
  signal?: AbortSignal,
): Promise<OverviewPage> {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0)
    throw new ApiError(422, "invalid_page");
  signal?.throwIfAborted();
  const identity = validateIdentity(
    await api.call("identity.read", {}, undefined, { signal }),
  );
  const domains = [...identity.domains].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const pages = Math.max(1, Math.ceil(domains.length / DOMAIN_PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  const selected = domains.slice(
    page * DOMAIN_PAGE_SIZE,
    (page + 1) * DOMAIN_PAGE_SIZE,
  );
  const rows = new Array<DomainOverview>(selected.length);
  let next = 0;
  const stop = new AbortController();
  const abort = () => stop.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const readDomain = async (
    domain: AccessibleDomain,
  ): Promise<DomainOverview> => {
    const opts = { signal: stop.signal };
    try {
      const version = await api.call(
        "domain.version",
        { domain: domain.id },
        undefined,
        opts,
      );
      if (
        !version ||
        version.domain_id !== domain.id ||
        !Number.isSafeInteger(version.published_version) ||
        !Number.isSafeInteger(version.accepted_version) ||
        version.published_version < 0 ||
        version.accepted_version < version.published_version
      )
        throw new ApiError(200, "invalid_response");
      const graph = await readGraphWindow(
        api,
        domain.id,
        version.published_version,
        {},
        stop.signal,
        1,
      );
      // Re-read current authorization and fence the version before exposing stocks.
      await readGraphWindow(
        api,
        domain.id,
        version.published_version,
        { visibility: graph.visibility },
        stop.signal,
        1,
      );
      return {
        domain,
        stock: {
          version: graph.at_version,
          ...graph.domain_totals,
          observedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      stop.signal.throwIfAborted();
      if (error instanceof ApiError && error.status === 401) {
        stop.abort(error);
        throw error;
      }
      return {
        domain,
        error: error instanceof Error ? error.message : "Lecture indisponible.",
      };
    }
  };
  try {
    // At most two domain reads in flight; never fan out over the entire directory.
    await Promise.all(
      Array.from({ length: Math.min(2, selected.length) }, async () => {
        while (next < selected.length) {
          stop.signal.throwIfAborted();
          const index = next++;
          rows[index] = await readDomain(selected[index]);
        }
      }),
    );
    stop.signal.throwIfAborted();
    const current = validateIdentity(
      await api.call("identity.read", {}, undefined, { signal: stop.signal }),
    );
    if (fingerprint(current) !== fingerprint(identity))
      throw new ApiError(409, "identity_changed");
    const totals = rows.every((r) => r.stock)
      ? rows.reduce(
          (sum, r) => ({
            concepts: sum.concepts + r.stock!.concepts,
            relations: sum.relations + r.stock!.relations,
          }),
          { concepts: 0, relations: 0 },
        )
      : null;
    if (
      totals &&
      (!Number.isSafeInteger(totals.concepts) ||
        !Number.isSafeInteger(totals.relations))
    )
      throw new ApiError(200, "invalid_response");
    return { identity: current, page, pages, rows, totals };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
