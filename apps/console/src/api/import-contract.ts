import type { ImportView } from "../../../../packages/contracts/src/ImportView";
import type { ImportPage } from "../../../../packages/contracts/src/ImportPage";
import { ApiError } from "./client";

export const importLabels = {
  pending: "En attente",
  partial: "Partiellement traité",
  succeeded: "Import terminé",
  failed: "Échec",
  cancelled: "Annulé",
} as const;
export const itemLabels = {
  pending: "En attente",
  succeeded: "Source disponible",
  failed: "Échec",
  cancelled: "Annulé",
} as const;
export const importId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
const invalid = () => new ApiError(200, "invalid_response");

export function validateImport(job: ImportView, expected?: string): ImportView {
  if (
    !job ||
    !importId(job.id) ||
    (expected && job.id !== expected) ||
    !importId(job.collection_id) ||
    !Object.hasOwn(importLabels, job.status) ||
    (job.processing !== undefined && job.processing !== "local_text_only") ||
    !Array.isArray(job.items) ||
    job.items.length < 1 ||
    job.items.length > 20
  )
    throw invalid();
  job.items.forEach((item, position) => {
    if (
      !item ||
      item.position !== position ||
      typeof item.filename !== "string" ||
      !item.filename ||
      Array.from(item.filename).length > 200 ||
      /[/\\\x00-\x1f]/.test(item.filename) ||
      !Object.hasOwn(itemLabels, item.status) ||
      !Number.isSafeInteger(item.attempts) ||
      item.attempts < 0 ||
      !(item.source_id === null || importId(item.source_id)) ||
      !(
        item.error_code === null ||
        (typeof item.error_code === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(item.error_code))
      ) ||
      (item.status === "succeeded"
        ? !item.source_id || item.error_code !== null || item.attempts < 1
        : item.source_id !== null) ||
      (item.status === "failed" &&
        (item.error_code === null || item.attempts < 1))
    )
      throw invalid();
  });
  const states = new Set(job.items.map((i) => i.status));
  const expectedStatus =
    states.size === 1 && !states.has("cancelled")
      ? job.items[0].status
      : "partial";
  if (job.status !== "cancelled" && job.status !== expectedStatus)
    throw invalid();
  if (job.status === "cancelled" && states.has("pending")) throw invalid();
  return job;
}

export function validateImportPage(page: ImportPage, after = ""): ImportPage {
  if (
    !page ||
    !Array.isArray(page.items) ||
    page.items.length > 10 ||
    !(page.next_after === null || importId(page.next_after))
  )
    throw invalid();
  let previous = after;
  for (const item of page.items) {
    validateImport(item);
    if (item.id <= previous) throw invalid();
    previous = item.id;
  }
  if (
    page.next_after !== null &&
    (!page.items.length || page.next_after !== previous)
  )
    throw invalid();
  return page;
}

export function importProgress(job: ImportView) {
  const total = job.items.length;
  const count = (status: string) =>
    job.items.filter((i) => i.status === status).length;
  return `${count("succeeded")} fichier(s) traité(s) sur ${total} · ${count("pending")} en attente · ${count("failed")} en échec · ${count("cancelled")} annulé(s)`;
}
