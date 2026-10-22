import { useEffect, useRef, useState } from "react";
import { uuid } from "./uuid";

export const workId = (value: string) => uuid.test(value);
export const workName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim()
    .replace(/\s+/g, " ");

/** Names are resolved only among currently authorized, loaded rows. Never pick
 * the first duplicate, fetch another tenant, or put free text into navigation. */
export function resolveWorkName(
  value: string,
  rows: readonly { id: string; title: string }[],
) {
  if (workId(value)) return { id: value };
  const exact = rows.filter((r) => workName(r.title) === workName(value));
  return exact.length === 1
    ? { id: exact[0].id }
    : { ambiguous: exact.length > 1 };
}

/** Browser history may change the URL during an uncertain mutation. Restore the
 * existing target then; a prepared but unsent decision is discarded on navigation. */
export function useWorkSelection(options: {
  requested?: string;
  onNavigate?: (id: string, replace?: boolean) => void;
  locked: boolean;
  onReset: () => void;
  onBlocked: () => void;
}) {
  const requested =
    options.requested === undefined
      ? undefined
      : workId(options.requested)
        ? options.requested
        : "";
  const [selected, update] = useState(requested ?? "");
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (requested === undefined || requested === selected) return;
    if (latest.current.locked) {
      latest.current.onNavigate?.(selected, true);
      latest.current.onBlocked();
    } else {
      latest.current.onReset();
      update(requested);
    }
  }, [requested, selected, options.locked]);
  function select(id: string) {
    if (id && !workId(id)) return;
    update(id);
    latest.current.onNavigate?.(id);
  }
  return [selected, select] as const;
}
