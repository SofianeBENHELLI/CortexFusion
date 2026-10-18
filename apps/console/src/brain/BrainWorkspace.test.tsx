import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { seed } from "../mock";
import { BrainWorkspace } from "./BrainWorkspace";
import { mockProjection, observePublication } from "./mock-projection";
import { ThemeProvider } from "../theme";
import { catalogFixture } from "./catalog.fixture";
import { catalogProjection } from "./catalog";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
function Location() {
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{useLocation().search}</output>
      <button onClick={() => navigate(-1)}>Retour de recette</button>
    </>
  );
}
function fixture() {
  const state = seed(),
    beforeConcepts = structuredClone(state.concepts);
  state.concepts[0].relations.push("wave6");
  state.brainObservedSince = "2026-10-02T00:00:00Z";
  state.brainObservations = [
    observePublication({
      id: "pub",
      time: "2026-10-02T01:00:00Z",
      version: 42,
      proposalId: "PR-3082",
      before: beforeConcepts[0],
      after: state.concepts[0],
      beforeConcepts,
      afterConcepts: state.concepts,
    }),
  ];
  return mockProjection(state);
}
function setup(url = "/views/brain", projection = fixture()) {
  const onSource = vi.fn();
  render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <BrainWorkspace projection={projection} onSource={onSource} />
        <Location />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { onSource };
}
describe("BrainMap and Chronique journeys", () => {
  it("keeps long concept content available without displacing relations and source controls", () => {
    const p = fixture();
    const node = p.nodes[0];
    const body = "🧠".repeat(200000);
    node.description = body;
    setup(`/views/brain?node=${node.id}`, p);
    const detail = screen.getByRole("region", { name: "Détail sélectionné" });
    expect(within(detail).getByText("🧠".repeat(600) + "…")).toBeTruthy();
    const full = within(detail).getByText(body);
    expect(full.closest("details")?.open).toBe(false);
    expect(
      within(detail).getByText(/Contenu complet · 200.*000 caractères/),
    ).toBeTruthy();
    expect(
      within(detail).getByRole("button", { name: "Consulter la source" }),
    ).toBeTruthy();
    const region = full.closest('[role="region"]');
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.getAttribute("aria-label")).toBe(
      "Contenu complet du détail",
    );
  });
  it("bounds a large journal, pages through every event and resets when its scope changes", () => {
    const p = fixture();
    const base = p.events[0];
    p.coverage.to = "2026-10-02T12:00:00.000Z";
    p.coverage.partial = true;
    p.events = Array.from({ length: 83 }, (_, i) => ({
      ...base,
      id: `large-${i}`,
      title: `Trace ${String(i).padStart(2, "0")}`,
      time: new Date(
        Date.parse("2026-10-02T01:00:00Z") + i * 1000,
      ).toISOString(),
    }));
    setup("/views/brain", p);
    const journalElement = screen.getByRole("complementary", {
      name: "Journal synchronisé",
    });
    journalElement.scrollIntoView = vi.fn();
    const journal = within(journalElement);
    const entries = () => journal.getAllByRole("button", { name: /Trace \d+/ });
    expect(entries()).toHaveLength(5);
    fireEvent.click(
      journal.getByRole("button", { name: "Parcourir les 83 événements" }),
    );
    expect(entries()).toHaveLength(40);
    expect(entries()[0].textContent).toContain("Trace 82");
    expect(journal.getByRole("status").textContent).toContain(
      "1–40 sur 83 événements chargés",
    );
    expect(
      (
        journal.getByRole("button", {
          name: "Événements précédents",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      journal.getByRole("button", { name: "Événements suivants" }),
    );
    expect(entries()).toHaveLength(40);
    expect(entries()[0].textContent).toContain("Trace 42");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Journal synchronisé",
    );
    fireEvent.change(
      journal.getByRole("combobox", { name: "Page des événements" }),
      { target: { value: "2" } },
    );
    expect(entries()).toHaveLength(3);
    expect(entries()[2].textContent).toContain("Trace 00");
    expect(journal.getByRole("status").textContent).toContain(
      "81–83 sur 83 événements chargés",
    );
    expect(
      (
        journal.getByRole("button", {
          name: "Événements suivants",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      journal.getByRole("button", { name: "Événements précédents" }),
    );
    expect(entries()[0].textContent).toContain("Trace 42");
    fireEvent.click(
      journal.getByRole("button", { name: "Réduire le journal" }),
    );
    expect(entries()).toHaveLength(5);
    fireEvent.click(
      journal.getByRole("button", { name: "Parcourir les 83 événements" }),
    );
    expect(entries()[0].textContent).toContain("Trace 82");
    fireEvent.click(
      journal.getByRole("button", { name: "Événements suivants" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Période des événements" }),
      { target: { value: "7" } },
    );
    expect(entries()).toHaveLength(5);
    fireEvent.click(
      journal.getByRole("button", { name: "Parcourir les 83 événements" }),
    );
    expect(entries()[0].textContent).toContain("Trace 82");
    fireEvent.click(
      journal.getByRole("button", { name: "Événements suivants" }),
    );
    fireEvent.click(entries()[0]);
    expect(screen.getByTestId("location").textContent).toContain(
      "event=large-42",
    );
    expect(
      screen.getByRole("region", { name: "Détail sélectionné" }).textContent,
    ).toContain("Trace 42");
  });
  it("synchronizes the interval, map deltas and journal while retaining stock and browser history", () => {
    const p = fixture();
    p.coverage.to = "2026-10-02T12:00:00.000Z";
    p.events.push({
      ...p.events[0],
      id: "second",
      publicationId: "second",
      version: 43,
      time: "2026-10-02T10:00:00.000Z",
    });
    setup("/views/brain?period=1&api_domain=kept&map_locate=old", p);
    const metrics = screen.getByRole("group", {
      name: "Indicateurs du périmètre",
    });
    const stock = within(metrics)
      .getByText("Concepts publiés")
      .parentElement!.querySelector("strong")!.textContent;
    const timeline = screen.getByRole("region", {
      name: "Frise des changements",
    });
    const occupied = within(timeline).getAllByRole("button", {
      name: /1 événement chargé/,
    });
    expect(occupied).toHaveLength(2);
    expect(
      within(
        screen.getByRole("complementary", { name: "Journal synchronisé" }),
      ).getByText("2 événements"),
    ).toBeTruthy();
    fireEvent.click(occupied[0]);
    expect(document.activeElement).toBe(occupied[0]);
    expect(
      within(
        screen.getByRole("complementary", { name: "Journal synchronisé" }),
      ).getByText("1 événement"),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Carte du cerveau" }),
      ).getByText("+ 1 lien"),
    ).toBeTruthy();
    expect(
      within(metrics)
        .getByText("Concepts publiés")
        .parentElement!.querySelector("strong")!.textContent,
    ).toBe(stock);
    let query = new URLSearchParams(
      screen.getByTestId("location").textContent!,
    );
    expect(query.has("time_from")).toBe(true);
    expect(query.has("map_locate")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Retour de recette" }));
    expect(
      within(
        screen.getByRole("complementary", { name: "Journal synchronisé" }),
      ).getByText("2 événements"),
    ).toBeTruthy();
    fireEvent.click(occupied[1]);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Période des événements" }),
      { target: { value: "7" } },
    );
    query = new URLSearchParams(screen.getByTestId("location").textContent!);
    expect(query.has("time_from")).toBe(false);
    expect(query.get("period")).toBe("7");
  });
  it("restores an empty interval without claiming a complete inactive period or retaining a selected event", () => {
    const p = fixture();
    p.coverage.partial = true;
    p.coverage.to = "2026-10-02T12:00:00.000Z";
    setup(
      "/views/brain?period=1&time_from=2026-10-02T09:00:00.000Z&time_to=2026-10-02T10:00:00.000Z",
      p,
    );
    const timeline = screen.getByRole("region", {
      name: "Frise des changements",
    });
    expect(
      within(timeline).getAllByRole("button", {
        name: /couverture partielle, total inconnu/,
      }),
    ).toHaveLength(24);
    expect(
      screen.getByText(/Aucun événement chargé dans cet intervalle/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toute la période" }));
    expect(
      screen.getByRole("button", { name: /Nouvelle relation · v42/ }),
    ).toBeTruthy();
  });
  it("preserves the API domain and overview page while selecting a journal event", () => {
    const p = fixture();
    p.mode = "api";
    setup(
      "/views/brain?api_domain=domain-context&api_view=brain&domains_page=2",
      p,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Nouvelle relation · v42/ }),
    );
    const query = new URLSearchParams(
      screen.getByTestId("location").textContent!,
    );
    expect(query.get("api_domain")).toBe("domain-context");
    expect(query.get("api_view")).toBe("brain");
    expect(query.get("domains_page")).toBe("2");
    expect(query.get("event")).toBeTruthy();
  });
  it("explains a primary marker publication using the historical state even if the current link differs", () => {
    const p = fixture();
    const event = p.events.find((e) => e.relation)!;
    event.kind = "relation_primary_changed";
    event.detail =
      "Relation principale : non → oui. Marqueur modifié par publication.";
    event.relation = { ...event.relation!, primary: true };
    p.relations = p.relations.map((r) => ({ ...r, primary: false }));
    setup(`/views/brain?event=${encodeURIComponent(event.id)}`, p);
    const detail = screen.getByRole("region", { name: "Détail sélectionné" });
    expect(
      within(detail).getByText("Relation principale modifiée"),
    ).toBeTruthy();
    expect(within(detail).getByText("Relation principale : oui")).toBeTruthy();
    expect(within(detail).queryByText("Relation principale : non")).toBeNull();
    expect(
      within(detail).getByRole("button", { name: "Consulter la source" }),
    ).toBeTruthy();
  });
  it.each(["event", "relation"])(
    "keeps the authorized %s detail when its current neighborhood has disappeared",
    (kind) => {
      const p = fixture();
      const e = p.events.find((change) => change.relation)!;
      p.mode = "api";
      p.nodes = [];
      p.groups = [];
      p.relations = [];
      p.window = {
        focus: null,
        scopeIds: null,
        totals: { concepts: 0, relations: 0 },
        domainTotals: { concepts: 0, relations: 0 },
        loaded: 0,
        internalRelations: 0,
        boundaryRelations: 0,
        edgesTruncated: false,
      };
      setup(
        `/views/brain?level=concepts&group=${e.groupIds[0]}&${kind}=${encodeURIComponent(kind === "event" ? e.id : e.relation!.id)}`,
        p,
      );
      expect(
        screen.getByRole("region", { name: "Détail sélectionné" }).textContent,
      ).toContain(kind === "event" ? e.title : e.relation!.toTitle);
      expect(
        screen.getByText("Aucun concept publié dans ce périmètre."),
      ).toBeTruthy();
    },
  );
  it("drills through a dense family, restores a deep link and returns through each ancestor", () => {
    const c = catalogFixture();
    c.concepts = Array.from({ length: 65 }, (_, i) => ({
      ...c.concepts[0],
      id: `dense-${i}`,
      title: `Fiche ${i.toString().padStart(2, "0")}`,
      brand: [i < 50 ? "catia" : "simulia"],
      linked_concept_ids: [],
    }));
    const p = catalogProjection(c);
    setup("/views/brain?corpus=local", p);
    fireEvent.click(
      screen.getByRole("button", { name: "Explorer Offres & produits" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Explorer Produits" }));
    expect(
      screen.queryByRole("button", { name: "Consulter Fiche 00" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Explorer CATIA" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Explorer Fiche 00 → Fiche 23" }),
    );
    const metrics = screen.getByRole("group", {
      name: "Indicateurs du périmètre",
    });
    expect(
      within(metrics)
        .getByText("Fiches du corpus")
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("24");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Fiche 00" }));
    const url = "/views/brain" + screen.getByTestId("location").textContent;
    cleanup();
    setup(url, p);
    expect(
      screen.getByRole("region", { name: "Détail sélectionné" }).textContent,
    ).toContain("Fiche 00");
    fireEvent.click(
      screen.getByRole("button", { name: "Reculer d’un niveau" }),
    );
    expect(
      screen.getByRole("button", { name: "Explorer Fiche 00 → Fiche 23" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reculer d’un niveau" }),
    );
    expect(
      screen.getByRole("button", { name: "Explorer SIMULIA" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reculer d’un niveau" }),
    );
    expect(
      screen.getByRole("button", { name: "Explorer Produits" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reculer d’un niveau" }),
    );
    expect(
      screen.getByRole("button", { name: "Explorer Offres & produits" }),
    ).toBeTruthy();
  });
  it("keeps catalogue scope, counts and links synchronized across territories and restores root scope", () => {
    const p = catalogProjection(catalogFixture());
    setup("/views/brain?corpus=local", p);
    expect(screen.queryByText(/savoir publié v0/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Changements" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Explorer Offres & produits" }),
    );
    const metrics = screen.getByRole("group", {
      name: "Indicateurs du périmètre",
    });
    expect(
      within(metrics)
        .getByText("Fiches du corpus")
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("2");
    expect(
      within(metrics)
        .getByText("Références entre fiches")
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("3");
    expect(
      screen.queryByRole("button", { name: "Explorer Secteurs" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Reculer d’un niveau" }),
    );
    expect(screen.getByTestId("location").textContent).not.toContain(
      "territory=",
    );
    expect(screen.getByTestId("location").textContent).toContain(
      "corpus=local",
    );
    expect(
      screen.getByRole("button", { name: "Explorer Marchés & usages" }),
    ).toBeTruthy();
  });
  it("locates an off-page search match and follows a reference across territories", () => {
    const c = catalogFixture();
    for (let i = 0; i < 30; i++)
      c.concepts.push({
        ...c.concepts[0],
        id: `new-${i.toString().padStart(2, "0")}`,
        title: `Ajout ${i.toString().padStart(2, "0")}${i === 18 ? " Élément recherché" : ""}`,
        source_path: `okf/new-${i.toString().padStart(2, "0")}.md`,
        linked_concept_ids: ["c"],
      });
    setup("/views/brain?corpus=local", catalogProjection(c));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "element recherche" },
    });
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Résultats de recherche" }),
      ).getByRole("button"),
    );
    expect(
      screen.getByRole("button", {
        name: "Consulter Ajout 18 Élément recherché",
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toContain("node=new-18");
    expect(
      screen
        .getByRole("button", { name: "Page précédente de la carte" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Consulter Ajout 00" }),
    ).toBeNull();
    const detail = screen.getByRole("region", { name: "Détail sélectionné" });
    expect(detail.textContent).toContain("Fiche du corpus");
    fireEvent.click(
      within(detail).getByText("1 références entrantes et sortantes"),
    );
    fireEvent.click(within(detail).getByRole("button", { name: "→ c" }));
    expect(screen.getByTestId("location").textContent).toContain(
      "territory=market",
    );
    expect(screen.getByRole("button", { name: "Consulter c" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Détail sélectionné" }).textContent,
    ).toContain("Statut du corpus : draft");
    screen.getByRole("searchbox").focus();
    fireEvent.click(screen.getByRole("button", { name: "Consulter c" }));
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Détail sélectionné" }),
    );
  });
  it("drills through domain and neighborhood, and restores a selected event in the URL", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-02T12:00:00Z"));
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Explorer Marques & portefeuille" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Explorer SIMULIA" }));
    expect(
      screen.getByRole("button", { name: "Consulter wave6" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /SIMULIA → wave6 Nouvelle relation/ }),
    );
    expect(screen.getByTestId("location").textContent).toContain("event=");
    expect(
      screen.getByRole("region", { name: "Détail sélectionné" }).textContent,
    ).toContain("Publication v42");
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Détail sélectionné" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cerveau" }));
    expect(
      screen.getByRole("button", { name: "Explorer Marques & portefeuille" }),
    ).toBeTruthy();
  });
  it("keeps the graph scope when time changes and exposes sources from selection", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-10T12:00:00Z"));
    const { onSource } = setup("/views/brain?level=concepts&group=simulia");
    fireEvent.click(screen.getByRole("button", { name: "Consulter SIMULIA" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Consulter la source" }),
    );
    expect(onSource).toHaveBeenCalledWith(
      "SRC-001",
      expect.any(HTMLButtonElement),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Période des événements" }),
      { target: { value: "1" } },
    );
    expect(screen.getByTestId("location").textContent).toContain(
      "group=simulia",
    );
    expect(screen.getByText("Aucun changement enregistré")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Consulter wave6" }),
    ).toBeTruthy();
  });
  it("handles obsolete neighborhoods and empty published graphs", () => {
    setup("/views/brain?level=concepts&group=deleted");
    expect(screen.getByText(/Ce voisinage n’est plus accessible/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Explorer SIMULIA" }),
    ).toBeTruthy();
    cleanup();
    const model = mockProjection({ ...seed(), concepts: [] });
    setup("/views/brain?level=groups", model);
    expect(
      screen.getByText("Aucun concept publié dans ce périmètre."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Approfondir le premier territoire" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
  it("distinguishes unavailable telemetry from zero and persists the chosen theme", () => {
    setup();
    const metrics = screen.getByRole("group", {
      name: "Indicateurs du périmètre",
    });
    expect(within(metrics).getAllByText("—")).toHaveLength(2);
    expect(
      within(metrics).getByText("Dynamique non instrumentée"),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Apparence" }), {
      target: { value: "dark" },
    });
    expect(localStorage.getItem("cortexfusion.console.theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
