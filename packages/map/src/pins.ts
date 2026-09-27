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

export function prefs<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(`capy.${key}`) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(`capy.${key}`, value);
  } catch {
    /* ignore */
  }
}
