import { expect, it } from "vitest";
import {
  indexSceneChanges,
  observedSceneLinks,
  sceneLinkKey,
} from "./scene-changes";
import type { BrainChange, ChangeKind } from "./model";
import { id, scene } from "./scene.fixture";

const event = (
  version: number,
  kind: ChangeKind,
  from = id(1),
  to = id(2),
): BrainChange => ({
  id: `${version}:${kind}:${from}:${to}`,
  publicationId: String(version),
  version,
  time: "2026-10-04T12:00:00Z",
  kind,
  title: "Historical title",
  detail: "Published",
  nodeIds: [from, to],
  groupIds: [],
  sourceIds: [],
  relation: {
    id: "relation",
    from,
    to,
    kind: "associative",
    weight: 0.5,
    sourceIds: [],
  },
});
const pair = {
  ...scene,
  glyphs: [
    scene.glyphs[0],
    { ...scene.glyphs[0], id: id(2), concept_id: id(2), title: "Current Beta" },
  ],
  links: [
    {
      from: 0,
      to: 1,
      kind: "associative" as const,
      count: 1,
      weight: 0.8,
      aggregate: false,
    },
  ],
};

it("keeps an ordered history per exact directed relation, deduplicating events without treating cumulative effects as a net change", () => {
  const created = event(1, "relation_created"),
    stronger = event(3, "relation_strengthened"),
    weaker = event(4, "relation_weakened");
  const indexed = indexSceneChanges([
    created,
    weaker,
    stronger,
    created,
    event(5, "relation_created", id(2), id(1)),
  ]);
  const forward = indexed.relations.get(
    sceneLinkKey(id(1), id(2), "associative"),
  )!;
  expect(forward.latest).toBe(weaker);
  expect(forward.events.map((e) => e.version)).toEqual([4, 3, 1]);
  expect(forward.label).toBe(
    "Poids en baisse · Relation renforcée · Nouvelle relation",
  );
  expect(indexed.relations.size).toBe(2);
  expect(observedSceneLinks(pair, indexed.relations)).toMatchObject([
    {
      fromTitle: "Alpha",
      toTitle: "Current Beta",
      observation: { latest: weaker },
    },
  ]);
});

it("never infers changes in aggregate routes, references, opposite directions or links absent from the current scene", () => {
  const indexed = indexSceneChanges([event(3, "relation_removed")]);
  expect(observedSceneLinks({ ...pair, links: [] }, indexed.relations)).toEqual(
    [],
  );
  for (const link of [
    { ...pair.links[0], aggregate: true },
    { ...pair.links[0], kind: "reference" as const, weight: null },
    { ...pair.links[0], from: 1, to: 0 },
    { ...pair.links[0], kind: "structural" as const },
  ])
    expect(
      observedSceneLinks({ ...pair, links: [link] }, indexed.relations),
    ).toEqual([]);
  expect(
    observedSceneLinks(
      {
        ...pair,
        glyphs: [pair.glyphs[0], { ...pair.glyphs[1], concept_id: null }],
      },
      indexed.relations,
    ),
  ).toEqual([]);
  // A historically removed link can exist now (e.g. recreated outside the period).
  // Retain the historical label, never fabricate a "currently removed" status.
  expect(observedSceneLinks(pair, indexed.relations)[0].observation.label).toBe(
    "Relation retirée",
  );
  expect(indexSceneChanges([]).relations.size).toBe(0);
});
