import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { timelineBuckets, intervalLabel } from "./timeline";
import {
  countChanges,
  type BrainChange,
  type BrainProjection,
  type BrainSelection,
} from "./model";

export function BrainTimeline({
  projection,
  events,
  selectedEvents,
  selection,
  now,
  onSelect,
}: {
  projection: BrainProjection;
  events: BrainChange[];
  selectedEvents: BrainChange[];
  selection: BrainSelection;
  now: number;
  onSelect: (interval: BrainSelection["interval"]) => void;
}) {
  const buckets = useMemo(
    () => timelineBuckets(projection, events, selection.period, now),
    [projection, events, selection.period, now],
  );
  const bins = useRef<HTMLDivElement>(null);
  const intervalStatus = useRef<HTMLDivElement>(null);
  const previousInterval = useRef<string | null | undefined>();
  const intervalKey = selection.interval
    ? `${selection.interval.from}/${selection.interval.to}`
    : null;
  useEffect(() => {
    if (previousInterval.current === intervalKey) return;
    const first = previousInterval.current === undefined;
    previousInterval.current = intervalKey;
    if (first && !intervalKey) return;
    // An API reread may remount the view. Restore temporal focus after it,
    // while the parent still gives an explicit event/detail selection priority.
    (
      bins.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      intervalStatus.current
    )?.focus();
  }, [intervalKey]);
  if (!buckets.length) return null;
  const maximum = Math.max(1, ...buckets.map((b) => b.count));
  const totals = countChanges(selectedEvents);
  const updatedConcepts = selectedEvents.filter(
    (e) => e.kind === "concept_updated",
  ).length;
  const removedConcepts = selectedEvents.filter(
    (e) => e.kind === "concept_removed",
  ).length;
  const partial = buckets.some((b) => !b.complete);
  const publications = new Set(selectedEvents.map((e) => e.publicationId)).size;
  return (
    <section className="brain-timeline" aria-label="Frise des changements">
      <div className="brain-timeline-heading">
        <h2>Les changements dans le temps.</h2>
        <button disabled={!selection.interval} onClick={() => onSelect(null)}>
          Toute la période
        </button>
      </div>
      <div
        className="brain-timeline-scroll"
        ref={bins}
        role="group"
        aria-label="Intervalles temporels en UTC"
      >
        {buckets.map((bucket) => {
          const active =
            selection.interval?.from === bucket.from &&
            selection.interval?.to === bucket.to;
          const label = `${intervalLabel(bucket)} · ${bucket.count} événement${bucket.count === 1 ? "" : "s"} chargé${bucket.count === 1 ? "" : "s"} · ${bucket.publications} publication${bucket.publications === 1 ? "" : "s"} avec changements${bucket.complete ? " · intervalle couvert" : " · couverture partielle, total inconnu"}`;
          return (
            <button
              key={bucket.from}
              className={`brain-time-bin${bucket.complete ? "" : " is-partial"}`}
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() =>
                onSelect(active ? null : { from: bucket.from, to: bucket.to })
              }
            >
              <span className="brain-time-count">
                {bucket.count || (bucket.complete ? "0" : "—")}
              </span>
              <span className="brain-time-track" aria-hidden="true">
                <span
                  style={
                    {
                      "--bar-height": `${bucket.count ? Math.max(4, (bucket.count / maximum) * 100) : 0}%`,
                    } as CSSProperties
                  }
                />
              </span>
              <span className="brain-time-tick" aria-hidden="true">
                {new Intl.DateTimeFormat("fr-FR", {
                  timeZone: "UTC",
                  ...(selection.period === "1" ||
                  Date.parse(buckets.at(-1)!.to) -
                    Date.parse(buckets[0].from) <=
                    2 * 86400000
                    ? { hour: "2-digit" }
                    : { day: "2-digit", month: "2-digit" }),
                }).format(new Date(bucket.from))}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="brain-timeline-selection"
        role="status"
        ref={intervalStatus}
        tabIndex={-1}
      >
        <strong>
          {selection.interval
            ? intervalLabel(selection.interval)
            : `Toute la période chargée · ${intervalLabel({ from: buckets[0].from, to: buckets.at(-1)!.to })}`}
        </strong>
        <span>
          {selectedEvents.length} événement
          {selectedEvents.length === 1 ? "" : "s"} · {publications} publication
          {publications === 1 ? "" : "s"} avec changements
        </span>
      </div>
      {partial && (
        <p className="brain-timeline-note brain-time-warning">
          Zones hachurées : couverture partielle, seuls les événements chargés
          sont comptés.
        </p>
      )}
      <details className="brain-time-details">
        <summary>Détail des changements et lecture de la frise</summary>
        <p className="brain-timeline-note">
          Sélectionnez un intervalle pour filtrer la carte et la Chronique. Les
          stocks décrivent toujours le savoir actuel.
        </p>
        <ul
          className="brain-time-breakdown"
          aria-label="Changements dans l’intervalle"
        >
          <li>
            <strong>+{totals.concepts}</strong> concepts créés
          </li>
          {updatedConcepts > 0 && (
            <li>
              <strong>{updatedConcepts}</strong> modifications de concepts
            </li>
          )}
          {removedConcepts > 0 && (
            <li>
              <strong>− {removedConcepts}</strong> concepts retirés
            </li>
          )}
          <li>
            <strong>+{totals.created}</strong> nouvelles relations
          </li>
          {projection.capabilities.dynamics && (
            <>
              <li>
                <strong>↑ {totals.strengthened}</strong> renforcements publiés
              </li>
              <li>
                <strong>↓ {totals.weakened}</strong> baisses de poids publiées
              </li>
            </>
          )}
          <li>
            <strong>− {totals.removed}</strong> relations retirées
          </li>
          {totals.primaryChanged > 0 && (
            <li>
              <strong>{totals.primaryChanged}</strong> changements du marqueur
              principal
            </li>
          )}
        </ul>
        <p className="brain-timeline-note">
          {partial
            ? "Zones hachurées : couverture partielle. Les barres comptent uniquement les événements chargés ; une absence de barre ne prouve pas une absence d’activité. Aucune tendance complète n’en est déduite."
            : "Intervalles de durée égale, en UTC. Un événement est compté une seule fois ; une publication peut produire plusieurs changements."}
        </p>
      </details>
    </section>
  );
}
