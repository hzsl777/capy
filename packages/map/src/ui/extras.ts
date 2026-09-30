// Chrome that four designs add around the map (decision 74). All of it is outside the canvas and hidden by CSS in
// every other design:
// - Spreadsheet: a formula bar over the map whose line is built from the tuned place's name, the column letters
//   and row numbers around the map, lined up with the cells the canvas draws (src/map/sheet.ts).
// - Market Terminal: a header strip over the map with the reticle's latitude and longitude and a UTC clock.
// - Country Club: a small embroidered crest by the name: crossed oars inside a laurel, no animal and no letters.
// - Sleeper Car: a route bar over the map with the time, a line diagram and the next stop.
// Place names go in as text, never as HTML.

import type { ThemeId } from "../themes.ts";
import { columnName, sheetGrid } from "../map/sheet.ts";
import { h } from "./dom.ts";

export interface ExtrasSource {
  theme(): ThemeId;
  /** The names of the places under the reticle, or null. */
  tuned(): string[] | null;
  center(): [number, number];
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
  const brand = document.querySelector(".brand");
  brand?.prepend(crest());
  mapEl.append(routeBar());
  new ResizeObserver(() => layoutSheet()).observe(mapEl);
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
  moveExtras();
  clearInterval(timer);
  timer = 0;
  // Both clocks show hours and minutes only, so a check every fifteen seconds keeps them right.
  if ((theme === "rail" || theme === "terminal") && document.visibilityState === "visible") {
    tick();
    timer = window.setInterval(tick, 15000);
  }
}

const two = (n: number) => String(n).padStart(2, "0");

function tick() {
  const now = new Date();
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
