import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentMissionWorkspace,
  type MissionActions,
} from "./AgentMissionWorkspace";
import { ApiError, type CortexApi } from "./client";
import { chatIntent } from "./workspaceCommands";
import type { MissionIntent } from "./missionCommands";
import { readMissionRecovery, recoveryKey } from "./missionRecoveryStore";
const domain = "00000000-0000-0000-0000-000000000001",
  mid = "00000000-0000-0000-0000-000000000002",
  sid = "00000000-0000-0000-0000-000000000003",
  pid = "00000000-0000-0000-0000-000000000004",
  eid = "00000000-0000-0000-0000-000000000005";
const scope = { tenant: domain, subject: "alice" };
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function setup(coordinate = true) {
  const state = {
    denied: false,
    sourceDenied: false,
    sourcePassageOverride: {} as Record<string, unknown>,
    controlExtra: false,
    evidenceOverride: {} as Record<string, unknown>,
    error: undefined as unknown,
    receiptError: undefined as unknown,
    prepareMismatch: false,
    malformed: false,
    expiry: Date.now() + 300000,
    posts: [] as { op: string; body: any }[],
    mission: {
      id: mid,
      title: "Mission de recette",
      objective: "Relire un délai",
      criteria: "Citer la durée",
      agent: "task-agent",
      source_id: sid,
      source_hash: "a".repeat(64),
      max_reads: 10,
      max_chars: 20000,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      author: "alice",
      status: "queued",
      revision: 1,
      reads_used: 0,
      chars_used: 0,
      expired: false,
      lease_expired: false,
      lease_id: null,
      lease_expires_at: null,
      report: "",
      hypotheses: "",
      evidence: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowed_actions: ["stop"],
      provider: "none",
      execution: "client_managed",
    } as any,
  };
  const receipt = (body: any) => ({
    mission_id: state.malformed ? sid : mid,
    event_id: eid,
    revision: body.expected_revision ? body.expected_revision + 1 : 1,
    status: body.action === "stop" ? "stopped" : "queued",
    reads_used: 0,
    chars_used: 0,
    lease_id: null,
    lease_expires_at: null,
  });
  const call = vi.fn(async (op: string, p: any, b: any): Promise<unknown> => {
    if (op === "identity.read")
      return {
        tenant_id: domain,
        subject: "alice",
        domains: [
          {
            id: domain,
            capabilities: state.denied
              ? []
              : coordinate
                ? ["agent_missions", "coordinate_missions"]
                : ["agent_missions"],
          },
        ],
      };
    if (op === "sources.list")
      return {
        items: [
          {
            id: sid,
            title: "Source synthétique",
            location: "fixture",
            content_hash: "a".repeat(64),
            allowed_subjects: ["alice", "task-agent"],
          },
        ],
        next_after: null,
      };
    if (op === "sources.passage") {
      if (state.sourceDenied) throw new ApiError(404, "denied");
      return {
        source_id: sid,
        title: "Source synthétique",
        location: "synthetic://mission-selection",
        content_hash: "a".repeat(64),
        start: 0,
        end: 1,
        excerpt: "🧠",
        total_characters: 200000,
        next_offset: 1,
        offset_unit: "unicode_code_point",
        ...state.sourcePassageOverride,
      };
    }
    if (op === "agent_missions.candidates")
      return { items: [{ subject: "task-agent" }], next_after: null };
    if (op === "agent_missions.list")
      return { items: [state.mission], next_after: null };
    if (op === "agent_missions.evidence") {
      if (state.denied || state.sourceDenied) throw new ApiError(404, "denied");
      return {
        mission_id: mid,
        mission_revision: state.mission.revision,
        index: 1,
        source_id: sid,
        source_hash: "a".repeat(64),
        title: "Preuve synthétique",
        location: "synthetic://proof",
        start: 100,
        end: 104,
        total_characters: 104,
        excerpt: "A🧠é",
        read_kind: "human_report_review",
        ...state.evidenceOverride,
      };
    }
    if (op === "agent_missions.read") {
      if (state.denied || state.sourceDenied) throw new ApiError(404, "denied");
      return structuredClone(state.mission);
    }
    if (op === "agent_missions.control" || op === "agent_missions.controls") {
      const v = state.mission,
        c = {
          id: v.id,
          status: v.status,
          revision: v.revision,
          max_reads: v.max_reads,
          max_chars: v.max_chars,
          reads_used: v.reads_used,
          chars_used: v.chars_used,
          expires_at: v.expires_at,
          created_at: v.created_at,
          expired: v.expired,
          can_stop: ["queued", "running"].includes(v.status),
          content_withheld: true,
          ...(state.controlExtra ? { report: "must not display" } : {}),
        };
      return op.endsWith("controls") ? { items: [c], next_after: null } : c;
    }
    if (op === "agent_missions.prepare")
      return {
        preparation_id: pid,
        mandate: {
          ...b,
          title: state.prepareMismatch ? "Mauvais titre" : b.title,
        },
        source: {
          id: sid,
          title: "Source synthétique",
          content_hash: "a".repeat(64),
          characters: 100,
        },
        expires_at: new Date(state.expiry).toISOString(),
        provider: "none",
        execution: "client_managed",
      };
    if (op === "agent_missions.create" || op === "agent_missions.command") {
      state.posts.push({ op, body: b });
      if (state.error) throw state.error;
      return receipt(b);
    }
    if (op === "agent_missions.receipt") {
      if (state.receiptError) throw state.receiptError;
      return {
        command_id: p.command,
        receipt: receipt(state.posts.at(-1)!.body),
      };
    }
    if (op === "agent_missions.events")
      return {
        mission_id: mid,
        current_revision: 1,
        items: [
          {
            id: eid,
            actor: "alice",
            action: "create",
            revision: 1,
            status: "queued",
            reads_used: 0,
            chars_used: 0,
            start: null,
            end: null,
            reason: "",
            created_at: new Date().toISOString(),
          },
        ],
        next_after: null,
      };
    throw Error(op);
  });
  const ref = createRef<MissionActions>();
  const props = {
    ref,
    api: { call } as unknown as CortexApi,
    domain,
    onNotice: vi.fn(),
    recoveryScope: scope,
    canCoordinate: coordinate,
  };
  let view = render(<AgentMissionWorkspace {...props} />);
  async function command(text: string) {
    let result = "";
    await act(async () => {
      result = await ref.current!.act(chatIntent(text) as MissionIntent);
    });
    return result;
  }
  async function prepare() {
    await command("Cherche une source de mission : synthétique");
    await command("Source de mission : 1");
    await command("Services pour la mission");
    await command("Service de mission : 1");
    await command("Titre de mission : Vérifier un délai");
    await command("Objectif de mission : Relire la durée exacte");
    await command("Critères de mission : Citer les passages lus");
    await command("Prépare la mission");
  }
  return {
    state,
    call,
    command,
    prepare,
    reload() {
      view.unmount();
      view = render(<AgentMissionWorkspace {...props} />);
    },
  };
}
it("shares chat fields, a complete preview and explicit button confirmation without launching a provider", async () => {
  const t = setup();
  await t.prepare();
  expect(t.call).toHaveBeenCalledWith(
    "sources.passage",
    { domain, source_id: sid },
    undefined,
    expect.objectContaining({ query: { offset: 0, limit: 1 } }),
  );
  expect(t.call.mock.calls.some(([op]) => op === "sources.read")).toBe(false);
  expect(t.state.posts).toHaveLength(0);
  expect(
    screen.getByRole("region", { name: "Confirmation de mission" }).textContent,
  ).toContain("Citer les passages lus");
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la mission" }),
    ),
  );
  expect(t.state.posts).toHaveLength(1);
  expect(t.state.posts[0].body.mandate.agent).toBe("task-agent");
  expect(t.state.posts[0].body.mandate.max_chars).toBe(20000);
  expect(readMissionRecovery(scope).entries).toHaveLength(0);
  expect(
    t.call.mock.calls.some(([op]) => String(op).includes("complete")),
  ).toBe(false);
});
it.each([
  { source_id: mid },
  { excerpt: "🧠🧠", end: 2, next_offset: 2 },
  { content: "Unexpected full source body" },
])(
  "does not keep a previous mission source after a malformed minimal read: %j",
  async (override) => {
    const t = setup();
    await t.command("Cherche une source de mission : synthétique");
    await t.command("Source de mission : 1");
    t.state.sourcePassageOverride = override;
    await t.command("Source de mission : 1");
    expect(screen.queryByText("Source : Source synthétique")).toBeNull();
    await t.command("Prépare la mission");
    expect(
      t.call.mock.calls.some(([op]) => op === "agent_missions.prepare"),
    ).toBe(false);
    expect(t.state.posts).toHaveLength(0);
  },
);
it("clears the source and local mission fields when minimal selection is no longer allowed", async () => {
  const t = setup();
  await t.command("Cherche une source de mission : synthétique");
  await t.command("Source de mission : 1");
  await t.command("Titre de mission : Projet avant retrait");
  t.state.sourceDenied = true;
  await t.command("Source de mission : 1");
  expect(screen.queryByDisplayValue("Projet avant retrait")).toBeNull();
  expect(screen.queryByText("Source : Source synthétique")).toBeNull();
  expect(t.state.posts).toHaveLength(0);
});
it("rejects a changed server mandate and an expired preparation without a business POST", async () => {
  const t = setup();
  t.state.prepareMismatch = true;
  await t.prepare();
  expect(
    screen.queryByRole("region", { name: "Confirmation de mission" }),
  ).toBeNull();
  t.state.prepareMismatch = false;
  await t.command("Prépare la mission");
  const original = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(original + 400000);
  expect(await t.command("Confirme la mission")).toContain("expiré");
  expect(t.state.posts).toHaveLength(0);
});
it("keeps an unknown command, rejects editing and retries with the identical key", async () => {
  const t = setup();
  await t.prepare();
  t.state.error = new ApiError(502, "lost");
  await t.command("Confirme la mission");
  expect(readMissionRecovery(scope).entries).toHaveLength(1);
  expect(await t.command("Titre de mission : autre")).toContain("Terminez");
  expect(await t.command("Annule la preparation de mission")).toContain(
    "Impossible",
  );
  t.state.receiptError = new ApiError(404, "hidden");
  await t.command("Vérifie le reçu de mission");
  expect(readMissionRecovery(scope).entries).toHaveLength(1);
  t.state.error = undefined;
  await t.command("Reprends l’envoi de mission");
  expect(t.state.posts[0].body).toEqual(t.state.posts[1].body);
  expect(readMissionRecovery(scope).entries).toHaveLength(0);
});
it("recovers only a content-free receipt after reload without resending the mandate", async () => {
  const t = setup();
  await t.prepare();
  t.state.error = new ApiError(502, "lost");
  await t.command("Confirme la mission");
  expect(sessionStorage.getItem(recoveryKey)).not.toContain("Relire la durée");
  t.reload();
  expect(
    screen.queryByRole("textbox", { name: "Objectif de mission" }),
  ).toBeNull();
  await t.command("Vérifie le reçu de mission");
  fireEvent.click(
    screen.getByRole("button", { name: "Préparer un nouveau mandat" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Objectif de mission",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("");
  await t.command("Vérifie le reçu de mission");
  expect(t.state.posts).toHaveLength(1);
  expect(readMissionRecovery(scope).entries).toHaveLength(0);
});
it("sends nothing if the recovery reference cannot be retained", async () => {
  const t = setup();
  await t.prepare();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("stockage indisponible");
  });
  await t.command("Confirme la mission");
  expect(t.state.posts).toHaveLength(0);
});
it("prepares stop from a fresh version and confirms through the same chat command", async () => {
  const t = setup();
  await t.command(`Ouvre la mission : ${mid}`);
  await t.command("Motif de mission : Examiner le périmètre");
  await t.command("Arrête la mission");
  expect(t.state.posts).toHaveLength(0);
  await t.command("Confirme la mission");
  expect(t.state.posts[0]).toMatchObject({
    op: "agent_missions.command",
    body: {
      action: "stop",
      expected_revision: 1,
      reason: "Examiner le périmètre",
    },
  });
});
it("does not stop from a stale version, nor replace an unsent motif", async () => {
  const t = setup();
  await t.command(`Ouvre la mission : ${mid}`);
  await t.command("Motif de mission : À conserver");
  expect(await t.command("Mes missions d’agents")).toContain("conservé");
  t.state.mission.revision = 2;
  expect(await t.command("Arrête la mission")).toContain("changé");
  expect(t.state.posts).toHaveLength(0);
  expect(
    screen.queryByRole("region", { name: "Confirmation de mission" }),
  ).toBeNull();
});
it("masks report and notes when source access is lost", async () => {
  const t = setup();
  t.state.mission.status = "completed";
  t.state.mission.report = "Rapport synthétique privé";
  t.state.mission.hypotheses = "Hypothèse synthétique";
  await t.command(`Ouvre la mission : ${mid}`);
  expect(screen.getByText("Rapport synthétique privé")).toBeTruthy();
  t.state.denied = true;
  await t.command("Historique de la mission");
  expect(screen.queryByText("Rapport synthétique privé")).toBeNull();
});
it("a service read-only console cannot prepare a human coordination command", async () => {
  const t = setup(false);
  await t.command(`Ouvre la mission : ${mid}`);
  expect(
    screen.queryByRole("button", { name: "Préparer la mission" }),
  ).toBeNull();
  await t.command("Prépare la mission");
  expect(
    t.call.mock.calls.filter(([op]) => op === "agent_missions.prepare"),
  ).toHaveLength(0);
  expect(t.state.posts).toHaveLength(0);
});
it("does not count a mismatched stop receipt as success", async () => {
  const t = setup();
  await t.command(`Ouvre la mission : ${mid}`);
  await t.command("Motif de mission : Stop pour contrôle");
  await t.command("Arrête la mission");
  t.state.malformed = true;
  expect(await t.command("Confirme la mission")).toContain("inconnu");
  expect(readMissionRecovery(scope).entries).toHaveLength(1);
});
it("does not send a fresh command rejected by changed rights again automatically", async () => {
  const t = setup();
  await t.prepare();
  t.state.error = new ApiError(403, "denied");
  await t.command("Confirme la mission");
  expect(t.state.posts).toHaveLength(1);
  expect(readMissionRecovery(scope).entries).toHaveLength(0);
  expect(
    screen.queryByRole("region", { name: "Confirmation de mission" }),
  ).toBeNull();
});
it("shows event history and candidate limits without approval controls", async () => {
  const t = setup();
  t.state.mission.status = "completed";
  t.state.mission.report = "Candidat";
  t.state.mission.hypotheses = "À vérifier";
  t.state.mission.evidence = [{ start: 0, end: 10 }];
  await t.command(`Ouvre la mission : ${mid}`);
  await t.command("Historique de la mission");
  expect(
    screen.getByRole("region", { name: "Journal de mission" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/La couverture des passages est vérifiée/),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Approuver/ })).toBeNull();
});

it("keeps author controls available after source loss without redisplaying a mandate", async () => {
  const t = setup();
  await t.command(`Ouvre la mission : ${mid}`);
  t.state.sourceDenied = true;
  await t.command(`Ouvre la mission : ${mid}`);
  expect(screen.queryByRole("region", { name: "Mandat courant" })).toBeNull();
  await t.command("Mes contrôles de mission");
  await t.command("Ouvre le contrôle de mission : 1");
  const c = screen.getByRole("region", {
    name: "Contrôle de mission sans contenu",
  });
  expect(c.textContent).toContain("0/10 lectures");
  expect(c.textContent).not.toContain("Relire un délai");
  expect(c.textContent).not.toContain("task-agent");
  await t.command("Motif de mission : Stop sans source");
  expect(await t.command("Réactive la mission")).toContain("seulement l’arrêt");
  await t.command("Arrête la mission");
  expect(t.state.posts).toHaveLength(0);
  await t.command("Confirme la mission");
  expect(t.state.posts[0].body).toMatchObject({
    action: "stop",
    expected_revision: 1,
  });
});
it("rejects extra content in a minimal control response", async () => {
  const t = setup();
  t.state.controlExtra = true;
  await t.command("Mes contrôles de mission");
  expect(screen.queryByText(/must not display/)).toBeNull();
  await t.command(`Ouvre le contrôle de mission : ${mid}`);
  expect(
    screen.queryByRole("region", { name: "Contrôle de mission sans contenu" }),
  ).toBeNull();
  expect(t.state.posts).toHaveLength(0);
});
it("rechecks control revision and current coordinator permissions before preparing stop", async () => {
  const t = setup();
  await t.command(`Ouvre le contrôle de mission : ${mid}`);
  await t.command("Motif de mission : Arrêt à confirmer");
  t.state.mission.revision = 2;
  expect(await t.command("Arrête la mission")).toContain("changé");
  expect(
    screen.queryByRole("region", { name: "Confirmation de mission" }),
  ).toBeNull();
  t.state.denied = true;
  await t.command("Arrête la mission");
  expect(
    screen.queryByRole("region", { name: "Contrôle de mission sans contenu" }),
  ).toBeNull();
  expect(t.state.posts).toHaveLength(0);
});
it("recovers a stop from minimal controls without storing the reason", async () => {
  const t = setup();
  await t.command(`Ouvre le contrôle de mission : ${mid}`);
  await t.command("Motif de mission : Motif privé à ne pas stocker");
  await t.command("Arrête la mission");
  t.state.error = new ApiError(502, "lost");
  await t.command("Confirme la mission");
  expect(sessionStorage.getItem(recoveryKey)).not.toContain("Motif privé");
  t.reload();
  await t.command("Vérifie le reçu de mission");
  expect(t.state.posts).toHaveLength(1);
  expect(readMissionRecovery(scope).entries).toHaveLength(0);
});
it("does not offer another stop when the minimal state is terminal", async () => {
  const t = setup();
  t.state.mission.status = "stopped";
  await t.command(`Ouvre le contrôle de mission : ${mid}`);
  expect(screen.queryByRole("button", { name: "Préparer l’arrêt" })).toBeNull();
  expect(
    screen.getByText("Aucun arrêt supplémentaire nécessaire dans cet état."),
  ).toBeTruthy();
});

function completeMission(s: ReturnType<typeof setup>) {
  Object.assign(s.state.mission, {
    status: "completed",
    revision: 4,
    report: "Rapport candidat synthétique",
    hypotheses: "À examiner",
    evidence: [{ start: 100, end: 104 }],
    reads_used: 1,
    chars_used: 4,
    allowed_actions: [],
  });
}
it("reads the same version-bound Unicode evidence through button and chat without a mutation", async () => {
  const s = setup();
  completeMission(s);
  await s.command(`Ouvre la mission : ${mid}`);
  expect(
    screen.queryByRole("textbox", { name: "Motif de coordination" }),
  ).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Lire le passage de mission 1" }),
    );
  });
  expect(
    screen.getByRole("region", { name: "Preuve du rapport de mission" })
      .textContent,
  ).toContain("A🧠é");
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "Preuve du rapport de mission" }),
  );
  await s.command("Lis le passage de mission : 1");
  const calls = s.call.mock.calls.filter(
    (c) => c[0] === "agent_missions.evidence",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].slice(0, 3)).toEqual([
    "agent_missions.evidence",
    { domain, mission: mid, index: "1" },
    undefined,
  ]);
  expect((calls[0] as unknown[])[3]).toMatchObject({
    query: { expected_revision: 4 },
  });
  expect(s.state.posts).toHaveLength(0);
  expect(sessionStorage.length).toBe(0);
});
it("clears the proof and report when current source access is refused", async () => {
  const s = setup();
  completeMission(s);
  await s.command(`Ouvre la mission : ${mid}`);
  await s.command("Lis le passage de mission : 1");
  s.state.sourceDenied = true;
  await s.command("Lis le passage de mission : 1");
  expect(
    screen.queryByRole("region", { name: "Preuve du rapport de mission" }),
  ).toBeNull();
  expect(screen.queryByText("Rapport candidat synthétique")).toBeNull();
  expect(s.state.posts).toHaveLength(0);
});
it.each([
  { mission_revision: 3 },
  { source_hash: "b".repeat(64) },
  { excerpt: "A🧠e" },
  { end: 105 },
  { private_body: "never" },
])(
  "rejects mismatched, truncated or extended proof responses %j",
  async (bad) => {
    const s = setup();
    completeMission(s);
    await s.command(`Ouvre la mission : ${mid}`);
    await s.command("Lis le passage de mission : 1");
    s.state.evidenceOverride = bad;
    await s.command("Lis le passage de mission : 1");
    expect(
      screen.queryByRole("region", { name: "Preuve du rapport de mission" }),
    ).toBeNull();
  },
);
it("rejects an out-of-range evidence selection and removes a prior quote when changing mission", async () => {
  const s = setup();
  completeMission(s);
  await s.command(`Ouvre la mission : ${mid}`);
  await s.command("Lis le passage de mission : 2");
  expect(
    s.call.mock.calls.some((c) => c[0] === "agent_missions.evidence"),
  ).toBe(false);
  await s.command("Lis le passage de mission : 1");
  await s.command("Mes missions d’agents");
  expect(
    screen.queryByRole("region", { name: "Preuve du rapport de mission" }),
  ).toBeNull();
});
it("does not allow the agent UI to use the human evidence reading route", async () => {
  const s = setup(false);
  completeMission(s);
  await s.command(`Ouvre la mission : ${mid}`);
  expect(
    screen.queryByRole("button", { name: "Lire le passage de mission 1" }),
  ).toBeNull();
  await s.command("Lis le passage de mission : 1");
  expect(
    s.call.mock.calls.some((c) => c[0] === "agent_missions.evidence"),
  ).toBe(false);
});
