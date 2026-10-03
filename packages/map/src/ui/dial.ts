// Shortwave's radio front under the map (experimental, src/map/shortwave.ts lays it out): a speaker grille, a green
// tuning lamp, a long backlit dial window with a red needle, and a big tuning knob. The dial is how a reader moves
// round the world in this design: dragging along the window or turning the knob (or its arrow keys) turns the world
// east and west through the map's own `turnTo` and `turnBy`, and the needle and the knob follow the reticle's
// longitude however the map moves. The scale is longitude, printed like a band's frequencies, with no station, place
// or country names. Between places a faint grain lies over the window only, never over the map; a tuned place lights
// the lamp, which says nothing more than that. Hidden by CSS in every other design. No sounds.

import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";
import {
  dialAt,
  EYE_OPEN,
  EYE_R,
  KEY_PX,
  KNOB_PER_DEG,
  LAMP_FADE_S,
  lonAt,
  lonText,
  PAGE_PX,
  PX_PER_KNOB_DEG,
  scaleLabels,
  scaleStep,
  sectorPath,
  STATIC_DRIFT_S,
  STATIC_FADE_S,
  STATIC_OPACITY,
  turnBetween,
  WING_TURN,
} from "../map/shortwave.ts";

export interface DialSource {
  theme(): ThemeId;
  center(): [number, number];
  /** Whether a place is under the reticle. */
  tuned(): boolean;
  turnTo(lon: number): void;
  turnBy(px: number): void;
}

const NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

let src: DialSource | null = null;
let radio: HTMLElement;
let scale: HTMLElement;
let nums: HTMLElement;
let needle: HTMLElement;
let knob: HTMLElement;
let knobBody: SVGElement;
let step = 0;
let lastLon = NaN;
let lastAt = "";
let lastNow = "";
let knobAngle = 0;
let knobDrag = false;
let wasTuned: boolean | null = null;

/** The ticks every 5 degrees and the band markings under them, drawn once across the scale's 360 units. */
function ticks(): SVGElement {
  const lines: SVGElement[] = [];
  for (let d = 0; d <= 360; d += 5) {
    const major = d % 30 === 0;
    const mid = !major && d % 10 === 0;
    lines.push(svg("line", { x1: d, x2: d, y1: 0, y2: major ? 14 : mid ? 10 : 6, class: major ? "sw-tick sw-major" : "sw-tick" }));
  }
  // Band markings of our own: six plain bars, alternately brass and dark, that mark nothing but the dial's sixths;
  // never red, so no stretch of the world reads as flagged.
  const bands = Array.from({ length: 6 }, (_, i) => svg("rect", { x: i * 60 + 1.5, y: 18, width: 57, height: 3, class: i % 2 ? "sw-band sw-band-b" : "sw-band" }));
  return svg("svg", { class: "sw-ticks", viewBox: "0 0 360 22", preserveAspectRatio: "none", "aria-hidden": "true" }, ...lines, ...bands);
}

/** The green tuning eye: a lit green disc with a dark wedge, two wings that turn in over the wedge, and a dark cap. */
function eye(): SVGElement {
  const half = EYE_OPEN / 2;
  return svg(
    "svg",
    { class: "sw-eye-tube", viewBox: "0 0 40 40", "aria-hidden": "true" },
    svg(
      "defs",
      {},
      svg(
        "radialGradient",
        { id: "sw-eye-glow", cx: "50%", cy: "50%", r: "50%" },
        svg("stop", { offset: "0.25", "stop-color": "#c9ff9a" }),
        svg("stop", { offset: "0.7", "stop-color": "#4fd36a" }),
        svg("stop", { offset: "1", "stop-color": "#17703a" }),
      ),
    ),
    svg("circle", { cx: 20, cy: 20, r: 19.5, fill: "#0d1a10" }),
    svg("g", { class: "sw-eye-lit" }, svg("circle", { cx: 20, cy: 20, r: EYE_R, fill: "url(#sw-eye-glow)" })),
    svg("path", { d: sectorPath(-half, half), fill: "#0d1a10", class: "sw-eye-wedge" }),
    svg("path", { d: sectorPath(-half - WING_TURN, -half), fill: "url(#sw-eye-glow)", class: "sw-eye-wing sw-eye-left" }),
    svg("path", { d: sectorPath(half, half + WING_TURN), fill: "url(#sw-eye-glow)", class: "sw-eye-wing sw-eye-right" }),
    svg("circle", { cx: 20, cy: 20, r: 5.5, fill: "#1b120a", stroke: "#6b5326", "stroke-width": 0.8 }),
  );
}

/** The knob: a ridged Bakelite skirt, a domed cap and a cream pointer line. The gloss over it stays put as it turns. */
function knobDrawing(): SVGElement {
  return svg(
    "svg",
    { class: "sw-knob-body", viewBox: "0 0 100 100", "aria-hidden": "true" },
    svg(
      "defs",
      {},
      svg(
        "radialGradient",
        { id: "sw-knob-cap", cx: "38%", cy: "34%", r: "70%" },
        svg("stop", { offset: "0", "stop-color": "#7a4a26" }),
        svg("stop", { offset: "0.55", "stop-color": "#46260f" }),
        svg("stop", { offset: "1", "stop-color": "#1e0f05" }),
      ),
    ),
    svg("circle", { cx: 50, cy: 50, r: 47, fill: "#2a160a" }),
    // The ridges round the skirt: a dashed ring, so a few hundred grooves cost one stroke.
    svg("circle", { cx: 50, cy: 50, r: 45, fill: "none", stroke: "#5a341a", "stroke-width": 4.5, "stroke-dasharray": "2.2 2.5" }),
    svg("circle", { cx: 50, cy: 50, r: 37, fill: "url(#sw-knob-cap)", stroke: "#140a03", "stroke-width": 1.2 }),
    svg("circle", { cx: 50, cy: 50, r: 30, fill: "none", stroke: "rgba(255,226,180,0.12)", "stroke-width": 1 }),
    svg("rect", { x: 47.6, y: 9, width: 4.8, height: 26, rx: 2.4, fill: "#efe2c0" }),
  );
}

export function mountDial(source: DialSource) {
  src = source;
  const mapEl = document.getElementById("map")!;
  nums = h("div", { class: "sw-nums", "aria-hidden": "true" });
  needle = h("div", { class: "sw-needle", "aria-hidden": "true" });
  scale = h("div", { class: "sw-scale" }, nums, needle);
  scale.prepend(ticks());
  const staticEl = h("div", { class: "sw-static", "aria-hidden": "true" });
  const glass = h("div", { class: "sw-glass" }, scale, staticEl);
  const dial = h("div", { class: "sw-dial", title: "Drag along the dial to turn the world" }, glass);
  knobBody = knobDrawing();
  knob = h(
    "div",
    {
      class: "sw-knob",
      role: "slider",
      tabindex: "0",
      "aria-label": "Tuning. Turns the world east and west",
      "aria-valuemin": "-180",
      "aria-valuemax": "180",
    },
    h("span", { class: "sw-knob-gloss", "aria-hidden": "true" }),
  );
  knob.prepend(knobBody);
  radio = h(
    "div",
    { class: "sw-radio", role: "group", "aria-label": "Tuning dial" },
    h("div", { class: "sw-grille", "aria-hidden": "true" }),
    h("div", { class: "sw-eye", "aria-hidden": "true" }, eye()),
    dial,
    // A small printed label under the knob, as a radio's front names its controls; the knob's own name is for screen readers.
    h("div", { class: "sw-tune" }, knob, h("span", { class: "sw-tune-label", "aria-hidden": "true" }, "Tuning")),
  );
  radio.style.setProperty("--sw-static", String(STATIC_OPACITY));
  radio.style.setProperty("--sw-drift", `${STATIC_DRIFT_S}s`);
  radio.style.setProperty("--sw-static-fade", `${STATIC_FADE_S}s`);
  radio.style.setProperty("--sw-lamp-fade", `${LAMP_FADE_S}s`);
  radio.style.setProperty("--sw-wing", `${WING_TURN}deg`);
  mapEl.after(radio);

  // The window: the needle goes where it is pressed and follows the pointer, as if it were picked up.
  const fromPointer = (e: PointerEvent) => {
    const r = scale.getBoundingClientRect();
    if (r.width > 0) src?.turnTo(lonAt((e.clientX - r.left) / r.width));
  };
  dial.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dial.setPointerCapture(e.pointerId);
    radio.classList.add("dragging");
    fromPointer(e);
  });
  dial.addEventListener("pointermove", (e) => {
    if (dial.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  const dropDial = () => radio.classList.remove("dragging");
  dial.addEventListener("pointerup", dropDial);
  dial.addEventListener("pointercancel", dropDial);

  // The knob turns under the finger, round its centre, and the world turns with it, finer than the window.
  let prev = 0;
  const angleOf = (e: PointerEvent) => {
    const r = knob.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    knob.setPointerCapture(e.pointerId);
    knobDrag = true;
    prev = angleOf(e);
    knob.focus({ preventScroll: true });
  });
  knob.addEventListener("pointermove", (e) => {
    if (!knobDrag || !knob.hasPointerCapture(e.pointerId)) return;
    const a = angleOf(e);
    const d = turnBetween(prev, a);
    prev = a;
    if (!d) return;
    knobAngle += d;
    setKnob();
    src?.turnBy(d * PX_PER_KNOB_DEG);
  });
  const dropKnob = () => {
    knobDrag = false;
  };
  knob.addEventListener("pointerup", dropKnob);
  knob.addEventListener("pointercancel", dropKnob);
  knob.addEventListener("keydown", (e) => {
    const px: Record<string, number> = { ArrowRight: KEY_PX, ArrowUp: KEY_PX, ArrowLeft: -KEY_PX, ArrowDown: -KEY_PX, PageUp: PAGE_PX, PageDown: -PAGE_PX };
    const by = px[e.key];
    if (by === undefined) return;
    e.preventDefault();
    src?.turnBy(by);
  });

  new ResizeObserver(() => layoutScale()).observe(scale);
  moveDial();
}

/** The printed numbers: as many as fit the window's width, each centred on its longitude. */
function layoutScale() {
  const w = scale.clientWidth;
  if (!w) return;
  const s = scaleStep(w);
  if (s === step) return;
  step = s;
  nums.replaceChildren(
    ...scaleLabels(s).map((l) => {
      const el = h("span", { class: l.lon === -180 ? "sw-num sw-first" : l.lon === 180 ? "sw-num sw-last" : "sw-num" }, l.num, l.side ? h("small", {}, l.side) : null);
      el.style.left = `${(dialAt(l.lon) * 100).toFixed(3)}%`;
      if (l.lon === 180) el.style.left = "100%";
      return el;
    }),
  );
}

function setKnob() {
  knobBody.style.transform = `rotate(${knobAngle.toFixed(1)}deg)`;
}

/** On every frame the map draws: the needle to the reticle's longitude, the knob after it, the lamp and the static. */
export function moveDial() {
  if (!src || src.theme() !== "shortwave") {
    lastLon = NaN;
    return;
  }
  const lon = src.center()[0];
  if (lon !== lastLon) {
    if (!knobDrag && Number.isFinite(lastLon)) {
      knobAngle += turnBetween(lastLon, lon) * KNOB_PER_DEG;
      setKnob();
    }
    lastLon = lon;
    const at = `${(dialAt(lon) * 100).toFixed(2)}%`;
    if (at !== lastAt) {
      lastAt = at;
      needle.style.left = at;
    }
    const now = String(Math.round(lon));
    if (now !== lastNow) {
      lastNow = now;
      knob.setAttribute("aria-valuenow", now);
      knob.setAttribute("aria-valuetext", lonText(lon));
    }
  }
  const tuned = src.tuned();
  if (tuned !== wasTuned) {
    wasTuned = tuned;
    radio.classList.toggle("tuned", tuned);
  }
  if (!step) layoutScale();
}
