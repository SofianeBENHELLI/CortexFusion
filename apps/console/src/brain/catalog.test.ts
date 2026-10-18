import { describe, expect, it } from "vitest";
import { catalogFixture } from "./catalog.fixture";
import { catalogProjection, validateCatalog } from "./catalog";
import { macroLinks } from "./macro-links";

describe("Local catalogue boundaries and provenance", () => {
  it("preserves Unicode and declared statuses without inventing lifecycle or publication events", () => {
    const input = catalogFixture();
    input.concepts[1].declared_status = "deprecated";
    const p = catalogProjection(validateCatalog(input));
    expect(p.mode).toBe("catalog");
    expect(p.events).toEqual([]);
    expect(p.capabilities).toEqual({
      dynamics: false,
      memory: false,
      archives: false,
    });
    expect(p.nodes[1].declaredStatus).toBe("deprecated");
    expect(p.nodes[1].maturity).toBeUndefined();
    expect(p.sources[0].fullText).toBe(input.concepts[0].text);
    expect(p.sources[0].hash).toBe(input.concepts[0].source_sha256);
    expect(p.relations).toHaveLength(4);
    expect(
      p.relations.every((r) => r.kind === "unspecified" && r.weight === null),
    ).toBe(true);
  });
  it.each(["duplicate", "path", "offset", "target", "hash"])(
    "rejects invalid %s data before replacing a catalogue",
    (failure) => {
      const c = catalogFixture();
      if (failure === "duplicate") c.concepts.push(c.concepts[0]);
      if (failure === "path") c.concepts[0].source_path = "okf/../outside.md";
      if (failure === "offset")
        c.concepts[0].body_end = c.concepts[0].text.length; // UTF-16 length exceeds the Unicode code point length.
      if (failure === "target") c.concepts[0].linked_concept_ids.push("absent");
      if (failure === "hash") c.concepts[0].source_sha256 = "changed";
      expect(() => validateCatalog(c)).toThrow();
    },
  );
});
describe("Macro connections", () => {
  it("counts each directed reference once, groups both directions, excludes internal links", () => {
    const p = catalogProjection(catalogFixture());
    p.relations.push(p.relations[0]);
    const world = macroLinks(p, "domain"),
      families = macroLinks(p, "groups");
    expect(world).toHaveLength(1);
    expect(world[0].relations).toHaveLength(2);
    expect(families.map((g) => g.relations.length)).toEqual([2, 2]);
    expect(
      new Set(families.flatMap((g) => g.relations.map((r) => r.id))).size,
    ).toBe(4);
  });
  it("keeps macro identities stable when source order changes and filters changes before aggregation", () => {
    const p = catalogProjection(catalogFixture()),
      before = macroLinks(p, "domain");
    p.nodes.reverse();
    p.relations.reverse();
    expect(macroLinks(p, "domain").map((x) => x.id)).toEqual(
      before.map((x) => x.id),
    );
    expect(macroLinks(p, "domain", [p.relations[0]])[0].relations).toHaveLength(
      1,
    );
  });
});
