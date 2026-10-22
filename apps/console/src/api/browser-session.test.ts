import { expect, it, vi } from "vitest";
import { browserSessionRequest, loginLocation } from "./browser-session";

const id = "00000000-0000-0000-0000-000000000001";
const csrf = "s".repeat(43);
const payload = () => ({
  authenticated: true,
  csrf_token: csrf,
  expires_at: Date.now() / 1000 + 60,
  identity: { tenant_id: id, subject: "synthetic-reader", domains: [] },
});
it("restores only a bounded CSRF/deadline, with cookie credentials and no bearer or identity storage", async () => {
  const value = payload();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
  expect(
    await browserSessionRequest(
      undefined,
      new AbortController().signal,
      fetcher,
    ),
  ).toEqual({
    kind: "cookie",
    csrfToken: csrf,
    expiresAt: value.expires_at * 1000,
    identityStamp: JSON.stringify([id, "synthetic-reader", []]),
  });
  expect(fetcher.mock.calls[0]).toMatchObject([
    "/auth/session",
    {
      credentials: "same-origin",
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  ]);
  expect(Object.keys(fetcher.mock.calls[0][1]!.headers!)).toEqual(["Accept"]);
});
it.each([401, 204])(
  "confirms logout only for absence or 204 (%s), without a body",
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    expect(
      await browserSessionRequest(csrf, new AbortController().signal, fetcher),
    ).toBeNull();
    expect(fetcher.mock.calls[0]).toMatchObject([
      "/auth/logout",
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Cortex-CSRF": csrf },
      },
    ]);
    expect(fetcher.mock.calls[0][1]!.body).toBeUndefined();
  },
);
it.each([
  { authenticated: false },
  { csrf_token: "invalid" },
  { expires_at: 1 },
  { expires_at: Date.now() / 1000 + 172800 },
  { identity: {} },
  { access_token: "private" },
])(
  "rejects malformed or unexpected session fields without exposing content: %j",
  async (change) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...payload(), ...change }));
    await expect(
      browserSessionRequest(undefined, new AbortController().signal, fetcher),
    ).rejects.toMatchObject({ code: "invalid_response" });
  },
);
it.each([
  new Response("<html>fallback</html>"),
  Response.json({ ...payload(), padding: "x".repeat(80000) }),
])("rejects SPA fallback and oversized responses", async (response) => {
  await expect(
    browserSessionRequest(
      undefined,
      new AbortController().signal,
      vi.fn().mockResolvedValue(response),
    ),
  ).rejects.toBeDefined();
});
it("cancels in flight and does not retry logout after network loss", async () => {
  const aborter = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    (_, init) =>
      new Promise((_, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(new Error("never expose upstream")),
        );
      }),
  );
  const pending = browserSessionRequest(csrf, aborter.signal, fetcher);
  aborter.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const lost = vi.fn().mockRejectedValue(new Error("sensitive"));
  await expect(
    browserSessionRequest(csrf, new AbortController().signal, lost),
  ).rejects.not.toThrow("sensitive");
  expect(lost).toHaveBeenCalledTimes(1);
});
it("keeps reviewed navigation and relation identity, never arbitrary text or credentials in login URL", () => {
  const event = JSON.stringify([
    id,
    4,
    id,
    "relation_created",
    JSON.stringify([id, id, id, "structural"]),
  ]);
  const p = new URLSearchParams({
    api_domain: id,
    api_view: "brain",
    api_conversation: id,
    api_import: id,
    api_proposal: id,
    map_node: id,
    map_event: event,
    time_from: "2026-10-05T00:00:00Z",
    map_transport: "viewport",
    colors: "1",
    question: "PRIVATE QUESTION",
    token: "SECRET",
    return_to: "https://evil.test",
    __proto__: "evil",
  });
  const url = loginLocation(p);
  expect(url).not.toMatch(/PRIVATE|SECRET|evil/);
  const restored = new URLSearchParams(
    new URLSearchParams(url.split("?")[1]).get("return_to")!.split("?")[1],
  );
  for (const key of [
    "api_domain",
    "api_view",
    "api_conversation",
    "api_import",
    "api_proposal",
    "map_node",
    "map_event",
    "time_from",
    "map_transport",
    "colors",
  ])
    expect(restored.get(key)).toBe(p.get(key));
});
it.each([
  `api_proposal=${id}`,
  `api_import=${id}`,
  "api_import=PRIVATE-IMPORT",
  `api_domain=${id}&api_domain=${id}&map_node=${id}`,
  "__proto__=x&constructor=x&toString=x",
  "api_domain=secret&api_view=wrong&time_from=private&map_event=private",
  `map_node=${id}`,
])("drops ambiguous, malformed or unscoped navigation: %s", (query) => {
  expect(
    new URLSearchParams(
      loginLocation(new URLSearchParams(query)).split("?")[1],
    ).get("return_to"),
  ).toBe("/");
});

it.each(["PRIVATE-PROPOSAL", `${id}&api_proposal=${id}`])(
  "drops an invalid proposal while preserving its valid domain: %s",
  (value) => {
    const login = new URLSearchParams(
      loginLocation(
        new URLSearchParams(`api_domain=${id}&api_proposal=${value}`),
      ).split("?")[1],
    );
    const restored = new URLSearchParams(login.get("return_to")!.split("?")[1]);
    expect(restored.get("api_domain")).toBe(id);
    expect(restored.has("api_proposal")).toBe(false);
  },
);

it("retains only opaque work targets and a known dossier during login", () => {
  const route = new URLSearchParams(
    loginLocation(
      new URLSearchParams({
        api_domain: id,
        api_view: "work",
        api_dossier: "cases",
        api_task: id,
        api_case: id,
        title: "private title",
        excerpt: "private excerpt",
        search: "private search",
      }),
    ).split("?")[1],
  ).get("return_to")!;
  expect(new URLSearchParams(route.slice(2)).get("api_case")).toBe(id);
  expect(new URLSearchParams(route.slice(2)).get("api_task")).toBe(id);
  expect(route).toContain("api_dossier=cases");
  expect(
    decodeURIComponent(
      loginLocation(
        new URLSearchParams({ api_domain: id, api_dossier: "references" }),
      ),
    ),
  ).toContain("api_dossier=references");
  expect(route).not.toContain("private");
  for (const input of [
    new URLSearchParams({ api_case: id }),
    new URLSearchParams({ api_task: id }),
    new URLSearchParams({
      api_domain: id,
      api_dossier: "private title",
      api_case: "private excerpt",
    }),
  ]) {
    const filtered = new URLSearchParams(
      loginLocation(input).split("?")[1],
    ).get("return_to")!;
    expect(filtered).not.toMatch(/api_case|api_task|api_dossier|private/);
  }
});
it("changes identity stamp on a secondary-role or membership revision change even with identical capabilities", async () => {
  const base = {
    id,
    name: "Synthetic",
    role: "corpus_manager",
    roles: ["corpus_manager", "contributor"],
    membership_revision: 2,
    capabilities: ["query"],
  };
  const stamp = async (domain: typeof base) =>
    (await browserSessionRequest(
      undefined,
      new AbortController().signal,
      vi.fn().mockResolvedValue(
        Response.json({
          ...payload(),
          identity: {
            tenant_id: id,
            subject: "synthetic-reader",
            domains: [domain],
          },
        }),
      ),
    ))!.identityStamp;
  const original = await stamp(base);
  expect(await stamp({ ...base, roles: ["corpus_manager"] })).not.toBe(
    original,
  );
  expect(await stamp({ ...base, membership_revision: 3 })).not.toBe(original);
  expect(
    await stamp({ ...base, roles: ["contributor", "corpus_manager"] }),
  ).toBe(original);
});

it("serializes two tab restorations before cookie metadata can diverge", async () => {
  let tail = Promise.resolve<unknown>(undefined),
    cookie: string | undefined,
    grants = 0;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  const lock = vi.fn(
    (
      name: string,
      options: { signal: AbortSignal },
      callback: () => Promise<unknown>,
    ) => {
      const work = tail.then(() => {
        if (options.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        return callback();
      });
      tail = work.catch(() => {});
      return work;
    },
  );
  vi.stubGlobal("navigator", { locks: { request: lock } });
  const fetcher = vi.fn(async () => {
    const issued = cookie ?? String.fromCharCode(97 + grants++).repeat(43);
    if (!cookie) {
      entered();
      await gate;
      cookie = issued;
    }
    return Response.json({ ...payload(), csrf_token: issued });
  });
  try {
    const a = browserSessionRequest(
      undefined,
      new AbortController().signal,
      fetcher,
    );
    const b = browserSessionRequest(
      undefined,
      new AbortController().signal,
      fetcher,
    );
    await started;
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all([a, b]);
    expect(grants).toBe(1);
    expect(results[0]?.csrfToken).toBe(results[1]?.csrfToken);
    expect(
      lock.mock.calls.every((c) => c[0] === "openbrain.browser-session.v1"),
    ).toBe(true);
    expect(fetcher.mock.calls).toHaveLength(2);
  } finally {
    release();
    vi.unstubAllGlobals();
  }
});
it("aborts a queued session restore before it sends any request", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const lock = vi.fn(
    async (
      _name: string,
      options: { signal: AbortSignal },
      callback: () => Promise<unknown>,
    ) => {
      await held;
      if (options.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      return callback();
    },
  );
  vi.stubGlobal("navigator", { locks: { request: lock } });
  const fetcher = vi.fn(),
    controller = new AbortController();
  try {
    const pending = browserSessionRequest(
      undefined,
      controller.signal,
      fetcher,
    );
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    release();
    vi.unstubAllGlobals();
  }
});
it("does not bypass an available lock on coordination failure", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn().mockRejectedValue(Error("private lock diagnostic")),
    },
  });
  const fetcher = vi.fn();
  try {
    await expect(
      browserSessionRequest(undefined, new AbortController().signal, fetcher),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("preserves the reviewed reference-review dossier through login", () => {
  expect(
    loginLocation(
      new URLSearchParams({ api_domain: id, api_dossier: "referenceReviews" }),
    ),
  ).toContain("referenceReviews");
});
