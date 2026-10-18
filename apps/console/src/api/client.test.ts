import { expect, it, vi } from "vitest";
import { CortexApi, ApiError, type Session } from "./client";
const id = "00000000-0000-0000-0000-000000000001";
const session = () => ({ token: "synthetic-test-token", tenant: id });
it("uses same-origin cookies and mutation CSRF without any browser bearer or tenant", async () => {
  const cookie = { kind: "cookie" as const, csrfToken: "c".repeat(43) };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({}));
  const api = new CortexApi(() => cookie, fetcher);
  await api.call("identity.read", {}, undefined);
  await api.call(
    "conversations.create",
    { domain: id },
    { title: "Synthetic", idempotency_key: "stable" },
  );
  expect(fetcher.mock.calls[0][1]!.headers).toEqual({
    Accept: "application/json",
  });
  expect(fetcher.mock.calls[1][1]!.headers).toEqual({
    Accept: "application/json",
    "X-Cortex-CSRF": cookie.csrfToken,
    "Content-Type": "application/json",
  });
  expect(fetcher.mock.calls[1][1]!.credentials).toBe("same-origin");
});
it("invalidates the cookie boundary on native 401 but never from a stale session response", async () => {
  let current: Session | null = { kind: "cookie", csrfToken: "c".repeat(43) };
  const expired = vi.fn();
  const api = new CortexApi(
    () => current,
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    expired,
  );
  await expect(api.call("identity.read", {}, undefined)).rejects.toMatchObject({
    status: 401,
  });
  expect(expired).toHaveBeenCalledOnce();
  let finish!: (value: Response) => void;
  const later = new CortexApi(
    () => current,
    vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    ),
    expired,
  );
  const pending = later.call("identity.read", {}, undefined);
  current = { kind: "cookie", csrfToken: "d".repeat(43) };
  finish(new Response(null, { status: 401 }));
  await expect(pending).rejects.toBeDefined();
  expect(expired).toHaveBeenCalledOnce();
});
it("refuses malformed cookie state before the network", async () => {
  const fetcher = vi.fn();
  await expect(
    new CortexApi(() => ({ kind: "cookie", csrfToken: "bad" }), fetcher).call(
      "identity.read",
      {},
      undefined,
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});
it("never returns a successful private body after the session changes during decoding", async () => {
  let current: Session | null = { kind: "cookie", csrfToken: "c".repeat(43) };
  let finish!: (value: unknown) => void;
  const response = Response.json({});
  const decode = vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = new CortexApi(
    () => current,
    vi.fn().mockResolvedValue(response),
  ).call("identity.read", {}, undefined);
  await Promise.resolve();
  expect(decode).toHaveBeenCalledOnce();
  current = null;
  finish({ private: "former identity" });
  await expect(pending).rejects.toMatchObject({ code: "session_changed" });
});
it("sends Cortex authentication only to the same-origin API and preserves idempotency", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id }));
  const api = new CortexApi(session, fetcher);
  await api.call(
    "conversations.create",
    { domain: id },
    { title: "Essai", idempotency_key: "same-intent" },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`/api/v1/domains/${id}/conversations`);
  expect(init).toMatchObject({
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: {
      Authorization: "Bearer synthetic-test-token",
      "x-tenant-id": id,
    },
  });
  expect(JSON.parse(init!.body as string).idempotency_key).toBe("same-intent");
});
it.each([401, 403, 404, 409, 422, 429, 503])(
  "surfaces HTTP %s without retry or leaking server payload",
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ message: "server-sensitive-detail" }, { status }),
      );
    const promise = new CortexApi(session, fetcher).call(
      "identity.read",
      {},
      undefined,
    );
    await expect(promise).rejects.toMatchObject({ status });
    await expect(promise).rejects.not.toThrow("server-sensitive-detail");
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("refuses missing authentication and invalid identifiers before sending", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    new CortexApi(() => null, fetcher).call("identity.read", {}, undefined),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    new CortexApi(session, fetcher).call(
      "domain.version",
      { domain: "../../me" },
      undefined,
    ),
  ).rejects.toMatchObject({ status: 422 });
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not treat an HTML proxy response as data", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("<html>Fallback</html>"));
  await expect(
    new CortexApi(session, fetcher).call("identity.read", {}, undefined),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
it("reports network loss as uncertain rather than confirming an action", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("offline"));
  await expect(
    new CortexApi(session, fetcher).call("identity.read", {}, undefined),
  ).rejects.toMatchObject({ code: "network_error" });
});
it("cancels a stalled request at the deadline", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      (_, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
  await expect(
    new CortexApi(session, fetcher).call("identity.read", {}, undefined, {
      timeoutMs: 5,
    }),
  ).rejects.toMatchObject({ code: "timeout" });
});
it("honors caller cancellation", async () => {
  const controller = new AbortController();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      (_, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
  const request = new CortexApi(session, fetcher).call(
    "identity.read",
    {},
    undefined,
    { signal: controller.signal },
  );
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
it("does not bind the native transport to the API instance", async () => {
  let receiver: unknown = "unset";
  const transport = async function (this: unknown) {
    receiver = this;
    return Response.json({});
  };
  await new CortexApi(session, transport).call("identity.read", {}, undefined);
  expect(receiver).toBeUndefined();
});
it("reads split UTF-8 safely and charges actual bytes to the shared read budget", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ title: "🧠 é" }));
  let position = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(position, ++position));
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  const budget = { remainingBytes: bytes.length };
  const api = new CortexApi(
    session,
    vi.fn<typeof fetch>().mockResolvedValue(response),
  );
  expect(
    await api.call("identity.read", {}, undefined, {
      maxResponseBytes: bytes.length,
      responseBudget: budget,
    }),
  ).toEqual({ title: "🧠 é" });
  expect(budget.remainingBytes).toBe(0);
});
it.each([false, true])(
  "cancels an oversized response, with declared length %s",
  async (declared) => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("123456"));
        },
        cancel,
      }),
      {
        headers: {
          "content-type": "application/json",
          ...(declared ? { "content-length": "60" } : {}),
        },
      },
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      new CortexApi(session, fetcher).call("identity.read", {}, undefined, {
        maxResponseBytes: 5,
      }),
    ).rejects.toMatchObject({ code: "read_limit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
  },
);
it("limits the sum of individually valid responses without accepting a partial document", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ value: "123" }));
  const budget = { remainingBytes: 20 };
  const api = new CortexApi(session, fetcher);
  await api.call("identity.read", {}, undefined, {
    maxResponseBytes: 100,
    responseBudget: budget,
  });
  await expect(
    api.call("identity.read", {}, undefined, {
      maxResponseBytes: 100,
      responseBudget: budget,
    }),
  ).rejects.toMatchObject({ code: "read_limit" });
});
it("cancels a stalled response body at the request deadline", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    headers: { "content-type": "application/json" },
  });
  await expect(
    new CortexApi(
      session,
      vi.fn<typeof fetch>().mockResolvedValue(response),
    ).call("identity.read", {}, undefined, {
      timeoutMs: 5,
      maxResponseBytes: 100,
    }),
  ).rejects.toMatchObject({ code: "timeout" });
  expect(cancel).toHaveBeenCalled();
});
it("rejects incomplete JSON instead of returning the received prefix", async () => {
  const api = new CortexApi(
    session,
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"broken":', {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  await expect(
    api.call("identity.read", {}, undefined, { maxResponseBytes: 100 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
it.each([
  [403, "ORIGIN_NOT_ALLOWED", "adresse de la console"],
  [422, "AMBIGUOUS_EXCERPT", "apparaît plusieurs fois"],
  [422, "SCENE_CAPACITY_EXCEEDED", "budget de lecture"],
  [422, "MAP_CAPACITY_EXCEEDED", "budget de lecture global"],
  [409, "CORRECTION_NOT_PUBLISHED", "n’est pas encore publiée"],
  [409, "CORRECTION_NOT_ACTIVE", "n’est plus active"],
] as const)(
  "explains reviewed error %s/%s without server text",
  async (status, code, text) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: code, message: "private-server-detail" },
          { status },
        ),
      );
    const result = new CortexApi(session, fetcher).call(
      "identity.read",
      {},
      undefined,
    );
    await expect(result).rejects.toMatchObject({ status, code });
    await expect(result).rejects.toThrow(text);
    await expect(result).rejects.not.toThrow("private-server-detail");
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each([
  [403, JSON.stringify({ error: "CORRECTION_NOT_PUBLISHED" })],
  [409, JSON.stringify({ error: "private-unrecognized-code" })],
  [422, JSON.stringify({ error: "private-unrecognized-code" })],
  [403, JSON.stringify({ error: "AMBIGUOUS_EXCERPT" })],
  [409, "invalid JSON"],
  [
    409,
    JSON.stringify({
      error: "CORRECTION_NOT_PUBLISHED",
      padding: "x".repeat(9000),
    }),
  ],
] as const)(
  "keeps safe HTTP fallback for untrusted error bodies (%s)",
  async (status, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      new CortexApi(session, fetcher).call("identity.read", {}, undefined),
    ).rejects.toMatchObject({ status, code: `http_${status}` });
  },
);

it("allows only the special new draft key and still rejects traversal and non-UUID domains", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const api = new CortexApi(session, fetcher);
  await api.call("drafts.read", { domain: id, draft_key: "new" }, undefined);
  expect(fetcher.mock.calls[0][0]).toBe(
    `/api/v1/domains/${id}/conversation-drafts/new`,
  );
  for (const params of [
    { domain: id, draft_key: "../new" },
    { domain: "new", draft_key: id },
    { domain: id, draft_key: "someone" },
  ])
    await expect(
      api.call("drafts.read", params, undefined),
    ).rejects.toMatchObject({ status: 422 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("distinguishes a rejected browser session check from role permission without replay", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: "REQUEST_REJECTED", message: "private gateway details" },
        { status: 403 },
      ),
    );
  const expired = vi.fn();
  const cookie = { kind: "cookie" as const, csrfToken: "c".repeat(43) };
  const api = new CortexApi(() => cookie, fetcher, expired);
  const request = api.call(
    "conversations.create",
    { domain: id },
    { title: "Synthetic", idempotency_key: "stable" },
  );
  await expect(request).rejects.toMatchObject({
    status: 403,
    code: "REQUEST_REJECTED",
  });
  await expect(request).rejects.toThrow("session navigateur");
  await expect(request).rejects.not.toThrow("private gateway details");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(expired).not.toHaveBeenCalled();
});

it("bounds the evidence index exception to its exact route and keeps UUID identifiers strict", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({}));
  const api = new CortexApi(session, fetcher);
  for (const index of ["1", "10"])
    await api.call(
      "agent_missions.evidence",
      { domain: id, mission: id, index },
      undefined,
      { query: { expected_revision: 4 } },
    );
  expect(fetcher.mock.calls[0][0]).toBe(
    `/api/v1/domains/${id}/agent-missions/${id}/evidence/1?expected_revision=4`,
  );
  for (const index of ["0", "11", "01", "../1", id])
    await expect(
      api.call(
        "agent_missions.evidence",
        { domain: id, mission: id, index },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 422 });
  await expect(
    api.call("agent_missions.read", { domain: id, mission: "1" }, undefined),
  ).rejects.toMatchObject({ status: 422 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
