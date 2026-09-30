// Chrome that four designs add around the map (decision 74). All of it is outside the canvas and hidden by CSS in
// every other design:
// - Spreadsheet: a formula bar over the map whose line is built from the tuned place's name, the column letters
//   and row numbers around the map, lined up with the cells the canvas draws (src/map/sheet.ts).
// - Market Terminal: a header strip over the map with the reticle's latitude and longitude and a UTC clock.
// - Country Club: a small embroidered crest by the name: crossed oars inside a laurel, no animal and no letters.
// - Sleeper Car: a route bar over the map with the time, a line diagram and the next stop.
// - Rave: the DJ booth along the bottom of the map: two turntables and, between them, the waveforms of the two
//   tracks over a mixer. Our own plain drawings, no brand's deck; no text.
// - Old Realm: a carved stone ring with brass rivets and a compass rose around the round minimap in Map view.
// - Tactical: a HUD around the map: corner brackets, a clock since the day's map was built, and a short feed of the
//   newest headlines in the corner, newest first, as text.
// Place names go in as text, never as HTML.

import type { ThemeId } from "../themes.ts";
import { columnName, sheetGrid } from "../map/sheet.ts";
import { minimapDisc, minimapMargin } from "../map/minimap.ts";
import { h } from "./dom.ts";

export interface ExtrasSource {
  theme(): ThemeId;
  /** The names of the places under the reticle, or null. */
  tuned(): string[] | null;
  center(): [number, number];
  /** Tactical's feed: the newest headlines, newest first, each with its place and how to open it. */
  latest?(): { place: string; title: string; open(): void }[];
  /** When the day's map was built, in seconds, or null before it loads. */
  builtAt?(): number | null;
}

const NS = "http://www.w3.org/2000/svg";
/** Height of the formula bar and of the column letters, and width of the row numbers, in CSS pixels. */
const FORMULA_H = 28;
const COLS_H = 18;
const ROWS_W = 34;

let src: ExtrasSource | null = null;
let mapEl: HTMLElement;
let nameBox: HTMLElement;
let formula: HTMLElement;
let cols: HTMLElement;
let rows: HTMLElement;
let readout: HTMLElement;
let utc: HTMLElement;
let railStops: HTMLElement[] = [];
let railLine: HTMLElement;
let railClock: HTMLElement;
let railNext: HTMLElement;
let railPassed = -1;
let timer = 0;
let cell = "";
let ring: HTMLElement;
let ringFor = "";
let round: HTMLElement;
let feed: HTMLElement;
let feedKey = "";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Crossed oars inside a laurel, stitched in gold and cream on a navy shield. */
function crest(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 48 56", class: "x-crest", "aria-hidden": "true" });
  s.append(
    svg("path", { d: "M4 4H44V28C44 42 34 50 24 54C14 50 4 42 4 28Z", fill: "#1d2b4d", stroke: "#c9a043", "stroke-width": 2 }),
    svg("path", { d: "M7.5 7.5H40.5V28C40.5 40 32 47 24 50.5C16 47 7.5 40 7.5 28Z", fill: "none", stroke: "#efe6cf", "stroke-width": 0.8, "stroke-dasharray": "1.6 1.4" }),
  );
  // Two oars crossed: a shaft and a blade each.
  for (const flip of [1, -1]) {
    const g = svg("g", { transform: `translate(24 27) scale(${flip} 1) rotate(-38)` });
    g.append(
      svg("path", { d: "M0 -17V12", stroke: "#efe6cf", "stroke-width": 1.6, "stroke-linecap": "round" }),
      svg("path", { d: "M-2.6 11C-3 15 -2.2 19 0 20.5C2.2 19 3 15 2.6 11Z", fill: "#efe6cf" }),
      svg("path", { d: "M-1.6 -17H1.6", stroke: "#c9a043", "stroke-width": 1.4 }),
    );
    s.append(g);
  }
  // A laurel: leaves along two arcs under the oars.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI / 180) * (200 - i * 16);
      const x = 24 + side * Math.cos(a) * -13;
      const y = 30 - Math.sin(a) * 13;
      s.append(svg("ellipse", { cx: x.toFixed(1), cy: y.toFixed(1), rx: 2.6, ry: 1.2, fill: "#5f9a5a", transform: `rotate(${(side * (60 - i * 18)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})` }));
    }
  }
  s.append(svg("path", { d: "M14 45Q24 50 34 45", fill: "none", stroke: "#b3262e", "stroke-width": 2.2 }));
  return s;
}

/** Stops on the route diagram, evenly spaced; the train's mark sits between them by the reticle's longitude. */
const STOPS = 9;

/**
 * Sleeper Car's route bar over the map, like a modern train's on-board display: the time, a line diagram of the
 * route with the stops already passed greyed, and the next stop, which is the tuned place's name. The train's mark
 * follows the reticle's longitude from west to east; the stops have no names, so it links no place to another.
 */
function routeBar(): HTMLElement {
  railStops = Array.from({ length: STOPS }, () => h("span", { class: "x-stop" }));
  railLine = h("span", { class: "x-line" }, ...railStops, h("span", { class: "x-train" }));
  railClock = h("span", { class: "x-rclock" });
  railNext = h("span", { class: "x-next-name" });
  return h(
    "div",
    { class: "x-route", "aria-hidden": "true" },
    railClock,
    railLine,
    h("span", { class: "x-next" }, h("span", { class: "x-next-label" }, "Next stop"), railNext),
  );
}

/** A turntable seen from above: the plinth, the platter with a record whose label turns, and the tone arm. */
function turntable(label: string): SVGElement {
  const s = svg("svg", { viewBox: "0 0 100 100", class: "x-deck", "aria-hidden": "true" });
  s.append(
    svg("rect", { x: 2, y: 2, width: 96, height: 96, rx: 7, fill: "#16111f", stroke: "#2e2542", "stroke-width": 1.5 }),
    svg("circle", { cx: 44, cy: 50, r: 41, fill: "#0b0911", stroke: "#3a3150", "stroke-width": 1.5 }),
  );
  const record = svg("g", { class: "x-record" });
  record.append(svg("circle", { cx: 44, cy: 50, r: 37, fill: "#050308" }));
  for (const r of [33, 29, 25, 21, 17]) record.append(svg("circle", { cx: 44, cy: 50, r, fill: "none", stroke: "rgba(255,255,255,0.07)", "stroke-width": 0.8 }));
  // A sheen across the grooves and a stripe on the label, so the record is seen to turn.
  record.append(
    svg("path", { d: "M44 50L44 13A37 37 0 0 1 70 24Z", fill: "rgba(255,255,255,0.06)" }),
    svg("circle", { cx: 44, cy: 50, r: 11, fill: label }),
    svg("rect", { x: 42.5, y: 39.5, width: 3, height: 8, fill: "#0b0911" }),
  );
  s.append(
    record,
    svg("circle", { cx: 44, cy: 50, r: 1.6, fill: "#d8d2e6" }),
    svg("circle", { cx: 87, cy: 15, r: 6, fill: "#2a2238", stroke: "#4a4060", "stroke-width": 1 }),
    svg("path", { d: "M87 15L85 58L72 70", fill: "none", stroke: "#b9b3c8", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    svg("rect", { x: 66, y: 67, width: 9, height: 6, rx: 1, fill: "#d8d2e6", transform: "rotate(-40 70.5 70)" }),
    svg("rect", { x: 8, y: 84, width: 13, height: 8, rx: 2, fill: "none", stroke: label, "stroke-width": 1.4 }),
  );
  return s;
}

/**
 * The two tracks' waveforms scrolling past the playhead, as on a DJ's screen: bars of a fixed made-up track, drawn
 * twice over so the loop has no seam.
 */
function waveform(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 600 40", preserveAspectRatio: "none", class: "x-wave", "aria-hidden": "true" });
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lanes = [
    { y: 10, color: "#9dff2e", d: "" },
    { y: 30, color: "#3ff0ff", d: "" },
  ];
  lanes.forEach((lane, k) => {
    const amps = Array.from({ length: 150 }, (_, i) => {
      // A kick every eighth bar and a slow swell over the phrase.
      const kick = (i + k * 3) % 8 === 0 ? 0.35 : 0;
      return Math.min(1, 0.2 + 0.45 * Math.abs(Math.sin((i + k * 20) * 0.09)) * (0.5 + rnd() * 0.5) + kick);
    });
    for (let copy = 0; copy < 2; copy++)
      amps.forEach((a, i) => {
        const x = copy * 600 + i * 4 + 2;
        lane.d += `M${x} ${(lane.y - a * 8.5).toFixed(1)}V${(lane.y + a * 8.5).toFixed(1)}`;
      });
  });
  const run = svg("g", { class: "x-wave-run" });
  for (const lane of lanes) run.append(svg("path", { d: lane.d, stroke: lane.color, "stroke-width": 2.2, fill: "none" }));
  s.append(run, svg("line", { x1: 300, y1: 0, x2: 300, y2: 40, stroke: "#ffffff", "stroke-width": 1.4 }));
  return s;
}

/** The mixer between the decks: a knob column and a meter per channel, and the crossfader. */
function mixer(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 200 30", class: "x-mixer", "aria-hidden": "true" });
  s.append(svg("rect", { x: 1, y: 1, width: 198, height: 28, rx: 4, fill: "#16111f", stroke: "#2e2542", "stroke-width": 1 }));
  for (const [x0, dir] of [
    [14, 1],
    [186, -1],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      const x = x0 + dir * k * 15;
      s.append(
        svg("circle", { cx: x, cy: 15, r: 5, fill: "#241c34", stroke: "#4a4060", "stroke-width": 1 }),
        svg("line", { x1: x, y1: 15, x2: x + dir * 2.5, y2: 11, stroke: "#d8d2e6", "stroke-width": 1.2 }),
      );
    }
    // A level meter, lit to a fixed height: green, then violet at the top.
    for (let k = 0; k < 6; k++)
      s.append(svg("rect", { x: x0 + dir * 50 - 2, y: 24 - k * 3.4, width: 4, height: 2.4, fill: k < 4 ? "#9dff2e" : k < 5 ? "#8a4dff" : "#2e2542" }));
  }
  s.append(
    svg("rect", { x: 72, y: 14, width: 56, height: 2.4, rx: 1.2, fill: "#05030a" }),
    svg("rect", { x: 96, y: 8, width: 8, height: 14, rx: 1.5, fill: "#d8d2e6" }),
    svg("line", { x1: 100, y1: 9.5, x2: 100, y2: 20.5, stroke: "#ff3fd4", "stroke-width": 1.2 }),
  );
  return s;
}

function booth(): HTMLElement {
  return h("div", { class: "x-booth", "aria-hidden": "true" }, turntable("#9dff2e"), h("div", { class: "x-booth-mid" }, waveform(), mixer()), turntable("#ff3fd4"));
}

export function mountExtras(source: ExtrasSource) {
  src = source;
  mapEl = document.getElementById("map")!;
  nameBox = h("span", { class: "x-namebox" });
  formula = h("span", { class: "x-formula-text" });
  cols = h("div", { class: "x-cols" });
  rows = h("div", { class: "x-rows" });
  mapEl.append(
    h("div", { class: "x-formula", "aria-hidden": "true" }, nameBox, h("span", { class: "x-fx" }, "fx"), formula),
    h("div", { class: "x-corner", "aria-hidden": "true" }),
    cols,
    rows,
  );
  cols.setAttribute("aria-hidden", "true");
  rows.setAttribute("aria-hidden", "true");
  readout = h("span", { class: "x-readout" });
  utc = h("span", { class: "x-utc" });
  mapEl.append(h("div", { class: "x-term", "aria-hidden": "true" }, h("span", { class: "x-fkey" }, "F1"), h("span", { class: "x-term-title" }, "MAP"), readout, utc));
  mapEl.append(booth());
  ring = h("div", { class: "x-ring", "aria-hidden": "true" });
  round = h("span", { class: "x-round-time" });
  feed = h("ol", { class: "x-feed-list" });
  mapEl.append(
    ring,
    h("div", { class: "x-hud", "aria-hidden": "true" }, h("div", { class: "x-round" }, round, h("span", { class: "x-round-note" }, "since the map was built"))),
    h("section", { class: "x-feed", "aria-label": "Newest headlines" }, feed),
  );
  const brand = document.querySelector(".brand");
  brand?.prepend(crest());
  mapEl.append(routeBar());
  new ResizeObserver(() => {
    layoutSheet();
    layoutRing();
    // A short map (a phone with the reader open) keeps only the newest line of Tactical's feed.
    feed.classList.toggle("short", mapEl.clientHeight < 220);
  }).observe(mapEl);
  document.addEventListener("visibilitychange", () => refreshExtras());
  refreshExtras();
}

/** Letters and numbers lined up with the canvas's cells; the selected cell's column and row are marked. */
function layoutSheet() {
  if (!src || src.theme() !== "sheet") return;
  const w = mapEl.clientWidth, hh = mapEl.clientHeight;
  const g = sheetGrid(w, hh);
  mapEl.style.setProperty("--cell-w", `${g.cw}px`);
  mapEl.style.setProperty("--cell-h", `${g.ch}px`);
  const top = FORMULA_H + COLS_H;
  // The first column and row whose cell starts at or after the headers' edge get A and 1.
  const i0 = Math.ceil((ROWS_W - 2 - g.x0) / g.cw);
  const j0 = Math.ceil((top - 2 - g.y0) / g.ch);
  const ci = Math.floor((w / 2 - g.x0) / g.cw);
  const cj = Math.floor((hh / 2 - g.y0) / g.ch);
  const colSpans: HTMLElement[] = [];
  for (let i = i0; i < g.cols; i++) {
    const s = h("span", { class: i === ci ? "on" : undefined }, columnName(i - i0));
    s.style.left = `${g.x0 + i * g.cw - ROWS_W}px`;
    s.style.width = `${g.cw}px`;
    colSpans.push(s);
  }
  const rowSpans: HTMLElement[] = [];
  for (let j = j0; j < g.rows; j++) {
    const s = h("span", { class: j === cj ? "on" : undefined }, String(j - j0 + 1));
    s.style.top = `${g.y0 + j * g.ch - top}px`;
    s.style.height = `${g.ch}px`;
    rowSpans.push(s);
  }
  cols.replaceChildren(...colSpans);
  rows.replaceChildren(...rowSpans);
  cell = `${columnName(ci - i0)}${cj - j0 + 1}`;
  nameBox.textContent = cell;
}

/**
 * Old Realm's ring: carved grey stone with a brass lip, brass rivets, and a small compass rose set into it at the
 * upper right. Built again only when the map's size changes; the canvas clips the map to the same circle.
 */
function layoutRing() {
  if (!src || src.theme() !== "realm") return;
  const w = mapEl.clientWidth, hh = mapEl.clientHeight;
  const key = `${w}x${hh}`;
  if (!w || !hh || key === ringFor) return;
  ringFor = key;
  const { cx, cy, r } = minimapDisc(w, hh);
  const m = minimapMargin(w, hh);
  const band = m * 0.95;
  const s = svg("svg", { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh });
  const defs = svg("defs", {});
  const stone = svg("radialGradient", { id: "x-stone", cx, cy, r: r + band, gradientUnits: "userSpaceOnUse" });
  stone.append(
    svg("stop", { offset: (r / (r + band)).toFixed(3), "stop-color": "#4c4a45" }),
    svg("stop", { offset: ((r + band * 0.45) / (r + band)).toFixed(3), "stop-color": "#8d8a80" }),
    svg("stop", { offset: "1", "stop-color": "#3e3c38" }),
  );
  const boss = svg("radialGradient", { id: "x-boss", cx: "40%", cy: "35%", r: "70%" });
  boss.append(svg("stop", { offset: "0", "stop-color": "#9a968b" }), svg("stop", { offset: "1", "stop-color": "#45423d" }));
  const brass = svg("radialGradient", { id: "x-brass", cx: "35%", cy: "30%", r: "75%" });
  brass.append(svg("stop", { offset: "0", "stop-color": "#fff0b8" }), svg("stop", { offset: "0.45", "stop-color": "#c99a3c" }), svg("stop", { offset: "1", "stop-color": "#5e3f12" }));
  defs.append(stone, boss, brass);
  s.append(defs);
  // A soft shadow inside the window, then the stone band, its chisel marks, and the brass lip.
  s.append(svg("circle", { cx, cy, r: r + 3, fill: "none", stroke: "rgba(0,0,0,0.45)", "stroke-width": 8 }));
  s.append(svg("circle", { cx, cy, r: r + band / 2, fill: "none", stroke: "url(#x-stone)", "stroke-width": band }));
  s.append(svg("circle", { cx, cy, r: r + band - 1, fill: "none", stroke: "#23211e", "stroke-width": 2 }));
  s.append(svg("circle", { cx, cy, r: r + band * 0.5, fill: "none", stroke: "rgba(30,28,24,0.35)", "stroke-width": 1, "stroke-dasharray": "3 9 1 6" }));
  s.append(svg("circle", { cx, cy, r: r + 1.5, fill: "none", stroke: "#d8b060", "stroke-width": 3 }));
  s.append(svg("circle", { cx, cy, r: r + 3.5, fill: "none", stroke: "#5e3f12", "stroke-width": 1 }));
  // Rivets around the band, leaving room for the compass rose.
  const n = w < 520 ? 12 : 16;
  const rose = -Math.PI / 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
    if (Math.abs(Math.atan2(Math.sin(a - rose), Math.cos(a - rose))) < 0.35) continue;
    const rr = r + band * 0.55;
    s.append(svg("circle", { cx: (cx + Math.cos(a) * rr).toFixed(1), cy: (cy + Math.sin(a) * rr).toFixed(1), r: Math.max(2.2, band * 0.16).toFixed(1), fill: "url(#x-brass)", stroke: "#2c1d08", "stroke-width": 0.8 }));
  }
  // The compass rose on a stone boss: four long points and four short ones, north in red, no letters.
  const k = Math.max(17, m * 0.95);
  const bx = cx + Math.cos(rose) * (r + band * 0.5);
  const by = cy + Math.sin(rose) * (r + band * 0.5);
  const g = svg("g", { transform: `translate(${bx.toFixed(1)} ${by.toFixed(1)})` });
  g.append(
    svg("circle", { r: k, fill: "url(#x-boss)", stroke: "#23211e", "stroke-width": 2 }),
    svg("circle", { r: k - 3, fill: "#3b2a18", stroke: "#d8b060", "stroke-width": 2 }),
  );
  const pt = (len: number, wid: number, turn: number, fill: string) =>
    svg("path", { d: `M0 ${(-len).toFixed(1)}L${wid.toFixed(1)} 0L0 ${wid.toFixed(1)}L${(-wid).toFixed(1)} 0Z`, fill, stroke: "#2c1d08", "stroke-width": 0.6, transform: `rotate(${turn})` });
  for (const turn of [45, 135, 225, 315]) g.append(pt(k * 0.55, k * 0.16, turn, "#9c7a3a"));
  for (const turn of [90, 180, 270]) g.append(pt(k * 0.8, k * 0.2, turn, "#e9d9a6"));
  g.append(pt(k * 0.8, k * 0.2, 0, "#c8402c"), svg("circle", { r: (k * 0.12).toFixed(1), fill: "url(#x-brass)" }));
  s.append(g);
  ring.replaceChildren(s);
}

/** Tactical's feed: rebuilt only when its headlines change, so a button keeps focus while the map turns. */
function layoutFeed() {
  const list = src?.theme() === "tactical" ? (src.latest?.() ?? []) : [];
  const key = list.map((it) => `${it.place}|${it.title}`).join("\n");
  if (key === feedKey) return;
  feedKey = key;
  feed.replaceChildren(
    ...list.map((it) => {
      const b = h("button", { type: "button", class: "x-feed-item", title: it.title }, h("b", {}, it.place), h("span", { class: "x-feed-sep", "aria-hidden": "true" }), h("span", { class: "x-feed-title" }, it.title));
      b.addEventListener("click", () => it.open());
      return h("li", {}, b);
    }),
  );
}

/** Tactical's clock: hours, minutes and seconds since the day's map was built; past 99 hours it counts days. */
function tickRound(now: Date) {
  const built = src?.builtAt?.();
  if (!built) {
    round.textContent = "--:--";
    return;
  }
  const total = Math.max(0, Math.floor(now.getTime() / 1000 - built));
  const hrs = Math.floor(total / 3600);
  const two = (v: number) => String(v).padStart(2, "0");
  const mins = two(Math.floor(total / 60) % 60);
  if (hrs > 99) round.textContent = `${Math.floor(hrs / 24)}d ${two(hrs % 24)}:${mins}`;
  // With reduced motion the seconds don't run; the clock steps once a minute.
  else round.textContent = reduced ? `${two(hrs)}:${mins}` : `${two(hrs)}:${mins}:${two(total % 60)}`;
}

const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** Everything that follows the design or the tuned place. Cheap: called on every tune and theme change. */
export function refreshExtras() {
  if (!src) return;
  const theme = src.theme();
  if (theme === "sheet") {
    layoutSheet();
    const names = src.tuned();
    formula.textContent = names?.length ? `=REPORTS(${names.slice(0, 3).map(quote).join(", ")}${names.length > 3 ? ", ..." : ""})` : "=LATEST()";
  }
  if (theme === "rail") {
    const names = src.tuned();
    railNext.textContent = names?.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}` : "";
  }
  if (theme === "realm") layoutRing();
  layoutFeed();
  moveExtras();
  clearInterval(timer);
  timer = 0;
  // The clocks show hours and minutes only, so a check every fifteen seconds keeps them right; Tactical's counts seconds.
  if ((theme === "rail" || theme === "terminal" || theme === "tactical") && document.visibilityState === "visible") {
    tick();
    timer = window.setInterval(tick, theme === "tactical" && !reduced ? 1000 : 15000);
  }
}

const two = (n: number) => String(n).padStart(2, "0");

function tick() {
  const now = new Date();
  if (src?.theme() === "tactical") return tickRound(now);
  utc.textContent = `${two(now.getUTCHours())}:${two(now.getUTCMinutes())} UTC`;
  railClock.textContent = `${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** On every move of the map: the terminal's readout of the reticle's position, and the train's mark on the route. */
export function moveExtras() {
  if (!src) return;
  const theme = src.theme();
  if (theme === "rail") {
    // West to east along the line: the stops left of the mark are passed. Only a change of stop touches the stops.
    const at = ((((src.center()[0] + 180) % 360) + 360) % 360) / 360;
    railLine.style.setProperty("--at", `${(at * 100).toFixed(2)}%`);
    const passed = Math.floor(at * (STOPS - 1));
    if (passed !== railPassed) {
      railPassed = passed;
      railStops.forEach((s, i) => s.classList.toggle("passed", i <= passed));
    }
    return;
  }
  if (theme !== "terminal") return;
  const [lon, lat] = src.center();
  const fmt = (v: number, w: number) => Math.abs(v).toFixed(2).padStart(w, "0");
  readout.textContent = `LAT ${fmt(lat, 5)}${lat >= 0 ? "N" : "S"}  LON ${fmt(lon, 6)}${lon >= 0 ? "E" : "W"}`;
}
