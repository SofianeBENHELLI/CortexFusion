import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrainHub } from "./BrainHub";
import { ThemeProvider } from "../theme";
import { seed } from "../mock";
import { mockProjection } from "./mock-projection";
import { catalogFixture } from "./catalog.fixture";
import { readCatalog, storeCatalog } from "./catalog-store";
vi.mock("./catalog-store", () => ({
  readCatalog: vi.fn(),
  storeCatalog: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(readCatalog).mockResolvedValue(null);
  vi.mocked(storeCatalog).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup(url = "/views/brain") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <BrainHub
          projection={mockProjection(seed())}
          onSource={vi.fn()}
          onConcept={vi.fn()}
        />
      </ThemeProvider>
    </MemoryRouter>,
  );
}
async function upload(value: unknown) {
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Charger un catalogue OKF" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Catalogue OKF préparé"), {
    target: { files: [{ size: 100, text: async () => JSON.stringify(value) }] },
  });
}
it("restores the local catalogue after reload without manufacturing a publication", async () => {
  vi.mocked(readCatalog).mockResolvedValue(catalogFixture());
  setup("/views/brain?corpus=local");
  expect(
    await screen.findByRole("heading", { name: "Explorer le corpus." }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Corpus local · 3 fiches" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(storeCatalog).not.toHaveBeenCalled();
  expect(screen.queryByText(/savoir publié v0/)).toBeNull();
});
it("retains the current catalogue when an invalid replacement is rejected", async () => {
  vi.mocked(readCatalog).mockResolvedValue(catalogFixture());
  setup("/views/brain?corpus=local");
  await screen.findByRole("heading", { name: "Explorer le corpus." });
  await upload({ schema_version: 99 });
  expect(
    await screen.findByText(/ne correspond pas à un catalogue/),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Corpus local · 3 fiches" }),
  ).toBeTruthy();
  expect(storeCatalog).not.toHaveBeenCalled();
});
it("keeps a valid import available for the session when durable browser storage fails", async () => {
  vi.mocked(storeCatalog).mockRejectedValue(new Error("quota"));
  setup();
  await upload(catalogFixture());
  expect(
    await screen.findByText(/La conservation locale est indisponible/),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Explorer le corpus." }),
  ).toBeTruthy();
  expect(storeCatalog).toHaveBeenCalledTimes(1);
});
it("removes only the local catalogue and returns to the existing mock brain", async () => {
  vi.mocked(readCatalog).mockResolvedValue(catalogFixture());
  setup("/views/brain?corpus=local");
  fireEvent.click(
    await screen.findByRole("button", { name: "Retirer le corpus local" }),
  );
  expect(
    await screen.findByRole("heading", { name: "BrainMap & Chronique" }),
  ).toBeTruthy();
  expect(storeCatalog).toHaveBeenCalledWith(null);
  expect(
    screen
      .getByRole("button", { name: "Corpus local" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it.each(["cancel", "close", "button"])(
  "returns focus to the source trigger after dialog %s",
  async (method) => {
    const prototype = HTMLDialogElement.prototype;
    const originals = ["showModal", "close"].map((name) =>
      Object.getOwnPropertyDescriptor(prototype, name),
    );
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
        this.querySelector("button")?.focus();
      },
    });
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    });
    try {
      vi.mocked(readCatalog).mockResolvedValue(catalogFixture());
      setup("/views/brain?corpus=local");
      fireEvent.change(
        await screen.findByRole("searchbox", {
          name: "Rechercher dans le cerveau",
        }),
        { target: { value: "a" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "a product" }));
      const trigger = screen.getByRole("button", {
        name: "Consulter la source",
      });
      trigger.focus();
      fireEvent.click(trigger);
      const modal = screen.getByRole("dialog");
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Fermer la source du corpus" }),
      );
      if (method === "button") {
        fireEvent.click(
          screen.getByRole("button", { name: "Fermer la source du corpus" }),
        );
      } else {
        fireEvent(modal, new Event(method));
      }
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      ["showModal", "close"].forEach((name, index) => {
        if (originals[index])
          Object.defineProperty(prototype, name, originals[index]!);
        else Reflect.deleteProperty(prototype, name);
      });
    }
  },
);
