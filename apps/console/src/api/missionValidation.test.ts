import { describe, expect, it } from "vitest";
import {
  sameMandate,
  textBound,
  validateMission,
  validateMissionControl,
  validateMissionEvidence,
  validMandate,
} from "./missionValidation";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "c".repeat(64);
const mandate = {
  title: "Relire la procédure",
  objective: "Vérifier les délais d’escalade.",
  criteria: "Citer le passage exact.",
  agent: "agent",
  source_id: id(1),
  source_hash: HASH,
  max_reads: 3,
  max_chars: 5000,
  expires_at: "2026-10-23T10:00:00Z",
};
const mission = {
  ...mandate,
  id: id(2),
  author: "alice",
  status: "completed",
  revision: 4,
  reads_used: 2,
  chars_used: 1200,
  expired: false,
  lease_expired: false,
  lease_id: null,
  lease_expires_at: null,
  report: "Le délai est confirmé.",
  hypotheses: "",
  created_at: "2026-10-22T08:00:00Z",
  updated_at: "2026-10-22T09:00:00Z",
  provider: "none",
  execution: "client_managed",
  allowed_actions: ["stop"],
  evidence: [{ start: 10, end: 20 }],
};

describe("mandates", () => {
  it("bounds text by code points and rejects NUL and blank values", () => {
    expect(textBound("🧠".repeat(200), 200)).toBe(true);
    expect(textBound("🧠".repeat(201), 200)).toBe(false);
    expect(textBound("   ", 10)).toBe(false);
    expect(textBound("", 10, 0)).toBe(true);
    expect(textBound("a\0b", 10)).toBe(false);
  });

  it("accepts a bounded mandate and compares expiry by instant, not spelling", () => {
    expect(validMandate(mandate as never)).toBe(true);
    for (const change of [
      { max_reads: 0 },
      { max_reads: 101 },
      { max_chars: 100001 },
      { source_hash: "C".repeat(64) },
      { source_id: "not-a-uuid" },
      { expires_at: "demain" },
    ])
      expect(validMandate({ ...mandate, ...change } as never)).toBe(false);
    expect(
      sameMandate(
        mandate as never,
        {
          ...mandate,
          expires_at: "2026-10-23T12:00:00+02:00",
        } as never,
      ),
    ).toBe(true);
    expect(
      sameMandate(mandate as never, { ...mandate, max_reads: 4 } as never),
    ).toBe(false);
  });
});

describe("missions", () => {
  it("rejects self-assigned agents, overspent budgets and unknown actions", () => {
    expect(validateMission(mission as never)).toBe(mission);
    for (const change of [
      { author: "agent" },
      { reads_used: 4 },
      { chars_used: 5001 },
      { allowed_actions: ["publish"] },
      { provider: "openrouter" },
      { evidence: [{ start: 5, end: 5 }] },
      { status: "approved" },
    ])
      expect(() =>
        validateMission({ ...mission, ...change } as never),
      ).toThrow();
  });

  it("keeps control views content-free and consistent with the status", () => {
    const control = {
      id: id(2),
      status: "running",
      revision: 2,
      max_reads: 3,
      max_chars: 5000,
      reads_used: 1,
      chars_used: 100,
      expires_at: mandate.expires_at,
      created_at: mission.created_at,
      expired: false,
      can_stop: true,
      content_withheld: true,
    };
    expect(validateMissionControl(control as never)).toBe(control);
    for (const change of [
      { can_stop: false },
      { content_withheld: false },
      { report: "leak" },
      { status: "completed" },
    ])
      expect(() =>
        validateMissionControl({ ...control, ...change } as never),
      ).toThrow();
  });

  it("accepts evidence only for the cited span of a completed mission", () => {
    const evidence = {
      mission_id: id(2),
      mission_revision: 4,
      index: 1,
      source_id: id(1),
      source_hash: HASH,
      title: "Procédure",
      location: "synthetic://procedure",
      start: 10,
      end: 20,
      total_characters: 400,
      excerpt: "🧠".repeat(10),
      read_kind: "human_report_review",
    };
    expect(
      validateMissionEvidence(evidence as never, mission as never, 1),
    ).toBe(evidence);
    for (const change of [
      { end: 21 },
      { excerpt: "🧠".repeat(9) },
      { mission_revision: 3 },
      { source_hash: "d".repeat(64) },
    ])
      expect(() =>
        validateMissionEvidence(
          { ...evidence, ...change } as never,
          mission as never,
          1,
        ),
      ).toThrow();
    expect(() =>
      validateMissionEvidence(
        evidence as never,
        { ...mission, status: "running" } as never,
        1,
      ),
    ).toThrow();
    expect(() =>
      validateMissionEvidence(evidence as never, mission as never, 2),
    ).toThrow();
  });
});
