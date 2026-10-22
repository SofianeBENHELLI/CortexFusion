import { afterEach, expect, it, vi } from "vitest";
import {
  clearReviewRecovery,
  forgetReviewRecovery,
  readReviewRecovery,
  recoveryKey,
  recoveryLifetime,
  rememberReviewRecovery,
  type ReviewRecoveryEntry,
} from "./reviewRecoveryStore";
const tenant = "00000000-0000-0000-0000-000000000001",
  domain = "00000000-0000-0000-0000-000000000002",
  command = "00000000-0000-0000-0000-000000000003",
  review = "00000000-0000-0000-0000-000000000004";
const scope = { tenant, subject: "alice" };
const entry = (): ReviewRecoveryEntry => ({
  domain,
  command,
  review,
  status: "changes_requested",
  revision: 3,
  started: Date.now(),
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("preserves exact references across a new reader without a private payload", () => {
  rememberReviewRecovery(scope, entry());
  const stored = JSON.parse(sessionStorage.getItem(recoveryKey)!);
  expect(Object.keys(stored.entries[0]).sort()).toEqual([
    "command",
    "domain",
    "review",
    "revision",
    "started",
    "status",
  ]);
  expect(readReviewRecovery(scope).entries[0]).toMatchObject({
    command,
    review,
    revision: 3,
  });
  rememberReviewRecovery(scope, entry());
  expect(readReviewRecovery(scope).entries).toHaveLength(1);
  expect(() =>
    rememberReviewRecovery(scope, { ...entry(), revision: 4 }),
  ).toThrow("recovery_conflict");
  expect(() =>
    rememberReviewRecovery(scope, {
      ...entry(),
      reason: "private",
    } as ReviewRecoveryEntry),
  ).toThrow();
  forgetReviewRecovery(scope, command);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("isolates identity and tenant and clears foreign references only on verified activation", () => {
  rememberReviewRecovery(scope, entry());
  expect(readReviewRecovery({ ...scope, subject: "other" }).entries).toEqual(
    [],
  );
  expect(readReviewRecovery({ ...scope, tenant: domain }).entries).toEqual([]);
  expect(readReviewRecovery(scope).entries).toHaveLength(1);
  readReviewRecovery({ ...scope, subject: "other" }, Date.now(), true);
  expect(sessionStorage.getItem(recoveryKey)).toBeNull();
});
it("reports expiry and rejects malformed or oversized stored values", () => {
  rememberReviewRecovery(scope, entry());
  expect(
    readReviewRecovery(scope, Date.now() + recoveryLifetime),
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
  expect(readReviewRecovery(scope).available).toBe(false);
  sessionStorage.setItem(recoveryKey, "x".repeat(24001));
  expect(readReviewRecovery(scope).available).toBe(false);
});
it("does not evict unknown actions at the bound and can clear on logout", () => {
  for (let i = 0; i < 20; i++)
    rememberReviewRecovery(scope, {
      ...entry(),
      command: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
  expect(() =>
    rememberReviewRecovery(scope, {
      ...entry(),
      command: "10000000-0000-0000-0000-000000000000",
    }),
  ).toThrow("recovery_full");
  expect(readReviewRecovery(scope).entries).toHaveLength(20);
  clearReviewRecovery();
  expect(readReviewRecovery(scope).entries).toEqual([]);
});
it("fails closed if browser storage cannot retain the reference", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => rememberReviewRecovery(scope, entry())).toThrow("denied");
});
