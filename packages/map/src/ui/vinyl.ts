// Record Player's own controls and its centre label (src/map/vinyl.ts draws the turntable). Shown only in that design.
//
// The deck on the plinth has a start/stop key for the platter, which starts and stops the map's idle spin, and a 33
// and 45 speed switch, which sets how fast Replay steps through the day (the one thing it changes). The centre label
// is our own design: the site's name and the date in a round paper label, with the speed the switch is set to. It sits
// under the map's canvas, which leaves a hole for it round the spindle where no place lies, so every marker is drawn
// over it; the canvas moves it with the record.

import { SITE_NAME } from "../brand.ts";
import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";

export interface VinylDeps {
  theme(): ThemeId;
  /** Whether the map is turning on its own. */
  spinning(): boolean;
  start(): void;
  stop(): void;
  /** The date the label shows, as the masthead writes it. */
  date(): string;
}

/** Replay's step between moments, in milliseconds, at 33: the pace it has in every design. */
export const REPLAY_MS = 220;

let deps: VinylDeps | null = null;
let speed: 33 | 45 = 33;
/** The reader stopped the platter: the idle spin stays off until they start it again. */
let stopped = false;
let power: HTMLButtonElement | null = null;
let speedKeys: HTMLButtonElement[] = [];
let labelDate: SVGTextPathElement | null = null;
let labelSpeed: SVGTextElement | null = null;
let shown: boolean | null = null;

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const on = () => deps?.theme() === "vinyl";

/** How long Replay waits between moments: a third quicker at 45, as a record plays faster at that speed. */
export function replayStepMs(): number {
  return on() && speed === 45 ? Math.round((REPLAY_MS * 33) / 45) : REPLAY_MS;
}

/** Whether the reader has stopped the platter, so the map should not start turning on its own. */
export function deckStopped(): boolean {
  return on() && stopped;
}

/** The label: paper with a band, two printed rings, the name round the top, the date round the foot, the speed. */
function label(): HTMLElement {
  const root = svg("svg", { viewBox: "-50 -50 100 100", width: 100, height: 100, "aria-hidden": "true", focusable: "false" });
  const defs = svg("defs", {});
  // Text runs clockwise over the top and anticlockwise under the foot, so both read left to right.
  defs.append(svg("path", { id: "x-vinyl-top", d: "M -34 0 A 34 34 0 0 1 34 0" }), svg("path", { id: "x-vinyl-foot", d: "M -39 0 A 39 39 0 0 0 39 0" }));
  root.append(
    defs,
    svg("circle", { r: 50, class: "x-vinyl-paper" }),
    svg("circle", { r: 47, class: "x-vinyl-band" }),
    svg("circle", { r: 44.5, class: "x-vinyl-paper" }),
    svg("circle", { r: 27, class: "x-vinyl-rule" }),
    svg("circle", { r: 24.5, class: "x-vinyl-rule thin" }),
  );
  const name = svg("text", { class: "x-vinyl-name" });
  name.append(svg("textPath", { href: "#x-vinyl-top", startOffset: "50%", "text-anchor": "middle" }, SITE_NAME.toUpperCase()));
  const date = svg("text", { class: "x-vinyl-date" });
  labelDate = svg("textPath", { href: "#x-vinyl-foot", startOffset: "50%", "text-anchor": "middle" }, "");
  date.append(labelDate);
  labelSpeed = svg("text", { class: "x-vinyl-speed", x: 0, y: 17, "text-anchor": "middle" }, "33");
  root.append(name, date, labelSpeed, svg("circle", { r: 3.6, class: "x-vinyl-spindle" }), svg("circle", { r: 1.6, class: "x-vinyl-spindle-top" }));
  const el = h("div", { class: "x-vinyl-label", hidden: "" });
  el.append(root);
  return el;
}

/** Mounts the label under the map's canvas and the deck on the plinth. Call after the map exists. */
export function mountVinyl(d: VinylDeps) {
  deps = d;
  const map = document.getElementById("map")!;
  // First in the map, so under the canvas: markers are always drawn over the label.
  map.prepend(label());

  power = h("button", { type: "button", class: "x-deck-key x-deck-power", "aria-pressed": "false", title: "Start or stop the turning record" }, h("span", { class: "x-deck-lamp", "aria-hidden": "true" }), "Start / Stop") as HTMLButtonElement;
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
    const b = h("button", { type: "button", class: "x-deck-key x-deck-speed", role: "radio", "aria-checked": String(s === speed), title: `Replay at ${s === 33 ? "the usual" : "a faster"} pace` }, String(s)) as HTMLButtonElement;
    b.addEventListener("click", () => {
      speed = s;
      syncVinyl();
    });
    return b;
  });
  const deck = h(
    "div",
    { class: "x-deck" },
    power,
    h("div", { class: "x-deck-speeds", role: "radiogroup", "aria-label": "Replay speed" }, ...speedKeys),
  );
  map.append(deck);
  syncVinyl();
}

/**
 * Keeps the keys and the label in step: the start/stop key lit while the record turns on its own, the speed pressed,
 * the label's date and speed. Called on every frame the map draws, so it only touches what changed.
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
    const want = String((i === 0 ? 33 : 45) === speed);
    if (b.getAttribute("aria-checked") !== want) b.setAttribute("aria-checked", want);
  }
  const date = deps.date();
  if (labelDate && labelDate.textContent !== date) labelDate.textContent = date;
  if (labelSpeed && labelSpeed.textContent !== String(speed)) labelSpeed.textContent = String(speed);
}
