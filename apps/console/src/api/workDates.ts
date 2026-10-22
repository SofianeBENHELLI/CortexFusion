export function localDateInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const part = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${part(d.getMonth() + 1)}-${part(d.getDate())}T${part(d.getHours())}:${part(d.getMinutes())}`;
}
export function taskDueAt(input: string): string | undefined {
  if (!input.trim()) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      input,
    )
  )
    throw Error("invalid_date");
  if (
    Number(input.slice(11, 13)) > 23 ||
    Number(input.slice(14, 16)) > 59 ||
    (input[16] === ":" && Number(input.slice(17, 19)) > 59)
  )
    throw Error("invalid_time");
  const calendar = input.slice(0, 10);
  const day = new Date(`${calendar}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== calendar
  )
    throw Error("invalid_calendar_date");
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) throw Error("invalid_date");
  if (input.length === 16 && localDateInput(d.toISOString()) !== input)
    throw Error("invalid_local_date");
  return d.toISOString();
}
export function elapsedLabel(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "date à vérifier";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "moins d’une minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} j`;
}
