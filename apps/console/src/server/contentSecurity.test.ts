import { expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  contentSecurityPolicy,
} from "./contentSecurity";

it("applies only to builds and prepends one policy meta tag", () => {
  const plugin = contentSecurityPolicy();
  expect(plugin.apply).toBe("build");
  const transform = plugin.transformIndexHtml as () => unknown;
  expect(transform()).toEqual([
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: CONTENT_SECURITY_POLICY,
      },
      injectTo: "head-prepend",
    },
  ]);
});

it("never allows inline or evaluated scripts, plugins or other origins", () => {
  const directives = Object.fromEntries(
    CONTENT_SECURITY_POLICY.split("; ").map((d) => {
      const [name, ...sources] = d.split(" ");
      return [name, sources];
    }),
  );
  expect(directives["script-src"]).toEqual(["'self'"]);
  expect(directives["connect-src"]).toEqual(["'self'"]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
});
