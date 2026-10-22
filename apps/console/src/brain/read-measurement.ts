import { useEffect } from "react";

// Explicit local qualification build only. Never record identity, URLs, source
// text, search terms or error messages, and never transmit these measurements.
const enabled = () => import.meta.env.VITE_BRAIN_MEASURE === "1";
type Kind = "workspace" | "search" | "spatial-map";
type Reading = {
  id: number;
  kind: Kind;
  started: number;
  received: number;
  reported: boolean;
};
const readings = new Map<number, Reading>();
type Measured = { __brain_measurement_id?: number };
let sequence = 0;
const ms = (duration: number) => Math.round(duration * 1000) / 1000;
const report = (value: object) =>
  console.info("[BrainMap measure] " + JSON.stringify(value));

export function startSpatialStep(
  kind: "layout" | "draw",
  nodes: number,
  edges: number,
) {
  if (!enabled()) return () => {};
  const started = performance.now();
  return () =>
    report({
      kind: `spatial-${kind}`,
      phase: "cpu",
      nodes,
      edges,
      elapsed_ms: ms(performance.now() - started),
      visibility: document.visibilityState,
    });
}

export async function measureBrainRead<T extends object>(
  kind: Kind,
  read: () => Promise<T>,
): Promise<T> {
  if (!enabled()) return read();
  const reading: Reading = {
    id: ++sequence,
    kind,
    started: performance.now(),
    received: 0,
    reported: false,
  };
  report({ id: reading.id, kind, phase: "started" });
  try {
    const result = await read();
    reading.received = performance.now();
    // TanStack may structurally share/copy a result. A scalar local marker
    // survives that copy; it exists only in the opt-in measurement build.
    Object.assign(result, { __brain_measurement_id: reading.id });
    readings.set(reading.id, reading);
    if (readings.size > 200) readings.delete(readings.keys().next().value!);
    report({
      id: reading.id,
      kind,
      phase: "read",
      read_ms: ms(reading.received - reading.started),
    });
    return result;
  } catch (error) {
    report({
      id: reading.id,
      kind,
      phase: "failed",
      http_status:
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : null,
      cancelled: error instanceof Error && error.name === "AbortError",
      elapsed_ms: ms(performance.now() - reading.started),
    });
    throw error;
  }
}

// React has committed the authorized result. A second animation frame brackets
// a rendering opportunity, not proof of physical display or a network-cold load.
// Search debounce and time before the read starts are explicitly excluded.
export function useBrainReadPaint(value: object | undefined, ready: boolean) {
  useEffect(() => {
    if (!enabled() || !ready || !value) return;
    const id = (value as Measured).__brain_measurement_id;
    const reading = id === undefined ? undefined : readings.get(id);
    if (!reading || reading.reported) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (reading.reported) return;
        reading.reported = true;
        readings.delete(reading.id);
        const painted = performance.now();
        report({
          id: reading.id,
          kind: reading.kind,
          phase: "frame",
          read_ms: ms(reading.received - reading.started),
          after_read_ms: ms(painted - reading.received),
          total_ms: ms(painted - reading.started),
          visibility: document.visibilityState,
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [value, ready]);
}
