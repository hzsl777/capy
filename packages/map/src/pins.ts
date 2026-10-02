/**
 * Places the viewer follows. Stored only in this browser. `seen` is when the reader last looked at the place, on the
 * map's own clock (unix seconds, the end of the stretch of reports they could see), so a report that reaches the map
 * late still counts as new. A pin saved before last looks were kept has none until the day's file starts its clock.
 */
export interface Pin {
  id: string;
  name: string;
  seen?: number;
}

const KEY = "capy.pins";

export function loadPins(): Pin[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((p) => p && typeof p.id === "string")
      .map((p) => (typeof p.seen === "number" && Number.isFinite(p.seen) ? p : { id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

export function savePins(pins: Pin[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    /* private mode: pins last for this visit only */
  }
}

/** The pins with `id` looked at as of `at`. The time never goes back, so an older file can't bring old reports back as new. */
export function markSeen(pins: readonly Pin[], id: string, at: number): Pin[] {
  return pins.map((p) => (p.id === id ? { ...p, seen: Math.max(p.seen ?? at, at) } : p));
}

/** Pins with no last look yet start the clock at `at`, so nothing is new at a place until reports come in after it. */
export function startClocks(pins: readonly Pin[], at: number): Pin[] {
  return pins.map((p) => (p.seen === undefined ? { ...p, seen: at } : p));
}

/** A report is new at a pinned place when it came out after the reader's last look there. Never without a last look. */
export function isNew(t: number, seen: number | undefined): boolean {
  return seen !== undefined && t > seen;
}

/**
 * How many reports came out at each pinned place since the reader last looked there, by place index. `seen` holds the
 * pinned places' last looks; every other place is skipped, and a place with nothing new is left out.
 */
export function newCounts(items: Iterable<{ place: number; t: number }>, seen: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const it of items) if (isNew(it.t, seen.get(it.place))) out.set(it.place, (out.get(it.place) ?? 0) + 1);
  return out;
}

/** A saved choice, if it is still allowed. `rename` maps a value saved under an old name to its new one. */
export function prefs<T extends string>(key: string, fallback: T, allowed: readonly T[], rename: (v: string | null) => T | null = (v) => v as T | null): T {
  try {
    const v = rename(localStorage.getItem(`capy.${key}`));
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** A saved value as stored, or "" when there is none or storage is blocked. Callers check what they read. */
export function rawPref(key: string): string {
  try {
    return localStorage.getItem(`capy.${key}`) ?? "";
  } catch {
    return "";
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(`capy.${key}`, value);
  } catch {
    /* ignore */
  }
}
