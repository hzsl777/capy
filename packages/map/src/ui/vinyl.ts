// Record Player's own controls (src/map/vinyl.ts draws the turntable and its label). Shown only in that design.
//
// The deck on the plinth has a start/stop key for the platter, which starts and stops the record turning, and a 33
// and 45 speed switch, which sets how fast the record turns and how fast Replay steps through the day. The centre
// label is drawn on the record itself, so it turns with it; this module only tells it the date and the speed.
// Reduced motion keeps the record still: the start key is then switched off.

import { recordSpeed, setLabelDate, setRecordSpeed } from "../map/vinyl.ts";
import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";
import { REPLAY_MS } from "../data.ts";

export interface VinylDeps {
  theme(): ThemeId;
  /** Whether the record is turning. */
  spinning(): boolean;
  start(): void;
  stop(): void;
  /** The date the label shows, as the masthead writes it. */
  date(): string;
  /** Draws the map again, for a label or a speed that changed while the record is at rest. */
  redraw(): void;
}

export { REPLAY_MS };

let deps: VinylDeps | null = null;
/** The reader stopped the platter: the idle spin stays off until they start it again. */
let stopped = false;
let power: HTMLButtonElement | null = null;
let speedKeys: HTMLButtonElement[] = [];
let shown: boolean | null = null;

const on = () => deps?.theme() === "vinyl";

/** How long Replay waits between moments: a third quicker at 45, as a record plays faster at that speed. */
export function replayStepMs(): number {
  return on() && recordSpeed() === 45 ? Math.round((REPLAY_MS * 33) / 45) : REPLAY_MS;
}

/** Whether the reader has stopped the platter, so the map should not start turning on its own. */
export function deckStopped(): boolean {
  return on() && stopped;
}

/** Mounts the deck on the plinth. Call after the map exists. */
export function mountVinyl(d: VinylDeps) {
  deps = d;
  const map = document.getElementById("map")!;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  power = h(
    "button",
    { type: "button", class: "x-deck-key x-deck-power", "aria-pressed": "false", title: still ? "Motion is off" : "Start or stop the turning record" },
    h("span", { class: "x-deck-lamp", "aria-hidden": "true" }),
    "Start / Stop",
  ) as HTMLButtonElement;
  power.disabled = still;
  power.addEventListener("click", () => {
    if (!deps) return;
    if (deps.spinning()) {
      stopped = true;
      deps.stop();
    } else {
      stopped = false;
      deps.start();
    }
    syncVinyl();
  });
  speedKeys = ([33, 45] as const).map((s) => {
    const b = h(
      "button",
      { type: "button", class: "x-deck-key x-deck-speed", role: "radio", "aria-checked": String(s === recordSpeed()), title: `Turn and replay at ${s === 33 ? "the usual" : "a faster"} pace` },
      String(s),
    ) as HTMLButtonElement;
    b.addEventListener("click", () => {
      setRecordSpeed(s);
      syncVinyl();
      deps?.redraw();
    });
    return b;
  });
  const deck = h("div", { class: "x-deck" }, power, h("div", { class: "x-deck-speeds", role: "radiogroup", "aria-label": "Speed" }, ...speedKeys));
  map.append(deck);
  // The label is drawn in the page's own fonts, which may arrive after the first frame.
  void document.fonts?.ready.then(() => deps?.redraw());
  syncVinyl();
}

/**
 * Keeps the keys and the label in step: the start/stop key lit while the record turns, the speed pressed, the label's
 * date. Called on every frame the map draws, so it only touches what changed.
 */
export function syncVinyl() {
  if (!deps) return;
  const vis = on();
  if (vis !== shown) {
    shown = vis;
    if (!vis) stopped = false;
  }
  if (!vis) return;
  const turning = deps.spinning();
  if (power && power.getAttribute("aria-pressed") !== String(turning)) power.setAttribute("aria-pressed", String(turning));
  for (const [i, b] of speedKeys.entries()) {
    const want = String((i === 0 ? 33 : 45) === recordSpeed());
    if (b.getAttribute("aria-checked") !== want) b.setAttribute("aria-checked", want);
  }
  if (setLabelDate(deps.date())) deps.redraw();
}
