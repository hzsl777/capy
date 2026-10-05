// Alien (id alien): friendly visitors from elsewhere, studying the Earth from their ship. Our own
// drawings throughout, copied from no film, show, game or brand: no creature, craft, lettering or art of anyone's,
// no real place, no text on the canvas.
//
// Globe view is the world seen through the ship's round viewport: a pearl ring of rounded lights set in the hull's
// curved panels, the globe floating in a window of space, a halo of air round it, and little sparkles in the space
// between. Zooming moves the world inside the window; the ring stays, and places outside the window are neither drawn
// nor tuned. Map view is the ship's scanner: a rounded glass screen in a pearl bezel, a lamp over it and a row of
// lights under it. Land is sunset coral on deep indigo, seen through aqua light.
//
// The reticle is a tractor beam of soft light. A lamp over the map sends a faint cone of aqua light down to the
// reticle's ring whenever a place is tuned: it lowers over half a second when a place settles under the reticle, and
// lifts over half a second when the map is dragged away from it, so letting go of a drag reads as the beam locking
// onto the nearest place, which the map glides under it as in every design. The light is added to the picture and the
// view draws the markers after it, so it never dims, moves or covers one, and it adds at most `BEAM.alpha` of a
// pixel's brightness. Reduced motion shows the beam at once, still.
//
// Around the world, off the map, three small critters of our own (a dome, a bean, a pear, in lilac, peach and mint)
// stand in the hull's margins with glowing slates, taking notes: they blink, a bulb on one glows, and the squiggles
// on the slates write themselves. They keep clear of the globe's ring, the scanner's glass, the Key and the zoom
// buttons, and are left out where there is no room (`placeCritters`, tested). Nothing here is data: lights, critters,
// stars and seams stand wherever the lists below put them and mean nothing.
//
// What moves asks for ten frames a second through ambient.ts (sixty while the beam travels), never for reduced motion
// or in a hidden tab. Each moving light stays under the no-flash limit (`pulse`, `BEAM`, tested): none changes by a
// tenth of the brightness scale within a third of a second.

import { geoGraticule, geoPath } from "d3-geo";
import { motionTime, stillMotion, StillLayer } from "./ambient.ts";
import { offscreen, pathContext, seeded, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const TAU = Math.PI * 2;
const GRID = geoGraticule().step([15, 15])();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (x: number) => x * x * (3 - 2 * x);
type RGB = [number, number, number];
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

/** The colours of the picture. Decoration uses aqua and lilac only: lime is the fresh reports' alone. */
export const ALIEN = {
  /** The sea at the middle of the window or the glass, and toward its edge: deep indigo, a little lighter where the light is. */
  seaCore: [30, 42, 122] as RGB,
  sea: [14, 20, 76] as RGB,
  seaRim: [5, 7, 34] as RGB,
  /** The land, sunset coral, lit toward the middle and rose toward the edge. Never coloured by any political unit. */
  land: [246, 152, 150] as RGB,
  landShade: [188, 88, 132] as RGB,
  ice: [247, 241, 255] as RGB,
  aqua: [127, 247, 225] as RGB,
  lilac: [201, 167, 255] as RGB,
  /** The hull, from the window outward, and the pearl of the ring and bezel. */
  hull: ["#1d1658", "#130e3d", "#07051d"],
  pearl: ["#f4efff", "#bdb5ee", "#6e66b4"],
};

// ---- the lights, which never change quickly --------------------------------------------------------------------

/** How bright a decorative light is, as a share of its full glow, at its lowest and its highest. */
export const PULSE = { lo: 0.62, hi: 0.95, minPeriod: 6 };

/** A light's glow `t` seconds in: a slow sine between `PULSE.lo` and `PULSE.hi`, one swell every `period` seconds. */
export function pulse(t: number, period: number, phase: number): number {
  return PULSE.lo + (PULSE.hi - PULSE.lo) * (0.5 + 0.5 * Math.sin(TAU * (t / Math.max(period, PULSE.minPeriod) + phase)));
}

/** A blink, 1 when the eyes are open and down to 0.1 for the 0.16 seconds the blink lasts, once every `every` seconds. */
export function blink(t: number, every: number, phase: number): number {
  const u = (((t / every + phase) % 1) + 1) % 1;
  const d = 0.16 / every;
  return u < d ? 0.1 + 0.9 * Math.abs(u / d - 0.5) * 2 : 1;
}

// ---- the tractor beam ------------------------------------------------------------------------------------------

export const BEAM = {
  /** The most the beam's cone adds to a pixel of the picture, as a share of full brightness. */
  alpha: 0.14,
  /** Seconds to lower onto a place, and to lift off it. Each is slow enough that alpha changes by under a tenth in a third of a second. */
  rise: 0.5,
  fall: 0.5,
  /** Seconds the ring that spreads from the landing takes. */
  ping: 0.7,
};

/** Where the beam is: how far down it has come (0 to 1), and when it last reached the foot. */
export class Beam {
  level = 0;
  last = -1;
  pingAt = -1;

  /** Moves the beam toward `on` by the time since the last frame; with reduced motion it is there at once. Returns the level. */
  step(now: number, on: boolean, still: boolean): number {
    if (still) {
      this.level = on ? 1 : 0;
      this.last = now;
      this.pingAt = -1;
      return this.level;
    }
    const dt = this.last < 0 ? 0 : Math.min(0.12, (now - this.last) / 1000);
    this.last = now;
    const before = this.level;
    this.level = clamp(this.level + (on ? dt / BEAM.rise : -dt / BEAM.fall), 0, 1);
    if (before < 1 && this.level >= 1) this.pingAt = now;
    return this.level;
  }

  /** Whether the beam is travelling, so the view should ask for frames at once. */
  moving(on: boolean): boolean {
    return on ? this.level < 1 : this.level > 0;
  }
}

// ---- the frame: the viewport and the scanner ---------------------------------------------------------------------

/** The globe's radius at the widest zoom as a share of the frame's shorter side; the window is larger, so there is space round it. */
export const GLOBE_SCALE = 0.31;

export interface Viewport {
  cx: number;
  cy: number;
  /** The window's radius, and the ring's width round it. */
  r: number;
  ring: number;
  /** The ring's outer radius. */
  outer: number;
}

/** Globe view's window: a circle at the frame's centre, with its ring inside the frame. */
export function viewportOf(w: number, h: number): Viewport {
  const m = Math.min(w, h);
  const r = m * 0.44;
  const ring = clamp(m * 0.05, 9, 24);
  return { cx: w / 2, cy: h / 2, r, ring, outer: r + ring };
}

export interface Glass {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The corner radius, and the bezel's width (centred on the edge). */
  rad: number;
  rim: number;
  /** The strip above and below the glass, which holds the lamp and the lights, and where the critters stand. */
  strip: number;
}

/** Map view's scanner glass: inset the same above and below so the reticle stays at the frame's centre. */
export function glassOf(w: number, h: number): Glass {
  const wide = w >= 700;
  const mx = wide ? clamp(w * 0.02, 12, 26) : 8;
  const strip = clamp(h * 0.07, wide ? 34 : 24, 54);
  return { x0: mx, y0: strip, x1: w - mx, y1: h - strip, rad: clamp(Math.min(w, h) * 0.06, 14, 34), rim: wide ? 10 : 7, strip };
}

/** The glass's inside, where the world is seen and places are drawn: the bezel's inner edge. */
export function glassInner(g: Glass): { x0: number; y0: number; x1: number; y1: number; rad: number } {
  const k = g.rim / 2 + 1;
  return { x0: g.x0 + k, y0: g.y0 + k, x1: g.x1 - k, y1: g.y1 - k, rad: Math.max(4, g.rad - k) };
}

/** Whether a point is inside the glass's inner edge (a rounded rectangle). */
export function inGlass(g: Glass, x: number, y: number): boolean {
  const r = glassInner(g);
  const nx = clamp(x, r.x0 + r.rad, r.x1 - r.rad), ny = clamp(y, r.y0 + r.rad, r.y1 - r.rad);
  return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && Math.hypot(x - nx, y - ny) <= r.rad;
}

// ---- the critters ----------------------------------------------------------------------------------------------

export type CritterKind = "pip" | "bloop" | "mimi";

/** A critter as placed: its feet at (x, y), its height `s`, the way it faces (1 right, -1 left) and where it keeps clear. */
export interface Critter {
  kind: CritterKind;
  x: number;
  y: number;
  s: number;
  face: 1 | -1;
  box: Box;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What a critter draws within: its feet at the bottom middle, its antenna the top, its slate the sides. */
export function critterBox(x: number, y: number, s: number): Box {
  return { x0: x - 0.42 * s, y0: y - 1.02 * s, x1: x + 0.42 * s, y1: y + 0.06 * s };
}

/** The corner the Key takes and the corner the zoom buttons take, which nothing is placed behind. */
export const KEY_BOX = { w: 96, h: 60 };
export const ZOOM_BOX = { w: 60, h: 96 };

const boxHitsBox = (a: Box, b: Box, gap = 0) => a.x1 > b.x0 - gap && a.x0 < b.x1 + gap && a.y1 > b.y0 - gap && a.y0 < b.y1 + gap;

/** How near a box comes to a circle, in pixels (negative when it overlaps). */
export function boxToCircle(b: Box, cx: number, cy: number, r: number): number {
  return Math.hypot(clamp(cx, b.x0, b.x1) - cx, clamp(cy, b.y0, b.y1) - cy) - r;
}

/** Where Globe view tries to stand its critters, in order, as shares of the frame: the feet's place and the kind. */
const GLOBE_SLOTS: readonly { kind: CritterKind; fx: number; fy: number }[] = [
  { kind: "pip", fx: 0.09, fy: 0.95 },
  { kind: "mimi", fx: 0.91, fy: 0.3 },
  { kind: "bloop", fx: 0.1, fy: 0.62 },
  { kind: "pip", fx: 0.9, fy: 0.64 },
];
/** Map view stands them along the strip under the glass. */
const STRIP_SLOTS: readonly { kind: CritterKind; fx: number }[] = [
  { kind: "pip", fx: 0.07 },
  { kind: "bloop", fx: 0.16 },
  { kind: "mimi", fx: 0.93 },
];

/**
 * The critters for a frame, a fixed list placed to fit. In Globe view each tries a few sizes at its spot and stands
 * there only if it keeps 8 pixels from the ring, off the Key and zoom corners and off the others; in Map view they
 * stand in the strip under the glass and are left out when it is too thin. The same frame gets the same critters.
 */
export function placeCritters(w: number, h: number, mode: "2d" | "3d"): Critter[] {
  const out: Critter[] = [];
  if (mode === "2d") {
    const g = glassOf(w, h);
    const s = g.strip - 6;
    if (s < 22) return out;
    for (const slot of STRIP_SLOTS) {
      const x = w * slot.fx, y = h - 3;
      out.push({ kind: slot.kind, x, y, s, face: x < w / 2 ? 1 : -1, box: critterBox(x, y, s) });
    }
    return out;
  }
  const v = viewportOf(w, h);
  const m = Math.min(w, h);
  const keyBox: Box = { x0: 0, y0: 0, x1: KEY_BOX.w, y1: KEY_BOX.h };
  const zoomBox: Box = { x0: w - ZOOM_BOX.w, y0: h - ZOOM_BOX.h, x1: w, y1: h };
  const frame: Box = { x0: 4, y0: 4, x1: w - 4, y1: h - 4 };
  for (const slot of GLOBE_SLOTS) {
    for (const k of [1, 0.8, 0.64, 0.5]) {
      const s = clamp(m * 0.14, 34, 96) * k;
      const x = clamp(w * slot.fx, 4 + 0.42 * s, w - 4 - 0.42 * s), y = clamp(h * slot.fy, 4 + 1.02 * s, h - 4);
      const box = critterBox(x, y, s);
      if (box.x0 < frame.x0 || box.x1 > frame.x1 || box.y0 < frame.y0 || box.y1 > h - 2) continue;
      if (boxToCircle(box, v.cx, v.cy, v.outer) < 8) continue;
      if (boxHitsBox(box, keyBox, 6) || boxHitsBox(box, zoomBox, 6)) continue;
      if (out.some((o) => boxHitsBox(box, o.box, 6))) continue;
      out.push({ kind: slot.kind, x, y, s, face: x < w / 2 ? 1 : -1, box });
      break;
    }
  }
  return out;
}

// ---- the lights --------------------------------------------------------------------------------------------------

export interface Lamp {
  x: number;
  y: number;
  /** Long and short side, and the turn of the long side. */
  len: number;
  thick: number;
  turn: number;
  period: number;
  phase: number;
  tint: "aqua" | "lilac";
}

/** The lights round the ring or along the strips: fixed spots, fixed colours, no meaning. */
export function lampsOf(w: number, h: number, mode: "2d" | "3d"): Lamp[] {
  const out: Lamp[] = [];
  const rnd = seeded(5);
  if (mode === "3d") {
    const v = viewportOf(w, h);
    const mid = v.r + v.ring / 2;
    for (let k = 0; k < 12; k++) {
      const a = ((k * 30 + 15 - 90) * Math.PI) / 180;
      out.push({ x: v.cx + Math.cos(a) * mid, y: v.cy + Math.sin(a) * mid, len: v.ring * 0.62, thick: v.ring * 0.34, turn: a + Math.PI / 2, period: 6 + rnd() * 3, phase: rnd(), tint: k % 3 === 2 ? "lilac" : "aqua" });
    }
    return out;
  }
  const g = glassOf(w, h);
  const len = g.strip > 30 ? 16 : 11, thick = g.strip > 30 ? 6 : 4;
  const row = (y: number, xs: readonly number[]) => xs.forEach((fx, i) => out.push({ x: w * fx, y, len, thick, turn: 0, period: 6 + rnd() * 3, phase: rnd(), tint: i % 3 === 1 ? "lilac" : "aqua" }));
  const wide = w >= 700;
  row(g.strip / 2, wide ? [0.14, 0.2, 0.26, 0.32, 0.68, 0.74, 0.8, 0.86] : [0.2, 0.3, 0.7, 0.8]);
  row(h - g.strip / 2, wide ? [0.4, 0.45, 0.5, 0.55, 0.6] : [0.42, 0.5, 0.58]);
  return out;
}

/** The lamp over the world that sends the beam: its place and where the beam starts. */
export function emitterOf(w: number, h: number, mode: "2d" | "3d"): { x: number; y: number; top: number } {
  if (mode === "3d") {
    const v = viewportOf(w, h);
    return { x: v.cx, y: v.cy - v.r - v.ring / 2, top: v.cy - v.r };
  }
  const g = glassOf(w, h);
  return { x: w / 2, y: g.strip / 2 + 1, top: g.y0 + g.rim / 2 + 1 };
}

/** The tuning ring's radius, where the beam lands. */
export const ringOf = (w: number, h: number) => clamp(Math.min(w, h) * 0.035, 15, 26);

// ---- sparkles in the window ------------------------------------------------------------------------------------

export interface Sparkle {
  x: number;
  y: number;
  /** Arm length, brightness (0 to 1) and, for a few, a slow twinkle. */
  r: number;
  a: number;
  twinkle: number;
}

/**
 * Four-armed sparkles in the space between the globe at rest and the window's edge, from a fixed seed. Arms, never
 * dots, so none can read as a place; the globe is drawn over them, so none is ever over it.
 */
export function sparklesOf(w: number, h: number): Sparkle[] {
  const v = viewportOf(w, h);
  const rest = Math.min(w, h) * GLOBE_SCALE;
  const rnd = seeded(29);
  const out: Sparkle[] = [];
  const lo = rest * 1.1, hi = v.r * 0.96;
  if (hi <= lo) return out;
  // Fewer and finer in a small window, so a phone's thin band of space is not crowded.
  const k = clamp(v.r / 290, 0.5, 1);
  for (let i = 0; i < Math.round(70 * k); i++) {
    const a = rnd() * TAU, d = Math.sqrt(lo * lo + rnd() * (hi * hi - lo * lo));
    out.push({ x: v.cx + Math.cos(a) * d, y: v.cy + Math.sin(a) * d, r: (1.6 + rnd() * rnd() * 4.4) * k, a: 0.35 + rnd() * 0.6, twinkle: i % 7 === 0 ? 1 : 0 });
  }
  return out;
}

// ---- drawing: the critters -------------------------------------------------------------------------------------

const PAL: Record<CritterKind, { body: string; shade: string; belly: string }> = {
  pip: { body: "#b9a7ff", shade: "#7d68e0", belly: "#e3dbff" },
  bloop: { body: "#ffb690", shade: "#ee8160", belly: "#ffdcc6" },
  mimi: { body: "#88edd1", shade: "#44c4a6", belly: "#cbfcee" },
};

function eyeAt(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, open: number) {
  g.fillStyle = "#fffdf6";
  g.beginPath();
  g.ellipse(x, y, rx, ry * open, 0, 0, TAU);
  g.fill();
  if (open > 0.4) {
    g.fillStyle = "#2a1a6e";
    g.beginPath();
    g.ellipse(x + rx * 0.3, y + ry * 0.1, rx * 0.52, ry * 0.58 * open, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(x + rx * 0.45, y - ry * 0.18, rx * 0.2, 0, TAU);
    g.fill();
  }
}

/** A glowing slate held in front of a critter, with three squiggles that write themselves in turn. */
function slate(g: CanvasRenderingContext2D, x: number, y: number, turn: number, t: number, seed: number, hand: string) {
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.beginPath();
  g.roundRect(-0.15, -0.105, 0.3, 0.21, 0.035);
  g.fillStyle = "rgba(20,14,70,0.72)";
  g.fill();
  g.fillStyle = rgba(ALIEN.aqua, 0.16);
  g.fill();
  g.lineWidth = 0.02;
  g.strokeStyle = rgba(ALIEN.aqua, 0.95);
  g.stroke();
  g.lineWidth = 0.014;
  g.lineCap = "round";
  g.strokeStyle = rgba(ALIEN.aqua, 0.9);
  for (let k = 0; k < 3; k++) {
    const u = (((t / 7 + seed + k / 3) % 1) + 1) % 1;
    // Each squiggle writes along its line over the first half of its turn and then holds.
    const len = clamp(u * 2, 0, 1) * 0.22;
    const y0 = -0.052 + k * 0.05;
    g.beginPath();
    g.moveTo(-0.11, y0);
    for (let s = 0.02; s <= len; s += 0.02) g.lineTo(-0.11 + s, y0 + Math.sin(s * 55 + k) * 0.011);
    g.stroke();
  }
  g.fillStyle = hand;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * 0.15, 0.1, 0.035, 0, TAU);
    g.fill();
  }
  g.restore();
}

function glowBulb(g: CanvasRenderingContext2D, x: number, y: number, r: number, tint: RGB, a: number) {
  const p = g.createRadialGradient(x, y, 0, x, y, r * 3.2);
  p.addColorStop(0, rgba(tint, 0.9 * a));
  p.addColorStop(0.35, rgba(tint, 0.3 * a));
  p.addColorStop(1, rgba(tint, 0));
  g.fillStyle = p;
  g.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
  g.fillStyle = "#f3fffb";
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

/** A critter, its feet at (0, 0) and its height 1, drawn facing right. */
function paintCritter(g: CanvasRenderingContext2D, kind: CritterKind, t: number, phase: number) {
  const p = PAL[kind];
  const open = blink(t, 4.6 + phase * 2, phase);
  g.lineCap = "round";
  g.lineJoin = "round";
  // The soft shadow it stands in.
  g.fillStyle = "rgba(0,0,10,0.32)";
  g.beginPath();
  g.ellipse(0, 0.015, 0.3, 0.035, 0, 0, TAU);
  g.fill();
  const body = new Path2D();
  const shade = (b: Path2D, x: number, y: number, rx: number, ry: number) => {
    g.save();
    g.clip(b);
    g.fillStyle = "rgba(60,30,150,0.22)";
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fill();
    g.restore();
  };
  if (kind === "pip") {
    // A dome of jelly with a scalloped foot and one glowing bulb on a stalk.
    body.moveTo(-0.3, 0);
    body.bezierCurveTo(-0.37, -0.3, -0.3, -0.69, 0, -0.71);
    body.bezierCurveTo(0.3, -0.69, 0.37, -0.3, 0.3, 0);
    body.quadraticCurveTo(0.22, 0.045, 0.15, 0);
    body.quadraticCurveTo(0.075, 0.045, 0, 0);
    body.quadraticCurveTo(-0.075, 0.045, -0.15, 0);
    body.quadraticCurveTo(-0.22, 0.045, -0.3, 0);
    g.strokeStyle = p.shade;
    g.lineWidth = 0.026;
    g.beginPath();
    g.moveTo(0, -0.7);
    g.quadraticCurveTo(0.03, -0.82, 0.06, -0.89);
    g.stroke();
    g.fillStyle = p.body;
    g.fill(body);
    shade(body, 0.34, -0.3, 0.22, 0.5);
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.beginPath();
    g.ellipse(-0.14, -0.55, 0.07, 0.11, 0.5, 0, TAU);
    g.fill();
    eyeAt(g, -0.05, -0.44, 0.07, 0.086, open);
    eyeAt(g, 0.14, -0.44, 0.07, 0.086, open);
    g.strokeStyle = "#3a2290";
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(0, -0.32);
    g.quadraticCurveTo(0.045, -0.275, 0.09, -0.32);
    g.stroke();
    slate(g, 0.17, -0.15, -0.14, t, phase, p.shade);
    g.save();
    g.globalCompositeOperation = "lighter";
    glowBulb(g, 0.06, -0.93, 0.045, ALIEN.aqua, pulse(t, 6.5, phase));
    g.restore();
  } else if (kind === "bloop") {
    // A low wide bean on two stubby feet, its eyes on stalks.
    body.moveTo(-0.36, 0);
    body.bezierCurveTo(-0.44, -0.26, -0.32, -0.56, 0, -0.57);
    body.bezierCurveTo(0.32, -0.56, 0.44, -0.26, 0.36, 0);
    body.quadraticCurveTo(0, 0.03, -0.36, 0);
    g.strokeStyle = p.shade;
    g.lineWidth = 0.034;
    for (const [x0, x1, y1] of [[-0.1, -0.15, -0.8], [0.12, 0.18, -0.78]] as const) {
      g.beginPath();
      g.moveTo(x0, -0.52);
      g.quadraticCurveTo((x0 + x1) / 2 - 0.02, -0.66, x1, y1);
      g.stroke();
    }
    g.fillStyle = p.shade;
    for (const x of [-0.15, 0.15]) {
      g.beginPath();
      g.ellipse(x, 0, 0.09, 0.04, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = p.body;
    g.fill(body);
    shade(body, 0.4, -0.25, 0.26, 0.5);
    g.fillStyle = "rgba(255,255,255,0.3)";
    g.beginPath();
    g.ellipse(-0.18, -0.44, 0.09, 0.07, 0.4, 0, TAU);
    g.fill();
    eyeAt(g, -0.15, -0.8, 0.062, 0.07, open);
    eyeAt(g, 0.18, -0.78, 0.062, 0.07, open);
    g.strokeStyle = "#7a2f1c";
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(-0.07, -0.33);
    g.quadraticCurveTo(0.03, -0.26, 0.13, -0.33);
    g.stroke();
    slate(g, 0.13, -0.15, 0.12, t, phase + 0.3, p.shade);
  } else {
    // A pear with leaf ears and three nubs on its head, the middle one glowing.
    body.moveTo(-0.27, 0);
    body.bezierCurveTo(-0.33, -0.17, -0.22, -0.34, -0.14, -0.43);
    body.bezierCurveTo(-0.24, -0.5, -0.22, -0.8, 0, -0.8);
    body.bezierCurveTo(0.22, -0.8, 0.24, -0.5, 0.14, -0.43);
    body.bezierCurveTo(0.22, -0.34, 0.33, -0.17, 0.27, 0);
    body.quadraticCurveTo(0, 0.04, -0.27, 0);
    g.fillStyle = p.shade;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * 0.17, -0.58);
      g.bezierCurveTo(sx * 0.33, -0.78, sx * 0.42, -0.64, sx * 0.35, -0.56);
      g.bezierCurveTo(sx * 0.3, -0.5, sx * 0.22, -0.52, sx * 0.17, -0.58);
      g.fill();
    }
    g.fillStyle = p.body;
    g.fill(body);
    shade(body, 0.3, -0.35, 0.2, 0.5);
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.beginPath();
    g.ellipse(-0.1, -0.7, 0.05, 0.07, 0.4, 0, TAU);
    g.fill();
    g.fillStyle = p.shade;
    for (const [x, y] of [[-0.075, -0.835], [0.075, -0.835]] as const) {
      g.beginPath();
      g.arc(x, y, 0.035, 0, TAU);
      g.fill();
    }
    eyeAt(g, -0.07, -0.62, 0.065, 0.08, open);
    eyeAt(g, 0.1, -0.62, 0.065, 0.08, open);
    g.strokeStyle = "#1f6b59";
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(-0.02, -0.5);
    g.quadraticCurveTo(0.03, -0.46, 0.08, -0.5);
    g.stroke();
    slate(g, 0.15, -0.2, -0.1, t, phase + 0.6, p.shade);
    g.save();
    g.globalCompositeOperation = "lighter";
    glowBulb(g, 0, -0.87, 0.035, ALIEN.lilac, pulse(t, 7, phase));
    g.restore();
  }
}

function drawCritter(g: CanvasRenderingContext2D, c: Critter, t: number, i: number) {
  g.save();
  g.translate(c.x, c.y);
  g.scale(c.s * c.face, c.s);
  paintCritter(g, c.kind, t, (i * 0.37) % 1);
  g.restore();
}

// ---- drawing: lamps, hull and the world --------------------------------------------------------------------------

function pearlStroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const p = g.createLinearGradient(x0, y0, x1, y1);
  ALIEN.pearl.forEach((c, i) => p.addColorStop(i / 2, c));
  return p;
}

function capsule(g: CanvasRenderingContext2D, l: Lamp, pad = 0) {
  g.save();
  g.translate(l.x, l.y);
  g.rotate(l.turn);
  g.beginPath();
  g.roundRect(-l.len / 2 - pad, -l.thick / 2 - pad, l.len + pad * 2, l.thick + pad * 2, (l.thick + pad * 2) / 2);
  g.restore();
}

/** A lit lamp: its socket is already in the still layer; this adds the glow, brighter and dimmer by a slow pulse. */
function lampGlow(g: CanvasRenderingContext2D, l: Lamp, t: number) {
  const k = pulse(t, l.period, l.phase);
  const tint = l.tint === "aqua" ? ALIEN.aqua : ALIEN.lilac;
  g.save();
  g.globalCompositeOperation = "lighter";
  const r = l.len * 0.9;
  const p = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
  p.addColorStop(0, rgba(tint, 0.34 * k));
  p.addColorStop(1, rgba(tint, 0));
  g.fillStyle = p;
  g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  g.restore();
  capsule(g, l, -l.thick * 0.14);
  g.fillStyle = rgba(tint, 0.55 + 0.45 * k);
  g.fill();
}

/** The hull's curved panels seen from inside: seams that fan out from the window and rings round it, drawn once per size. */
function hullGlobe(g: CanvasRenderingContext2D, w: number, h: number) {
  const v = viewportOf(w, h);
  const far = Math.hypot(w, h);
  const base = g.createRadialGradient(v.cx, v.cy, v.outer * 0.9, v.cx, v.cy, far * 0.75);
  base.addColorStop(0, ALIEN.hull[0]!);
  base.addColorStop(0.5, ALIEN.hull[1]!);
  base.addColorStop(1, ALIEN.hull[2]!);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU + 0.1;
    const c = Math.cos(a), s = Math.sin(a);
    // Each seam is a pair of lines, a dark groove and a pale edge beside it, so it reads as joined plates.
    for (const [o, col] of [[0, "rgba(0,0,12,0.55)"], [1.4, "rgba(190,180,255,0.1)"]] as const) {
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(v.cx + c * (v.outer + 4) - s * o, v.cy + s * (v.outer + 4) + c * o);
      g.lineTo(v.cx + c * far - s * o, v.cy + s * far + c * o);
      g.stroke();
    }
  }
  for (const k of [1.2, 1.5, 1.95]) {
    for (const [o, col] of [[0, "rgba(0,0,12,0.5)"], [1.4, "rgba(190,180,255,0.09)"]] as const) {
      g.strokeStyle = col;
      g.beginPath();
      g.arc(v.cx, v.cy, v.outer * k + o, 0, TAU);
      g.stroke();
    }
  }
  // Light from the window spills onto the plates round it.
  const spill = g.createRadialGradient(v.cx, v.cy, v.outer, v.cx, v.cy, v.outer * 1.7);
  spill.addColorStop(0, rgba(ALIEN.aqua, 0.12));
  spill.addColorStop(1, rgba(ALIEN.aqua, 0));
  g.fillStyle = spill;
  g.fillRect(0, 0, w, h);
  // The window's space, and the sparkles in it.
  const sp = g.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, v.r);
  sp.addColorStop(0, "#1b1a58");
  sp.addColorStop(0.7, "#0d0c38");
  sp.addColorStop(1, "#05041c");
  g.fillStyle = sp;
  g.beginPath();
  g.arc(v.cx, v.cy, v.r, 0, TAU);
  g.fill();
  g.lineCap = "round";
  for (const s of sparklesOf(w, h)) {
    if (s.twinkle) continue;
    g.strokeStyle = `rgba(235,244,255,${s.a})`;
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(s.x - s.r, s.y);
    g.lineTo(s.x + s.r, s.y);
    g.moveTo(s.x, s.y - s.r);
    g.lineTo(s.x, s.y + s.r);
    g.stroke();
  }
}

/** The ring in front of the world, with a socket for each light and the lamp on top. */
function ringGlobe(g: CanvasRenderingContext2D, w: number, h: number) {
  const v = viewportOf(w, h);
  const mid = v.r + v.ring / 2;
  // Glass glare across the window, faint.
  g.save();
  g.beginPath();
  g.arc(v.cx, v.cy, v.r, 0, TAU);
  g.clip();
  const glare = g.createLinearGradient(v.cx - v.r, v.cy - v.r, v.cx + v.r * 0.2, v.cy + v.r * 0.2);
  glare.addColorStop(0, "rgba(220,230,255,0.09)");
  glare.addColorStop(1, "rgba(220,230,255,0)");
  g.fillStyle = glare;
  g.fillRect(v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
  g.restore();
  // Drop shadow, then the pearl ring, a dark groove at its inner edge, an aqua line and a pale highlight.
  g.beginPath();
  g.arc(v.cx, v.cy, mid + 2, 0, TAU);
  g.lineWidth = v.ring + 6;
  g.strokeStyle = "rgba(0,0,15,0.4)";
  g.stroke();
  g.beginPath();
  g.arc(v.cx, v.cy, mid, 0, TAU);
  g.lineWidth = v.ring;
  g.strokeStyle = pearlStroke(g, v.cx - v.outer, v.cy - v.outer, v.cx + v.outer, v.cy + v.outer);
  g.stroke();
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(v.cx, v.cy, v.r + 1.2, 0, TAU);
  g.strokeStyle = "rgba(8,5,46,0.85)";
  g.stroke();
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(v.cx, v.cy, v.r - 0.4, 0, TAU);
  g.strokeStyle = rgba(ALIEN.aqua, 0.7);
  g.stroke();
  g.beginPath();
  g.arc(v.cx, v.cy, v.outer - 1.2, 0, TAU);
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.stroke();
  for (const l of lampsOf(w, h, "3d")) {
    capsule(g, l, l.thick * 0.28);
    g.fillStyle = "#17104a";
    g.fill();
  }
  housing(g, emitterOf(w, h, "3d"), v.ring * 2.2, v.ring * 1.15);
}

/** The lamp's rounded housing, a pearl capsule with a dark socket for its lens. */
function housing(g: CanvasRenderingContext2D, e: { x: number; y: number }, bw: number, bh: number) {
  g.save();
  g.translate(e.x, e.y);
  g.beginPath();
  g.roundRect(-bw / 2 - 1.5, -bh / 2 - 1.5 + 2, bw + 3, bh + 3, bh / 2);
  g.fillStyle = "rgba(0,0,15,0.4)";
  g.fill();
  g.beginPath();
  g.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
  g.fillStyle = pearlStroke(g, -bw / 2, -bh / 2, bw / 2, bh / 2);
  g.fill();
  g.beginPath();
  g.roundRect(-bw * 0.3, -bh * 0.3, bw * 0.6, bh * 0.6, bh * 0.3);
  g.fillStyle = "#120c42";
  g.fill();
  g.restore();
}

/** The scanner's hull: panels in the strips above and below, a seam where the glass sits. */
function hullGlass(g: CanvasRenderingContext2D, w: number, h: number) {
  const gl = glassOf(w, h);
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, ALIEN.hull[0]!);
  base.addColorStop(0.5, ALIEN.hull[1]!);
  base.addColorStop(1, ALIEN.hull[0]!);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  // Plate seams in the strips, a dark groove with a pale edge.
  const step = clamp(w / 9, 60, 150);
  for (const [y0, y1] of [[0, gl.strip], [h - gl.strip, h]] as const) {
    for (let x = step / 2; x < w; x += step) {
      for (const [o, col] of [[0, "rgba(0,0,12,0.5)"], [1.4, "rgba(190,180,255,0.1)"]] as const) {
        g.strokeStyle = col;
        g.beginPath();
        g.moveTo(x + o, y0);
        g.lineTo(x + o + (y0 === 0 ? 8 : -8), y1);
        g.stroke();
      }
    }
  }
  // The deep sea behind the glass, so anything the world leaves bare reads as the screen.
  g.beginPath();
  g.roundRect(gl.x0, gl.y0, gl.x1 - gl.x0, gl.y1 - gl.y0, gl.rad);
  g.fillStyle = rgba(ALIEN.sea, 1);
  g.fill();
}

function bezelGlass(g: CanvasRenderingContext2D, w: number, h: number) {
  const gl = glassOf(w, h);
  const inner = glassInner(gl);
  g.save();
  g.beginPath();
  g.roundRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0, inner.rad);
  g.clip();
  const sheen = g.createLinearGradient(inner.x0, inner.y0, inner.x0 + (inner.x1 - inner.x0) * 0.5, inner.y0 + (inner.y1 - inner.y0) * 0.6);
  sheen.addColorStop(0, "rgba(220,230,255,0.08)");
  sheen.addColorStop(1, "rgba(220,230,255,0)");
  g.fillStyle = sheen;
  g.fillRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
  g.restore();
  const rect = (grow: number) => g.roundRect(gl.x0 - grow, gl.y0 - grow, gl.x1 - gl.x0 + grow * 2, gl.y1 - gl.y0 + grow * 2, gl.rad + grow);
  g.beginPath();
  rect(2);
  g.lineWidth = gl.rim + 5;
  g.strokeStyle = "rgba(0,0,15,0.4)";
  g.stroke();
  g.beginPath();
  rect(0);
  g.lineWidth = gl.rim;
  g.strokeStyle = pearlStroke(g, gl.x0, gl.y0, gl.x1, gl.y1);
  g.stroke();
  g.lineWidth = 1.2;
  g.beginPath();
  g.roundRect(inner.x0 - 0.4, inner.y0 - 0.4, inner.x1 - inner.x0 + 0.8, inner.y1 - inner.y0 + 0.8, inner.rad);
  g.strokeStyle = rgba(ALIEN.aqua, 0.7);
  g.stroke();
  g.beginPath();
  rect(gl.rim / 2 - 1);
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.stroke();
  for (const l of lampsOf(w, h, "2d")) {
    capsule(g, l, l.thick * 0.3);
    g.fillStyle = "#17104a";
    g.fill();
  }
  const e = emitterOf(w, h, "2d");
  housing(g, e, clamp(gl.strip * 2.4, 54, 110), gl.strip * 0.78);
}

interface Layers {
  key: string;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  lamps: Lamp[];
  critters: Critter[];
  twinkles: Sparkle[];
}

/** The land and sea in the window or the glass: sea in indigo light, a faint grid, coral land and a glow along every coast. */
function paintWorld(f: SurfaceFrame, g: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  const { w, h, mode, map } = f;
  const globe = mode === "3d";
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  g.save();
  g.beginPath();
  if (globe) {
    const v = viewportOf(w, h);
    g.arc(v.cx, v.cy, v.r, 0, TAU);
  } else {
    const r = glassInner(glassOf(w, h));
    g.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.rad);
  }
  g.clip();
  g.lineCap = "round";
  g.lineJoin = "round";
  // The sea: lit from the upper left on the globe, from the middle on the glass.
  const sea = globe ? g.createRadialGradient(cx - R * 0.3, cy - R * 0.34, R * 0.05, cx, cy, R * 1.12) : g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
  sea.addColorStop(0, rgba(ALIEN.seaCore, 1));
  sea.addColorStop(0.55, rgba(ALIEN.sea, 1));
  sea.addColorStop(1, rgba(ALIEN.seaRim, 1));
  g.fillStyle = sea;
  if (globe) {
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();
  } else g.fillRect(0, 0, w, h);
  g.strokeStyle = rgba(ALIEN.aqua, 0.13);
  g.lineWidth = 0.7;
  g.stroke(path(GRID));

  const coast = path(map.coast);
  const lakes = path(map.lakes);
  const land = path(map.land);
  land.addPath(lakes);
  // The glow the land throws into the sea round it.
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = rgba(ALIEN.aqua, 0.06);
  g.lineWidth = 11;
  g.stroke(coast);
  g.strokeStyle = rgba(ALIEN.aqua, 0.09);
  g.lineWidth = 4;
  g.stroke(coast);
  g.globalCompositeOperation = "source-over";
  const reach = globe ? R : Math.max(w, h) * 0.7;
  const lit = g.createRadialGradient(cx - (globe ? R * 0.25 : 0), cy - (globe ? R * 0.3 : 0), reach * 0.1, cx, cy, reach * 1.05);
  lit.addColorStop(0, rgba(ALIEN.land, 1));
  lit.addColorStop(1, rgba(ALIEN.landShade, 1));
  g.fillStyle = lit;
  g.fill(land, "evenodd");
  if (map.ice) {
    g.fillStyle = rgba(ALIEN.ice, 1);
    g.fill(path(map.ice));
  }
  // Light gathered along the coast inside the land.
  g.save();
  g.clip(land, "evenodd");
  g.globalCompositeOperation = "lighter";
  for (const [lw, a] of [[9, 0.05], [4, 0.07], [1.8, 0.1]] as const) {
    g.lineWidth = lw;
    g.strokeStyle = rgba(ALIEN.aqua, a);
    g.stroke(coast);
  }
  g.restore();
  if (f.zoom >= 2) {
    g.strokeStyle = "rgba(255,236,224,0.5)";
    g.lineWidth = 0.8;
    g.stroke(path(map.rivers));
  }
  g.strokeStyle = "rgba(255,244,234,0.95)";
  g.lineWidth = f.theme.coastWidth;
  g.stroke(coast);
  g.lineWidth = f.theme.coastWidth * 0.7;
  g.stroke(lakes);
  if (globe) {
    // The limb darkens, so the globe reads as a lit ball.
    const shade = g.createRadialGradient(cx - R * 0.3, cy - R * 0.34, R * 0.5, cx, cy, R * 1.02);
    shade.addColorStop(0, "rgba(4,4,30,0)");
    shade.addColorStop(1, "rgba(4,4,30,0.66)");
    g.fillStyle = shade;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();
  }
  g.restore();
}

export class AlienCache {
  world = new StillLayer();
  layers?: Layers;
  beam = new Beam();
}

function layersFor(f: SurfaceFrame, cache: AlienCache): Layers {
  const { w, h, dpr, mode } = f;
  const key = `${mode}|${w}|${h}|${dpr}`;
  if (cache.layers?.key === key) return cache.layers;
  const [back, bg] = offscreen(w, h, dpr);
  const [front, fg] = offscreen(w, h, dpr);
  if (mode === "3d") {
    hullGlobe(bg, w, h);
    ringGlobe(fg, w, h);
  } else {
    hullGlass(bg, w, h);
    bezelGlass(fg, w, h);
  }
  cache.layers = { key, back, front, lamps: lampsOf(w, h, mode), critters: placeCritters(w, h, mode), twinkles: mode === "3d" ? sparklesOf(w, h).filter((s) => s.twinkle) : [] };
  return cache.layers;
}

/** The soft halo of air round the globe, and a few sparkles that twinkle slowly. */
function drawHalo(f: SurfaceFrame, twinkles: readonly Sparkle[], cx: number, cy: number, R: number, t: number) {
  const { ctx } = f;
  const v = viewportOf(f.w, f.h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(v.cx, v.cy, v.r, 0, TAU);
  ctx.clip();
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.22);
  halo.addColorStop(0, rgba(ALIEN.aqua, 0.34));
  halo.addColorStop(0.4, rgba(ALIEN.lilac, 0.12));
  halo.addColorStop(1, rgba(ALIEN.lilac, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
  ctx.lineWidth = 0.9;
  ctx.lineCap = "round";
  for (const s of twinkles) {
    ctx.strokeStyle = `rgba(235,244,255,${pulse(t, 7, s.x * 0.013)})`;
    ctx.beginPath();
    ctx.moveTo(s.x - s.r, s.y);
    ctx.lineTo(s.x + s.r, s.y);
    ctx.moveTo(s.x, s.y - s.r);
    ctx.lineTo(s.x, s.y + s.r);
    ctx.stroke();
  }
  ctx.restore();
}

/** The tractor beam, its foot ring and the faint ring that waits when no place is tuned: light only, under the markers. */
function drawBeam(f: SurfaceFrame, cache: AlienCache, level: number, on: boolean, t: number, still: boolean) {
  const { ctx, w, h, mode } = f;
  const e = emitterOf(w, h, mode);
  const cx = w / 2, cy = h / 2;
  const rf = ringOf(w, h);
  const total = cy - e.top;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (level > 0) {
    const reach = smooth(level);
    const y1 = e.top + total * reach;
    const wid = (y: number) => 3 + (rf - 3) * ((y - e.top) / total);
    const cone = ctx.createLinearGradient(0, e.top, 0, y1);
    cone.addColorStop(0, rgba(ALIEN.aqua, BEAM.alpha * level * 0.3));
    cone.addColorStop(1, rgba(ALIEN.aqua, BEAM.alpha * level));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - 3, e.top);
    ctx.lineTo(cx + 3, e.top);
    ctx.lineTo(cx + wid(y1), y1);
    ctx.lineTo(cx - wid(y1), y1);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(ALIEN.aqua, 0.2 * level);
    ctx.beginPath();
    ctx.moveTo(cx - 3, e.top);
    ctx.lineTo(cx - wid(y1), y1);
    ctx.moveTo(cx + 3, e.top);
    ctx.lineTo(cx + wid(y1), y1);
    ctx.stroke();
    if (level >= 1) {
      // Short streaks of light rise along the beam, slowly: lines, not dots.
      ctx.lineCap = "round";
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 7; k++) {
        const u = (((t / 3.4 + k / 7) % 1) + 1) % 1;
        const y = cy - total * 0.92 * u;
        const x = cx + (((k * 0.37) % 1) - 0.5) * wid(y) * 1.5;
        ctx.strokeStyle = rgba(ALIEN.aqua, 0.5 * Math.sin(Math.PI * u));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 9);
        ctx.stroke();
      }
    }
    const foot = ctx.createRadialGradient(cx, cy, 0, cx, cy, rf * 2);
    foot.addColorStop(0, rgba(ALIEN.aqua, 0.2 * smooth(clamp((level - 0.6) / 0.4, 0, 1))));
    foot.addColorStop(1, rgba(ALIEN.aqua, 0));
    ctx.fillStyle = foot;
    ctx.fillRect(cx - rf * 2, cy - rf * 2, rf * 4, rf * 4);
  }
  ctx.globalCompositeOperation = "source-over";
  // The ring where the beam lands: solid and bright once a place is tuned, a faint dashed one that turns slowly otherwise.
  ctx.lineWidth = on && level >= 1 ? 1.6 : 1.1;
  ctx.strokeStyle = rgba(ALIEN.aqua, on && level >= 1 ? 0.95 : 0.4 + 0.3 * level);
  if (!(on && level >= 1)) {
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = still ? 0 : -t * 3;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, rf, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.moveTo(cx + dx * (rf + 3), cy + dy * (rf + 3));
    ctx.lineTo(cx + dx * (rf + 9), cy + dy * (rf + 9));
  }
  ctx.stroke();
  // When the beam lands, one thin ring spreads from the foot and fades.
  if (!still && cache.beam.pingAt >= 0) {
    const u = (performance.now() - cache.beam.pingAt) / 1000 / BEAM.ping;
    if (u < 1) {
      ctx.strokeStyle = rgba(ALIEN.aqua, 0.6 * (1 - u));
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, rf + (rf * 2.2) * smooth(u), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A soft band of aqua light that drifts down the window or the glass every nine seconds, adding under a twentieth. */
export const SCAN = { alpha: 0.045, period: 9 };
function drawScan(f: SurfaceFrame, t: number) {
  const { ctx, w, h, mode } = f;
  const top = mode === "3d" ? h / 2 - viewportOf(w, h).r : glassOf(w, h).y0;
  const span = mode === "3d" ? viewportOf(w, h).r * 2 : glassOf(w, h).y1 - top;
  const band = Math.max(60, span * 0.2);
  const u = (t / SCAN.period) % 1;
  const y = top - band + (span + band * 2) * u;
  const g = ctx.createLinearGradient(0, y - band, 0, y + band);
  g.addColorStop(0, rgba(ALIEN.aqua, 0));
  g.addColorStop(0.5, rgba(ALIEN.aqua, SCAN.alpha));
  g.addColorStop(1, rgba(ALIEN.aqua, 0));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(0, y - band, w, band * 2);
  ctx.restore();
}

export function drawAlien(f: SurfaceFrame, cache: AlienCache): SurfaceResult {
  const { ctx, w, h, mode, proj } = f;
  const globe = mode === "3d";
  const still = stillMotion();
  const t = motionTime();
  const layers = layersFor(f, cache);
  ctx.drawImage(layers.back, 0, 0, w, h);

  let clip: Path2D;
  let inside: (x: number, y: number) => boolean;
  if (globe) {
    const v = viewportOf(w, h);
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    drawHalo(f, layers.twinkles, cx, cy, R, t);
    cache.world.draw(f, (g) => paintWorld(f, g, cx, cy, R), [v.cx - v.r - 2, v.cy - v.r - 2, v.cx + v.r + 2, v.cy + v.r + 2]);
    clip = new Path2D();
    clip.arc(v.cx, v.cy, v.r - 1, 0, TAU);
    inside = (x, y) => Math.hypot(x - v.cx, y - v.cy) < v.r - 5;
  } else {
    const gl = glassOf(w, h);
    cache.world.draw(f, (g) => paintWorld(f, g, w / 2, h / 2, 0), [gl.x0, gl.y0, gl.x1, gl.y1]);
    const r = glassInner(gl);
    clip = new Path2D();
    clip.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.rad);
    inside = (x, y) => inGlass(gl, x, y);
  }
  ctx.drawImage(layers.front, 0, 0, w, h);

  // The beam's lamp glows more as the beam comes down; every lamp pulses slowly.
  const on = !!f.tuned;
  const level = cache.beam.step(performance.now(), on, still);
  for (const l of layers.lamps) lampGlow(ctx, l, t);
  const e = emitterOf(w, h, mode);
  const lens = clamp(Math.min(w, h) * 0.014, 5, 9);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glowBulb(ctx, e.x, e.y, lens * 0.7, ALIEN.aqua, 0.45 + 0.55 * level);
  ctx.restore();
  layers.critters.forEach((c, i) => drawCritter(ctx, c, t, i));

  return {
    inside,
    clip,
    under: () => {
      if (!still) drawScan(f, t);
      drawBeam(f, cache, level, on, t, still);
    },
    next: !still && cache.beam.moving(on) ? 16 : undefined,
  };
}
