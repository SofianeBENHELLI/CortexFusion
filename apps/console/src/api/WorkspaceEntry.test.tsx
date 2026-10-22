import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { WorkspaceEntry, ResponsibilityHelp } from "./WorkspaceEntry";
import type { AccessibleDomain } from "../../../../packages/contracts/src/IdentityView";
afterEach(cleanup);
const domain: AccessibleDomain = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Procédures",
  role: "contributor",
  capabilities: ["work_brief", "propose", "feedback"],
};
it("offers only server roles and opens an authorized domain without changing its role", () => {
  const open = vi.fn();
  render(
    <WorkspaceEntry
      domains={[
        domain,
        {
          ...domain,
          id: "00000000-0000-0000-0000-000000000002",
          name: "Lectures",
          role: "viewer",
          capabilities: ["feedback"],
        },
      ]}
      localAccess
      onOpen={open}
    />,
  );
  expect(screen.getByText("Espace personnel local")).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "Responsable de domaine" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Ma responsabilité"), {
    target: { value: "viewer" },
  });
  expect(
    screen.queryByRole("button", { name: "Ouvrir mon espace : Procédures" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Ouvrir mon espace : Lectures" }),
  );
  expect(open).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000002");
  expect(screen.getByText("Utiliser dans mon chatbot")).toBeTruthy();
  expect(screen.getByText(/cette page ne les configure pas/)).toBeTruthy();
});
it("searches accents, resets empty filters and bounds visible cards", () => {
  render(
    <WorkspaceEntry
      domains={Array.from({ length: 11 }, (_, i) => ({
        ...domain,
        id: `domain-${i}`,
        name: `Procédures ${i}`,
      }))}
      localAccess={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("article")).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "Espaces suivants" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  fireEvent.change(screen.getByLabelText("Rechercher un domaine"), {
    target: { value: "procedures 10" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain("1–1");
  fireEvent.change(screen.getByLabelText("Rechercher un domaine"), {
    target: { value: "absent" },
  });
  expect(screen.queryByRole("article")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Effacer les filtres" }));
  expect(screen.getAllByRole("article")).toHaveLength(8);
});
it("does not suggest operational rights just from a privileged role label", () => {
  const { rerender } = render(
    <ResponsibilityHelp
      domain={{ ...domain, role: "owner", capabilities: [] }}
    />,
  );
  expect(screen.queryByRole("list")).toBeNull();
  rerender(
    <ResponsibilityHelp
      domain={{
        ...domain,
        role: "owner",
        capabilities: ["work_brief", "coordinate_tasks", "import_commands"],
      }}
    />,
  );
  const list = within(screen.getByRole("list"));
  expect(list.getAllByRole("listitem")).toHaveLength(2);
  expect(list.getByText(/répartir les tâches/)).toBeTruthy();
  expect(list.queryByText(/contribution sourcée/)).toBeNull();
});
it("removes withdrawn roles and clamps the current page on an updated identity", () => {
  const { rerender } = render(
    <WorkspaceEntry
      domains={Array.from({ length: 9 }, (_, i) => ({
        ...domain,
        id: `domain-${i}`,
        name: `Domaine ${i}`,
      }))}
      localAccess={false}
      onOpen={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Ma responsabilité"), {
    target: { value: "contributor" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Espaces suivants" }));
  rerender(
    <WorkspaceEntry
      domains={[{ ...domain, role: "viewer", capabilities: [] }]}
      localAccess={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.queryByRole("option", { name: "Contributeur" })).toBeNull();
  rerender(
    <WorkspaceEntry domains={[]} localAccess={false} onOpen={vi.fn()} />,
  );
  expect(
    screen.queryByRole("button", { name: /Ouvrir mon espace/ }),
  ).toBeNull();
  expect(screen.getByText(/Demandez à votre administrateur/)).toBeTruthy();
});
it("filters every explicitly assigned responsibility without multiplying domains or granting actions", () => {
  const open = vi.fn();
  render(
    <WorkspaceEntry
      domains={[
        {
          ...domain,
          role: "corpus_manager",
          roles: ["corpus_manager", "contributor", "viewer"],
          capabilities: ["feedback"],
        },
      ]}
      localAccess
      onOpen={open}
    />,
  );
  fireEvent.change(screen.getByLabelText("Ma responsabilité"), {
    target: { value: "contributor" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain(
    "1 résultat sur 1 domaine",
  );
  expect(
    screen.getByText("Responsable de corpus · Contributeur · Lecteur"),
  ).toBeTruthy();
  expect(screen.queryByText(/répartir les tâches/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Ouvrir mon espace : Procédures" }),
  );
  expect(open).toHaveBeenCalledWith(domain.id);
});
