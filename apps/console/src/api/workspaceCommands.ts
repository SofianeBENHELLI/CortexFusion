import { guideIntent, type GuideIntent } from "./guideCommands";
import { activityIntent, type ActivityIntent } from "./activityCommands";
import { missionIntent, type MissionIntent } from "./missionCommands";
import {
  referenceReviewIntent,
  type ReferenceReviewIntent,
} from "./referenceReviewCommands";
import { referenceIntent, type ReferenceIntent } from "./referenceCommands";
import { decisionIntent, type DecisionIntent } from "./decisionCommands";
import {
  contributionIntent,
  type ContributionIntent,
} from "./contributionCommands";
import { importChatIntent, type ImportChatIntent } from "./importCommands";
import { caseChatIntent, type CaseChatIntent } from "./caseCommands";
import { taskChatIntent, type TaskChatIntent } from "./taskCommands";
import { workId } from "./workSelection";
/** Bounded, explicit chat intents. This is not a general language-model agent.
 * Only user input reaches this interpreter; answers and source text never do.
 * Operations below reuse the native HTTP/MCP business operations, not a second API.
 */
export const workspaceCommands = {
  guides: {
    label: "Utiliser mon chatbot",
    operation: "companion_guides.list",
    capability: "companion_guides",
  },
  activity: {
    label: "Boîte de réception",
    operation: "work_activity.list",
    capability: "work_activity",
    effect: "read",
  },
  missions: {
    label: "Missions d’agents",
    operation: "agent_missions.list",
    capability: "agent_missions",
    effect: "read",
  },
  referenceReviews: {
    label: "Revues de référence",
    operation: "reference_reviews.list",
    capability: "reference_reviews",
    effect: "read",
  },
  references: {
    label: "Questions de référence",
    operation: "reference_drafts.list",
    capability: "reference_drafts",
    effect: "read",
  },
  cases: {
    label: "Dossiers partagés",
    operation: "cases.list",
    capability: "shared_cases",
    effect: "read",
  },
  tasks: {
    label: "Mes tâches",
    operation: "tasks.list",
    capability: "work_tasks",
    effect: "read",
  },
  sources: {
    label: "Preuves de la réponse",
    operation: "sources.read",
    capability: "inspect",
    effect: "read",
  },
  issues: {
    label: "Mes signalements",
    operation: "issues.list",
    capability: "personal_issues",
    effect: "read",
  },
  proposals: {
    label: "Propositions",
    operation: "proposals.list",
    capability: "read_proposals",
    effect: "read",
  },
  imports: {
    label: "Mes imports",
    operation: "imports.list",
    capability: "personal_history",
    effect: "read",
  },
  feedback: {
    label: "Donner mon avis",
    operation: "episodes.feedback",
    capability: "feedback",
    effect: "personal",
  },
} as const;
export type DossierCommand = Exclude<
  keyof typeof workspaceCommands,
  "feedback"
>;
export type ChatIntent =
  | {
      kind: "source_read";
      index: number;
      action: "proof" | "full" | "next" | "previous" | "close";
    }
  | GuideIntent
  | ActivityIntent
  | MissionIntent
  | ReferenceReviewIntent
  | ReferenceIntent
  | DecisionIntent
  | ContributionIntent
  | ImportChatIntent
  | CaseChatIntent
  | TaskChatIntent
  | {
      kind: "work_brief";
      scope: "assigned" | "domain";
      section?:
        | "tasks"
        | "received"
        | "imports"
        | "mine"
        | "reviews"
        | "sentReviews"
        | "missions";
    }
  | { kind: "proposal_select"; id: string }
  | { kind: "dossier"; dossier: DossierCommand }
  | { kind: "feedback"; rating: "helpful" | "unhelpful"; comment: string }
  | { kind: "confirm_feedback" }
  | { kind: "cancel_feedback" }
  | { kind: "unsupported" }
  | { kind: "save_draft"; text: string }
  | { kind: "inspect_draft" }
  | { kind: "apply_draft" }
  | { kind: "question" };
const normalize = (text: string) =>
  text
    .replace(/[’‘]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export function chatIntent(input: string): ChatIntent {
  const source = input.split(":");
  const sourceActions = {
    "lis la preuve": "proof",
    "lis la source": "full",
    "passage source suivant": "next",
    "passage source precedent": "previous",
    "ferme la lecture source": "close",
    "reviens au passage cite": "proof",
  } as const;
  const sourceAction =
    sourceActions[normalize(source[0]) as keyof typeof sourceActions];
  if (sourceAction)
    return source.length === 2 && /^[1-9][0-9]?$/.test(source[1].trim())
      ? {
          kind: "source_read",
          index: Number(source[1].trim()),
          action: sourceAction,
        }
      : { kind: "unsupported" };
  const guide = guideIntent(input);
  if (guide) return guide;
  const activity = activityIntent(input);
  if (activity) return activity;
  const mission = missionIntent(input);
  if (mission) return mission;
  const review = referenceReviewIntent(input);
  if (review) return review;
  const reference = referenceIntent(input);
  if (reference) return reference;
  const contribution = contributionIntent(input);
  if (contribution) return contribution;
  const importIntent = importChatIntent(input);
  if (importIntent) return importIntent;
  const separator = input.indexOf(":");
  const head = separator < 0 ? input : input.slice(0, separator);
  const comment = separator < 0 ? "" : input.slice(separator + 1).trim();
  const value = normalize(head)
    .replace(/[.!?]+$/, "")
    .trim();
  const decision = decisionIntent(value, comment);
  if (decision) return decision;
  if (
    /^prepare (?:l.approbation|la publication|le rejet|le report|une demande de correction|la reouverture)\b/.test(
      value,
    )
  )
    return { kind: "unsupported" };
  if (
    ["ouvre la proposition", "montre les avis de la proposition"].includes(
      value,
    )
  ) {
    return workId(comment)
      ? { kind: "proposal_select", id: comment.toLowerCase() }
      : { kind: "unsupported" };
  }
  if (
    separator < 0 &&
    [
      "que dois-je faire",
      "que dois je faire",
      "montre mon brief",
      "actualise mon brief",
      "mes priorites",
      "mon prochain pas",
    ].includes(value)
  )
    return { kind: "work_brief", scope: "assigned" };
  if (
    separator < 0 &&
    ["montre le brief du domaine", "actualise le brief du domaine"].includes(
      value,
    )
  )
    return { kind: "work_brief", scope: "domain" };
  const briefSections = {
    "montre le suivi de mes missions": "missions",
    "montre mes revues a traiter": "reviews",
    "montre le suivi de mes revues": "sentReviews",
    "montre mes dossiers a traiter": "received",
    "montre mes imports a traiter": "imports",
    "montre le suivi de mes partages": "mine",
  } as const;
  if (separator < 0 && Object.hasOwn(briefSections, value))
    return {
      kind: "work_brief",
      scope: "assigned",
      section: briefSections[value as keyof typeof briefSections],
    };
  const sharedCase = caseChatIntent(value, comment);
  if (sharedCase) return sharedCase;
  const task = taskChatIntent(head, value, comment);
  if (task) return task;
  if (
    [
      "enregistre ce brouillon",
      "enregistrer ce brouillon",
      "/brouillon",
    ].includes(value)
  )
    return separator >= 0
      ? { kind: "save_draft", text: comment }
      : { kind: "unsupported" };
  if (
    [
      "reprends mon brouillon",
      "montre mon brouillon",
      "/voir-brouillon",
    ].includes(value)
  )
    return { kind: "inspect_draft" };
  if (
    ["utilise le brouillon enregistre", "/utiliser-brouillon"].includes(value)
  )
    return { kind: "apply_draft" };
  if (
    ["confirme le retour", "confirmer le retour", "/confirmer-retour"].includes(
      value,
    )
  )
    return { kind: "confirm_feedback" };
  if (
    ["annule le retour", "annuler le retour", "/annuler-retour"].includes(value)
  )
    return { kind: "cancel_feedback" };
  if (
    [
      "/utile",
      "cette reponse est utile",
      "la derniere reponse est utile",
    ].includes(value)
  )
    return { kind: "feedback", rating: "helpful", comment };
  if (
    [
      "/ameliorer",
      "cette reponse est a ameliorer",
      "cette reponse est incorrecte",
      "je ne suis pas d'accord avec cette reponse",
    ].includes(value)
  )
    return { kind: "feedback", rating: "unhelpful", comment };
  const target = value
    .replace(/^(?:ouvre|affiche|montre|voir)(?:-moi| moi)? /, "")
    .replace(/^(?:les|mes|des|le|la) /, "");
  const aliases: Record<string, DossierCommand> = {
    preuves: "sources",
    sources: "sources",
    "preuves de la reponse": "sources",
    "/preuves": "sources",
    signalements: "issues",
    "/signalements": "issues",
    propositions: "proposals",
    "/propositions": "proposals",
    taches: "tasks",
    "/taches": "tasks",
    "dossiers partages": "cases",
    imports: "imports",
    "/imports": "imports",
  };
  if (separator < 0 && Object.hasOwn(aliases, target))
    return { kind: "dossier", dossier: aliases[target] };
  // Do not turn a rejected action into a knowledge query or fabricate an effect.
  if (
    /^(?:\/|publie\b|approuve\b|supprime\b|delegue\b|assigne\b|importe\b|corrige\b|prepare un partage\b|prepare un avis\b|lie la proposition\b|lie une tache\b|delie la tache\b|(?:cree|prepare) une tache\b|confirme\b|annule\b)/.test(
      value,
    )
  )
    return { kind: "unsupported" };
  return { kind: "question" };
}
