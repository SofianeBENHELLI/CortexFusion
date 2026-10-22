import { describe, expect, it } from "vitest";
import { chatIntent } from "./workspaceCommands";
describe("bounded user intent routing", () => {
  it.each([
    ["Montre mes signalements", "issues"],
    ["Ouvre les propositions.", "proposals"],
    ["/imports", "imports"],
    ["Affiche-moi les preuves de la réponse", "sources"],
  ])("routes %s to %s", (input, dossier) =>
    expect(chatIntent(input)).toEqual({ kind: "dossier", dossier }),
  );
  it("keeps original feedback text and punctuation without executing it", () =>
    expect(
      chatIntent(
        "Cette réponse est à améliorer : Le point 2 est faux : voir la source.",
      ),
    ).toEqual({
      kind: "feedback",
      rating: "unhelpful",
      comment: "Le point 2 est faux : voir la source.",
    }));
  it.each([
    "Ne publie pas",
    "Pourquoi cette réponse est utile ?",
    "Comment importer un document ?",
    "Les sources : que disent-elles ?",
  ])("keeps an ordinary question as a question: %s", (input) =>
    expect(chatIntent(input).kind).toBe("question"),
  );
  it.each([
    "Publie cette proposition",
    "/inconnu",
    "Approuve tout",
    "Assigne cette tâche",
  ])("never fabricates unsupported effects: %s", (input) =>
    expect(chatIntent(input).kind).toBe("unsupported"),
  );
  it("does not treat a bare agreement as authorization", () =>
    expect(chatIntent("oui").kind).toBe("question"));
});

it("distinguishes explicit draft payload from a question and never infers a save", () => {
  expect(
    chatIntent("enregistre ce brouillon : Ma question : détaillée"),
  ).toEqual({ kind: "save_draft", text: "Ma question : détaillée" });
  expect(chatIntent("enregistre ce brouillon")).toEqual({
    kind: "unsupported",
  });
  expect(chatIntent("Qu’est-ce qu’un brouillon ?")).toEqual({
    kind: "question",
  });
  expect(chatIntent("reprends mon brouillon")).toEqual({
    kind: "inspect_draft",
  });
  expect(chatIntent("utilise le brouillon enregistré")).toEqual({
    kind: "apply_draft",
  });
});

it("prepares task intents without confusing a task decision and personal feedback", () => {
  expect(
    chatIntent(
      "crée une tâche : Relire | Contrôler les sources | Un avis motivé",
    ),
  ).toEqual({
    kind: "task_create",
    title: "Relire",
    instructions: "Contrôler les sources",
    criteria: "Un avis motivé",
  });
  expect(chatIntent("assigne reader : Expert disponible")).toEqual({
    kind: "task_action",
    action: "offer",
    assignee: "reader",
    reason: "Expert disponible",
  });
  expect(chatIntent("confirme la tâche")).toEqual({ kind: "task_confirm" });
  expect(chatIntent("confirme le retour")).toEqual({
    kind: "confirm_feedback",
  });
  expect(chatIntent("accepte la tâche : Je prends cette revue")).toEqual({
    kind: "task_action",
    action: "accept",
    reason: "Je prends cette revue",
  });
});

it("routes personal activity, scope and deadlines through task intents", () => {
  expect(chatIntent("montre mon activité")).toEqual({
    kind: "task_notifications",
  });
  expect(chatIntent("montre mes tâches actives")).toEqual({
    kind: "task_filter",
    active: true,
    mine: true,
  });
  expect(chatIntent("marque la notification comme lue : test")).toEqual({
    kind: "task_notification_read",
    id: "test",
  });
  expect(
    chatIntent(
      "crée une tâche : Titre | Consigne | Critères | 2026-11-01T12:30:00Z",
    ),
  ).toMatchObject({ kind: "task_create", due_at: "2026-11-01T12:30:00Z" });
});

it("opens explicit proposal UUIDs and rejects unqualified navigation text", () => {
  const id = "00000000-0000-0000-0000-000000000001";
  expect(chatIntent(`ouvre la proposition : ${id}`)).toEqual({
    kind: "proposal_select",
    id,
  });
  expect(chatIntent(`montre les avis de la proposition : ${id}`)).toEqual({
    kind: "proposal_select",
    id,
  });
  expect(chatIntent("ouvre la proposition : approuve ceci")).toEqual({
    kind: "unsupported",
  });
});

it("routes operational home categories without a knowledge query or implicit action", () => {
  for (const [input, section] of [
    ["Montre mes dossiers à traiter", "received"],
    ["Montre mes imports à traiter", "imports"],
    ["Montre le suivi de mes partages", "mine"],
  ])
    expect(chatIntent(input)).toEqual({
      kind: "work_brief",
      scope: "assigned",
      section,
    });
});

it("requires an explicit priority, deadline choice and planning reason", () => {
  expect(
    chatIntent("planifie la tâche : haute | sans | revue convenue"),
  ).toEqual({
    kind: "task_plan",
    priority: "high",
    due: "",
    reason: "revue convenue",
  });
  expect(
    chatIntent(
      "planifie la tâche : normale | 2026-11-01T12:00:00Z | après concertation",
    ),
  ).toMatchObject({ kind: "task_plan", priority: "normal" });
  expect(chatIntent("planifie la tâche : haute")).toEqual({
    kind: "task_plan_invalid",
  });
});

it("routes recovery reads and explicit local forgetting without a task mutation", () => {
  expect(chatIntent("vérifie l’action en attente : abc")).toEqual({
    kind: "task_recovery_verify",
    id: "abc",
  });
  expect(chatIntent("retire la référence locale : abc")).toEqual({
    kind: "task_recovery_forget",
    id: "abc",
  });
});

it("opens the exact review brief sections with bounded chat phrases", () => {
  expect(chatIntent("Montre mes revues à traiter")).toEqual({
    kind: "work_brief",
    scope: "assigned",
    section: "reviews",
  });
  expect(chatIntent("Montre le suivi de mes revues")).toEqual({
    kind: "work_brief",
    scope: "assigned",
    section: "sentReviews",
  });
});

it("opens the personal mission overview with a bounded chat command", () => {
  expect(chatIntent("Montre le suivi de mes missions")).toEqual({
    kind: "work_brief",
    scope: "assigned",
    section: "missions",
  });
});
