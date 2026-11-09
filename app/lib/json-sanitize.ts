export function sanitizeJsonForPostgres(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\u0000", "");
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonForPostgres(item));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJsonForPostgres(item)]));
  }
  return value;
}
