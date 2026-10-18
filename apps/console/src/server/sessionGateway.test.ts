// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { gatewayRelay, gatewayTarget } from "./sessionGateway";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const servers: http.Server[] = [];
async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
it("wires the actual opt-in Vite configuration without stripping /api or exposing callback query errors", async () => {
  const paths: string[] = [];
  const target = await serve((req, res) => {
    paths.push(req.url!);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ fixture: true, host: req.headers.host }));
  });
  vi.stubEnv("VITE_DATA_MODE", "api");
  vi.stubEnv("VITE_AUTH_MODE", "session");
  vi.stubEnv("CORTEX_BROWSER_GATEWAY_TARGET", target);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const vite = await createServer({
    root,
    configFile: root + "vite.config.ts",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "silent",
  });
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
    for (const path of ["/auth/session", "/api/v1/me"]) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        fixture: true,
        host: new URL(origin).host,
      });
    }
    expect(paths).toEqual(["/auth/session", "/api/v1/me"]);
    expect((await fetch(origin + "/.runtime/private.json")).status).toBe(403);
    const stopped = servers.pop()!;
    stopped.closeAllConnections();
    await new Promise<void>((r) => stopped.close(() => r()));
    const response = await fetch(
      origin + "/auth/callback?code=PRIVATE-SYNTHETIC",
      { redirect: "manual" },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "GATEWAY_UNAVAILABLE" });
  } finally {
    await vite.close();
  }
});
it.each([
  undefined,
  "https://127.0.0.1",
  "http://localhost:8015",
  "http://evil.test",
  "http://user:secret@127.0.0.1",
  "http://127.0.0.1/path",
  "http://127.0.0.1?token=secret",
])(
  "rejects unsafe gateway targets without reflecting their values: %s",
  (target) => {
    expect(() => gatewayTarget(target)).toThrow(
      "explicit HTTP loopback origin",
    );
    expect(() => gatewayTarget(target)).not.toThrow("secret");
  },
);
it("relays exact auth/API paths, bodies, cookies and browser Host/Origin without redirects or native path rewriting", async () => {
  const seen: {
    path?: string;
    host?: string;
    origin?: string;
    body: string;
    csrf?: string;
  }[] = [];
  const target = await serve(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({
      path: req.url,
      host: req.headers.host,
      origin: req.headers.origin,
      body,
      csrf: req.headers["x-cortex-csrf"] as string,
    });
    res.writeHead(302, {
      location: "/?api_view=brain",
      "set-cookie": "synthetic=opaque; HttpOnly; SameSite=Lax; Path=/",
      "cache-control": "no-store",
    });
    res.end();
  });
  const relay = gatewayRelay(gatewayTarget(target));
  const origin = await serve((req, res) =>
    relay(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  const auth = await fetch(
    origin + "/auth/callback?code=SYNTHETIC&state=BOUND",
    { redirect: "manual" },
  );
  expect(auth.status).toBe(302);
  expect(auth.headers.get("set-cookie")).toContain("HttpOnly");
  const body = JSON.stringify({
    title: "Fixture",
    idempotency_key: "same-key",
  });
  await fetch(origin + "/api/v1/domains/fixture/conversations", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Cortex-CSRF": "synthetic",
      "Content-Type": "application/json",
    },
    body,
    redirect: "manual",
  });
  expect(seen).toEqual([
    {
      path: "/auth/callback?code=SYNTHETIC&state=BOUND",
      host: new URL(origin).host,
      origin: undefined,
      body: "",
      csrf: undefined,
    },
    {
      path: "/api/v1/domains/fixture/conversations",
      host: new URL(origin).host,
      origin,
      body,
      csrf: "synthetic",
    },
  ]);
  expect((await fetch(origin + "/authentication")).status).toBe(404);
});
it("returns an opaque no-store failure when gateway is unavailable without logging callback secrets", async () => {
  const target = await serve((_req, res) => res.end());
  const stopped = servers.pop()!;
  await new Promise<void>((r) => stopped.close(() => r()));
  const relay = gatewayRelay(gatewayTarget(target));
  const origin = await serve((req, res) => relay(req, res, () => res.end()));
  const error = vi.spyOn(console, "error");
  try {
    const response = await fetch(
      origin + "/auth/callback?code=PRIVATE-SYNTHETIC",
      { redirect: "manual" },
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "GATEWAY_UNAVAILABLE" });
    expect(error).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
