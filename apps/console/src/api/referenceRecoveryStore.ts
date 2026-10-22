import { uuid } from "./uuid";

export type RecoveryScope = { tenant: string; subject: string };
export type ReferenceRecoveryEntry = {
  command: string;
  domain: string;
  question: string;
  revision: number;
  started: number;
};
export const recoveryKey = "openbrain.reference-recovery.v1";
export const recoveryLifetime = 24 * 60 * 60 * 1000;
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function clearReferenceRecovery() {
  try {
    storage()?.removeItem(recoveryKey);
  } catch {
    /* No private payload is stored. */
  }
}
function validEntry(v: ReferenceRecoveryEntry, now: number) {
  return (
    v &&
    Object.keys(v).sort().join() ===
      "command,domain,question,revision,started" &&
    uuid.test(v.command) &&
    uuid.test(v.domain) &&
    uuid.test(v.question) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 1 &&
    Number.isSafeInteger(v.started) &&
    v.started > 0 &&
    v.started <= now + 30000
  );
}
export function readReferenceRecovery(
  scope: RecoveryScope,
  now = Date.now(),
  resetForeign = false,
) {
  const store = storage();
  if (!store)
    return {
      entries: [] as ReferenceRecoveryEntry[],
      expired: 0,
      available: false,
    };
  try {
    const raw = store.getItem(recoveryKey);
    if (!raw)
      return {
        entries: [] as ReferenceRecoveryEntry[],
        expired: 0,
        available: true,
      };
    if (raw.length > 24000) throw new Error("invalid");
    const data = JSON.parse(raw);
    if (data.tenant !== scope.tenant || data.subject !== scope.subject) {
      if (resetForeign) store.removeItem(recoveryKey);
      return {
        entries: [] as ReferenceRecoveryEntry[],
        expired: 0,
        available: true,
      };
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length > 20 ||
      !data.entries.every((e: ReferenceRecoveryEntry) => validEntry(e, now)) ||
      new Set(data.entries.map((e: ReferenceRecoveryEntry) => e.command))
        .size !== data.entries.length
    )
      throw new Error("invalid");
    const entries = (data.entries as ReferenceRecoveryEntry[]).filter(
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
    return {
      entries: [] as ReferenceRecoveryEntry[],
      expired: 0,
      available: false,
    };
  }
}
export function rememberReferenceRecovery(
  scope: RecoveryScope,
  entry: ReferenceRecoveryEntry,
) {
  const current = readReferenceRecovery(scope);
  if (!current.available || !validEntry(entry, Date.now()))
    throw new Error("recovery_unavailable");
  const previous = current.entries.find((e) => e.command === entry.command);
  if (previous) {
    if (
      previous.domain !== entry.domain ||
      previous.question !== entry.question ||
      previous.revision !== entry.revision
    )
      throw new Error("recovery_conflict");
    return;
  }
  if (current.entries.length >= 20) throw new Error("recovery_full");
  // Explicit projection: never persist a caller's command body or arbitrary properties.
  const { command, domain, question, revision, started } = entry;
  storage()!.setItem(
    recoveryKey,
    JSON.stringify({
      version: 1,
      tenant: scope.tenant,
      subject: scope.subject,
      entries: [
        ...current.entries,
        { command, domain, question, revision, started },
      ],
    }),
  );
}
export function forgetReferenceRecovery(scope: RecoveryScope, command: string) {
  const current = readReferenceRecovery(scope);
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
  else clearReferenceRecovery();
}
