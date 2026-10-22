// @vitest-environment node
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { backendOperations } from "./backend-map";
it("every mapped operation exists in the checked-in backend contracts", () => {
  const core = JSON.parse(
    readFileSync(
      new URL("../../../packages/contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  const extensions = JSON.parse(
    readFileSync(
      new URL(
        "../../../packages/contracts/rust-extensions.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const all = new Set<string>();
  function visit(x: unknown) {
    if (x && typeof x === "object") {
      if ("operationId" in x && typeof x.operationId === "string")
        all.add(x.operationId);
      Object.values(x).forEach(visit);
    }
  }
  visit(core);
  visit(extensions);
  for (const group of Object.values(backendOperations))
    for (const id of group) expect(all.has(id), id).toBe(true);
});
