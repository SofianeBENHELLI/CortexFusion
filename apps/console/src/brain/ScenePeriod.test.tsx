import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { ScenePeriod } from "./ScenePeriod";
afterEach(cleanup);
it("keeps UTC milliseconds and rejects a reversed interval without applying it", () => {
  const change = vi.fn();
  render(
    <ScenePeriod
      interval={{
        from: "2026-10-04T01:00:00.123Z",
        to: "2026-10-04T02:00:00.456Z",
      }}
      onChange={change}
    />,
  );
  const start = screen.getByLabelText("Début inclus en UTC");
  const end = screen.getByLabelText("Fin exclue en UTC");
  fireEvent.click(screen.getByRole("button", { name: "Appliquer la période" }));
  expect(change).toHaveBeenLastCalledWith({
    from: "2026-10-04T01:00:00.123Z",
    to: "2026-10-04T02:00:00.456Z",
  });
  change.mockClear();
  fireEvent.change(end, { target: { value: "2026-10-03T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Appliquer la période" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(start, { target: { value: "2026-02-30T00:00:00.000Z" } });
  fireEvent.change(end, { target: { value: "2026-03-04T00:00:00.000Z" } });
  fireEvent.click(screen.getByRole("button", { name: "Appliquer la période" }));
  expect(change).not.toHaveBeenCalled();
});
