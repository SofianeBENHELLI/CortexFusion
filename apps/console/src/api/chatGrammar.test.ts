import { describe, expect, it } from "vitest";
import { chatIntent } from "./workspaceCommands";

// Users type accents, capitals and typographic apostrophes; the grammar must not care.
describe("task commands", () => {
  it("plans with a French or English priority and an optional due date", () => {
    expect(
      chatIntent("Planifie la tâche : haute | 2026-11-01 | Client prioritaire"),
    ).toEqual({
      kind: "task_plan",
      priority: "high",
      due: "2026-11-01",
      reason: "Client prioritaire",
    });
    expect(
      chatIntent("planifie la tache: basse | sans échéance | Plus tard"),
    ).toMatchObject({
      kind: "task_plan",
      priority: "low",
      due: "",
    });
    expect(chatIntent("Planifie la tâche : urgente | demain | Vite")).toEqual({
      kind: "task_plan_invalid",
    });
    expect(chatIntent("Planifie la tâche : haute | 2026-11-01")).toEqual({
      kind: "task_plan_invalid",
    });
  });

  it("filters, creates, assigns and acts on tasks", () => {
    expect(chatIntent("Montre mes tâches actives")).toEqual({
      kind: "task_filter",
      active: true,
      mine: true,
    });
    expect(chatIntent("Montre toutes les tâches du domaine")).toEqual({
      kind: "task_filter",
      active: false,
      mine: false,
    });
    expect(
      chatIntent(
        "Crée une tâche : Relire | Vérifier les délais | Passage cité | 2026-11-02",
      ),
    ).toEqual({
      kind: "task_create",
      title: "Relire",
      instructions: "Vérifier les délais",
      criteria: "Passage cité",
      due_at: "2026-11-02",
    });
    expect(chatIntent("Crée une tâche : a | b | c | d | e").kind).not.toBe(
      "task_create",
    );
    expect(chatIntent("Assigne bob : merci de reprendre")).toEqual({
      kind: "task_action",
      action: "offer",
      assignee: "bob",
      reason: "merci de reprendre",
    });
    expect(chatIntent("Soumets le résultat : Délai confirmé.")).toEqual({
      kind: "task_action",
      action: "submit",
      reason: "Délai confirmé.",
      result_summary: "Délai confirmé.",
    });
    for (const text of [
      "Vérifie l’action en attente : abc",
      "verifie l'action en attente: abc",
    ])
      expect(chatIntent(text)).toEqual({
        kind: "task_recovery_verify",
        id: "abc",
      });
  });
});

describe("shared case commands", () => {
  it("prepares a share with recipients and a known target only", () => {
    expect(
      chatIntent(
        "Prépare un partage : Délai | extrait cité | bob, carol | preuves",
      ),
    ).toEqual({
      kind: "case_prepare",
      title: "Délai",
      excerpt: "extrait cité",
      recipients: ["bob", "carol"],
      target: "retrieved_evidence",
    });
    expect(
      chatIntent("Prépare un partage : Délai | extrait | bob"),
    ).toMatchObject({
      kind: "case_prepare",
      target: "delivered_answer",
    });
    expect(
      chatIntent("Prépare un partage : Délai | extrait | bob | ailleurs").kind,
    ).not.toBe("case_prepare");
  });

  it("lists, qualifies and closes cases", () => {
    expect(chatIntent("Montre mes partages")).toEqual({
      kind: "case_list",
      scope: "mine",
    });
    expect(chatIntent("Qualifie le dossier : périmé")).toEqual({
      kind: "case_action",
      action: "qualify",
      qualification: "outdated",
    });
    expect(
      chatIntent("Clos le dossier sans changement : Rien à corriger"),
    ).toEqual({
      kind: "case_action",
      action: "close_without_change",
      public_conclusion: "Rien à corriger",
    });
  });
});

describe("expert review commands", () => {
  it("prepares an opinion from a fixed vocabulary with optional sources", () => {
    expect(
      chatIntent("Prépare un avis : à revoir | Preuve trop ancienne | s1, s2"),
    ).toEqual({
      kind: "task_opinion_prepare",
      opinion: "changes_requested",
      justification: "Preuve trop ancienne",
      sources: ["s1", "s2"],
    });
    expect(chatIntent("Prépare un avis : peut-être | hésitant").kind).not.toBe(
      "task_opinion_prepare",
    );
    expect(chatIntent("Confirme le lien")).toEqual({
      kind: "task_expert_confirm",
      linking: true,
    });
  });
});

describe("source contribution commands", () => {
  const source = "00000000-0000-4000-8000-0000000000AB";

  it("prepares an addition only with a source id, all fields and a valid start", () => {
    expect(
      chatIntent(
        `Prépare un ajout source : ${source} | Délai | 24 heures | Manquant | 120`,
      ),
    ).toEqual({
      kind: "contribution_prepare",
      source: source.toLowerCase(),
      title: "Délai",
      excerpt: "24 heures",
      reason: "Manquant",
      start: 120,
    });
    for (const text of [
      `Prépare un ajout source : pas-un-id | Délai | 24 heures | Manquant`,
      `Prépare un ajout source : ${source} | Délai |  | Manquant`,
      `Prépare un ajout source : ${source} | Délai | 24 heures | Manquant | -1`,
      `Prépare un ajout source : ${source} | Délai | 24 heures | Manquant | 01`,
      `Prépare un ajout source : ${source} | a | b | c | 1 | extra`,
    ])
      expect(chatIntent(text)).toEqual({ kind: "contribution_invalid" });
  });

  it("routes draft actions only without arguments and searches by text", () => {
    expect(chatIntent("Enregistre mon brouillon d’ajout")).toEqual({
      kind: "contribution_draft",
      action: "save",
    });
    expect(chatIntent("Enregistre mon brouillon d’ajout : texte")).toEqual({
      kind: "contribution_invalid",
    });
    expect(chatIntent(`Ouvre la source pour proposer : ${source}`)).toEqual({
      kind: "contribution_load",
      source: source.toLowerCase(),
    });
    expect(
      chatIntent("Ouvre la source pour proposer : procédure incident"),
    ).toEqual({
      kind: "contribution_source_search",
      query: "procédure incident",
    });
  });
});
