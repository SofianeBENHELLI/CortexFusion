import { afterEach, expect, it, vi } from "vitest";
import {
  clearMissionRecovery,
  forgetMissionRecovery,
  readMissionRecovery,
  recoveryKey,
  recoveryLifetime,
  rememberMissionRecovery,
  type MissionRecoveryEntry,
} from "./missionRecoveryStore";
const tenant = "00000000-0000-0000-0000-000000000001",
  domain = "00000000-0000-0000-0000-000000000002",
  command = "00000000-0000-0000-0000-000000000003",
  mission = "00000000-0000-0000-0000-000000000004";
const scope = { tenant, subject: "alice" };
const entry = (): MissionRecoveryEntry => ({
  domain,
  command,
  mission,
  status: "stopped",
  revision: 3,
  started: Date.now(),
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("preserves exact references across a new reader without a private payload", () => {
  rememberMissionRecovery(scope, entry());
  const stored = JSON.parse(sessionStorage.getItem(recoveryKey)!);
  expect(Object.keys(stored.entries[0]).sort()).toEqual([
    "command",
    "domain",
    "mission",
    "revision",
    "started",
    "status",
  ]);
  expect(readMissionRecovery(scope).entries[0]).toMatchObject({
    command,
    mission,
    revision: 3,
  });
  rememberMissionRecovery(scope, entry());
  expect(readMissionRecovery(scope).entries).toHaveLength(1);
  expect(() =>
    rememberMissionRecovery(scope, { ...entry(), revision: 4 }),
  ).toThrow("recovery_conflict");
  expect(() =>
    rememberMissionRecovery(scope, {
      ...entry(),
      reason: "private",
    } as MissionRecoveryEntry),
  ).toThrow();
  forgetMissionRecovery(scope, command);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("isolates identity and tenant and clears foreign references only on verified activation", () => {
  rememberMissionRecovery(scope, entry());
  expect(readMissionRecovery({ ...scope, subject: "other" }).entries).toEqual(
    [],
  );
  expect(readMissionRecovery({ ...scope, tenant: domain }).entries).toEqual([]);
  expect(readMissionRecovery(scope).entries).toHaveLength(1);
  readMissionRecovery({ ...scope, subject: "other" }, Date.now(), true);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("reports expiry and rejects malformed or oversized stored values", () => {
  rememberMissionRecovery(scope, entry());
  expect(
    readMissionRecovery(scope, Date.now() + recoveryLifetime),
  ).toMatchObject({
    entries: [],
    expired: 1,
  });
  sessionStorage.setItem(
    recoveryKey,
    JSON.stringify({
      version: 1,
      ...scope,
      entries: [{ ...entry(), revision: -1 }],
    }),
  );
  expect(readMissionRecovery(scope).available).toBe(false);
  sessionStorage.setItem(recoveryKey, "x".repeat(24001));
  expect(readMissionRecovery(scope).available).toBe(false);
});
it("does not evict unknown actions at the bound and can clear on logout", () => {
  for (let i = 0; i < 20; i++)
    rememberMissionRecovery(scope, {
      ...entry(),
      command: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
  expect(() =>
    rememberMissionRecovery(scope, {
      ...entry(),
      command: "10000000-0000-0000-0000-000000000000",
    }),
  ).toThrow("recovery_full");
  expect(readMissionRecovery(scope).entries).toHaveLength(20);
  clearMissionRecovery();
  expect(readMissionRecovery(scope).entries).toEqual([]);
});
it("fails closed if browser storage cannot retain the reference", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => rememberMissionRecovery(scope, entry())).toThrow("denied");
});
