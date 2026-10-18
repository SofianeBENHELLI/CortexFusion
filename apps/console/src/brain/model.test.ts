import { describe, expect, it } from "vitest";
import { seed } from "../mock";
import { mockProjection, observePublication } from "./mock-projection";
import {
  countChanges,
  defaultSelection,
  readSelection,
  relationId,
  selectEvents,
  writeSelection,
} from "./model";

const when = "2026-10-02T14:00:00.000Z";
function changed() {
  const state = seed();
  const beforeConcepts = structuredClone(state.concepts);
  state.concepts[0].relations = ["Abaqus", "Isight", "wave6"];
  state.brainObservedSince = when;
  state.brainObservations = [
    observePublication({
      id: "pub42",
      time: when,
      version: 42,
      proposalId: "PR-3082",
      before: beforeConcepts[0],
      after: state.concepts[0],
      beforeConcepts,
      afterConcepts: state.concepts,
    }),
  ];
  return state;
}
describe("brain publication read model", () => {
  it("orders simultaneous publications by numeric version, not their string identity", () => {
    const model = mockProjection(changed());
    model.events = [9, 10, 100].map((version) => ({
      ...model.events[0],
      version,
      id: `publication-${version}`,
    }));
    expect(
      selectEvents(model, defaultSelection, Date.parse(when)).map(
        (event) => event.version,
      ),
    ).toEqual([100, 10, 9]);
  });
  it("does not turn named relation targets or proposals into published concepts", () => {
    const state = seed(),
      model = mockProjection(state);
    expect(model.nodes.filter((n) => n.kind === "concept")).toHaveLength(
      state.concepts.length,
    );
    expect(model.nodes.find((n) => n.title === "Abaqus")?.kind).toBe(
      "reference",
    );
    expect(model.nodes.some((n) => n.title === "wave6")).toBe(false);
    expect(model.events).toEqual([]);
    expect(model.capabilities.memory).toBe(false);
    expect(model.coverage.publicationChanges).toBe(false);
  });
  it("records actual additions and removals without interpreting removal as archival", () => {
    const model = mockProjection(changed());
    expect(model.events.map((e) => e.kind).sort()).toEqual([
      "relation_created",
      "relation_removed",
    ]);
    expect(
      model.events.find((e) => e.kind === "relation_removed")?.title,
    ).toContain("fe-safe");
    expect(countChanges(model.events)).toMatchObject({
      created: 1,
      removed: 1,
      concepts: 0,
      archived: 0,
    });
  });
  it("deduplicates replayed events and applies period and territory together", () => {
    const model = mockProjection(changed());
    model.events.push(...model.events);
    const now = Date.parse(when) + 60_000;
    expect(selectEvents(model, defaultSelection, now)).toHaveLength(2);
    expect(
      selectEvents(
        model,
        { ...defaultSelection, level: "concepts", group: "outscale" },
        now,
      ),
    ).toHaveLength(0);
    expect(
      selectEvents(
        model,
        { ...defaultSelection, period: "1" },
        now + 2 * 86400000,
      ),
    ).toHaveLength(0);
    expect(countChanges(model.events).created).toBe(1);
  });
  it("keeps identities stable across reordered concepts and avoids separator collisions", () => {
    const state = seed();
    const before = mockProjection(state)
      .relations.map((r) => r.id)
      .sort();
    state.concepts.reverse();
    expect(
      mockProjection(state)
        .relations.map((r) => r.id)
        .sort(),
    ).toEqual(before);
    expect(relationId("a", "b:c", "d", "structural")).not.toBe(
      relationId("a", "b", "c:d", "structural"),
    );
  });
  it("records a new concept and its relation as separate effects", () => {
    const state = seed(),
      c = {
        id: "new",
        name: "Nouveau",
        description: "Savoir",
        relations: ["SIMULIA"],
        source: "SRC-002",
      };
    const observation = observePublication({
      id: "newpub",
      time: when,
      version: 42,
      proposalId: "p",
      before: undefined,
      after: c,
      beforeConcepts: state.concepts,
      afterConcepts: [...state.concepts, c],
    });
    expect(countChanges(observation.changes)).toMatchObject({
      concepts: 1,
      created: 1,
    });
    expect(observation.changes[1].relation?.to).toBe("concept:simulia");
  });
  it("restores shareable selection and rejects invalid route controls", () => {
    const selection = {
      ...defaultSelection,
      group: "a & b",
      level: "concepts" as const,
      event: "pub:é/1",
      period: "7" as const,
      colors: true,
      page: 2,
    };
    expect(readSelection(writeSelection(selection))).toEqual(selection);
    expect(
      readSelection(
        new URLSearchParams("level=bad&period=-4&page=Infinity&mode=bad"),
      ),
    ).toEqual(defaultSelection);
  });
});
