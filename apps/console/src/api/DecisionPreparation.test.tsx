import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReviewCommand, type ReviewCommandHandle } from "./ReviewCommand";
import { availableDecisions, decisionCommand } from "./decisionCommands";
import { chatIntent } from "./workspaceCommands";
import { ApiError, type CortexApi } from "./client";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
afterEach(cleanup);
const domain = "00000000-0000-0000-0000-000000000001",
  id = "00000000-0000-0000-0000-000000000002";
const proposal: ProposalView = {
  id,
  status: "ready",
  base_version: 3,
  review_revision: 2,
  digest: "a".repeat(64),
  reason: "Synthetic",
  payload: [],
  replaces_id: null,
  validation: {
    status: "passed",
    source_support: "verbatim_v1",
    graph: "acyclic",
    policy: "owner_low_risk_v1",
    risk: "low",
    source_ids: [],
  },
};
const version = {
  domain_id: domain,
  accepted_version: 3,
  published_version: 3,
};
function setup(
  status: ProposalView["status"] = "ready",
  caps = ["review", "approve", "publish"],
) {
  const current = { ...proposal, status };
  const call = vi.fn(async (op: string) => {
    if (op === "identity.read")
      return {
        subject: "synthetic-owner",
        tenant_id: domain,
        domains: [
          {
            id: domain,
            name: "Synthetic domain",
            role: "owner",
            capabilities: caps,
          },
        ],
      };
    if (op === "domain.version")
      return { ...version, accepted_version: status === "approved" ? 4 : 3 };
    if (op === "proposals.read") return current;
    throw new Error("Unexpected mutation");
  });
  const ref = createRef<ReviewCommandHandle>();
  const error = vi.fn();
  const notice = vi.fn();
  const view = render(
    <ReviewCommand
      ref={ref}
      api={{ call } as unknown as CortexApi}
      domain={domain}
      proposal={current}
      capabilities={caps}
      onReadError={error}
      onNotice={notice}
    />,
  );
  return { ref, call, error, notice, ...view };
}
it("rechecks identity, versions and exact proposal before preparing approval; never executes it", async () => {
  const { call } = setup();
  fireEvent.click(
    screen.getByText("Préparer une décision pour l’hôte de confiance"),
  );
  fireEvent.change(screen.getByLabelText("Motif de la décision"), {
    target: { value: "Preuves vérifiées" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Préparer : Approuver" }));
  await screen.findByRole("region", { name: "Projet de décision" });
  const command = JSON.parse(
    (
      screen.getByLabelText(
        "Commande MCP à faire confirmer",
      ) as HTMLTextAreaElement
    ).value,
  );
  expect(command.name).toBe("api_proposals_approve");
  expect(command.arguments.body).toMatchObject({
    expected_version: 3,
    expected_review_revision: 2,
    digest: proposal.digest,
    reason: "Preuves vérifiées",
  });
  expect(call.mock.calls.map((c) => c[0])).toEqual([
    "identity.read",
    "domain.version",
    "proposals.read",
  ]);
  expect(
    screen.queryByRole("button", { name: "Préparer : Approuver" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Annuler le projet de décision" }),
  );
  expect(
    screen.queryByRole("region", { name: "Projet de décision" }),
  ).toBeNull();
});
it("chat and button preparation share the same command; a chat confirmation cannot sign", async () => {
  const { ref, call } = setup("approved");
  const intent = chatIntent("Prépare la publication");
  expect(intent).toEqual({
    kind: "decision_prepare",
    action: "publish",
    reason: "",
  });
  await act(async () => {
    await ref.current!.act(intent as any);
  });
  const command = JSON.parse(
    (
      screen.getByLabelText(
        "Commande MCP à faire confirmer",
      ) as HTMLTextAreaElement
    ).value,
  );
  expect(command).toEqual(
    decisionCommand(
      domain,
      { ...proposal, status: "approved" },
      { ...version, accepted_version: 4 },
      "publish",
      "",
      "unused",
    ),
  );
  await act(async () => {
    expect(await ref.current!.act({ kind: "decision_confirm" })).toContain(
      "n’est pas raccordée",
    );
  });
  expect(call).toHaveBeenCalledTimes(3);
  await act(async () => {
    await ref.current!.act({
      kind: "decision_prepare",
      action: "publish",
      reason: "",
    });
  });
  expect(call).toHaveBeenCalledTimes(3);
});
it.each(["identity", "revision", "access"])(
  "fails closed when %s changes during preparation",
  async (kind) => {
    const { ref, call, error } = setup();
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (op) => {
      if (kind === "identity" && op === "identity.read")
        return {
          subject: "synthetic-owner",
          tenant_id: domain,
          domains: [],
        } as any;
      if (op === "proposals.read" && kind === "revision")
        return { ...proposal, review_revision: 3 } as any;
      if (op === "proposals.read" && kind === "access")
        throw new ApiError(404, "not_accessible");
      return original(op);
    });
    await act(async () => {
      await ref.current!.act({
        kind: "decision_prepare",
        action: "approve",
        reason: "Synthetic",
      });
    });
    expect(error).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", { name: "Projet de décision" }),
    ).toBeNull();
    expect(
      call.mock.calls.every((c) =>
        ["identity.read", "domain.version", "proposals.read"].includes(c[0]),
      ),
    ).toBe(true);
  },
);
it("does not expose owner decisions to contributors and does not infer capabilities from status", () => {
  setup("ready", ["propose", "read_proposals"]);
  expect(
    screen.queryByText("Préparer une décision pour l’hôte de confiance"),
  ).toBeNull();
  expect(
    availableDecisions("published", ["approve", "publish", "review"]),
  ).toEqual([]);
});
it("rejects stale base, pending publication and malformed version without building a command", () => {
  expect(() =>
    decisionCommand(
      domain,
      proposal,
      { ...version, published_version: 2 },
      "approve",
      "Synthetic",
      "key",
    ),
  ).toThrow(/attend/);
  expect(() =>
    decisionCommand(
      domain,
      proposal,
      { ...version, published_version: 4, accepted_version: 4 },
      "approve",
      "Synthetic",
      "key",
    ),
  ).toThrow(/ancienne/);
  expect(() =>
    decisionCommand(
      domain,
      proposal,
      { ...version, accepted_version: NaN },
      "approve",
      "Synthetic",
      "key",
    ),
  ).toThrow();
  expect(() =>
    decisionCommand(domain, proposal, version, "publish", "", "key"),
  ).toThrow();
});
