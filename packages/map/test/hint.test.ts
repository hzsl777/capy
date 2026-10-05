// The first-visit hint is shown once: the flag in localStorage, the fallback when storage fails, and a shared link.
import { describe, expect, it } from "vitest";
import { HINT_KEY, hintGate, type FlagStorage } from "../src/hint.ts";

/** A storage in memory that survives a "reload" (a new gate on the same one). */
function memory(): FlagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("the first-visit hint", () => {
  it("shows on a first visit, once, and never on a later visit", () => {
    const store = memory();
    const first = hintGate(() => store);
    expect(first.claim(false)).toBe(true);
    // Not twice in one page load, whatever calls it.
    expect(first.claim(false)).toBe(false);
    expect(store.data.get(HINT_KEY)).toBe("1");
    // A reload, a new tab, a return the next day: the flag is there.
    expect(hintGate(() => store).claim(false)).toBe(false);
    expect(hintGate(() => store).claim(false)).toBe(false);
  });

  it("shows once per page load when storage throws, on every read and write", () => {
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const load = hintGate(() => broken);
    expect(load.claim(false)).toBe(true);
    expect(load.claim(false)).toBe(false);
    // A new page load has no memory of the last, so it shows again, once.
    const next = hintGate(() => broken);
    expect(next.claim(false)).toBe(true);
    expect(next.claim(false)).toBe(false);
  });

  it("shows once per page load when there is no storage object at all", () => {
    const load = hintGate(() => {
      throw new Error("the accessor throws, as in a private window");
    });
    expect(load.claim(false)).toBe(true);
    expect(load.claim(false)).toBe(false);
    expect(hintGate(() => null).claim(false)).toBe(true);
  });

  it("shows when only the write fails", () => {
    const readOnly: FlagStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const load = hintGate(() => readOnly);
    expect(load.claim(false)).toBe(true);
    expect(load.claim(false)).toBe(false);
  });

  it("does not show on a shared link that opens a place, and leaves the flag for the reader's first plain visit", () => {
    const store = memory();
    expect(hintGate(() => store).claim(true)).toBe(false);
    expect(store.data.has(HINT_KEY)).toBe(false);
    expect(hintGate(() => store).claim(false)).toBe(true);
    expect(hintGate(() => store).claim(true)).toBe(false);
  });

  it("is a reader's flag alone: any stored value counts as having had it", () => {
    const store = memory();
    store.data.set(HINT_KEY, "1");
    expect(hintGate(() => store).claim(false)).toBe(false);
  });
});
