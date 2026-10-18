import { expect, it } from "vitest";
import { taskDueAt, elapsedLabel, localDateInput } from "./workDates";
it("requires an explicit valid date and preserves timezone offset", () => {
  expect(taskDueAt("")).toBeUndefined();
  expect(taskDueAt("2026-11-01T12:30:00+02:00")).toBe(
    "2026-11-01T10:30:00.000Z",
  );
  expect(() => taskDueAt("demain")).toThrow();
  expect(() => taskDueAt("2026-10-17T24:00:00Z")).toThrow();
  expect(() => taskDueAt("2026-02-30T12:00:00+02:00")).toThrow();
  expect(() => taskDueAt("2026-02-30T12:00")).toThrow();
  const local = "2026-10-20T12:30";
  expect(localDateInput(taskDueAt(local)!)).toBe(local);
});
it("uses creation/activity dates without resetting age or inventing missing dates", () => {
  const time = Date.parse("2026-10-16T12:00:00Z");
  expect(elapsedLabel("2026-10-16T11:30:00Z", time)).toBe("30 min");
  expect(elapsedLabel("2026-10-15T12:00:00Z", time)).toBe("1 j");
  expect(elapsedLabel("bad", time)).toBe("date à vérifier");
});
