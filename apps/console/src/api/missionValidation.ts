import type { AgentMissionEvidence } from "../../../../packages/contracts/src/AgentMissionEvidence";
import type { AgentMissionControl } from "../../../../packages/contracts/src/AgentMissionControl";
import type { AgentMissionDetail } from "../../../../packages/contracts/src/AgentMissionDetail";
import type { AgentMissionMandate } from "../../../../packages/contracts/src/AgentMissionMandate";
import type { AgentMissionReceipt } from "../../../../packages/contracts/src/AgentMissionReceipt";
import { ApiError } from "./client";
import { workId } from "./workSelection";
import type { MissionRecoveryEntry } from "./missionRecoveryStore";
export const missionLabels = {
  queued: "En attente du service",
  running: "Bail de lecture ouvert",
  stopped: "Arrêtée",
  completed: "Rapport candidat remis",
};
export const invalidMission = () => new ApiError(200, "invalid_response");
export const whole = (n: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
export const textBound = (s: string, max: number, min = 1) =>
  typeof s === "string" &&
  Array.from(s).length <= max &&
  s.trim().length >= min &&
  !s.includes("\0");
export const dateValid = (s: string) =>
  typeof s === "string" && Number.isFinite(Date.parse(s));
export const hashValid = (s: string) =>
  typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
export function validMandate(m: AgentMissionMandate): boolean {
  return (
    !!m &&
    textBound(m.title, 200) &&
    textBound(m.objective, 4000) &&
    textBound(m.criteria, 4000) &&
    textBound(m.agent, 200) &&
    workId(m.source_id) &&
    hashValid(m.source_hash) &&
    whole(m.max_reads, 1, 100) &&
    whole(m.max_chars, 1, 100000) &&
    dateValid(m.expires_at)
  );
}
export function sameMandate(a: AgentMissionMandate, b: AgentMissionMandate) {
  return (
    [
      "title",
      "objective",
      "criteria",
      "agent",
      "source_id",
      "source_hash",
      "max_reads",
      "max_chars",
    ].every(
      (k) =>
        a[k as keyof AgentMissionMandate] === b[k as keyof AgentMissionMandate],
    ) && Date.parse(a.expires_at) === Date.parse(b.expires_at)
  );
}
export function validateMission(v: AgentMissionDetail) {
  if (
    !validMandate(v) ||
    !workId(v.id) ||
    !textBound(v.author, 200) ||
    v.author === v.agent ||
    !Object.hasOwn(missionLabels, v.status) ||
    !whole(v.revision, 1) ||
    !whole(v.reads_used, 0, v.max_reads) ||
    !whole(v.chars_used, 0, v.max_chars) ||
    typeof v.expired !== "boolean" ||
    typeof v.lease_expired !== "boolean" ||
    !(v.lease_id === null || workId(v.lease_id)) ||
    !(v.lease_expires_at === null || dateValid(v.lease_expires_at)) ||
    !textBound(v.report, 8000, 0) ||
    !textBound(v.hypotheses, 2000, 0) ||
    !dateValid(v.created_at) ||
    !dateValid(v.updated_at) ||
    v.provider !== "none" ||
    v.execution !== "client_managed" ||
    !Array.isArray(v.allowed_actions) ||
    v.allowed_actions.length > 6 ||
    v.allowed_actions.some(
      (a) =>
        !["claim", "renew", "read", "complete", "stop", "resume"].includes(a),
    ) ||
    !Array.isArray(v.evidence) ||
    v.evidence.length > 10 ||
    v.evidence.some((e) => !e || !whole(e.start) || !whole(e.end, e.start + 1))
  )
    throw invalidMission();
  return v;
}
export function validateMissionReceipt(
  r: AgentMissionReceipt,
  t: MissionRecoveryEntry,
) {
  if (
    !r ||
    !workId(r.mission_id) ||
    !workId(r.event_id) ||
    (t.mission !== null && r.mission_id !== t.mission) ||
    r.revision !== t.revision ||
    r.status !== t.status ||
    !whole(r.reads_used, 0, 100) ||
    !whole(r.chars_used, 0, 100000) ||
    r.lease_id !== null ||
    r.lease_expires_at !== null
  )
    throw invalidMission();
  return r;
}

export function validateMissionControl(v: AgentMissionControl) {
  const keys = [
    "id",
    "status",
    "revision",
    "max_reads",
    "max_chars",
    "reads_used",
    "chars_used",
    "expires_at",
    "created_at",
    "expired",
    "can_stop",
    "content_withheld",
  ]
    .sort()
    .join();
  if (
    !v ||
    Object.keys(v).sort().join() !== keys ||
    !workId(v.id) ||
    !Object.hasOwn(missionLabels, v.status) ||
    !whole(v.revision, 1) ||
    !whole(v.max_reads, 1, 100) ||
    !whole(v.max_chars, 1, 100000) ||
    !whole(v.reads_used, 0, v.max_reads) ||
    !whole(v.chars_used, 0, v.max_chars) ||
    !dateValid(v.expires_at) ||
    !dateValid(v.created_at) ||
    typeof v.expired !== "boolean" ||
    v.can_stop !== ["queued", "running"].includes(v.status) ||
    v.content_withheld !== true
  )
    throw invalidMission();
  return v;
}

export function validateMissionEvidence(
  v: AgentMissionEvidence,
  m: AgentMissionDetail,
  index: number,
) {
  const span = m.evidence[index - 1];
  const keys = [
    "mission_id",
    "mission_revision",
    "index",
    "source_id",
    "source_hash",
    "title",
    "location",
    "start",
    "end",
    "total_characters",
    "excerpt",
    "read_kind",
  ]
    .sort()
    .join();
  if (
    !v ||
    !span ||
    m.status !== "completed" ||
    Object.keys(v).sort().join() !== keys ||
    v.mission_id !== m.id ||
    v.mission_revision !== m.revision ||
    v.index !== index ||
    v.source_id !== m.source_id ||
    v.source_hash !== m.source_hash ||
    v.start !== span.start ||
    v.end !== span.end ||
    !whole(v.start) ||
    !whole(v.end, v.start + 1, v.start + 8192) ||
    !whole(v.total_characters, v.end) ||
    !textBound(v.title, 1000) ||
    !textBound(v.location, 4096, 0) ||
    !textBound(v.excerpt, 8192, 0) ||
    Array.from(v.excerpt).length !== v.end - v.start ||
    v.read_kind !== "human_report_review"
  )
    throw invalidMission();
  return v;
}
