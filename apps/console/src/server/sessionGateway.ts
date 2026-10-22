import http from "node:http";
import type { Connect, Plugin } from "vite";

export function gatewayTarget(value: string | undefined): URL {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url;
  } catch {
    throw new Error(
      "CORTEX_BROWSER_GATEWAY_TARGET must be an explicit HTTP loopback origin",
    );
  }
}

/** Small local dev/preview relay. Never logs callback codes, query text or errors. */
export function gatewayRelay(target: URL): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!/^\/(?:auth|api)(?:\/|\?|$)/.test(req.url ?? "")) {
      next();
      return;
    }
    // Keep the browser Host/Origin. The gateway enforces its canonical origin.
    const upstream = http.request({
      hostname: target.hostname.replace(/^\[|\]$/g, ""),
      port: target.port || 80,
      path: req.url,
      method: req.method,
      headers: req.headers,
    });
    const timer = setTimeout(() => upstream.destroy(), 32000);
    const finish = () => clearTimeout(timer);
    const close = () => {
      if (!res.writableEnded) upstream.destroy();
      finish();
    };
    res.on("close", close);
    req.on("aborted", () => upstream.destroy());
    req.on("error", () => upstream.destroy());
    upstream.on("error", () => {
      finish();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end('{"error":"GATEWAY_UNAVAILABLE"}');
    });
    upstream.on("response", (reply) => {
      reply.on("error", () => {
        finish();
        res.destroy();
      });
      reply.on("end", finish);
      res.on("close", () => reply.destroy());
      // Only the fixed local gateway can issue cookies and redirect the auth flow.
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    req.pipe(upstream);
  };
}

export function sessionGateway(value: string | undefined): Plugin {
  const relay = gatewayRelay(gatewayTarget(value));
  return {
    name: "cortex-session-gateway",
    configureServer(server) {
      server.middlewares.use(relay);
    },
    configurePreviewServer(server) {
      server.middlewares.use(relay);
    },
  };
}
