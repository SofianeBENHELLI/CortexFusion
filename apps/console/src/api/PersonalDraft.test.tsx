import React, { createRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApiError, CortexApi } from "./client";
import { PersonalDraft, type PersonalDraftActions } from "./PersonalDraft";
const domain = "00000000-0000-0000-0000-000000000001";
const actions = createRef<PersonalDraftActions>();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const api = new CortexApi(() => null);
  let remote = {
    draft_key: "new",
    text: "Texte enregistré",
    revision: 1,
    updated_at: "2026-10-16",
  };
  const call = vi
    .spyOn(api, "call")
    .mockImplementation(async (op, _params, body) => {
      if (op === "drafts.read") return { ...remote };
      if (op === "drafts.save") {
        const input = body as { text: string; expected_revision: number };
        if (input.expected_revision !== remote.revision)
          throw new ApiError(409, "DRAFT_REVISION_CONFLICT");
        remote = { ...remote, text: input.text, revision: remote.revision + 1 };
        return {
          receipt_id: "receipt-1",
          draft_key: "new",
          revision: remote.revision,
        };
      }
      throw new Error("Unexpected operation");
    });
  function Test() {
    const [text, setText] = useState("Ma saisie locale");
    return (
      <>
        <textarea
          aria-label="Saisie"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <PersonalDraft
          ref={actions}
          api={api}
          domain={domain}
          draftKey="new"
          text={text}
          disabled={false}
          onApply={setText}
        />
      </>
    );
  }
  render(<Test />);
  return {
    api,
    call,
    remote: () => remote,
    setRemote: (text: string) => {
      remote = { ...remote, text, revision: remote.revision + 1 };
    },
  };
}
it("reads without overwriting or saving; explicit restore only changes local composer", async () => {
  const { call } = setup();
  await screen.findByText(/révision 1/);
  expect((screen.getByLabelText("Saisie") as HTMLTextAreaElement).value).toBe(
    "Ma saisie locale",
  );
  expect(call.mock.calls.every(([op]) => op === "drafts.read")).toBe(true);
  fireEvent.click(screen.getByText("Voir le brouillon enregistré"));
  await screen.findByText("Texte enregistré");
  fireEvent.click(screen.getByText("Utiliser le brouillon enregistré"));
  expect((screen.getByLabelText("Saisie") as HTMLTextAreaElement).value).toBe(
    "Texte enregistré",
  );
  expect(call.mock.calls.every(([op]) => op === "drafts.read")).toBe(true);
});
it("explicit save returns a receipt and reloads the current revision", async () => {
  const { call, remote } = setup();
  await screen.findByText(/révision 1/);
  fireEvent.click(screen.getByText("Enregistrer mon brouillon"));
  await screen.findByText(/Sauvegarde privée confirmée/);
  expect(remote().text).toBe("Ma saisie locale");
  expect(call.mock.calls.filter(([op]) => op === "drafts.save")).toHaveLength(
    1,
  );
  expect(call.mock.calls.map(([op]) => op)).toEqual([
    "drafts.read",
    "drafts.save",
    "drafts.read",
  ]);
});
it("conflict cannot overwrite either side before explicit comparison choice", async () => {
  const { setRemote, remote, call } = setup();
  await screen.findByText(/révision 1/);
  setRemote("Autre onglet");
  fireEvent.click(screen.getByText("Enregistrer mon brouillon"));
  await screen.findByText("Autre onglet");
  expect(
    (screen.getByText("Enregistrer mon brouillon") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText("Saisie") as HTMLTextAreaElement).value).toBe(
    "Ma saisie locale",
  );
  fireEvent.click(screen.getByText("Garder mon texte local"));
  expect(remote().text).toBe("Autre onglet");
  fireEvent.click(screen.getByText("Enregistrer mon brouillon"));
  await screen.findByText(/Sauvegarde privée confirmée/);
  expect(remote().text).toBe("Ma saisie locale");
  const saves = call.mock.calls.filter(([op]) => op === "drafts.save");
  expect(
    saves.map(
      ([, , body]) => (body as { expected_revision: number }).expected_revision,
    ),
  ).toEqual([1, 2]);
});
it("unknown result retries the exact payload even if local text changes", async () => {
  const { call } = setup();
  await screen.findByText(/révision 1/);
  const normal = call.getMockImplementation()!;
  let first = true;
  call.mockImplementation(async (...args) => {
    if (args[0] === "drafts.save" && first) {
      first = false;
      throw new ApiError(0, "network_error");
    }
    return normal(...args);
  });
  fireEvent.click(screen.getByText("Enregistrer mon brouillon"));
  await screen.findByText(/Résultat inconnu/);
  fireEvent.change(screen.getByLabelText("Saisie"), {
    target: { value: "Une nouvelle saisie" },
  });
  fireEvent.click(screen.getByText("Réessayer la même sauvegarde"));
  await screen.findByText(/Sauvegarde privée confirmée/);
  const saves = call.mock.calls.filter(([op]) => op === "drafts.save");
  expect(saves[0][2]).toEqual(saves[1][2]);
  expect((screen.getByLabelText("Saisie") as HTMLTextAreaElement).value).toBe(
    "Une nouvelle saisie",
  );
});
it("fresh access denial masks cached draft and disables saves", async () => {
  const { call } = setup();
  await screen.findByText(/révision 1/);
  fireEvent.click(screen.getByText("Voir le brouillon enregistré"));
  await screen.findByText("Texte enregistré");
  call.mockRejectedValue(new ApiError(403, "DENIED"));
  fireEvent.click(screen.getByText("Enregistrer mon brouillon"));
  await screen.findByText(/n’est plus accessible/);
  expect(screen.queryByText("Texte enregistré")).toBeNull();
  expect(
    (screen.getByText("Enregistrer mon brouillon") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("chat invokes exactly the same save, preview and restore functions", async () => {
  const { remote, call } = setup();
  await screen.findByText(/révision 1/);
  await act(async () => {
    await actions.current!.save("Brouillon via chat");
  });
  expect(remote().text).toBe("Brouillon via chat");
  await act(async () => {
    await actions.current!.inspect();
  });
  act(() => actions.current!.apply());
  expect((screen.getByLabelText("Saisie") as HTMLTextAreaElement).value).toBe(
    "Brouillon via chat",
  );
  expect(call.mock.calls.filter(([op]) => op === "drafts.save")).toHaveLength(
    1,
  );
});
it("late read after unmount cannot restore text into another scope", async () => {
  let finish: (value: unknown) => void = () => {};
  const api = new CortexApi(() => null);
  vi.spyOn(api, "call").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
  );
  const apply = vi.fn();
  const view = render(
    <PersonalDraft
      api={api}
      domain={domain}
      draftKey="new"
      text="local"
      disabled={false}
      onApply={apply}
    />,
  );
  view.unmount();
  await act(async () => {
    finish({ draft_key: "new", text: "old", revision: 1, updated_at: null });
  });
  expect(apply).not.toHaveBeenCalled();
});
