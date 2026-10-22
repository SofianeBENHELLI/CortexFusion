import {
  periodStart,
  type BrainChange,
  type BrainProjection,
  type BrainSelection,
} from "./model";

export interface TimeBucket {
  from: string;
  to: string;
  count: number;
  publications: number;
  complete: boolean;
}
const DAY = 86400000;

/** Fixed elapsed-time bins, never calendar/DST days. Input has already been scoped. */
export function timelineBuckets(
  projection: BrainProjection,
  events: BrainChange[],
  period: BrainSelection["period"],
  now: number,
): TimeBucket[] {
  if (!projection.coverage.publicationChanges || !Number.isFinite(now))
    return [];
  const unique = [...new Map(events.map((e) => [e.id, e])).values()].filter(
    (e) => Number.isFinite(Date.parse(e.time)) && Date.parse(e.time) <= now,
  );
  const observedFrom = projection.coverage.from
    ? Date.parse(projection.coverage.from)
    : -Infinity;
  // Keep the time axis stable when zooming into another spatial scope.
  const earliest = projection.events.reduce(
    (min, e) =>
      Number.isFinite(Date.parse(e.time))
        ? Math.min(min, Date.parse(e.time))
        : min,
    now,
  );
  const start =
    period === "all"
      ? Math.min(
          now - DAY,
          Number.isFinite(observedFrom) ? observedFrom : earliest,
        )
      : periodStart(period, now);
  const end = now + 1; // Include an event exactly at the fixed observation instant.
  const count = period === "7" ? 7 : period === "30" ? 30 : 24;
  const width = Math.ceil((end - start) / count);
  const publications = Array.from({ length: count }, () => new Set<string>());
  const buckets = Array.from({ length: count }, (_, i) => {
    const from = start + i * width,
      to = Math.min(end, from + width);
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      count: 0,
      publications: 0,
      complete:
        !projection.coverage.partial &&
        from >= observedFrom &&
        (!projection.coverage.to ||
          to - 1 <= Date.parse(projection.coverage.to)),
    };
  });
  for (const event of unique) {
    const time = Date.parse(event.time);
    if (time < start || time >= end) continue;
    const index = Math.floor((time - start) / width);
    buckets[index].count++;
    publications[index].add(event.publicationId);
  }
  return buckets.map((bucket, i) => ({
    ...bucket,
    publications: publications[i].size,
  }));
}

const utc = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
export function intervalLabel(interval: { from: string; to: string }) {
  return `${utc.format(new Date(interval.from))} – ${utc.format(new Date(interval.to))} UTC`;
}
