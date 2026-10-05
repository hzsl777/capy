// Bunny (id bunny): a burrow and a meadow, every picture our own drawing. The bunnies are soft, round and
// plain: a round body, a round head, long ears with a pink inside, a cotton tail. They are none of any book, film,
// cartoon, game, toy or brand, and nothing here copies a mark of any maker.
//
// Globe view sits the globe in the round opening of a burrow in a green hill, the earth of the opening shading down
// round it, a pair of ears peeking over the hilltop. Map view is the arched window of the burrow looking out on the
// world, an earth ceiling with roots above it and a lawn below. On the lawn are carrots, clover and hay, and round
// holes where bunnies pop out; the two inner holes are the one active bunny's.
//
// The world is painted a way of its own and only from the basemap's land, ice and relief layer: sage land with a
// trefoil of clover at fixed points of longitude and latitude (so the texture is tied to the world and cut by the coast),
// a pale fur-soft rim inside every coast, soft darker clover over the relief layer's mountains, and white over ice, on a
// pale blue sea with a foam of light along the shores. No rivers, no borders, no text.
//
// Everything that is a picture sits off the map: in Globe view outside the opening's ring, in Map view outside the
// window, and `bitsOf` leaves out anything that would reach the globe, the Key or the zoom buttons (test/bunny.test.ts).
// The one thing that moves is the active bunny: while the map turns it hops to the nearest of its holes and ducks in,
// and once the map has rested for half a second it pops out and hops to sit under the reticle, on the lawn below the
// map and never over it. It carries no data. It hops at about two hops a second, asks for a frame about fifteen times
// a second only while it moves, and sits still for reduced motion and in a hidden tab (the view asks for no frames).

import { geoPath } from "d3-geo";
import { StillLayer } from "./ambient.ts";
import { clamp, landPaths, once, pxPerDeg, RAD, speckle, wideCoast } from "./handmade.ts";
import { hash2, pathContext, seeded, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;
const TAU = Math.PI * 2;

// ---- Colours ------------------------------------------------------------------------------------------------------

export const SKY = ["#cde6f2", "#e8f2ee", "#fdeedc"] as const;
export const SEA = "#cfe3f1";
export const MEADOW = "#b8dca4";
export const CLOVER = "#6aac78";
export const CLOVER_DEEP = "#4f9161";
export const HAY = "#efd48c";
export const HAY_DEEP = "#cfa95a";
export const EARTH = "#caa690";
export const EARTH_HI = "#e2c9b4";
export const EARTH_LO = "#a98470";
export const DEEP = "#6c4e47";
export const CARROT = "#f08a3a";
export const CARROT_DEEP = "#d9691f";
export const LEAF = "#69b176";
const INK = "#55404a";
const NOSE = "#ef9aae";

/** A bunny's coat: body, the line round it, and the inside of its ears. Three, so a lawn holds a small family. */
export type FurName = "cream" | "dove" | "honey";
const FUR: Record<FurName, { body: string; line: string; ear: string; shade: string; far: string }> = {
  cream: { body: "#fffaf0", line: "#d9c9b3", ear: "#f7b9c6", shade: "rgba(214,190,160,0.45)", far: "#efe3d2" },
  dove: { body: "#dcd5e2", line: "#a99fb8", ear: "#f2b3c4", shade: "rgba(150,138,170,0.4)", far: "#c4bace" },
  honey: { body: "#f1cfa3", line: "#c49a68", ear: "#f6b4a8", shade: "rgba(190,140,90,0.4)", far: "#e3b985" },
};

// ---- Geometry (plain numbers, tested) -----------------------------------------------------------------------------

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** The Key button's corner at the frame's upper left and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 116, h: 64 };
export const ZOOM_BOX = { w: 76, h: 112 };

/** The opening's radius round the globe, and the hilltop's rise over it, as shares of the globe's radius. */
export const HOLE = 1.18;
const CREST = 1.36;

export const lawnHeight = (h: number) => clamp(Math.round(h * 0.14), 44, 88);

/** The lawn along the foot of the frame: its top edge, the line the bunnies stand on and the bunny's unit size. */
export function lawnOf(w: number, h: number): { top: number; base: number; unit: number; box: Box } {
  const lh = lawnHeight(h);
  return { top: h - lh, base: h - lh * 0.2, unit: lh * 0.5, box: { x0: 0, y0: h - lh, x1: w, y1: h } };
}

/** The arched window Map view looks through: its box and the radii of its four corners (top left, top right, bottom right, bottom left). */
export function windowOf(w: number, h: number): { box: Box; radii: [number, number, number, number]; crest: number; ear: number } {
  const m = clamp(w * 0.012, 6, 14);
  const top = clamp(h * 0.11, 40, 78);
  const box = { x0: m, y0: top, x1: w - m, y1: h - lawnHeight(h) };
  const tl = Math.max(4, Math.min((box.x1 - box.x0) / 2, (box.y1 - box.y0) * 0.34, 96));
  const ear = clamp(top * 0.55, 20, 40);
  return { box, radii: [tl, tl, 20, 20], crest: ear * 0.8 + 6, ear };
}

/** The hill over the opening in Globe view: its crest, and the height of the hill's top edge at x. */
export function hillOf(w: number, h: number, cx: number, cy: number, R: number): { crest: number; at: (x: number) => number } {
  const crest = cy - R * CREST;
  const rx = Math.max(1.5 * Math.max(cx, w - cx), R * 2.6);
  const a = Math.max(h * 1.3, R * 3);
  return {
    crest,
    at: (x) => {
      const q = (x - cx) / rx;
      return Math.abs(q) >= 1 ? Infinity : crest + a - a * Math.sqrt(1 - q * q);
    },
  };
}

/** The lawn's holes by x: the inner two are the active bunny's, the outer two hold a bunny that only peeks. */
export function holesOf(w: number, h: number, avoid: Circle | null): { inner: number[]; outer: number[] } {
  const L = lawnOf(w, h);
  const rx = L.unit * 0.8;
  const ok = (x: number) => {
    if (x - rx < 4 || x + rx > w - 4) return false;
    if (x + rx > w - ZOOM_BOX.w && L.base > h - ZOOM_BOX.h) return false;
    if (avoid && Math.hypot(x - avoid.x, L.base - avoid.y) < avoid.r + L.unit * 1.5) return false;
    return true;
  };
  return { inner: [0.3, 0.7].map((f) => f * w).filter(ok), outer: [0.1, 0.9].map((f) => f * w).filter(ok) };
}

export type BitKind = "carrot" | "carrotLying" | "clover" | "hay" | "tuft" | "peek";

/** One picture on the lawn or the hill: where it stands, its size (a bunny's unit) and the radius it stays inside. */
export interface Bit {
  kind: BitKind;
  x: number;
  y: number;
  s: number;
  r: number;
  fur?: FurName;
  flip?: boolean;
}

/** Slots on the lawn: share of the width, share of the lawn's depth, kind. */
const LAWN_SLOTS: readonly [number, number, BitKind][] = [
  [0.035, 0.55, "clover"],
  [0.065, 0.85, "carrot"],
  [0.19, 0.6, "hay"],
  [0.215, 0.95, "clover"],
  [0.375, 0.9, "carrotLying"],
  [0.425, 0.55, "clover"],
  [0.5, 0.95, "tuft"],
  [0.58, 0.55, "clover"],
  [0.625, 0.9, "carrot"],
  [0.775, 0.6, "clover"],
  [0.81, 0.95, "hay"],
  [0.935, 0.55, "clover"],
  [0.965, 0.9, "carrot"],
];

/** Slots on the hill's flanks in Globe view: share of the width, share of the height, kind, coat. */
const FLANK_SLOTS: readonly [number, number, BitKind, FurName?][] = [
  [0.075, 0.5, "peek", "honey"],
  [0.925, 0.46, "peek", "dove"],
  [0.15, 0.36, "clover"],
  [0.86, 0.34, "clover"],
  [0.05, 0.3, "tuft"],
  [0.95, 0.26, "tuft"],
  [0.19, 0.66, "hay"],
  [0.83, 0.68, "carrot"],
];

const REACH: Record<BitKind, number> = { carrot: 0.55, carrotLying: 0.85, clover: 0.45, hay: 0.8, tuft: 0.4, peek: 1.15 };

/** The radius a flank picture's unit is, from the frame. */
const flankUnit = (w: number, h: number) => clamp(Math.min(w, h) * 0.05, 13, 28);

/**
 * Every picture on the lawn and, in Globe view, on the hill's flanks, left out where it would reach the globe's opening
 * (`globe`: the opening's circle), the Key, the zoom buttons, the frame's edge or the other pictures. Pure and
 * deterministic, so the tests can check every frame size and zoom.
 */
export function bitsOf(w: number, h: number, globe: Circle | null, hill?: (x: number) => number): Bit[] {
  const L = lawnOf(w, h);
  const out: Bit[] = [];
  const holes = holesOf(w, h, globe);
  const clear = (b: Bit) => {
    if (b.x - b.r < 3 || b.x + b.r > w - 3 || b.y - b.r < 3 || b.y > h - 1) return false;
    if (globe && Math.hypot(b.x - globe.x, b.y - globe.y) < globe.r + b.r + 4) return false;
    if (b.x - b.r < KEY_BOX.w && b.y - b.r < KEY_BOX.h) return false;
    if (b.x + b.r > w - ZOOM_BOX.w && b.y + b.r > h - ZOOM_BOX.h) return false;
    for (const hx of [...holes.inner, ...holes.outer]) if (Math.hypot(b.x - hx, b.y - L.base) < b.r + L.unit * 0.9) return false;
    return !out.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < (o.r + b.r) * 0.8);
  };
  for (const [fx, fy, kind] of LAWN_SLOTS) {
    const depth = L.top + (L.base - L.top) * (0.1 + fy * 0.9);
    const s = L.unit * (0.7 + 0.35 * fy);
    const b: Bit = { kind, x: fx * w, y: Math.min(depth, h - 4), s, r: REACH[kind] * s };
    if (kind === "hay" || kind === "carrotLying") b.y = Math.min(h - 3, b.y + s * 0.1);
    // A picture stays on the lawn: its top is no higher than the lawn's edge.
    if (b.y - b.r * 0.8 < L.top - 2) continue;
    if (clear(b)) out.push(b);
  }
  if (globe && hill) {
    const u = flankUnit(w, h);
    for (const [fx, fy, kind, fur] of FLANK_SLOTS) {
      const s = u * (kind === "peek" ? 1 : 0.9);
      const b: Bit = { kind, x: fx * w, y: fy * h, s, r: REACH[kind] * s, fur, flip: fx > 0.5 };
      // On the hill, under its crest and above the lawn, never in the sky.
      if (b.y - b.r < hill(b.x) + 6 || b.y + b.r * 0.4 > L.top - 2) continue;
      if (clear(b)) out.push(b);
    }
  }
  return out;
}

// ---- The one that moves -------------------------------------------------------------------------------------------

/** Seconds a hop takes from one take-off to the next, and the share of it spent in the air. About two hops a second. */
export const HOP_S = 0.42;
export const AIR = 0.7;
/** How long the map must have rested, in milliseconds, before the bunny comes out. */
export const SETTLE_MS = 500;
const DIVE_S = 0.3;
const RISE_S = 0.35;
/** A hop's length in units, and its height as a share of a unit. */
export const HOP_LEN = 1.4;
export const HOP_UP = 0.3;

/** How far a circle is from a box: 0 when they touch or overlap. */
export function rectCircleGap(b: Box, c: Circle): number {
  const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1);
  const dy = Math.max(b.y0 - c.y, 0, c.y - b.y1);
  return Math.hypot(dx, dy) - c.r;
}

/** Whether a bunny standing at `x` on the lawn, ears and a hop included, is clear of a circle (the globe's opening). */
export function bunnyClear(x: number, L: { base: number; unit: number }, c: Circle): boolean {
  const u = L.unit;
  return rectCircleGap({ x0: x - u * 0.7, y0: L.base - u * 1.5, x1: x + u * 0.7, y1: L.base }, c) > 0;
}

export interface Pose {
  x: number;
  /** Pixels above the ground. */
  lift: number;
  /** How much of the bunny shows over its hole, 0 to 1. */
  e: number;
  face: 1 | -1;
  /** Whether it is hopping, diving, rising or waiting between hops. */
  busy: boolean;
  /** Whether the map has moved lately, so the bunny stays away. */
  away: boolean;
}

/**
 * The active bunny. While the view changes it hops to the nearer of its holes and ducks in; once the view has rested for
 * `SETTLE_MS` it rises and hops to `home`, under the reticle. Time comes from the caller, so a test can run it.
 */
export class Hopper {
  x = Number.NaN;
  e = 1;
  face: 1 | -1 = 1;
  private t = -1;
  private view = "";
  private movedAt = -1e9;
  private hopOn = false;
  private hopFrom = 0;
  private hopTo = 0;
  private phase = 0;
  private pause = 0;

  step(now: number, view: string, home: number, holes: readonly number[], unit: number, still: boolean): Pose {
    if (still || !holes.length) {
      this.x = home;
      this.e = 1;
      this.hopOn = false;
      this.t = now;
      this.view = view;
      return { x: home, lift: 0, e: 1, face: this.face, busy: false, away: false };
    }
    if (Number.isNaN(this.x)) this.x = home;
    const dt = this.t < 0 ? 0 : clamp((now - this.t) / 1000, 0, 0.1);
    this.t = now;
    if (!this.view) this.view = view;
    else if (view !== this.view) {
      this.view = view;
      this.movedAt = now;
    }
    const away = now - this.movedAt < SETTLE_MS;
    const near = holes.reduce((a, b) => (Math.abs(b - this.x) < Math.abs(a - this.x) ? b : a));
    const atHole = holes.some((hx) => Math.abs(hx - this.x) <= 0.75);
    let lift = 0;
    let busy = false;
    if (away) {
      if (atHole && !this.hopOn) {
        if (this.e > 0) {
          this.e = Math.max(0, this.e - dt / DIVE_S);
          busy = true;
        }
      } else {
        ({ lift, busy } = this.travel(near, dt, unit));
      }
    } else if (this.e < 1) {
      this.e = Math.min(1, this.e + dt / RISE_S);
      busy = true;
    } else {
      ({ lift, busy } = this.travel(home, dt, unit));
    }
    return { x: this.x, lift, e: this.e, face: this.face, busy, away };
  }

  /** One step of hopping toward `to`: a hop in the air for most of a cycle, then a short rest on the ground. */
  private travel(to: number, dt: number, unit: number): { lift: number; busy: boolean } {
    if (!this.hopOn) {
      if (Math.abs(to - this.x) < 0.75) {
        this.x = to;
        return { lift: 0, busy: false };
      }
      this.pause -= dt;
      if (this.pause > 0) return { lift: 0, busy: true };
      this.face = to > this.x ? 1 : -1;
      const len = Math.min(HOP_LEN * unit, Math.abs(to - this.x));
      this.hopFrom = this.x;
      this.hopTo = this.x + this.face * len;
      this.phase = 0;
      this.hopOn = true;
    }
    this.phase += dt;
    const air = AIR * HOP_S;
    const k = Math.min(1, this.phase / air);
    this.x = this.hopFrom + (this.hopTo - this.hopFrom) * k;
    const size = Math.abs(this.hopTo - this.hopFrom) / (HOP_LEN * unit);
    const lift = Math.sin(Math.PI * k) * HOP_UP * unit * size;
    if (k >= 1) {
      this.hopOn = false;
      this.x = this.hopTo;
      this.pause = (1 - AIR) * HOP_S;
      return { lift: 0, busy: true };
    }
    return { lift, busy: true };
  }
}

// ---- Small drawings, in units of a bunny's size ---------------------------------------------------------------------

/**
 * A bunny standing at (x, y), its feet on y, `s` tall for a body (ears reach to about 1.3 s). `lift` raises it off the
 * ground with a stretch and swept-back ears for a hop; `lop` lets the ears fall.
 */
export function bunny(g: CanvasRenderingContext2D, x: number, y: number, s: number, coat: FurName, face: 1 | -1, o: { lift?: number; lop?: boolean } = {}) {
  const fur = FUR[coat];
  const up = clamp((o.lift ?? 0) / Math.max(1, s * HOP_UP), 0, 1);
  g.save();
  // The shadow stays on the ground and fades as the bunny rises.
  g.fillStyle = `rgba(78,56,56,${0.2 * (1 - up * 0.6)})`;
  g.beginPath();
  g.ellipse(x, y, s * 0.5 * (1 - up * 0.2), s * 0.08, 0, 0, TAU);
  g.fill();
  g.translate(x, y - (o.lift ?? 0));
  g.scale(face, 1);
  g.scale(s, s);
  g.lineJoin = "round";
  g.lineCap = "round";
  const px = 1 / s;
  g.lineWidth = Math.max(0.025, px * 1.1);
  g.strokeStyle = fur.line;
  g.fillStyle = fur.body;
  const blob = (cx: number, cy: number, rx: number, ry: number, rot = 0) => {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
    g.fill();
    g.stroke();
  };
  const ear = (bx: number, by: number, lean: number, len: number, inner: string, body: string) => {
    g.save();
    g.translate(bx, by);
    g.rotate(lean);
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, -len * 0.5, 0.078, len * 0.5, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(0, -len * 0.48, 0.04, len * 0.4, 0, 0, TAU);
    g.fill();
    g.restore();
  };
  if (up > 0) g.rotate(-0.28 * up);
  // The cotton tail, a round tuft behind.
  g.fillStyle = "#fffdf8";
  blob(-0.45, -0.3, 0.115, 0.115);
  g.fillStyle = fur.body;
  // Back, haunch, hind foot and front paws.
  blob(-0.04, -0.31, 0.44, 0.31);
  g.fillStyle = fur.shade;
  g.beginPath();
  g.ellipse(-0.17, -0.25, 0.26, 0.22, 0, 0, TAU);
  g.fill();
  g.fillStyle = fur.body;
  blob(0.0, -0.05, 0.19, 0.06);
  blob(0.3, -0.05, 0.1, 0.055);
  // Ears behind the head: the far one a shade darker, both leaning back and swept further back in a hop.
  const lean = o.lop ? -1.0 : -0.3 - 0.55 * up;
  const len = o.lop ? 0.36 : 0.54;
  ear(0.3, -0.76, lean * 0.7, len * 0.96, fur.ear, fur.far);
  g.fillStyle = fur.body;
  blob(0.27, -0.58, 0.26, 0.235);
  ear(0.17, -0.77, lean, len, fur.ear, fur.body);
  // The face: an eye with a catchlight, a rosy cheek, a small pink nose.
  g.fillStyle = "rgba(244,150,170,0.38)";
  g.beginPath();
  g.arc(0.38, -0.5, 0.06, 0, TAU);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(0.36, -0.61, 0.034, 0, TAU);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(0.37, -0.62, 0.011, 0, TAU);
  g.fill();
  g.fillStyle = NOSE;
  g.beginPath();
  g.ellipse(0.5, -0.55, 0.032, 0.024, 0, 0, TAU);
  g.fill();
  g.restore();
}

/** A carrot growing in the ground at (x, y): its orange shoulder over the soil and a tuft of leaves. */
function carrotGrowing(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineCap = "round";
  g.lineJoin = "round";
  // Leaves: three stems each ending in a soft leaf.
  g.fillStyle = LEAF;
  g.strokeStyle = "#4f9161";
  g.lineWidth = 0.025;
  for (const [a, l] of [[-0.55, 0.5], [0.0, 0.62], [0.5, 0.48]] as const) {
    g.save();
    g.translate(0, -0.1);
    g.rotate(a);
    g.beginPath();
    g.moveTo(-0.03, 0);
    g.quadraticCurveTo(-0.1, -l * 0.55, 0, -l);
    g.quadraticCurveTo(0.1, -l * 0.55, 0.03, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = CARROT;
  g.strokeStyle = CARROT_DEEP;
  g.beginPath();
  g.ellipse(0, -0.05, 0.19, 0.12, 0, Math.PI, 0);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(190,90,30,0.55)";
  g.lineWidth = 0.02;
  g.beginPath();
  g.moveTo(-0.1, -0.1);
  g.lineTo(0.0, -0.09);
  g.moveTo(0.02, -0.04);
  g.lineTo(0.1, -0.05);
  g.stroke();
  g.restore();
}

/** A carrot lying on the grass at (x, y), its leaves toward -x and its point toward +x. */
function carrotLying(g: CanvasRenderingContext2D, x: number, y: number, s: number, flip: boolean) {
  g.save();
  g.translate(x, y);
  g.scale(flip ? -s : s, s);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.fillStyle = "rgba(78,56,56,0.16)";
  g.beginPath();
  g.ellipse(0.05, 0.03, 0.62, 0.07, 0, 0, TAU);
  g.fill();
  g.fillStyle = LEAF;
  g.strokeStyle = "#4f9161";
  g.lineWidth = 0.025;
  for (const a of [-0.45, 0, 0.45]) {
    g.save();
    g.translate(-0.45, -0.1);
    g.rotate(Math.PI + a);
    g.beginPath();
    g.moveTo(0, -0.025);
    g.quadraticCurveTo(0.22, -0.12, 0.34, 0);
    g.quadraticCurveTo(0.22, 0.12, 0, 0.025);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = CARROT;
  g.strokeStyle = CARROT_DEEP;
  g.beginPath();
  g.moveTo(-0.5, -0.19);
  g.bezierCurveTo(-0.1, -0.22, 0.4, -0.1, 0.75, -0.06);
  g.bezierCurveTo(0.4, 0.0, -0.1, 0.0, -0.5, -0.01);
  g.bezierCurveTo(-0.58, -0.07, -0.58, -0.14, -0.5, -0.19);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(190,90,30,0.5)";
  g.lineWidth = 0.02;
  g.beginPath();
  for (const u of [-0.3, -0.1, 0.12, 0.34]) {
    g.moveTo(u, -0.17 + u * 0.1);
    g.lineTo(u + 0.03, -0.08 + u * 0.05);
  }
  g.stroke();
  g.restore();
}

/** A patch of clover: three trefoils on little stems. */
function clover(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineCap = "round";
  const leaf = (cx: number, cy: number, k: number) => {
    g.strokeStyle = CLOVER_DEEP;
    g.lineWidth = 0.025;
    g.beginPath();
    g.moveTo(cx * 0.4, 0);
    g.quadraticCurveTo(cx * 0.8, cy * 0.4, cx, cy);
    g.stroke();
    g.fillStyle = CLOVER;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3;
      g.beginPath();
      g.arc(cx + Math.cos(a) * 0.08 * k, cy + Math.sin(a) * 0.08 * k, 0.085 * k, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "rgba(230,248,214,0.8)";
    g.lineWidth = 0.02;
    g.beginPath();
    g.moveTo(cx - 0.05 * k, cy + 0.0);
    g.lineTo(cx, cy - 0.01);
    g.lineTo(cx + 0.05 * k, cy);
    g.stroke();
  };
  leaf(-0.2, -0.28, 0.9);
  leaf(0.0, -0.42, 1.1);
  leaf(0.22, -0.26, 0.85);
  g.restore();
}

/** A small bale of hay, tied with twine, with a few loose straws. */
function hay(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineCap = "round";
  g.fillStyle = "rgba(78,56,56,0.16)";
  g.beginPath();
  g.ellipse(0, 0.01, 0.7, 0.07, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.roundRect(-0.55, -0.55, 1.1, 0.55, 0.12);
  g.fillStyle = HAY;
  g.fill();
  g.lineWidth = 0.03;
  g.strokeStyle = HAY_DEEP;
  g.stroke();
  g.save();
  g.clip();
  g.strokeStyle = "rgba(190,150,70,0.6)";
  g.lineWidth = 0.025;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const yy = -0.5 + i * 0.09;
    g.moveTo(-0.55, yy);
    g.lineTo(0.55, yy + (i % 2 ? 0.02 : -0.02));
  }
  g.stroke();
  g.restore();
  g.strokeStyle = "#b98a4e";
  g.lineWidth = 0.035;
  g.beginPath();
  g.moveTo(-0.22, -0.55);
  g.lineTo(-0.22, 0);
  g.moveTo(0.22, -0.55);
  g.lineTo(0.22, 0);
  g.stroke();
  g.strokeStyle = HAY_DEEP;
  g.lineWidth = 0.025;
  g.beginPath();
  g.moveTo(0.55, -0.12);
  g.quadraticCurveTo(0.7, -0.16, 0.76, -0.1);
  g.moveTo(0.55, -0.22);
  g.quadraticCurveTo(0.68, -0.3, 0.74, -0.26);
  g.moveTo(-0.55, -0.3);
  g.quadraticCurveTo(-0.68, -0.34, -0.74, -0.24);
  g.stroke();
  g.restore();
}

/** A few blades of grass in one clump. */
function tuft(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineCap = "round";
  g.lineWidth = 0.05;
  for (const [dx, lean, l, c] of [[-0.12, -0.12, 0.32, CLOVER], [-0.04, -0.03, 0.42, CLOVER_DEEP], [0.05, 0.08, 0.36, CLOVER], [0.13, 0.16, 0.26, CLOVER_DEEP]] as const) {
    g.strokeStyle = c;
    g.beginPath();
    g.moveTo(dx, 0);
    g.quadraticCurveTo(dx + lean * 0.3, -l * 0.6, dx + lean, -l);
    g.stroke();
  }
  g.restore();
}

/** A round hole in the lawn, its heap of earth round it. `front` is the lower lip, drawn over a bunny rising out of it. */
function hole(g: CanvasRenderingContext2D, x: number, y: number, s: number, front = false) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  if (!front) {
    g.fillStyle = EARTH;
    g.beginPath();
    g.ellipse(0, 0.02, 0.8, 0.24, 0, 0, TAU);
    g.fill();
    g.strokeStyle = EARTH_LO;
    g.lineWidth = 0.025;
    g.stroke();
    const gr = g.createRadialGradient(0, -0.04, 0.04, 0, 0, 0.62);
    gr.addColorStop(0, "#3f2d2d");
    gr.addColorStop(1, DEEP);
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, 0.6, 0.17, 0, 0, TAU);
    g.fill();
  } else {
    g.lineCap = "round";
    g.strokeStyle = EARTH_HI;
    g.lineWidth = 0.07;
    g.beginPath();
    g.ellipse(0, 0, 0.6, 0.17, 0, 0.12, Math.PI - 0.12);
    g.stroke();
    g.strokeStyle = EARTH_LO;
    g.lineWidth = 0.02;
    g.beginPath();
    g.ellipse(0, 0.035, 0.63, 0.2, 0, 0.18, Math.PI - 0.18);
    g.stroke();
  }
  g.restore();
}

/** A bunny peeking out of a hole at (x, y): the hole, the head and ears over its back edge, its front lip over them. */
function peeker(g: CanvasRenderingContext2D, x: number, y: number, s: number, coat: FurName, face: 1 | -1, lop = false) {
  hole(g, x, y, s);
  g.save();
  const clip = new Path2D();
  clip.rect(x - s * 2, y - s * 3, s * 4, s * 3.02);
  g.clip(clip);
  bunny(g, x, y + s * 0.5, s, coat, face, { lop });
  g.restore();
  hole(g, x, y, s, true);
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.beginPath();
  g.arc(x - r * 0.9, y + r * 0.1, r * 0.62, 0, TAU);
  g.arc(x - r * 0.15, y - r * 0.25, r * 0.85, 0, TAU);
  g.arc(x + r * 0.7, y, r * 0.7, 0, TAU);
  g.rect(x - r * 0.9, y + r * 0.1, r * 1.6, r * 0.62);
  g.fill();
}

function drawBit(g: CanvasRenderingContext2D, b: Bit) {
  if (b.kind === "carrot") carrotGrowing(g, b.x, b.y, b.s);
  else if (b.kind === "carrotLying") carrotLying(g, b.x, b.y, b.s, !!b.flip);
  else if (b.kind === "clover") clover(g, b.x, b.y, b.s);
  else if (b.kind === "hay") hay(g, b.x, b.y, b.s);
  else if (b.kind === "tuft") tuft(g, b.x, b.y, b.s);
  else peeker(g, b.x, b.y, b.s, b.fur ?? "honey", b.flip ? -1 : 1, b.fur === "honey");
}

/** Blades along a line of points, each leaning a little, in one stroke per colour. */
function blades(g: CanvasRenderingContext2D, pts: readonly [number, number][], len: number, seed: number) {
  const rnd = seeded(seed);
  const a = new Path2D(), b = new Path2D();
  for (const [x, y] of pts) {
    for (let i = 0; i < 2; i++) {
      const p = i ? b : a;
      const dx = (rnd() - 0.5) * len * 0.9;
      const l = len * (0.6 + rnd() * 0.6);
      p.moveTo(x + (rnd() - 0.5) * 6, y + 1.5);
      p.quadraticCurveTo(x + dx * 0.3, y - l * 0.6, x + dx, y - l);
    }
  }
  g.lineCap = "round";
  g.lineWidth = Math.max(1.4, len * 0.2);
  g.strokeStyle = CLOVER_DEEP;
  g.stroke(a);
  g.strokeStyle = CLOVER;
  g.stroke(b);
}

function pebbles(g: CanvasRenderingContext2D, list: readonly [number, number, number][]) {
  for (const [x, y, r] of list) {
    g.fillStyle = "#d4cad4";
    g.beginPath();
    g.ellipse(x, y, r, r * 0.72, 0, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.4, r * 0.25, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(120,100,120,0.35)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.72, 0, 0, TAU);
    g.stroke();
  }
}

// ---- The lawn, sky and hill (everything round the world) --------------------------------------------------------------

/** The sky with a few clouds. */
function sky(g: CanvasRenderingContext2D, w: number, h: number, clouds: readonly [number, number, number][]) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, SKY[0]);
  gr.addColorStop(0.55, SKY[1]);
  gr.addColorStop(1, SKY[2]);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  for (const [fx, fy, r] of clouds) cloud(g, fx * w, fy * h, r);
}

/** The lawn: soft grass lit from above, its far edge a gentle curve with a fringe of blades, then its pictures. */
function lawn(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, bits: readonly Bit[], holes: { inner: number[]; outer: number[] }) {
  const L = lawnOf(w, h);
  const gr = g.createLinearGradient(0, L.top, 0, h);
  gr.addColorStop(0, "#c4e3ae");
  gr.addColorStop(1, "#a7d594");
  g.fillStyle = gr;
  const edge = (x: number) => L.top + 2.2 * Math.sin(x * 0.018 + 1.3) + 1.6 * Math.sin(x * 0.047);
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, edge(0));
  for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, edge(x));
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.fillStyle = speckle(g, dpr, "rgba(60,120,80,0.5)", 90, [0.6, 1.5], 31, 110);
  g.fill();
  const pts: [number, number][] = [];
  for (let x = 6; x < w; x += 15) pts.push([x, edge(x) + 2]);
  blades(g, pts, clamp(L.unit * 0.22, 5, 9), 17);
  // Holes, then the pictures standing in the grass in front of them from the back row to the front.
  for (const hx of [...holes.inner, ...holes.outer]) hole(g, hx, L.base, L.unit);
  holes.outer.forEach((hx, i) => peeker(g, hx, L.base, L.unit, i ? "dove" : "honey", i ? -1 : 1, !i));
  for (const b of [...bits].filter((q) => q.kind !== "peek").sort((a, c) => a.y - c.y)) drawBit(g, b);
}

// ---- Globe view's scene ----------------------------------------------------------------------------------------------

/** The hill and its opening, the sky and far hills behind and the ears over the crest, then the lawn in front. */
function globeScene(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, cx: number, cy: number, R: number, bits: readonly Bit[], holes: { inner: number[]; outer: number[] }) {
  const hill = hillOf(w, h, cx, cy, R);
  const m = Math.min(w, h);
  sky(g, w, h, [[0.13, 0.17, m * 0.065], [0.86, 0.1, m * 0.05], [0.72, 0.27, m * 0.04]]);
  // Far hills, paler.
  g.fillStyle = "#dbebd6";
  g.beginPath();
  g.ellipse(w * 0.12, h * 0.62, w * 0.42, h * 0.22, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#cfe6cb";
  g.beginPath();
  g.ellipse(w * 0.9, h * 0.66, w * 0.4, h * 0.24, 0, 0, TAU);
  g.fill();
  // The ears over the crest: two long ears, one leaning, the other a little behind, their bases under the hill.
  const e = R * 0.3;
  const ear = (x: number, lean: number, body: string, inner: string) => {
    g.save();
    g.translate(x, hill.at(x) + R * 0.04);
    g.rotate(lean);
    g.lineJoin = "round";
    g.fillStyle = body;
    g.strokeStyle = FUR.cream.line;
    g.lineWidth = Math.max(1, R * 0.012);
    g.beginPath();
    g.ellipse(0, -e * 0.7, R * 0.095, e * 1.0, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(0, -e * 0.68, R * 0.05, e * 0.8, 0, 0, TAU);
    g.fill();
    g.restore();
  };
  ear(cx - R * 0.17, -0.16, "#fffaf0", FUR.cream.ear);
  ear(cx + R * 0.15, 0.1, "#fffaf0", FUR.cream.ear);
  // The hill, a soft mound lit from above, a pale band along its top edge and blades along it.
  const y0 = hill.crest;
  const grad = g.createLinearGradient(0, y0, 0, h);
  grad.addColorStop(0, "#cde8b8");
  grad.addColorStop(0.5, "#b4dc9f");
  grad.addColorStop(1, "#9ccd8c");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, h);
  const top: [number, number][] = [];
  for (let x = 0; x <= w + 6; x += 6) {
    const y = hill.at(Math.min(x, w));
    g.lineTo(x, Number.isFinite(y) ? y : h);
    if (Number.isFinite(y)) top.push([x, y]);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.fillStyle = speckle(g, dpr, "rgba(60,120,80,0.45)", 80, [0.6, 1.4], 7, 120);
  g.fill();
  g.strokeStyle = "rgba(236,250,214,0.8)";
  g.lineWidth = Math.max(2, R * 0.025);
  g.lineJoin = "round";
  g.beginPath();
  top.forEach(([x, y], i) => (i ? g.lineTo(x, y + g.lineWidth * 0.5) : g.moveTo(x, y + g.lineWidth * 0.5)));
  g.stroke();
  blades(g, top.filter((_, i) => i % 4 === 0), clamp(R * 0.045, 4, 8), 5);
  // The opening: a ring of turf, a soft shadow on the grass, then the earth shading down toward the globe.
  const H = R * HOLE;
  const sh = g.createRadialGradient(cx, cy, H, cx, cy, H + R * 0.2);
  sh.addColorStop(0, "rgba(70,100,70,0.32)");
  sh.addColorStop(1, "rgba(70,100,70,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.arc(cx, cy, H + R * 0.2, 0, TAU);
  g.fill();
  const earth = g.createRadialGradient(cx, cy - R * 0.1, R * 0.9, cx, cy, H);
  earth.addColorStop(0, "#5d4440");
  earth.addColorStop(0.5, "#86645a");
  earth.addColorStop(1, "#b99682");
  g.fillStyle = earth;
  g.beginPath();
  g.arc(cx, cy, H, 0, TAU);
  g.fill();
  // Roots hanging into the opening from its top edge, and pebbles in its earth.
  g.save();
  const clip = new Path2D();
  clip.arc(cx, cy, H, 0, TAU);
  g.clip(clip);
  g.strokeStyle = "rgba(226,201,180,0.7)";
  g.lineCap = "round";
  g.lineWidth = Math.max(1.2, R * 0.016);
  const rnd = seeded(23);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.1;
    const l = R * (0.1 + rnd() * 0.12);
    const x = cx + Math.cos(a) * H, y = cy + Math.sin(a) * H;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - Math.cos(a) * l * 0.3 + l * 0.2, y - Math.sin(a) * l * 0.3, x - Math.cos(a) * l * 0.7 - l * 0.2, y - Math.sin(a) * l * 0.7, x - Math.cos(a) * l, y - Math.sin(a) * l);
    g.stroke();
  }
  pebbles(
    g,
    Array.from({ length: 9 }, (_, i): [number, number, number] => {
      const a = (i / 9) * TAU + 0.3, d = R * (1.04 + (hash2(i, 5) - 0.5) * 0.12);
      return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.022 + hash2(i, 9) * 0.02)];
    }),
  );
  g.restore();
  // The rim: a ring of turf, lit along the top, with blades growing over its edge.
  g.lineWidth = Math.max(3, R * 0.05);
  const rim = g.createLinearGradient(0, cy - H, 0, cy + H);
  rim.addColorStop(0, "#d6efc0");
  rim.addColorStop(1, "#98cb88");
  g.strokeStyle = rim;
  g.beginPath();
  g.arc(cx, cy, H + g.lineWidth * 0.3, 0, TAU);
  g.stroke();
  const rimPts: [number, number][] = [];
  for (let i = 0; i < 46; i++) {
    const a = -Math.PI / 2 + ((i - 23) / 23) * 1.25;
    rimPts.push([cx + Math.cos(a) * (H + R * 0.04), cy + Math.sin(a) * (H + R * 0.04)]);
  }
  blades(g, rimPts, clamp(R * 0.05, 4, 9), 3);
  pebbles(
    g,
    Array.from({ length: 12 }, (_, i): [number, number, number] => {
      const a = Math.PI * (0.05 + (i / 11) * 0.9) + (hash2(i, 3) - 0.5) * 0.12;
      const d = H + R * (0.1 + hash2(i, 1) * 0.06);
      return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.03 + hash2(i, 2) * 0.018)];
    }).filter(([x, y, r]) => y < lawnOf(w, h).top - r && x > r && x < w - r),
  );
  lawn(g, w, h, dpr, bits, holes);
  for (const b of bits.filter((q) => q.kind === "peek")) drawBit(g, b);
}

// ---- Map view's scene -------------------------------------------------------------------------------------------------

/** Whether a point is inside the window, a `margin` clear of its edge and of its arched corners. */
export function inWindow(w: number, h: number, x: number, y: number, margin = 4): boolean {
  const { box, radii } = windowOf(w, h);
  if (x < box.x0 + margin || x > box.x1 - margin || y < box.y0 + margin || y > box.y1 - margin) return false;
  const [tl, tr, br, bl] = radii;
  const corner = (cx: number, cy: number, r: number, dx: number, dy: number) => (dx * (x - cx) > 0 && dy * (y - cy) > 0 ? Math.hypot(x - cx, y - cy) <= r - margin : true);
  return (
    corner(box.x0 + tl, box.y0 + tl, tl, -1, -1) &&
    corner(box.x1 - tr, box.y0 + tr, tr, 1, -1) &&
    corner(box.x1 - br, box.y1 - br, br, 1, 1) &&
    corner(box.x0 + bl, box.y1 - bl, bl, -1, 1)
  );
}

function roundedWindow(p: Path2D, box: Box, r: [number, number, number, number]) {
  p.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, r);
}

/** The sky, the ears over the crest, the earth ceiling with its roots, the earth beside the window and the lawn below. */
function mapScene(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, bits: readonly Bit[], holes: { inner: number[]; outer: number[] }) {
  const W = windowOf(w, h);
  const edge = (x: number) => W.crest + 2.4 * Math.sin(x * 0.011 + 0.6) + 1.4 * Math.sin(x * 0.037);
  sky(g, w, h, [[0.12, 0.012, W.ear * 0.9], [0.52, 0.004, W.ear * 0.7], [0.9, 0.014, W.ear * 0.85]]);
  // Two pairs of ears over the crest: a cream pair and a dove-grey pair, their bases under the earth.
  const pair = (x: number, a: FurName, b: FurName, lop: boolean) => {
    const e = W.ear;
    const one = (dx: number, lean: number, coat: FurName, len: number) => {
      const fur = FUR[coat];
      g.save();
      g.translate(x + dx * e, edge(x) + 2);
      g.rotate(lean);
      g.fillStyle = fur.body;
      g.strokeStyle = fur.line;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(0, -len * 0.5, e * 0.27, len * 0.5, 0, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = fur.ear;
      g.beginPath();
      g.ellipse(0, -len * 0.5, e * 0.13, len * 0.4, 0, 0, TAU);
      g.fill();
      g.restore();
    };
    one(-0.4, -0.14, a, e * 1.2);
    one(0.4, lop ? 0.5 : 0.1, b, lop ? e * 0.9 : e * 1.15);
  };
  pair(w * 0.2, "cream", "cream", false);
  pair(w * 0.77, "dove", "dove", true);
  // The earth: a wall of soft biscuit-brown with a lighter top and pebbles and specks in it.
  const earth = g.createLinearGradient(0, W.crest, 0, h);
  earth.addColorStop(0, EARTH_HI);
  earth.addColorStop(0.35, EARTH);
  earth.addColorStop(1, EARTH_LO);
  g.fillStyle = earth;
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, edge(0));
  for (let x = 0; x <= w + 6; x += 6) g.lineTo(x, edge(x));
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.fillStyle = speckle(g, dpr, "rgba(110,76,66,0.5)", 120, [0.7, 1.8], 11, 120);
  g.fill();
  const top = W.box.y0;
  const rnd = seeded(41);
  const stones: [number, number, number][] = [];
  for (let i = 0; i < Math.round(w / 70); i++) stones.push([(i + 0.3 + rnd() * 0.4) * (w / Math.round(w / 70)), W.crest + (top - W.crest) * (0.35 + rnd() * 0.5), 3 + rnd() * 3.4]);
  pebbles(g, stones);
  // A turf edge along the crest, blades growing over it.
  g.strokeStyle = "#b9dfa3";
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.beginPath();
  for (let x = 0; x <= w + 6; x += 6) (x ? g.lineTo(x, edge(x) + 2.5) : g.moveTo(x, edge(x) + 2.5));
  g.stroke();
  const pts: [number, number][] = [];
  for (let x = 5; x < w; x += 13) pts.push([x, edge(x) + 1]);
  blades(g, pts, clamp(W.ear * 0.3, 5, 8), 9);
  // Roots hang from the crest's earth toward the window.
  g.strokeStyle = "rgba(244,226,208,0.75)";
  g.lineCap = "round";
  g.lineWidth = 1.6;
  const rr = seeded(77);
  for (let i = 0; i < Math.round(w / 90); i++) {
    const x = (i + 0.2 + rr() * 0.6) * (w / Math.round(w / 90));
    const l = (top - W.crest) * (0.3 + rr() * 0.4);
    g.beginPath();
    g.moveTo(x, W.crest + 8);
    g.bezierCurveTo(x + 6, W.crest + 8 + l * 0.3, x - 6, W.crest + 8 + l * 0.7, x + 2, W.crest + 8 + l);
    g.stroke();
  }
  lawn(g, w, h, dpr, bits, holes);
}

/** The window's rim, drawn over the world: the earth's soft shadow falling inside the opening and a pale lip. */
function windowRim(g: CanvasRenderingContext2D, w: number, h: number) {
  const W = windowOf(w, h);
  const win = new Path2D();
  roundedWindow(win, W.box, W.radii);
  g.save();
  g.clip(win);
  const outer = new Path2D();
  outer.rect(-40, -40, w + 80, h + 80);
  outer.addPath(win);
  g.shadowColor = "rgba(86,56,50,0.5)";
  g.shadowBlur = 14;
  g.fillStyle = EARTH;
  g.fill(outer, "evenodd");
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,246,232,0.9)";
  g.stroke(win);
}

// ---- The world ----------------------------------------------------------------------------------------------------------

/** Grid steps in degrees, each dividing 180, so a trefoil stays at the same place on the world at a given step. */
const STEPS = [0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6] as const;

/** The grid step that makes a cell about `px` pixels across at `pxDeg` pixels per degree. */
export function cloverStep(pxDeg: number, px = 22): number {
  const want = px / Math.max(1e-6, pxDeg);
  for (const s of STEPS) if (s >= want) return s;
  return STEPS[STEPS.length - 1]!;
}

/** The clover at cell (i, j) of a step: where it lies, which way it turns and how large it is, always the same. */
export function cloverAt(step: number, i: number, j: number): { lon: number; lat: number; turn: number; size: number } {
  return {
    lon: (i + 0.5 + (hash2(i * 7 + 3, j * 13 + 1) - 0.5) * 0.8) * step - 180,
    lat: (j + 0.5 + (hash2(i * 11 + 5, j * 3 + 7) - 0.5) * 0.8) * step - 90,
    turn: hash2(i * 5 + 9, j * 17 + 2) * TAU,
    size: 0.8 + hash2(i * 19 + 1, j * 7 + 11) * 0.45,
  };
}

/** The part of the world the frame can show: a latitude range and a longitude half-span from the view's centre (180 for all). */
function visibleBox(f: SurfaceFrame, step: number): { lat0: number; lat1: number; lon0: number; lon1: number } {
  if (f.mode === "3d") {
    const R = f.proj.scale();
    const reach = Math.hypot(f.w, f.h) / 2;
    const a = reach >= R ? 90 : Math.asin(reach / R) / RAD;
    const lat0 = Math.max(-90, f.lat - a - step), lat1 = Math.min(90, f.lat + a + step);
    const edge = Math.max(Math.abs(lat0), Math.abs(lat1));
    const dl = edge >= 89 || a >= 89 ? 180 : Math.min(180, a / Math.cos(edge * RAD) + step * 2);
    return { lat0, lat1, lon0: f.lon - dl, lon1: f.lon + dl };
  }
  const inv = f.proj.invert!;
  let lat0 = 90, lat1 = -90, lo = 180, hi = -180, hole = false;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const q = inv([(f.w * i) / 6, (f.h * j) / 6]);
      if (!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) {
        hole = true;
        continue;
      }
      lat0 = Math.min(lat0, q[1]);
      lat1 = Math.max(lat1, q[1]);
      lo = Math.min(lo, q[0]);
      hi = Math.max(hi, q[0]);
    }
  }
  lat0 = Math.max(-90, lat0 - step);
  lat1 = Math.min(90, lat1 + step);
  if (hole || hi - lo > 200) return { lat0: -90, lat1: 90, lon0: -180, lon1: 180 };
  return { lat0, lat1, lon0: lo - step, lon1: hi + step };
}

/** The trefoils of clover on the land, in one path: three small round leaves at each cell that lies on or beside land. */
function trefoils(f: SurfaceFrame): Path2D {
  const pxDeg = pxPerDeg(f.proj);
  const screenK = clamp(Math.min(f.w, f.h) / 720, 0.75, 1);
  const step = cloverStep(pxDeg, 26 * screenK);
  const box = visibleBox(f, step);
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const p = new Path2D();
  const cols = Math.round(360 / step);
  const i0 = Math.floor((box.lon0 + 180) / step), i1 = Math.ceil((box.lon1 + 180) / step);
  const j0 = Math.floor((box.lat0 + 90) / step), j1 = Math.ceil((box.lat1 + 90) / step);
  const span = Math.min(cols, i1 - i0 + 1);
  const near = step * 0.5;
  const leaf = clamp(pxDeg * step * 0.11, 1.1, 2.4);
  for (let j = j0; j <= j1; j++) {
    for (let k = 0; k < span; k++) {
      const i = (((i0 + k) % cols) + cols) % cols;
      const c = cloverAt(step, i, j);
      if (c.lat < -90 || c.lat > 90) continue;
      if (!f.isLand(c.lon, c.lat) || !f.isLand(c.lon + near, c.lat) || !f.isLand(c.lon - near, c.lat)) continue;
      let fore = 1;
      if (globe) {
        const a = c.lat * RAD, b = f.lat * RAD;
        const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((c.lon - f.lon) * RAD);
        if (cosc < 0.05) continue;
        fore = Math.max(0.4, Math.sqrt(cosc));
      }
      const q = f.proj([c.lon, c.lat]);
      if (!q || q[0] < -8 || q[1] < -8 || q[0] > f.w + 8 || q[1] > f.h + 8) continue;
      if (globe && Math.hypot(q[0] - cx, q[1] - cy) > R) continue;
      const r = leaf * c.size * fore;
      for (let n = 0; n < 3; n++) {
        const a = c.turn + (n * TAU) / 3;
        const x = q[0] + Math.cos(a) * r * 0.95, y = q[1] + Math.sin(a) * r * 0.95;
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, TAU);
      }
    }
  }
  return p;
}

const LOW = 4;
type Soft = { canvas?: HTMLCanvasElement; g?: CanvasRenderingContext2D };

/** A soft layer: strokes drawn on a canvas a quarter the frame's size, so laid back over the frame they come out blurred. */
function soft(slot: Soft, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const W = Math.max(1, Math.ceil(w / LOW)), H = Math.max(1, Math.ceil(h / LOW));
  if (!slot.canvas || !slot.g || slot.canvas.width !== W || slot.canvas.height !== H) {
    slot.canvas = document.createElement("canvas");
    slot.canvas.width = W;
    slot.canvas.height = H;
    slot.g = slot.canvas.getContext("2d")!;
  }
  const g = slot.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(1 / LOW, 0, 0, 1 / LOW, 0, 0);
  g.lineJoin = "round";
  g.lineCap = "round";
  draw(g);
  return slot.canvas;
}

/** Pins a pattern to a point of the world, so a texture travels with the sea as it is dragged (the globe's centre on the globe). */
function anchor(p: CanvasPattern, f: SurfaceFrame, k: number): CanvasPattern {
  const o = f.mode === "2d" ? (f.proj([0, 0]) ?? [0, 0]) : f.proj.translate();
  p.setTransform(new DOMMatrix().translate(o[0], o[1]).scale(k));
  return p;
}

/** The sea, the land and its clover, inside `clip` (the window or the globe). */
function paintWorld(f: SurfaceFrame, cache: BunnyCache, g: CanvasRenderingContext2D, clip: Path2D) {
  const { w, h, dpr } = f;
  const k = clamp(0.85 + f.zoom * 0.15, 1, 1.8) * clamp(Math.min(w, h) / 720, 0.7, 1);
  g.save();
  g.clip(clip);
  g.fillStyle = SEA;
  g.fillRect(0, 0, w, h);
  // A few small pale glints on the water, tied to the world.
  g.fillStyle = anchor(speckle(g, dpr, "rgba(255,255,255,0.9)", 70, [0.8, 1.8], 53, 120), f, 1 / dpr);
  g.globalAlpha = 0.5;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  const { land, coast, ice } = landPaths(f, f.map);
  const wide = wideCoast(f, coast);
  // The relief layer's mountains: a disc round each peak, so a range joins into one soft darker band.
  const pr = clamp(pxPerDeg(f.proj) * 0.9, 4, 20);
  const peaks = new Path2D();
  for (const [lon, lat] of f.relief?.peaks ?? []) {
    if (f.mode === "3d") {
      const a = lat * RAD, b = f.lat * RAD;
      if (Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * RAD) < 0.05) continue;
    }
    const q = f.proj([lon, lat]);
    if (!q || q[0] < -pr || q[1] < -pr || q[0] > w + pr || q[1] > h + pr) continue;
    peaks.moveTo(q[0] + pr, q[1]);
    peaks.arc(q[0], q[1], pr, 0, TAU);
  }
  // Foam: a pale light along the shore in the water, fading out from the land.
  g.drawImage(
    soft(cache.foam, w, h, (s) => {
      s.strokeStyle = "rgba(255,255,255,0.17)";
      for (const d of [30, 21, 13, 7]) {
        s.lineWidth = d * k;
        s.stroke(wide);
      }
    }),
    0,
    0,
    w,
    h,
  );
  g.fillStyle = MEADOW;
  g.fill(land);
  g.save();
  g.clip(land);
  // The land's soft fur: a pale lighter rim inside every coast, and darker clover over the mountains.
  g.drawImage(
    soft(cache.fur, w, h, (s) => {
      s.strokeStyle = "rgba(244,252,222,0.5)";
      s.lineWidth = 16 * k;
      s.stroke(wide);
      s.strokeStyle = "rgba(244,252,222,0.35)";
      s.lineWidth = 7 * k;
      s.stroke(wide);
      s.fillStyle = "rgba(70,140,92,0.3)";
      s.fill(peaks);
    }),
    0,
    0,
    w,
    h,
  );
  g.fillStyle = "rgba(79,145,97,0.34)";
  g.fill(trefoils(f));
  if (ice) {
    g.fillStyle = "rgba(255,255,252,0.9)";
    g.fill(ice);
  }
  g.restore();
  // Lakes are water; no rivers, since a thin line running inland reads too much like a border.
  const path = geoPath(f.proj, g);
  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = SEA;
  g.fill();
  g.lineWidth = 0.7;
  g.strokeStyle = "rgba(95,157,110,0.7)";
  g.stroke();
  g.lineWidth = f.theme.coastWidth;
  g.strokeStyle = "rgba(84,150,102,0.9)";
  g.stroke(coast);
  g.restore();
}

// ---- The frame ------------------------------------------------------------------------------------------------------------

export class BunnyCache {
  world = new StillLayer();
  back: { key?: string; canvas?: HTMLCanvasElement } = {};
  rim: { key?: string; canvas?: HTMLCanvasElement } = {};
  foam: Soft = {};
  fur: Soft = {};
  hopper = new Hopper();
}

/** The globe's lit dome: light from the upper left, a bluish shade toward the limb, and its outline. */
function globeLight(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, sphere: Path2D) {
  g.save();
  g.clip(sphere);
  const gr = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R);
  gr.addColorStop(0, "rgba(255,255,244,0.3)");
  gr.addColorStop(0.55, "rgba(255,255,244,0)");
  gr.addColorStop(0.85, "rgba(96,128,170,0.06)");
  gr.addColorStop(1, "rgba(70,100,150,0.3)");
  g.fillStyle = gr;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
  g.lineWidth = 1.2;
  g.strokeStyle = "rgba(72,110,96,0.7)";
  g.stroke(sphere);
}

/** The active bunny in its pose, over the lawn, with its hole's front lip over it while it is still rising. */
function paintHopper(f: SurfaceFrame, pose: Pose, holes: readonly number[], lawnClip: Path2D | null, hidden: boolean) {
  if (hidden) return;
  const { ctx: g } = f;
  const L = lawnOf(f.w, f.h);
  if (pose.e <= 0.001) return;
  g.save();
  if (lawnClip) g.clip(lawnClip);
  const hx = holes.find((x) => Math.abs(x - pose.x) <= 1.5);
  if (hx !== undefined && pose.e < 1) {
    // Rising out of or ducking into its hole: only what is over the hole's far edge shows.
    const c = new Path2D();
    c.rect(hx - L.unit * 2, L.base - L.unit * 3, L.unit * 4, L.unit * 3);
    g.clip(c);
    bunny(g, pose.x, L.base + (1 - pose.e) * L.unit * 1.05, L.unit, "cream", pose.face);
    g.restore();
    hole(g, hx, L.base, L.unit, true);
    return;
  }
  bunny(g, pose.x, L.base, L.unit, "cream", pose.face, { lift: pose.lift });
  g.restore();
}

export function drawBunnyScene(f: SurfaceFrame, c: BunnyCache): SurfaceResult {
  const { w, h, dpr } = f;
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const L = lawnOf(w, h);
  const ring: Circle | null = globe ? { x: cx, y: cy, r: R * (HOLE + 0.18) } : null;
  const holes = holesOf(w, h, ring);
  const hill = globe ? hillOf(w, h, cx, cy, R) : null;
  const bits = bitsOf(w, h, ring, hill?.at);
  const key = globe ? `g|${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}` : `m|${w}|${h}|${dpr}`;
  const back = once(c.back, key, w, h, dpr, (g) => (globe ? globeScene(g, w, h, dpr, cx, cy, R, bits, holes) : mapScene(g, w, h, dpr, bits, holes)));
  const win = new Path2D();
  const W = windowOf(w, h);
  roundedWindow(win, W.box, W.radii);
  const sphere = new Path2D();
  if (globe) geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  c.world.draw(f, (g) => {
    g.drawImage(back, 0, 0, w, h);
    if (globe) {
      paintWorld(f, c, g, sphere);
      globeLight(g, cx, cy, R, sphere);
    } else {
      paintWorld(f, c, g, win);
      g.drawImage(
        once(c.rim, `${w}|${h}|${dpr}`, w, h, dpr, (r) => windowRim(r, w, h)),
        0,
        0,
        w,
        h,
      );
    }
  });
  // The one that moves. It stands under the reticle, on the lawn, and leaves the map and the globe alone.
  const view = `${f.mode}|${f.lon.toFixed(3)}|${f.lat.toFixed(3)}|${f.zoom.toFixed(3)}`;
  const holeXs = holes.inner;
  const home = cx;
  // Hidden when the frame is too small for it or the opening has grown over its place (zoomed in on the globe).
  const hidden = !holeXs.length || (globe && !bunnyClear(home, L, { x: cx, y: cy, r: R * HOLE }));
  const pose = c.hopper.step(f.now ?? 0, view, home, holeXs, L.unit, !!f.still);
  const lawnClip = new Path2D();
  lawnClip.rect(0, L.top, w, h - L.top);
  paintHopper(f, pose, holeXs, globe ? null : lawnClip, hidden);
  // It asks for frames only while it hops or the map has moved lately, so a map at rest costs nothing.
  const next = !hidden && (pose.busy || pose.away) ? 66 : 0;
  if (globe) return { next };
  return { inside: (x, y) => inWindow(w, h, x, y), clip: win, next };
}
