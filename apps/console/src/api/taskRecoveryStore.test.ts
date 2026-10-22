import { afterEach, expect, it, vi } from "vitest";
import {
  clearTaskRecovery,
  forgetTaskRecovery,
  readTaskRecovery,
  recoveryKey,
  recoveryLifetime,
  rememberTaskRecovery,
  type TaskRecoveryEntry,
} from "./taskRecoveryStore";
const tenant = "00000000-0000-0000-0000-000000000001",
  domain = "00000000-0000-0000-0000-000000000002",
  command = "00000000-0000-0000-0000-000000000003",
  task = "00000000-0000-0000-0000-000000000004";
const scope = { tenant, subject: "alice" };
const entry = (): TaskRecoveryEntry => ({
  domain,
  command,
  task,
  action: "accept",
  revision: 3,
  started: Date.now(),
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("preserves exact references across a new reader without a private payload", () => {
  rememberTaskRecovery(scope, entry());
  const stored = JSON.parse(sessionStorage.getItem(recoveryKey)!);
  expect(Object.keys(stored.entries[0]).sort()).toEqual([
    "action",
    "command",
    "domain",
    "revision",
    "started",
    "task",
  ]);
  expect(readTaskRecovery(scope).entries[0]).toMatchObject({
    command,
    task,
    revision: 3,
  });
  rememberTaskRecovery(scope, entry());
  expect(readTaskRecovery(scope).entries).toHaveLength(1);
  expect(() =>
    rememberTaskRecovery(scope, { ...entry(), revision: 4 }),
  ).toThrow("recovery_conflict");
  expect(() =>
    rememberTaskRecovery(scope, {
      ...entry(),
      reason: "private",
    } as TaskRecoveryEntry),
  ).toThrow();
  forgetTaskRecovery(scope, command);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("isolates identity and tenant and clears foreign references only on verified activation", () => {
  rememberTaskRecovery(scope, entry());
  expect(readTaskRecovery({ ...scope, subject: "other" }).entries).toEqual([]);
  expect(readTaskRecovery({ ...scope, tenant: domain }).entries).toEqual([]);
  expect(readTaskRecovery(scope).entries).toHaveLength(1);
  readTaskRecovery({ ...scope, subject: "other" }, Date.now(), true);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("reports expiry and rejects malformed or oversized stored values", () => {
  rememberTaskRecovery(scope, entry());
  expect(readTaskRecovery(scope, Date.now() + recoveryLifetime)).toMatchObject({
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
  expect(readTaskRecovery(scope).available).toBe(false);
  sessionStorage.setItem(recoveryKey, "x".repeat(24001));
  expect(readTaskRecovery(scope).available).toBe(false);
});
it("does not evict unknown actions at the bound and can clear on logout", () => {
  for (let i = 0; i < 20; i++)
    rememberTaskRecovery(scope, {
      ...entry(),
      command: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
  expect(() =>
    rememberTaskRecovery(scope, {
      ...entry(),
      command: "10000000-0000-0000-0000-000000000000",
    }),
  ).toThrow("recovery_full");
  expect(readTaskRecovery(scope).entries).toHaveLength(20);
  clearTaskRecovery();
  expect(readTaskRecovery(scope).entries).toEqual([]);
});
it("fails closed if browser storage cannot retain the reference", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => rememberTaskRecovery(scope, entry())).toThrow("denied");
});
