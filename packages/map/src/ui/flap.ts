// Departures (id flap): the board's moving parts, after the feel of a split-flap departures board in a
// big station hall and nothing else from one: no operator's, airline's, railway's or maker's names, logos, colours,
// lettering or sounds. All of it is chrome outside the canvas, inert in every other design:
// - The site's name and the day's word in flap tiles, one letter per tile (main.ts sets the letters with
//   `lettered`); each tile flips through the letters before its own and lands, a few flaps each, staggered left to
//   right, all landed within a second. Each flip is a small tile's top half folding down over the split, a transform,
//   never a change of light.
// - Each report's row on the board: its time in amber flaps, then its outlet, then the headline (CSS sets the
//   headline in flap cells that wrap to as many rows as it needs, never cut off). Rows stay newest first and are
//   never numbered. When the tuned place changes, the rows turn over to the new place's reports in a quick cascade.
// - A hall clock in the toolbar: a plain cream face with hour bars and two hands, no second hand, set to the
//   reader's own time once a minute.
// Reduced motion shows everything at once, and nothing runs while the tab is hidden.

import { h } from "./dom.ts";

/** The order of characters on a tile's drum: a blank, the letters, then the digits. */
export const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** Milliseconds one flap takes to fall, and how many flaps a tile passes before its own letter. */
export const STEP_MS = 60;
export const STEPS = 5;
/** Every tile of a word has landed within this many milliseconds. */
export const LAND_MS = 900;
/** The longest wait between one tile starting and the next, left to right. */
export const STAGGER_MS = 45;

/**
 * A tile's upper half and its falling flap (style.css, kept in step by test/flap.test.ts): nearly the same dark grey,
 * so a flip is a fold over the letter and never a change of light.
 */
export const TILE_TOP = "#2d383b";
export const FLAP_FACE = "#323e41";

/** The board's rows turning over: how long one row takes, the wait between rows, and how many rows wait at most. */
export const TURN_MS = 240;
export const ROW_MS = 40;
export const TURN_ROWS = 12;

/**
 * The characters a tile shows on its way to `ch`: the `steps` before it on the drum, then `ch` itself. A character
 * not on the drum (an accent, a space) lands at once.
 */
export function flapSequence(ch: string, steps = STEPS): string[] {
  const i = DRUM.indexOf(ch.toUpperCase());
  if (i <= 0 || steps <= 0) return [ch];
  const out: string[] = [];
  for (let k = steps; k >= 1; k--) out.push(DRUM[(i - k + DRUM.length) % DRUM.length]!);
  out.push(ch);
  return out;
}

/** When each of n tiles starts to flip, in milliseconds: left to right, closer together for a long word. */
export function flipStarts(n: number, steps = STEPS): number[] {
  const room = LAND_MS - steps * STEP_MS;
  const gap = n > 1 ? Math.min(STAGGER_MS, room / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => Math.round(i * gap));
}

/** When the last of n tiles has landed. */
export function flipEnd(n: number, steps = STEPS): number {
  return n ? flipStarts(n, steps)[n - 1]! + steps * STEP_MS : 0;
}

/** Which flap a tile shows `t` milliseconds after the word began, from its start: 0 first, `steps` landed. */
export function flapAt(t: number, start: number, steps = STEPS): number {
  return Math.max(0, Math.min(steps, Math.floor((t - start) / STEP_MS)));
}

/** When the board's row i starts to turn over, and when the whole turn has ended for n rows. */
export const rowStart = (i: number) => Math.min(i, TURN_ROWS) * ROW_MS;
export const turnEnd = (n: number) => (n ? rowStart(n - 1) + TURN_MS : 0);

let reduce: MediaQueryList | null = null;
const still = () => {
  if (typeof matchMedia !== "function") return true;
  reduce ??= matchMedia("(prefers-reduced-motion: reduce)");
  return reduce.matches;
};

/** What each slot (the name, the word, a panel title) last showed, so a redraw with the same text doesn't flip again. */
const shown = new Map<string, string>();
const runs = new Map<string, number>();

/**
 * Flips a run of letter tiles (`.lt`, made by `lettered` in main.ts) in to their letters, once per new text in a
 * slot. Each tile starts a few letters back on its drum and lands on its own letter; screen readers have the whole
 * text from the element's label throughout.
 */
export function flipIn(el: HTMLElement, slot: string) {
  const tiles = [...el.querySelectorAll<HTMLElement>(".lt")];
  const finals = tiles.map((t) => t.textContent ?? "");
  const text = finals.join("");
  if (shown.get(slot) === text) return;
  shown.set(slot, text);
  clearTimeout(runs.get(slot));
  if (!tiles.length || still() || document.hidden) return;
  const seqs = finals.map((ch) => flapSequence(ch));
  const starts = flipStarts(tiles.length);
  const at = tiles.map(() => 0);
  tiles.forEach((t, i) => (t.textContent = seqs[i]![0]!));
  const t0 = performance.now();
  const land = () => tiles.forEach((t, i) => {
    t.textContent = finals[i]!;
    t.classList.remove("fl-a", "fl-b");
  });
  const frame = () => {
    // A hidden tab, or a word redrawn meanwhile: every tile shows its own letter at once.
    if (document.hidden || !el.isConnected) return land();
    const now = performance.now() - t0;
    let busy = false;
    tiles.forEach((t, i) => {
      const k = flapAt(now, starts[i]!, seqs[i]!.length - 1);
      if (k < seqs[i]!.length - 1) busy = true;
      if (k === at[i]) return;
      at[i] = k;
      t.textContent = seqs[i]![k]!;
      // Two names for one fold, so each new flap starts its own animation without a reflow.
      const next = t.classList.contains("fl-a") ? "fl-b" : "fl-a";
      t.classList.remove("fl-a", "fl-b");
      t.classList.add(next);
    });
    if (busy) runs.set(slot, window.setTimeout(frame, STEP_MS / 2));
    else runs.set(slot, window.setTimeout(land, STEP_MS));
  };
  runs.set(slot, window.setTimeout(frame, STEP_MS / 2));
}

const two = (n: number) => String(n).padStart(2, "0");

/** A report's time on the board: hours and minutes on the reader's own clock, as a board shows them. */
export function boardClock(t: number): string {
  const d = new Date(t * 1000);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The start of a report's row: its time in amber flaps and its outlet (with the outlet's own city), or the time alone
 * where the panel's header already names the place's one outlet.
 */
export function boardHead(t: number, outlet: string | null): HTMLElement {
  return h(
    "span",
    { class: "fl-row" },
    h("time", { class: "fl-time", datetime: new Date(t * 1000).toISOString() }, boardClock(t)),
    outlet ? h("span", { class: "fl-outlet" }, outlet) : null,
  );
}

let boardKey = "";
let turnTimer = 0;

/**
 * After a place's panel is drawn: the board's column heads over its rows, and when the tuned place has changed, the
 * rows turn over to the new reports, top to bottom, each a short fold from left to right. The order is the panel's
 * own, newest first; nothing here numbers or reorders a row.
 */
export function boardTurn(panel: HTMLElement, key: string) {
  const first = panel.querySelector(".stories-group, .stories");
  if (first && !panel.querySelector(".fl-heads")) {
    first.before(h("div", { class: "fl-heads", "aria-hidden": "true" }, h("span", {}, "Time"), h("span", {}, "Outlet and report")));
  }
  if (key === boardKey) return;
  boardKey = key;
  clearTimeout(turnTimer);
  panel.classList.remove("fl-turn");
  if (still() || document.hidden) return;
  const rows = [...panel.querySelectorAll<HTMLElement>(".stories > li")];
  rows.forEach((li, i) => li.style.setProperty("--fl-i", String(Math.min(i, TURN_ROWS))));
  void panel.offsetWidth;
  panel.classList.add("fl-turn");
  turnTimer = window.setTimeout(() => panel.classList.remove("fl-turn"), turnEnd(rows.length) + 60);
}

const NS = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The hands' angles in degrees from twelve o'clock for a time of day. */
export function handAngles(hours: number, minutes: number): { hour: number; minute: number } {
  return { hour: ((hours % 12) + minutes / 60) * 30, minute: minutes * 6 };
}

/**
 * The hall clock in the toolbar: a cream face with twelve blue hour bars and two dark hands, set once a minute to the
 * reader's time. Hidden by CSS in every other design; it does nothing while the tab is hidden.
 */
export function mountBoard(toolbar: HTMLElement, masthead: HTMLElement) {
  if (document.querySelector(".fl-clock")) return;
  const face = svg("svg", { viewBox: "-50 -50 100 100", "aria-hidden": "true" });
  face.append(svg("circle", { r: 46, fill: "#f3ecd6", stroke: "#a58848", "stroke-width": 6 }));
  for (let i = 0; i < 12; i++) face.append(svg("rect", { x: -3, y: -40, width: 6, height: 12, fill: "#15406b", transform: `rotate(${i * 30})` }));
  const hourHand = svg("rect", { x: -4, y: -24, width: 8, height: 30, fill: "#1b2a33" });
  const minuteHand = svg("rect", { x: -3, y: -38, width: 6, height: 44, fill: "#1b2a33" });
  face.append(hourHand, minuteHand);
  const box = h("span", { class: "fl-clock", role: "img" }, face as unknown as Node);
  // On a phone the toolbar's one row holds the four controls, so the clock hangs in the masthead's corner instead,
  // opposite About.
  const phone = matchMedia("(max-width: 760px)");
  const place = () => (phone.matches ? masthead : toolbar).append(box);
  phone.addEventListener("change", place);
  place();
  let timer = 0;
  const tick = () => {
    clearTimeout(timer);
    if (document.hidden) return;
    const now = new Date();
    const a = handAngles(now.getHours(), now.getMinutes());
    hourHand.setAttribute("transform", `rotate(${a.hour})`);
    minuteHand.setAttribute("transform", `rotate(${a.minute})`);
    box.setAttribute("aria-label", `Clock, ${two(now.getHours())}:${two(now.getMinutes())}`);
    timer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };
  document.addEventListener("visibilitychange", tick);
  tick();
}
