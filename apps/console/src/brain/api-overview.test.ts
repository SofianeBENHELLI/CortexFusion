import { describe, it, expect, vi } from "vitest";
import { ApiError, CortexApi } from "../api/client";
import { readOverviewPage } from "./api-overview";
import { graphFixture } from "./api-graph.fixture";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export function overviewFixture(count = 8) {
  const identity = {
    tenant_id: id(99),
    subject: "alice",
    domains: Array.from({ length: count }, (_, i) => ({
      id: id(i + 1),
      name: `Domaine ${i + 1}`,
      role: i === 0 ? ("owner" as const) : ("viewer" as const),
      capabilities: [],
    })),
  };
  const call = vi.fn(
    async (
      op: string,
      path: Record<string, string>,
      _body: unknown,
      opts: { query?: Record<string, unknown> },
    ) => {
      if (op === "identity.read") return structuredClone(identity);
      const version = path.domain === id(1) ? 7 : 3;
      if (op === "domain.version")
        return {
          domain_id: path.domain,
          accepted_version: version + 1,
          published_version: version,
        };
      if (op === "graph.window") {
        const concepts: Concept[] = [
          {
            concept_id: id(50),
            title: "Shared identifier scoped by domain",
            body: "Proof",
            sources: [{ source_id: id(51), start: 0, end: 5 }],
            links: [],
          },
        ];
        return graphFixture(path.domain, concepts, opts.query, version);
      }
      throw new Error(`Unexpected ${op}`);
    },
  );
  return { identity, call, api: { call } as unknown as CortexApi };
}
describe("bounded authorized multi-domain stock page", () => {
  it("keeps independent versions, tuple-scoped stocks and a bounded page without journal or full graph reads", async () => {
    const { api, call } = overviewFixture();
    const result = await readOverviewPage(api, 0);
    expect(result.rows).toHaveLength(6);
    expect(result.totals).toEqual({ concepts: 6, relations: 0 });
    expect(result.rows[0].stock?.version).toBe(7);
    expect(result.rows[1].stock?.version).toBe(3);
    expect(new Set(call.mock.calls.map(([op]) => op))).toEqual(
      new Set(["identity.read", "domain.version", "graph.window"]),
    );
    const windows = call.mock.calls.filter(([op]) => op === "graph.window");
    expect(windows).toHaveLength(12);
    expect(
      windows.every(
        ([, path, , opts]) => opts.query?.limit === 1 && path.domain <= id(6),
      ),
    ).toBe(true);
    expect(
      windows.filter(([, , , opts]) => !!opts.query?.visibility),
    ).toHaveLength(6);
    call.mockClear();
    const second = await readOverviewPage(api, 1);
    expect(second.rows.map((r) => r.domain.id)).toEqual([id(7), id(8)]);
    expect(second.totals?.concepts).toBe(2);
    expect((await readOverviewPage(api, 999)).page).toBe(1);
  });
  it("never starts more than two simultaneous requests", async () => {
    const { api, call } = overviewFixture();
    const read = call.getMockImplementation()!;
    let active = 0,
      max = 0;
    call.mockImplementation(async (...args) => {
      active++;
      max = Math.max(max, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await read(...args);
      } finally {
        active--;
      }
    });
    await readOverviewPage(api, 0);
    expect(max).toBe(2);
  });
  it.each([403, 404, 409, 503])(
    "marks a failed domain %s unavailable and withholds totals",
    async (status) => {
      const { api, call } = overviewFixture(2),
        read = call.getMockImplementation()!;
      call.mockImplementation(async (...args) => {
        if (args[0] === "graph.window" && args[1].domain === id(1))
          throw new ApiError(status, "denied");
        return read(...args);
      });
      const result = await readOverviewPage(api, 0);
      expect(result.rows[0].stock).toBeUndefined();
      expect(result.rows[0].error).toBeTruthy();
      expect(result.rows[1].stock?.concepts).toBe(1);
      expect(result.totals).toBeNull();
    },
  );
  it("fails the whole observation when authentication expires", async () => {
    const { api, call } = overviewFixture(2),
      read = call.getMockImplementation()!;
    call.mockImplementation(async (...args) => {
      if (args[0] === "graph.window") throw new ApiError(401, "expired");
      return read(...args);
    });
    await expect(readOverviewPage(api, 0)).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each(["role", "membership", "subject", "tenant"])(
    "rejects a changed identity: %s",
    async (fault) => {
      const { api, call, identity } = overviewFixture(2),
        read = call.getMockImplementation()!;
      let identities = 0;
      call.mockImplementation(async (...args) => {
        if (args[0] === "identity.read" && ++identities === 2) {
          const changed = structuredClone(identity);
          if (fault === "role") changed.domains[0].role = "viewer";
          if (fault === "membership") changed.domains.pop();
          if (fault === "subject") changed.subject = "bob";
          if (fault === "tenant") changed.tenant_id = id(98);
          return changed;
        }
        return read(...args);
      });
      await expect(readOverviewPage(api, 0)).rejects.toMatchObject({
        status: 409,
      });
    },
  );
  it("rejects duplicate domain identities and honors cancellation before reading", async () => {
    const { api, identity, call } = overviewFixture(1);
    identity.domains.push(identity.domains[0]);
    await expect(readOverviewPage(api, 0)).rejects.toMatchObject({
      code: "invalid_response",
    });
    call.mockClear();
    const stop = new AbortController();
    stop.abort();
    await expect(readOverviewPage(api, 0, stop.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(call).not.toHaveBeenCalled();
  });
  it("reports an authorized empty directory without inventing a version", async () => {
    const { api } = overviewFixture(0);
    expect(await readOverviewPage(api, 0)).toMatchObject({
      rows: [],
      pages: 1,
      totals: { concepts: 0, relations: 0 },
    });
  });
});
