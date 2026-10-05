// Machine Music's rack under the map (experimental, src/map/machine.ts has its timing and its picture). A strip of
// its own below the map, so the map keeps its whole frame, built like a rack of modules and hidden by CSS in every
// other design. Two kinds of module:
// - Controls that do real things, as real buttons: a transport key (Replay), a rocker for Map and Globe, zoom keys
//   with a column of lamps showing the detail level, four tuning keys that move the map as the arrow keys do (the
//   place nearest the reticle then glides under it, decision 125), and a display of the reticle's longitude and
//   latitude. Each one presses the page's own control or key, so nothing here can do what the page cannot.
// - Machinery that is decoration only: a sixteen-step sequencer whose lit step walks two steps a second, a scope trace,
//   two needle meters and four knobs. They carry no data and mean nothing, hold still for reduced motion and stop in
//   a hidden tab.
// No text from the news goes in here; the legends are our own words.

import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";
import { latText, lonText, METER_SWING_S, SCOPE_PASS_S, SEQ_FADE_S, SEQ_HZ, SEQ_PATTERN, SEQ_STEPS, seqStep, zoomLamps } from "../map/machine.ts";

export interface MachineSource {
  theme(): ThemeId;
  center(): [number, number];
  /** The map's detail level, 0 (the widest) up to `LAMPS - 1`. */
  level(): number;
}

/** Lamps in the zoom column: the map's levels, 0 to 4. */
const LAMPS = 5;
const NS = "http://www.w3.org/2000/svg";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let src: MachineSource | null = null;
let mapEl: HTMLElement;
let pads: HTMLElement[] = [];
let lamps: HTMLElement[] = [];
let playKey: HTMLButtonElement;
let viewKeys: HTMLButtonElement[] = [];
let lonEl: HTMLElement;
let latEl: HTMLElement;
let seqLit = -1;
let seqTimer = 0;
let seenLevel = -1;
let seenView = "";
let seenPlay = "";
let seenLon = "";
let seenLat = "";

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A small triangle or bar drawn into a key, in the key's ink. */
function glyph(kind: "play" | "pause" | "left" | "right" | "up" | "down"): SVGElement {
  const s = svg("svg", { viewBox: "0 0 12 12", class: "x-glyph", "aria-hidden": "true" });
  const d = {
    play: "M3 1.5L10.5 6L3 10.5Z",
    pause: "M2.5 1.5H5V10.5H2.5ZM7 1.5H9.5V10.5H7Z",
    left: "M8.5 1.5L2.5 6L8.5 10.5Z",
    right: "M3.5 1.5L9.5 6L3.5 10.5Z",
    up: "M1.5 8.5L6 2.5L10.5 8.5Z",
    down: "M1.5 3.5L6 9.5L10.5 3.5Z",
  }[kind];
  s.append(svg("path", { d, fill: "currentColor" }));
  return s;
}

/** The scope: a faint grid and a red trace that slides past slowly. */
function scope(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 200 40", preserveAspectRatio: "none", class: "x-scope", "aria-hidden": "true" });
  const grid = svg("path", { d: "M0 20H200M50 0V40M100 0V40M150 0V40M0 10H200M0 30H200", stroke: "rgba(154,154,148,0.22)", "stroke-width": 0.6, fill: "none", "vector-effect": "non-scaling-stroke" });
  let d = "";
  for (let x = 0; x <= 400; x += 2) {
    const y = 20 - 11 * Math.sin((x * Math.PI * 2) / 50) * (0.55 + 0.45 * Math.sin((x * Math.PI * 2) / 200));
    d += `${x ? "L" : "M"}${x} ${y.toFixed(1)}`;
  }
  const run = svg("g", { class: "x-scope-run" });
  run.append(svg("path", { d, stroke: "#ff3a2f", "stroke-width": 1.4, fill: "none", "vector-effect": "non-scaling-stroke" }));
  s.append(grid, run);
  return s;
}

/** A needle meter: a pale face with a scale of ticks, red at the top end, and a needle that swings slowly. */
function meter(k: number): SVGElement {
  const s = svg("svg", { viewBox: "0 0 60 36", class: "x-meter", "aria-hidden": "true" });
  s.append(svg("rect", { x: 1, y: 1, width: 58, height: 34, rx: 2, fill: "#d9d9d1", stroke: "#0a0a0a", "stroke-width": 1.5 }));
  for (let i = 0; i <= 10; i++) {
    const a = ((-50 + i * 10) * Math.PI) / 180;
    const r0 = i % 5 === 0 ? 20 : 22;
    s.append(
      svg("line", {
        x1: (30 + Math.sin(a) * r0).toFixed(1),
        y1: (33 - Math.cos(a) * r0).toFixed(1),
        x2: (30 + Math.sin(a) * 25).toFixed(1),
        y2: (33 - Math.cos(a) * 25).toFixed(1),
        stroke: i >= 8 ? "#d71920" : "#1a1a19",
        "stroke-width": i >= 8 ? 1.6 : 1,
      }),
    );
  }
  const needle = svg("line", { x1: 30, y1: 33, x2: 30, y2: 9, stroke: "#0a0a0a", "stroke-width": 1.2, class: "x-needle" });
  (needle as SVGElement & ElementCSSInlineStyle).style.animationDuration = `${METER_SWING_S[k % METER_SWING_S.length]}s`;
  s.append(needle, svg("circle", { cx: 30, cy: 33, r: 2.4, fill: "#0a0a0a" }));
  return s;
}

/** Four knobs, each turned to its own fixed angle: grey caps with a fine knurl and a white line. */
function knobs(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 128 36", class: "x-knobs", "aria-hidden": "true" });
  [-120, -35, 40, 110].forEach((turn, i) => {
    const cx = 16 + i * 32;
    s.append(
      svg("circle", { cx, cy: 18, r: 14, fill: "none", stroke: "#6b6b66", "stroke-width": 1, "stroke-dasharray": "1 2.6" }),
      svg("circle", { cx, cy: 18, r: 11, fill: "#1b1b1a", stroke: "#9a9a94", "stroke-width": 1 }),
      svg("circle", { cx, cy: 18, r: 8, fill: "#3a3a37" }),
      svg("line", { x1: cx, y1: 18, x2: cx, y2: 8, stroke: "#f4f4ee", "stroke-width": 1.6, "stroke-linecap": "square", transform: `rotate(${turn} ${cx} 18)` }),
    );
  });
  return s;
}

/** One module: its parts above an engraved legend. */
function mod(cls: string, legend: string, ...parts: Node[]): HTMLElement {
  return h("div", { class: `x-rack-mod ${cls}` }, h("div", { class: "x-mod-body" }, ...parts), h("span", { class: "x-legend", "aria-hidden": "true" }, legend));
}

/** The page's own control, by id; pressing the rack's key presses it. */
const page = (id: string) => document.getElementById(id);

/** The four tuning keys: a tap moves the map one arrow-key step, and holding keeps moving it, twelve steps a second at most. */
const TUNE: [string, string, string, "left" | "up" | "down" | "right"][] = [
  ["ArrowLeft", "Move the map left", "left", "left"],
  ["ArrowUp", "Move the map up", "up", "up"],
  ["ArrowDown", "Move the map down", "down", "down"],
  ["ArrowRight", "Move the map right", "right", "right"],
];

function tuneKeys(): HTMLElement[] {
  const send = (key: string) => mapEl.querySelector("canvas")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  return TUNE.map(([key, label, side, glyphKind]) => {
    const b = h("button", { type: "button", class: `x-key x-arrow x-${side}`, "aria-label": label, title: label }, glyph(glyphKind));
    let hold = 0;
    const stop = () => {
      clearInterval(hold);
      hold = 0;
    };
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      send(key);
      stop();
      hold = window.setInterval(() => send(key), 85);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel", "blur"]) b.addEventListener(ev, stop);
    // A pointer already moved the map on pointerdown; Enter and Space arrive as a click with no pointer (detail 0).
    b.addEventListener("click", (e) => {
      if (e.detail === 0) send(key);
    });
    return b;
  });
}

function rack(): HTMLElement {
  pads = Array.from({ length: SEQ_STEPS }, (_, i) =>
    h("span", { class: ["x-step", i % 4 === 0 ? "x-beat" : "", SEQ_PATTERN[i] ? "x-prog" : ""].filter(Boolean).join(" ") }),
  );
  lamps = Array.from({ length: LAMPS }, () => h("span", { class: "x-lamp" }));

  playKey = h("button", { type: "button", class: "x-key x-play", "aria-label": "Replay the last 24 hours", "aria-pressed": "false" }, glyph("play"), h("span", { class: "x-play-lamp", "aria-hidden": "true" }));
  playKey.addEventListener("click", () => page("play")?.click());

  const view = (v: "2d" | "3d", text: string) => {
    const b = h("button", { type: "button", class: "x-key x-view", "aria-pressed": "false", "data-view": v }, text);
    b.addEventListener("click", () => {
      const sel = page("view-select") as HTMLSelectElement | null;
      if (!sel || sel.value === v) return;
      sel.value = v;
      sel.dispatchEvent(new Event("change"));
    });
    return b;
  };
  viewKeys = [view("2d", "Map"), view("3d", "Globe")];

  const zoomKey = (id: string, label: string, text: string) => {
    const b = h("button", { type: "button", class: "x-key x-zoom-key", "aria-label": label, title: label }, text);
    b.addEventListener("click", () => page(id)?.click());
    return b;
  };

  lonEl = h("span", { class: "x-read-lon" });
  latEl = h("span", { class: "x-read-lat" });

  const el = h(
    "div",
    { class: "x-rack", role: "group", "aria-label": "Machine controls" },
    h("span", { class: "x-rack-ear", "aria-hidden": "true" }),
    mod("x-m-play", "Replay", playKey),
    mod("x-m-view", "View", h("div", { class: "x-rocker", role: "group", "aria-label": "View" }, ...viewKeys)),
    mod("x-m-zoom", "Zoom", zoomKey("zoom-out", "Zoom out", "−"), h("div", { class: "x-lamps", "aria-hidden": "true" }, ...lamps), zoomKey("zoom-in", "Zoom in", "+")),
    mod("x-m-tune", "Tune", ...tuneKeys(), h("div", { class: "x-read", "aria-hidden": "true" }, lonEl, latEl)),
    h("div", { class: "x-rack-mod x-m-seq", "aria-hidden": "true" }, h("div", { class: "x-seq" }, ...pads), h("span", { class: "x-legend" }, "Sequence")),
    h("div", { class: "x-rack-mod x-scope-mod", "aria-hidden": "true" }, scope()),
    h("div", { class: "x-rack-mod x-meters", "aria-hidden": "true" }, meter(0), meter(1)),
    h("div", { class: "x-rack-mod x-knob-mod", "aria-hidden": "true" }, knobs()),
    h("span", { class: "x-rack-ear", "aria-hidden": "true" }),
  );
  el.style.setProperty("--seq-fade", `${SEQ_FADE_S}s`);
  el.style.setProperty("--scope-pass", `${SCOPE_PASS_S}s`);
  return el;
}

/** Lights the sequencer's step for now, or the still step for reduced motion. */
function tickSeq() {
  const k = seqStep(performance.now() / 1000, reduced);
  if (k === seqLit) return;
  pads[seqLit]?.classList.remove("on");
  pads[k]?.classList.add("on");
  seqLit = k;
}

/** Steps the sequencer on each beat, timed to the beat rather than a fixed interval, so the steps stay even. */
function runSeq() {
  tickSeq();
  const per = 1 / SEQ_HZ;
  const t = performance.now() / 1000;
  seqTimer = window.setTimeout(runSeq, (per - (t % per)) * 1000 + 8);
}

/** The Replay key follows the page's own Replay button, which says "Pause" while the replay runs. */
function syncPlay() {
  const playing = page("play")?.textContent === "Pause" ? "1" : "0";
  if (playing === seenPlay) return;
  seenPlay = playing;
  playKey.setAttribute("aria-pressed", playing === "1" ? "true" : "false");
  playKey.classList.toggle("lit", playing === "1");
  playKey.replaceChildren(glyph(playing === "1" ? "pause" : "play"), h("span", { class: "x-play-lamp", "aria-hidden": "true" }));
}

export function mountMachine(source: MachineSource) {
  src = source;
  mapEl = document.getElementById("map")!;
  mapEl.after(rack());
  const play = page("play");
  if (play) new MutationObserver(syncPlay).observe(play, { childList: true, characterData: true, subtree: true });
  document.addEventListener("visibilitychange", () => refreshMachine());
  refreshMachine();
}

/** Whenever the design, the page or the tab's visibility changes. */
export function refreshMachine() {
  if (!src) return;
  // The sequencer walks only while it shows, never in a hidden tab, and holds one step for reduced motion.
  clearTimeout(seqTimer);
  seqTimer = 0;
  if (src.theme() === "machine") {
    if (!reduced && document.visibilityState === "visible") runSeq();
    else tickSeq();
    syncPlay();
    seenLevel = -1;
    seenView = "";
    seenLon = seenLat = "";
    moveMachine();
  }
}

/** On every move of the map: the lamps, the display and the rocker follow the page; each touches the page only when it changes. */
export function moveMachine() {
  if (!src || src.theme() !== "machine") return;
  const lit = zoomLamps(src.level(), LAMPS);
  if (lit !== seenLevel) {
    seenLevel = lit;
    lamps.forEach((l, i) => l.classList.toggle("on", i < lit));
  }
  const view = (page("view-select") as HTMLSelectElement | null)?.value ?? "";
  if (view !== seenView) {
    seenView = view;
    for (const k of viewKeys) k.setAttribute("aria-pressed", k.dataset.view === view ? "true" : "false");
  }
  const [lon, lat] = src.center();
  const a = lonText(lon), b = latText(lat);
  if (a !== seenLon) lonEl.textContent = `LON ${(seenLon = a)}`;
  if (b !== seenLat) latEl.textContent = `LAT ${(seenLat = b)}`;
}
