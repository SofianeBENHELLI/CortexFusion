import { it, expect } from "vitest";
import { indexProjection, indexChanges } from "./projection-index";
import type { BrainProjection } from "./model";
it("indexes overlapping territories without duplicating membership or change counts", () => {
  const p = {
    groups: [
      { id: "g", title: "G" },
      { id: "h", title: "H" },
    ],
    nodes: [
      { id: "a", groups: ["g", "g", "h"] },
      { id: "b", groups: ["g"] },
    ],
  } as BrainProjection;
  const index = indexProjection(p);
  expect(index.members.get("g")?.map((n) => n.id)).toEqual(["a", "b"]);
  expect(index.members.get("h")?.map((n) => n.id)).toEqual(["a"]);
  const changes = indexChanges([
    { id: "e", nodeIds: ["a", "a", "b"], groupIds: ["g", "g", "h"] },
  ] as BrainProjection["events"]);
  expect(changes.byGroup.get("g")).toHaveLength(1);
  expect(changes.byNode.get("a")).toHaveLength(1);
});
