export type RecoveryScope = { tenant: string; subject: string };
export type MissionRecoveryEntry = {
  command: string;
  domain: string;
  mission: string | null;
  status: "queued" | "stopped";
  revision: number;
  started: number;
};
export const recoveryKey = "openbrain.mission-recovery.v1";
export const recoveryLifetime = 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function clearMissionRecovery() {
  try {
    storage()?.removeItem(recoveryKey);
  } catch {
    /* No private payload is stored. */
  }
}
function validEntry(v: MissionRecoveryEntry, now: number) {
  return (
    v &&
    Object.keys(v).sort().join() ===
      "command,domain,mission,revision,started,status" &&
    uuid.test(v.command) &&
    uuid.test(v.domain) &&
    (v.mission === null || uuid.test(v.mission)) &&
    ["queued", "stopped"].includes(v.status) &&
    (v.mission !== null || (v.status === "queued" && v.revision === 1)) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 1 &&
    Number.isSafeInteger(v.started) &&
    v.started > 0 &&
    v.started <= now + 30000
  );
}
export function readMissionRecovery(
  scope: RecoveryScope,
  now = Date.now(),
  resetForeign = false,
) {
  const store = storage();
  if (!store)
    return {
      entries: [] as MissionRecoveryEntry[],
      expired: 0,
      available: false,
    };
  try {
    const raw = store.getItem(recoveryKey);
    if (!raw)
      return {
        entries: [] as MissionRecoveryEntry[],
        expired: 0,
        available: true,
      };
    if (raw.length > 24000) throw new Error("invalid");
    const data = JSON.parse(raw);
    if (data.tenant !== scope.tenant || data.subject !== scope.subject) {
      if (resetForeign) store.removeItem(recoveryKey);
      return {
        entries: [] as MissionRecoveryEntry[],
        expired: 0,
        available: true,
      };
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length > 20 ||
      !data.entries.every((e: MissionRecoveryEntry) => validEntry(e, now)) ||
      new Set(data.entries.map((e: MissionRecoveryEntry) => e.command)).size !==
        data.entries.length
    )
      throw new Error("invalid");
    const entries = (data.entries as MissionRecoveryEntry[]).filter(
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
      entries: [] as MissionRecoveryEntry[],
      expired: 0,
      available: false,
    };
  }
}
export function rememberMissionRecovery(
  scope: RecoveryScope,
  entry: MissionRecoveryEntry,
) {
  const current = readMissionRecovery(scope);
  if (!current.available || !validEntry(entry, Date.now()))
    throw new Error("recovery_unavailable");
  const previous = current.entries.find((e) => e.command === entry.command);
  if (previous) {
    if (
      previous.domain !== entry.domain ||
      previous.mission !== entry.mission ||
      previous.status !== entry.status ||
      previous.revision !== entry.revision
    )
      throw new Error("recovery_conflict");
    return;
  }
  if (current.entries.length >= 20) throw new Error("recovery_full");
  // Explicit projection: never persist a caller's command body or arbitrary properties.
  const { command, domain, mission, status, revision, started } = entry;
  storage()!.setItem(
    recoveryKey,
    JSON.stringify({
      version: 1,
      tenant: scope.tenant,
      subject: scope.subject,
      entries: [
        ...current.entries,
        { command, domain, mission, status, revision, started },
      ],
    }),
  );
}
export function forgetMissionRecovery(scope: RecoveryScope, command: string) {
  const current = readMissionRecovery(scope);
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
  else clearMissionRecovery();
}
