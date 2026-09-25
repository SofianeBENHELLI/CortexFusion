import { afterEach, describe, it, expect, vi } from "vitest";
import { MockGateway, seed } from "./mock";
const gateway = () =>
  new MockGateway({ state: seed(), delay: 0, storage: false });
afterEach(() => vi.restoreAllMocks());
describe("governance mock", () => {
  it("requires a decision, preserves published knowledge until a successful publication and rejects replay", async () => {
    const g = gateway();
    await expect(g.publish("PR-3082", 41)).rejects.toMatchObject({
      status: 409,
    });
    await g.decide("PR-3082", "approve", "Preuve vérifiée", 41);
    expect((await g.get()).concepts[0].relations).not.toContain("wave6");
    expect((await g.get()).version).toBe(41);
    await expect(
      g.decide("PR-3082", "approve", "Encore", 41),
    ).rejects.toMatchObject({ status: 409 });
    await g.publish("PR-3082", 41);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
    const s = await g.get();
    expect(s.version).toBe(42);
    expect(s.concepts[0].relations).toContain("wave6");
    expect(s.concepts[0].source).toBe("SRC-002");
  });
  it("failure preserves v41 and allows an explicit retry", async () => {
    const g = gateway();
    await g.decide("PR-3082", "approve", "Preuve vérifiée", 41);
    g.failPublication = true;
    await g.publish("PR-3082", 41);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 3000);
    let s = await g.get();
    expect(s.version).toBe(41);
    expect(s.proposals[1].error).toContain("DG-7f3a");
    await g.publish("PR-3082", 41);
    vi.spyOn(Date, "now").mockReturnValue(now + 6000);
    s = await g.get();
    expect(s.version).toBe(42);
  });
  it("rejects stale decisions and empty reasons", async () => {
    const g = gateway();
    await expect(g.decide("PR-3082", "reject", " ", 41)).rejects.toMatchObject({
      status: 422,
    });
    await g.decide("PR-3082", "approve", "OK", 41);
    await expect(
      g.decide("PR-3081", "approve", "OK", 41),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces simulated role restrictions in the gateway and filters admin history", async () => {
    const g = gateway();
    g.role = "viewer";
    await expect(
      g.decide("PR-3082", "approve", "OK", 41),
    ).rejects.toMatchObject({ status: 403 });
    await expect(g.correction("simulia", "wave6", "OK")).rejects.toMatchObject({
      status: 403,
    });
    expect((await g.get()).events.some((e) => e.admin)).toBe(false);
    g.role = "corpus_manager";
    await expect(g.member("Marc Petit", "owner", "OK")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("a relation correction replaces its target only after approval and publication", async () => {
    const g = gateway();
    const id = await g.correction(
      "simulia",
      "Abaqus 2026",
      "Actualiser",
      "SRC-001",
      "Abaqus",
    );
    let s = await g.get();
    expect(s.concepts[0].relations).toContain("Abaqus");
    expect(s.proposals.at(-1)?.after).not.toMatch(/Abaqus,/);
    await g.decide(id, "approve", "OK", 41);
    await g.publish(id, 41);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
    s = await g.get();
    expect(s.concepts[0].relations).not.toContain("Abaqus");
    expect(s.concepts[0].relations).toContain("Abaqus 2026");
  });
  it("negative feedback becomes a traceable signal and correction without mutating published facts", async () => {
    const g = gateway();
    await g.feedback("SIMULIA ?", "Réponse v41", "unhelpful", "Incomplet", 41);
    const s = await g.get();
    const id = await g.handleSignal(
      s.signals[0].id,
      "corrected",
      "Ajouter wave6",
      { concept: "simulia", target: "wave6", source: "SRC-002" },
    );
    const after = await g.get();
    expect(after.signals[0].proposal).toBe(id);
    expect(after.proposals.some((p) => p.id === id)).toBe(true);
    expect(after.version).toBe(41);
    await expect(
      g.handleSignal(s.signals[0].id, "done", "OK"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects unsupported imports explicitly and does not read oversized files", async () => {
    const g = gateway();
    await g.importFile(new File(["%PDF"], "scan.pdf"));
    const s = await g.get();
    expect(s.sources[0].status).toBe("refused");
    expect(s.sources[0].error).toContain("mock accepte");
    await g.importFile(new File(["a".repeat(500001)], "large.md"));
    expect((await g.get()).sources[0].error).toContain("volumineux");
  });
  it("handles simulated unavailability without performing the mutation", async () => {
    const g = gateway();
    g.offline = true;
    await expect(
      g.decide("PR-3082", "approve", "OK", 41),
    ).rejects.toMatchObject({ status: 503 });
    g.offline = false;
    expect((await g.get()).accepted).toBe(41);
  });
});
it("rejects unstructured signal corrections instead of converting the reason into a fact", async () => {
  const g = gateway();
  await expect(
    g.handleSignal("SIG-01", "corrected", "Ajouter une relation"),
  ).rejects.toMatchObject({ status: 422 });
  expect((await g.get()).proposals).toHaveLength(5);
});
it("publishes a reviewed imported concept with its name, full description and relation", async () => {
  const state = seed();
  state.sources.push({
    id: "new-source",
    name: "file.md",
    text: "Preuve fictive complète",
    status: "ready",
  });
  const g = new MockGateway({ state, delay: 0, storage: false });
  const description = "Description complète ".repeat(30);
  const id = await g.sourceProposal("new-source", {
    name: "Atelier Démo",
    description,
    target: "Découverte",
    reason: "Extrait examiné",
  });
  await g.decide(id, "approve", "Validé", 41);
  await g.publish(id, 41);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
  const c = (await g.get()).concepts.find((c) => c.name === "Atelier Démo");
  expect(c?.description).toBe(description.trim());
  expect(c?.relations).toEqual(["Découverte"]);
});
