/** Places the viewer follows. Stored only in this browser. */
export interface Pin {
  id: string;
  name: string;
}

const KEY = "capy.pins";

export function loadPins(): Pin[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string") : [];
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
