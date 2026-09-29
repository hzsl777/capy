// Postgres refuses the NUL character in text and in JSON, so one stray control character in a feed, a page or a
// model's answer used to fail the whole write. Tab, newline and carriage return are kept.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function noControl(s: string): string {
  return s.replace(CONTROL, "");
}

/** The same for every string inside a parsed JSON value. */
export function noControlDeep<T>(value: T): T {
  if (typeof value === "string") return noControl(value) as T;
  if (Array.isArray(value)) return value.map(noControlDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noControlDeep(v)])) as T;
  return value;
}
