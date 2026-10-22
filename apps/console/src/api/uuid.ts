// Canonical 8-4-4-4-12 hexadecimal identifiers, in either case. Without a `g`
// flag the shared expression keeps no state between calls.
export const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
