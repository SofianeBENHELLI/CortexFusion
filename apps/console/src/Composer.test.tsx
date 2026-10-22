import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  onresult: null | ((event: { results: { transcript: string }[][] }) => void) =
    null;
  onerror: null | (() => void) = null;
  onend: null | (() => void) = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}
const send = vi.fn();
function Harness({ initial = "" }: { initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return (
    <Composer draft={draft} setDraft={setDraft} send={send} busy={false} />
  );
}
function start() {
  fireEvent.click(screen.getByRole("button", { name: "Parler" }));
  return FakeRecognition.instances.at(-1)!;
}
function result(r: FakeRecognition, text: string) {
  act(() => r.onresult?.({ results: [[{ transcript: text }]] }));
}
function value() {
  return (
    screen.getByRole("textbox", { name: "Votre message" }) as HTMLInputElement
  ).value;
}
beforeEach(() => {
  FakeRecognition.instances = [];
  send.mockClear();
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps text entry and submission available when speech is unsupported", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Parler" }));
  expect(screen.getByRole("status").textContent).toContain(
    "n’est pas disponible",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Votre message" }), {
    target: { value: "Question saisie" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  expect(send).toHaveBeenCalledWith("Question saisie", false);
});

it("leaves the draft usable after microphone refusal", () => {
  render(<Harness initial="Question conservée" />);
  const r = start();
  act(() => r.onerror?.());
  expect(screen.getByRole("status").textContent).toContain(
    "autorisation refusée",
  );
  expect(value()).toBe("Question conservée");
  expect(screen.getByRole("button", { name: "Parler" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  expect(send).toHaveBeenCalledWith("Question conservée", false);
});

it("does not replace the existing draft or accumulate interim transcription", () => {
  render(<Harness initial="Explique le périmètre :" />);
  const r = start();
  expect(r.start).toHaveBeenCalledTimes(1);
  expect(r.lang).toBe("fr-FR");
  result(r, "SIMULIA");
  result(r, "SIMULIA et ses produits");
  expect(value()).toBe("Explique le périmètre : SIMULIA et ses produits");
  expect(send).not.toHaveBeenCalled();
});

it("ignores a late result after the user has edited the draft", () => {
  render(<Harness />);
  const r = start();
  const late = r.onresult!;
  result(r, "Texte dicté");
  fireEvent.change(screen.getByRole("textbox", { name: "Votre message" }), {
    target: { value: "Texte corrigé" },
  });
  act(() => late({ results: [[{ transcript: "Ancien résultat tardif" }]] }));
  expect(value()).toBe("Texte corrigé");
  expect(r.abort).toHaveBeenCalledTimes(1);
});

it("cannot update a different conversation through an unmounted composer", () => {
  const setDraft = vi.fn();
  const view = render(
    <Composer draft="" setDraft={setDraft} send={send} busy={false} />,
  );
  const r = start();
  const late = r.onresult!;
  view.unmount();
  act(() => late({ results: [[{ transcript: "Ancienne conversation" }]] }));
  expect(setDraft).not.toHaveBeenCalled();
  expect(r.abort).toHaveBeenCalledTimes(1);
});

it("cancels recognition on send and ignores results that would overwrite the next draft", () => {
  render(<Harness />);
  const r = start();
  const late = r.onresult!;
  result(r, "Question dictée");
  fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
  act(() => late({ results: [[{ transcript: "Trop tard" }]] }));
  expect(send).toHaveBeenCalledWith("Question dictée", true);
  expect(value()).toBe("Question dictée");
  expect(r.abort).toHaveBeenCalledTimes(1);
});

it("applies the same length bound to dictated and typed text", () => {
  render(<Harness initial="Question" />);
  const r = start();
  result(r, "x".repeat(4100));
  expect(value()).toHaveLength(4000);
  expect(screen.getByRole("status").textContent).toContain("4 000");
});

it("cancels dictation when a suggested question starts another request", () => {
  const setDraft = vi.fn();
  const view = render(
    <Composer draft="" setDraft={setDraft} send={send} busy={false} />,
  );
  const r = start();
  const late = r.onresult!;
  view.rerender(<Composer draft="" setDraft={setDraft} send={send} busy />);
  act(() => late({ results: [[{ transcript: "Ancien résultat" }]] }));
  expect(setDraft).not.toHaveBeenCalled();
  expect(r.abort).toHaveBeenCalledTimes(1);
});

it.each(["constructor", "start"])(
  "recovers from a browser %s failure without losing typed text",
  (stage) => {
    vi.stubGlobal(
      "SpeechRecognition",
      class extends FakeRecognition {
        constructor() {
          super();
          if (stage === "constructor") throw new Error("Browser failure");
          this.start.mockImplementation(() => {
            throw new Error("Browser failure");
          });
        }
      },
    );
    render(<Harness initial="Texte conservé" />);
    start();
    expect(screen.getByRole("status").textContent).toContain(
      "Impossible de démarrer",
    );
    expect(value()).toBe("Texte conservé");
    expect(screen.getByRole("button", { name: "Parler" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(send).toHaveBeenCalledWith("Texte conservé", false);
  },
);
