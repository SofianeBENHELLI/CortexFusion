import { expect, it, vi } from "vitest";
import { CortexApi, ApiError } from "./client";
const id = "00000000-0000-0000-0000-000000000001";
const session = () => ({ token: "synthetic-test-token", tenant: id });
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
