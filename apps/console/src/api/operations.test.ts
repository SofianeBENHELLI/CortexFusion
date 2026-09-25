// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { operations } from "./operations";
it("transport methods and paths match the backend OpenAPI operations", () => {
  const spec = JSON.parse(
    readFileSync(
      new URL("../../../../packages/contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [id, route] of Object.entries(operations)) {
    expect(spec.paths[route.path][route.method.toLowerCase()].operationId).toBe(
      id,
    );
  }
});
