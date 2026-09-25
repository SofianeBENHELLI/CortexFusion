import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CortexApi, ApiError } from "./client";
import { ConceptCorrection } from "./ConceptCorrection";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
const concept: Concept = {
  concept_id: "concept",
  title: "Ancien titre",
  body: "Preuve inchangée",
  maturity: "reference",
  sources: [{ source_id: "source", start: 2, end: 18 }],
  links: [
    { target_id: "target", kind: "associative", weight: 0.4, primary: false },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(changed = false) {
  const api = new CortexApi(() => null);
  let versions = 0;
  const call = vi.spyOn(api, "call").mockImplementation(async (op) => {
    if (op === "domain.version")
      return {
        domain_id: "domain",
        accepted_version: 4,
        published_version: changed ? ++versions : 4,
      };
    if (op === "concepts.list") return [concept];
    throw new ApiError(0, "network_error");
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConceptCorrection api={api} domain="domain" issueId="issue" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Corriger le titre d’un concept existant"));
  fireEvent.click(
    screen.getByRole("button", { name: "Charger les concepts publiés" }),
  );
  return call;
}
it("preserves existing concept identity, evidence, maturity and relationships on retry", async () => {
  const call = setup();
  await screen.findByText("Base de correction : version 4");
  fireEvent.change(screen.getByLabelText("Concept à corriger"), {
    target: { value: "concept" },
  });
  fireEvent.change(screen.getByLabelText("Nouveau titre"), {
    target: { value: "Titre précisé" },
  });
  fireEvent.change(screen.getByLabelText("Motif de correction"), {
    target: { value: "Clarifier" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Proposer la correction du titre" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Réessayer la même correction" }),
  );
  await screen.findByRole("button", { name: "Réessayer la même correction" });
  const bodies = call.mock.calls
    .filter((c) => c[0] === "proposals.create")
    .map((c) => c[2]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({
    base_version: 4,
    reason: "Ticket issue : Clarifier",
    changes: [
      { kind: "put_concept", concept: { ...concept, title: "Titre précisé" } },
    ],
  });
  expect(concept.title).toBe("Ancien titre");
});
it("rejects a snapshot read across a publication change", async () => {
  const call = setup(true);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Concept à corriger")).toBeNull();
  expect(call.mock.calls.some((c) => c[0] === "proposals.create")).toBe(false);
});
