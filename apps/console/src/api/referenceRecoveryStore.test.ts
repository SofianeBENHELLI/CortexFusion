import { afterEach, expect, it, vi } from "vitest";
import {
  clearReferenceRecovery,
  forgetReferenceRecovery,
  readReferenceRecovery,
  recoveryKey,
  recoveryLifetime,
  rememberReferenceRecovery,
  type ReferenceRecoveryEntry,
} from "./referenceRecoveryStore";
const tenant = "00000000-0000-0000-0000-000000000001",
  domain = "00000000-0000-0000-0000-000000000002",
  command = "00000000-0000-0000-0000-000000000003",
  question = "00000000-0000-0000-0000-000000000004";
const scope = { tenant, subject: "alice" };
const entry = (): ReferenceRecoveryEntry => ({
  domain,
  command,
  question,
  revision: 3,
  started: Date.now(),
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("preserves exact references across a new reader without a private payload", () => {
  rememberReferenceRecovery(scope, entry());
  const stored = JSON.parse(sessionStorage.getItem(recoveryKey)!);
  expect(Object.keys(stored.entries[0]).sort()).toEqual([
    "command",
    "domain",
    "question",
    "revision",
    "started",
  ]);
  expect(readReferenceRecovery(scope).entries[0]).toMatchObject({
    command,
    question,
    revision: 3,
  });
  rememberReferenceRecovery(scope, entry());
  expect(readReferenceRecovery(scope).entries).toHaveLength(1);
  expect(() =>
    rememberReferenceRecovery(scope, { ...entry(), revision: 4 }),
  ).toThrow("recovery_conflict");
  expect(() =>
    rememberReferenceRecovery(scope, {
      ...entry(),
      reason: "private",
    } as ReferenceRecoveryEntry),
  ).toThrow();
  forgetReferenceRecovery(scope, command);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("isolates identity and tenant and clears foreign references only on verified activation", () => {
  rememberReferenceRecovery(scope, entry());
  expect(readReferenceRecovery({ ...scope, subject: "other" }).entries).toEqual(
    [],
  );
  expect(readReferenceRecovery({ ...scope, tenant: domain }).entries).toEqual(
    [],
  );
  expect(readReferenceRecovery(scope).entries).toHaveLength(1);
  readReferenceRecovery({ ...scope, subject: "other" }, Date.now(), true);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("reports expiry and rejects malformed or oversized stored values", () => {
  rememberReferenceRecovery(scope, entry());
  expect(
    readReferenceRecovery(scope, Date.now() + recoveryLifetime),
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
  expect(readReferenceRecovery(scope).available).toBe(false);
  sessionStorage.setItem(recoveryKey, "x".repeat(24001));
  expect(readReferenceRecovery(scope).available).toBe(false);
});
it("does not evict unknown actions at the bound and can clear on logout", () => {
  for (let i = 0; i < 20; i++)
    rememberReferenceRecovery(scope, {
      ...entry(),
      command: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
  expect(() =>
    rememberReferenceRecovery(scope, {
      ...entry(),
      command: "10000000-0000-0000-0000-000000000000",
    }),
  ).toThrow("recovery_full");
  expect(readReferenceRecovery(scope).entries).toHaveLength(20);
  clearReferenceRecovery();
  expect(readReferenceRecovery(scope).entries).toEqual([]);
});
it("fails closed if browser storage cannot retain the reference", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => rememberReferenceRecovery(scope, entry())).toThrow("denied");
});
