// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { guardNavigation } from "./navigationGuard";

function request(url: string, method = "GET", accept = "text/html") {
  const req = { url, method, headers: { accept } } as IncomingMessage;
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  guardNavigation(req, res as unknown as ServerResponse, next);
  return { req, res, next };
}

it.each(["/views/concepts/%E0%A4%A", "/views/%", "/views/%FF"])(
  "rejects malformed navigation %s without reflecting input or a stack",
  (url) => {
    const { res, next } = request(url);
    expect(res.statusCode).toBe(400);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    const body = res.end.mock.calls[0][0] as string;
    expect(body).toContain("Cette adresse est invalide");
    expect(body).toContain('href="/"');
    expect(body).not.toContain(url);
    expect(body).not.toContain("URIError");
    expect(next).not.toHaveBeenCalled();
  },
);

it.each([
  "/views/concepts/%C3%89toile",
  "/assets/index.js",
  "/api/concepts?q=%FF",
  "/views/brain?search=100%",
  "/views/concepts/100%25",
])("leaves valid paths and their raw query intact: %s", (url) => {
  const { req, res, next } = request(url);
  expect(next).toHaveBeenCalledOnce();
  expect(res.end).not.toHaveBeenCalled();
  expect(req.url).toBe(url);
});

it.each([
  "/@fs/workspace/.runtime/private.txt",
  "/@fs/workspace/.runtime/private.txt?raw",
  "/@fs/workspace/%2eruntime/private.txt",
  "/@fs/workspace/%252eruntime%252fprivate.txt?import",
  "/@fs/workspace%5c.runtime%5cprivate.txt",
  "/.git/config",
])("withholds private workspace files before static handling: %s", (url) => {
  const { res, next } = request(url);
  expect(res.statusCode).toBe(403);
  expect(res.end).toHaveBeenCalledWith('{"error":"forbidden_path"}');
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(next).not.toHaveBeenCalled();
  expect(request(url, "HEAD").res.end).toHaveBeenCalledWith(undefined);
});

it("does not send HTML to API clients or a body for HEAD", () => {
  const api = request("/api/%FF", "POST", "application/json");
  expect(api.res.statusCode).toBe(400);
  expect(api.res.end).toHaveBeenCalledWith('{"error":"invalid_path"}');
  const head = request("/views/%FF", "HEAD");
  expect(head.res.statusCode).toBe(400);
  expect(head.res.end).toHaveBeenCalledWith(undefined);
});
