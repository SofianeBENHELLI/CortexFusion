import { taskEventLabels } from "./taskCommands";
export type RecoveryScope = { tenant: string; subject: string };
export type TaskRecoveryEntry = {
  command: string;
  domain: string;
  task: string | null;
  action: keyof typeof taskEventLabels;
  revision: number;
  started: number;
};
export const recoveryKey = "openbrain.task-recovery.v1";
export const recoveryLifetime = 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function clearTaskRecovery() {
  try {
    storage()?.removeItem(recoveryKey);
  } catch {
    /* No private payload is stored. */
  }
}
function validEntry(v: TaskRecoveryEntry, now: number) {
  return (
    v &&
    Object.keys(v).sort().join() ===
      "action,command,domain,revision,started,task" &&
    uuid.test(v.command) &&
    uuid.test(v.domain) &&
    (v.task === null
      ? v.action === "create" && v.revision === 1
      : uuid.test(v.task)) &&
    Object.hasOwn(taskEventLabels, v.action) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 1 &&
    Number.isSafeInteger(v.started) &&
    v.started > 0 &&
    v.started <= now + 30000
  );
}
export function readTaskRecovery(
  scope: RecoveryScope,
  now = Date.now(),
  resetForeign = false,
) {
  const store = storage();
  if (!store)
    return { entries: [] as TaskRecoveryEntry[], expired: 0, available: false };
  try {
    const raw = store.getItem(recoveryKey);
    if (!raw)
      return {
        entries: [] as TaskRecoveryEntry[],
        expired: 0,
        available: true,
      };
    if (raw.length > 24000) throw new Error("invalid");
    const data = JSON.parse(raw);
    if (data.tenant !== scope.tenant || data.subject !== scope.subject) {
      if (resetForeign) store.removeItem(recoveryKey);
      return {
        entries: [] as TaskRecoveryEntry[],
        expired: 0,
        available: true,
      };
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length > 20 ||
      !data.entries.every((e: TaskRecoveryEntry) => validEntry(e, now)) ||
      new Set(data.entries.map((e: TaskRecoveryEntry) => e.command)).size !==
        data.entries.length
    )
      throw new Error("invalid");
    const entries = (data.entries as TaskRecoveryEntry[]).filter(
      (e) => now - e.started < recoveryLifetime,
    );
    return {
      entries,
      expired: data.entries.length - entries.length,
      available: true,
    };
  } catch {
    try {
      store.removeItem(recoveryKey);
    } catch {
      /* Storage may be denied. */
    }
    return { entries: [] as TaskRecoveryEntry[], expired: 0, available: false };
  }
}
export function rememberTaskRecovery(
  scope: RecoveryScope,
  entry: TaskRecoveryEntry,
) {
  const current = readTaskRecovery(scope);
  if (!current.available || !validEntry(entry, Date.now()))
    throw new Error("recovery_unavailable");
  const previous = current.entries.find((e) => e.command === entry.command);
  if (previous) {
    if (
      previous.domain !== entry.domain ||
      previous.task !== entry.task ||
      previous.action !== entry.action ||
      previous.revision !== entry.revision
    )
      throw new Error("recovery_conflict");
    return;
  }
  if (current.entries.length >= 20) throw new Error("recovery_full");
  // Explicit projection: never persist a caller's command body or arbitrary properties.
  const { command, domain, task, action, revision, started } = entry;
  storage()!.setItem(
    recoveryKey,
    JSON.stringify({
      version: 1,
      tenant: scope.tenant,
      subject: scope.subject,
      entries: [
        ...current.entries,
        { command, domain, task, action, revision, started },
      ],
    }),
  );
}
export function forgetTaskRecovery(scope: RecoveryScope, command: string) {
  const current = readTaskRecovery(scope);
  if (!current.available || !current.entries.some((e) => e.command === command))
    return;
  const entries = current.entries.filter((e) => e.command !== command);
  if (entries.length)
    storage()!.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        tenant: scope.tenant,
        subject: scope.subject,
        entries,
      }),
    );
  else clearTaskRecovery();
}
