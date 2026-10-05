// The first-visit hint's once-only rule. A flag in localStorage says the reader has had it; if storage is blocked or
// fails, the hint is shown once per page load instead. A shared link that opens a place directly never shows it and
// leaves the flag alone, so the reader's first plain visit still gets it. Pure but for the storage handed in, so it
// is unit tested.

/** The two calls of localStorage the rule uses. */
export type FlagStorage = Pick<Storage, "getItem" | "setItem">;

export const HINT_KEY = "capy.hint";

/** One gate per page load. `claim` is true at most once per load, and only until the reader has had the hint. */
export function hintGate(storage: () => FlagStorage | null) {
  let shown = false;
  return {
    claim(sharedLink: boolean): boolean {
      if (shown || sharedLink) return false;
      try {
        if (storage()?.getItem(HINT_KEY)) return false;
      } catch {
        /* storage is blocked: fall back to once per load */
      }
      try {
        storage()?.setItem(HINT_KEY, "1");
      } catch {
        /* the same, nothing to write to */
      }
      shown = true;
      return true;
    },
  };
}

/** The window of a drag, in pixels: a press that moves further than this is a drag, one that does not is a tap. */
export const DRAG_PX = 6;
