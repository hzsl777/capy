// Noodle Bowl (id soup, experimental): the world in a bowl of broth, seen from above. Globe view floats the globe in
// the broth with noodles, a spoon, a soft egg, a sheet of seaweed, scallion rings and herb sprigs of our own drawing
// laid round it in the bowl, and steam drifting off the top. Map view is the broth's surface in a wide pot with two
// handles, the land cut from the coastline alone. A drag or a zoom sets the broth moving: the whole picture bends a
// little, like noodles in a stir, and settles within about two seconds of letting go (`Wobble`).
//
// Everything laid round the world is decoration: its places are fixed lists, tied to the frame and never to data, so
// nothing stands for a place, a count or a story. Each piece is checked against the globe or the pot (`placeDisc`,
// `placeRect`) so none comes near the world, the Key button or the zoom buttons, the noodles keep to a ring of the
// bowl clear of the globe (`noodleBand`), and the steam is clipped away from the world. The view draws markers last
// and nothing here moves them: they go through the same wobble as the land under them, so each sits on its place.
// The wobble is a smooth sway of a few pixels that is nil at the frame's centre (the tuned place never moves), is
// still for reduced motion and in a hidden tab (the view asks for no frames then), and swings under three times a
// second, so nothing flashes.

import { geoPath } from "d3-geo";
import { motionTime, viewKey } from "./ambient.ts";
import { cachedPicture, pathContext, Picture, type SurfaceFrame, type SurfaceResult } from "./surface.ts";
import type { Warp } from "./warp.ts";

const DEG = Math.PI / 180;
const TAU_RAD = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Everything laid round the world keeps at least this many pixels from it. */
export const GAP = 8;

// ---- the broth's sway --------------------------------------------------------------------------------------------

/** Seconds for the sway to fall to 1/e of its size, and the sway's rate in swings a second (under the flash limit of 3). */
export const SETTLE_S = 0.55;
export const SWAY_HZ = 1.3;
/** The sway is gone below this share of its full size, and a drag at or past SPEED_FULL px/s gives the full sway. */
export const SWAY_MIN = 0.015;
export const SPEED_FULL = 450;
const SPEED_FLOOR = 25;

/** The most the sway moves any point, in pixels, for a frame of this size. */
export function swayAmp(w: number, h: number): number {
  return clamp(Math.min(w, h) * 0.019, 6, 13);
}

/**
 * The sway as a displacement field over the frame. It grows from nothing at the centre (so the tuned place stays where
 * it is and a tap at the centre needs no correction) to its full size, as two slow waves running across the picture,
 * each along the other's axis, so a stretch of the picture bends one way as the next bends the other, like a noodle.
 */
export function swayField(w: number, h: number, amp: number, phase: number): (x: number, y: number) => [number, number] {
  const cx = w / 2, cy = h / 2;
  const m = Math.min(w, h);
  const L = m * 0.075;
  const rho = m * 0.34;
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    const env = 1 - Math.exp(-(dx * dx + dy * dy) / (rho * rho));
    const u = dx / L, v = dy / L;
    return [amp * env * (Math.sin(v + phase) + 0.5 * Math.sin(1.7 * u - 1.3 * phase + 1)), amp * env * (Math.sin(u - 0.8 * phase + 2) + 0.5 * Math.sin(1.9 * v + 1.1 * phase))];
  };
}

/** The sway as a warp (src/map/warp.ts): points go forward through the field, and back by settling on the preimage. */
export function swayWarp(w: number, h: number, amp: number, phase: number): Warp {
  const d = swayField(w, h, amp, phase);
  return {
    kind: "wobble",
    fwd: (x, y) => {
      const [dx, dy] = d(x, y);
      return [x + dx, y + dy];
    },
    inv: (x, y) => {
      // The field bends gently (its slope stays well under 1), so repeating "start from the screen point, take back the
      // shift found at the guess" settles on the flat point that lands here.
      let px = x, py = y;
      for (let i = 0; i < 16; i++) {
        const [dx, dy] = d(px, py);
        px = x - dx;
        py = y - dy;
      }
      return [px, py];
    },
    split: 10,
    unpan: (dx, dy) => [dx, dy],
  };
}

/**
 * How much the broth is stirred, from how fast the view moved. The view calls `step` once a frame with its position;
 * a drag, a glide or a zoom kicks the sway up, and it dies away by itself. Reduced motion never stirs it.
 */
export class Wobble {
  /** 0 (still) to 1 (a fast drag). */
  energy = 0;
  phase = 0;
  private t = -1;
  private lon = 0;
  private lat = 0;
  private zoom = 1;
  private warp: Warp | null = null;

  get active(): boolean {
    return this.energy > 0;
  }

  /** `k` is pixels per radian at the centre. Returns the warp for this frame, or null while the broth is still. */
  step(now: number, lon: number, lat: number, zoom: number, k: number, w: number, h: number, still: boolean): Warp | null {
    if (still) {
      this.energy = 0;
      this.t = -1;
      this.warp = null;
      return null;
    }
    const dt = (now - this.t) / 1000;
    // A second paint in the same instant (a resize, a hover) neither moves nor steadies the broth.
    if (this.t >= 0 && dt < 0.004 && this.warp) return this.warp;
    if (this.t >= 0 && dt < 0.5) {
      let dlon = lon - this.lon;
      dlon -= 360 * Math.round(dlon / 360);
      const moved = Math.hypot(dlon * DEG * Math.cos(lat * DEG) * k, (lat - this.lat) * DEG * k) + Math.abs(Math.log(zoom / this.zoom)) * k * 0.6;
      const kick = clamp((moved / Math.max(dt, 0.008) - SPEED_FLOOR) / (SPEED_FULL - SPEED_FLOOR), 0, 1);
      this.energy = Math.max(this.energy * Math.exp(-dt / SETTLE_S), kick);
      this.phase += dt * SWAY_HZ * TAU_RAD * (0.7 + 0.3 * this.energy);
    } else this.energy = 0;
    if (this.energy < SWAY_MIN) this.energy = 0;
    this.t = now;
    this.lon = lon;
    this.lat = lat;
    this.zoom = zoom;
    if (!this.energy) return (this.warp = null);
    return (this.warp = swayWarp(w, h, swayAmp(w, h) * this.energy, this.phase));
  }
}

// ---- the vessel --------------------------------------------------------------------------------------------------

/** A size for everything laid round the world: 1 at a 645 px frame, never below 0.5 or above 1.25. */
export const unitOf = (w: number, h: number) => clamp(Math.min(w, h) / 645, 0.5, 1.25);

/** The bowl's rim in pixels: a lacquer band outside a cream ledge. */
export function rimOf(w: number, h: number): { ledge: number; lacquer: number; total: number } {
  // The rim keeps a readable thickness on a small frame, where the things laid round the world shrink further.
  const u = Math.max(unitOf(w, h), 0.7);
  const ledge = Math.round(6 * u), lacquer = Math.round(13 * u);
  return { ledge, lacquer, total: ledge + lacquer };
}

/** Globe view's bowl: the broth's disc. It grows with the globe so the globe always floats in it. */
export function bowlOf(w: number, h: number, R: number): { cx: number; cy: number; r: number } {
  const rim = rimOf(w, h).total;
  return { cx: w / 2, cy: h / 2, r: Math.max(Math.min(w, h) / 2 - rim - 6, R * 1.17 + 20) };
}

/** Map view's pot: the broth's rounded rectangle, with room round it on a wide screen for the handles and a few things. */
export function potOf(w: number, h: number): { x0: number; y0: number; x1: number; y1: number; r: number; wide: boolean } {
  const wide = w >= 700;
  const rim = rimOf(w, h).total;
  const mx = wide ? Math.round(clamp(w * 0.1, 78, 150)) : rim + 5;
  const my = wide ? Math.max(22, rim + 6) : rim + 4;
  const mb = wide ? Math.round(clamp(h * 0.1, 46, 84)) : rim + 4;
  const x0 = mx, y0 = my, x1 = w - mx, y1 = h - mb;
  return { x0, y0, x1, y1, r: clamp(Math.min(x1 - x0, y1 - y0) * 0.1, 16, 48), wide };
}

/** What is laid round the world is drawn this much larger than the rim and steam, so it reads at a glance. */
export const pieceUnit = (w: number, h: number) => unitOf(w, h) * 1.3;

/** The Key button's corner and the zoom buttons' corner, which nothing laid round the world comes near. */
export const KEY_BOX = { x0: 0, y0: 0, x1: 84, y1: 56 };
export const zoomBox = (w: number, h: number) => ({ x0: w - 64, y0: h - 104, x1: w, y1: h });

// ---- what is laid round the world --------------------------------------------------------------------------------

export type Kind = "egg" | "scallion" | "sprig" | "nori" | "spoon" | "sticks" | "oil";
type Circle = [number, number, number];

/**
 * Each piece's footprint as circles in its own units (x along the piece, scaled by the frame's unit): everything it
 * ever draws lies inside them, so the placement checks below keep the whole piece clear of the world.
 */
export const FOOTPRINT: Record<Kind, Circle[]> = {
  egg: [[0, 0, 28]],
  scallion: [[-10, -4, 12], [9, -7, 12], [2, 10, 12]],
  sprig: [[-17, 0, 13], [0, 0, 13], [17, 0, 13]],
  nori: [[-13, 0, 19], [13, 0, 19]],
  spoon: [[0, 0, 27], [34, 0, 10], [50, 0, 8], [66, 0, 8], [82, 0, 8]],
  sticks: [-54, -36, -18, 0, 18, 36, 54].map((x): Circle => [x, 0, 8]),
  oil: [[0, 0, 16]],
};

export interface Placed {
  kind: Kind;
  x: number;
  y: number;
  /** Radians. */
  rot: number;
  /** The footprint in frame pixels. */
  circles: Circle[];
}

interface Candidate {
  kind: Kind;
  /** The screen angle (degrees clockwise from the right) the search starts from, then widens either side of. */
  from: number;
  /** How far across the free stretch to put it, 0 (snug to the world) to 1 (against the rim). */
  f: number;
  /** Extra turn in degrees from the radial direction. */
  turn: number;
  /** Turn the piece to lie along the radial direction (the spoon's handle points out). */
  radial?: boolean;
  /** Allowed to reach past the bowl's rim onto the table (the spoon's handle). */
  out?: boolean;
}

/** The globe view's pieces, in the order they claim room. A piece that finds none is left out. */
export const DISC_PIECES: readonly Candidate[] = [
  { kind: "spoon", from: 150, f: 0.3, turn: 0, radial: true, out: true },
  { kind: "egg", from: -38, f: 0.5, turn: 20 },
  { kind: "nori", from: -104, f: 0.55, turn: 90, radial: true },
  { kind: "egg", from: 214, f: 0.45, turn: -30 },
  { kind: "scallion", from: 28, f: 0.45, turn: 10 },
  { kind: "sprig", from: 84, f: 0.5, turn: 70, radial: true },
  { kind: "scallion", from: -150, f: 0.5, turn: 50 },
  { kind: "scallion", from: -62, f: 0.4, turn: 0 },
  { kind: "sprig", from: -8, f: 0.5, turn: 20, radial: true },
  { kind: "oil", from: 8, f: 0.7, turn: 0 },
  { kind: "oil", from: 62, f: 0.2, turn: 25 },
  { kind: "oil", from: 120, f: 0.8, turn: -15 },
  { kind: "oil", from: 190, f: 0.3, turn: 10 },
  { kind: "oil", from: 250, f: 0.7, turn: 40 },
  { kind: "oil", from: 305, f: 0.25, turn: -20 },
];

const sceneryOk = (c: Circle, w: number, h: number) => c[0] - c[2] >= 3 && c[0] + c[2] <= w - 3 && c[1] - c[2] >= 3 && c[1] + c[2] <= h - 3;

const boxHit = (c: Circle, b: { x0: number; y0: number; x1: number; y1: number }, pad: number) => {
  const nx = clamp(c[0], b.x0, b.x1), ny = clamp(c[1], b.y0, b.y1);
  return Math.hypot(c[0] - nx, c[1] - ny) < c[2] + pad;
};

function circlesOf(kind: Kind, x: number, y: number, rot: number, u: number): Circle[] {
  const co = Math.cos(rot), si = Math.sin(rot);
  return FOOTPRINT[kind].map(([a, b, r]): Circle => [x + (a * co - b * si) * u, y + (a * si + b * co) * u, r * u]);
}

/** Angles to try, nearest to `from` first, alternating either side, every 15 degrees all the way round. */
const sweep = (from: number) => Array.from({ length: 24 }, (_, i) => from + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 15);

/**
 * The pieces laid in a bowl of radius `Rb` round a globe of radius `R`, centred (cx, cy). Each takes the first angle
 * (nearest its own) where every circle of its footprint is GAP clear of the globe, inside the bowl (the spoon's handle
 * may reach the table), inside the frame, off the Key and zoom corners and clear of the pieces before it. The same
 * frame always gets the same pieces.
 */
export function placeDisc(w: number, h: number, cx: number, cy: number, R: number, Rb: number): Placed[] {
  const u = pieceUnit(w, h);
  const zb = zoomBox(w, h);
  const out: Placed[] = [];
  for (const c of DISC_PIECES) {
    let found: Placed | null = null;
    for (const a of sweep(c.from)) {
      const dir = a * DEG;
      const rot = c.radial ? dir + c.turn * DEG : (c.turn + a) * DEG;
      // The distances along this angle where the whole footprint fits, found by walking out from the globe.
      const ok: number[] = [];
      for (let d = R; d <= Rb + 90 * u; d += 3) {
        const x = cx + Math.cos(dir) * d, y = cy + Math.sin(dir) * d;
        const circles = circlesOf(c.kind, x, y, rot, u);
        let good = true;
        for (const [i, k] of circles.entries()) {
          const dist = Math.hypot(k[0] - cx, k[1] - cy);
          if (dist - k[2] < R + GAP || !sceneryOk(k, w, h) || boxHit(k, KEY_BOX, 8) || boxHit(k, zb, 8)) good = false;
          // In the bowl: the spoon's head, and every circle of a piece that stays in it.
          else if ((!c.out || i === 0) && dist + k[2] > Rb - 5) good = false;
          else if (out.some((o) => o.circles.some((q) => Math.hypot(q[0] - k[0], q[1] - k[1]) < q[2] + k[2] + 4))) good = false;
          if (!good) break;
        }
        if (good) ok.push(d);
      }
      if (!ok.length) continue;
      const d = ok[Math.round(c.f * (ok.length - 1))]!;
      const x = cx + Math.cos(dir) * d, y = cy + Math.sin(dir) * d;
      found = { kind: c.kind, x, y, rot, circles: circlesOf(c.kind, x, y, rot, u) };
      break;
    }
    if (found) out.push(found);
  }
  return out;
}

interface Slot {
  kind: Kind;
  side: "L" | "R" | "B";
  /** Along the pot's side, 0 to 1. */
  t: number;
  /** Degrees. */
  rot: number;
}

/** Map view's pieces, in the margins round the pot, on a wide screen only. */
export const POT_PIECES: readonly Slot[] = [
  { kind: "spoon", side: "B", t: 0.1, rot: 0 },
  { kind: "spoon", side: "L", t: 0.66, rot: 90 },
  { kind: "sticks", side: "B", t: 0.62, rot: -2 },
  { kind: "egg", side: "L", t: 0.14, rot: 15 },
  { kind: "scallion", side: "R", t: 0.12, rot: 0 },
  { kind: "sprig", side: "L", t: 0.88, rot: 100 },
  { kind: "nori", side: "R", t: 0.86, rot: 80 },
  { kind: "egg", side: "B", t: 0.4, rot: -20 },
  { kind: "scallion", side: "L", t: 0.3, rot: 10 },
  { kind: "sprig", side: "R", t: 0.3, rot: 70 },
];

/** The ring round the pot (its ledge and lacquer) as a box, and the handles' circles, for what must stay clear of them. */
export function potObstacles(w: number, h: number): { box: { x0: number; y0: number; x1: number; y1: number }; handles: Circle[] } {
  const p = potOf(w, h);
  const rim = rimOf(w, h).total;
  const box = { x0: p.x0 - rim, y0: p.y0 - rim, x1: p.x1 + rim, y1: p.y1 + rim };
  const handles: Circle[] = [];
  if (p.wide) for (const s of [-1, 1] as const) for (const dy of [-22, 0, 22]) handles.push([s < 0 ? box.x0 - 18 : box.x1 + 18, (p.y0 + p.y1) / 2 + dy, 21]);
  return { box, handles };
}

/** The pieces for Map view: slots along the pot's sides, each walked outward from the rim to the first place it fits. */
export function placeRect(w: number, h: number): Placed[] {
  const p = potOf(w, h);
  if (!p.wide) return [];
  const u = pieceUnit(w, h);
  const zb = zoomBox(w, h);
  const { box, handles } = potObstacles(w, h);
  const out: Placed[] = [];
  const hold: Circle[] = [...handles];
  for (const s of POT_PIECES) {
    const rot = s.rot * DEG;
    const dir = s.side === "L" ? [-1, 0] : s.side === "R" ? [1, 0] : [0, 1];
    for (let d = 0; d < 170; d += 3) {
      const [ex, ey] = s.side === "B" ? [p.x0 + s.t * (p.x1 - p.x0), box.y1] : [s.side === "L" ? box.x0 : box.x1, p.y0 + s.t * (p.y1 - p.y0)];
      const x = ex + dir[0]! * d, y = ey + dir[1]! * d;
      const circles = circlesOf(s.kind, x, y, rot, u);
      const good = circles.every((k) => sceneryOk(k, w, h) && !boxHit(k, KEY_BOX, 8) && !boxHit(k, zb, 8) && !boxHit(k, box, 5) && !hold.some((q) => Math.hypot(q[0] - k[0], q[1] - k[1]) < q[2] + k[2] + 3));
      if (!good) continue;
      out.push({ kind: s.kind, x, y, rot, circles });
      hold.push(...circles);
      break;
    }
  }
  return out;
}

/** A strand of noodle lying round the globe in the bowl: its radius from the globe's centre sways, and it curls. */
export interface Noodle {
  /** Where its curve starts and how far it runs, in radians round the bowl. */
  a0: number;
  span: number;
  /** The radius's centre line, its sway's size and number of waves round the whole bowl, and the sway's phase. */
  r0: number;
  amp: number;
  n: number;
  phi: number;
  /** How far its sideways swing carries it round the bowl, in pixels, and that swing's phase. It loops when it passes pitch / 2 pi. */
  tang: number;
  phi2: number;
  /** Its thickness in pixels. */
  width: number;
}

/** Each strand: where it starts and runs (degrees), how far across the free ring (0 to 1), the length of one wave along the rim, and its sway, sideways swing and thickness in units. */
const NOODLES: readonly { a0: number; span: number; f: number; pitch: number; amp: number; tang: number; wid: number }[] = [
  { a0: 188, span: 100, f: 0.3, pitch: 52, amp: 9, tang: 12, wid: 7 },
  { a0: 14, span: 86, f: 0.68, pitch: 70, amp: 5, tang: 5, wid: 6.5 },
  { a0: 258, span: 96, f: 0.45, pitch: 46, amp: 8, tang: 13, wid: 7 },
  { a0: 108, span: 66, f: 0.25, pitch: 64, amp: 6, tang: 6, wid: 6 },
  { a0: 318, span: 62, f: 0.7, pitch: 44, amp: 7, tang: 11, wid: 6.5 },
  { a0: 146, span: 54, f: 0.8, pitch: 58, amp: 4, tang: 5, wid: 6 },
];

/** The radii a noodle may use: from just outside the globe's gap to just inside the bowl's rim. */
export function noodleBand(R: number, Rb: number): [number, number] {
  return [R + GAP, Rb - 6];
}

/**
 * The noodles for a bowl: each keeps its whole thickness, with its sway, between the globe's gap and the rim, or is left
 * out when the free ring is too narrow. Its sideways swing moves it round the bowl and never in or out, so the radius
 * bound holds however much it curls.
 */
export function placeNoodles(w: number, h: number, R: number, Rb: number): Noodle[] {
  const u = pieceUnit(w, h);
  const [lo, hi] = noodleBand(R, Rb);
  const out: Noodle[] = [];
  NOODLES.forEach((s, i) => {
    const amp = s.amp * u, width = s.wid * u;
    const room = hi - lo - 2 * amp - width;
    if (room < 2) return;
    const r0 = lo + amp + width / 2 + s.f * room;
    out.push({ a0: s.a0 * DEG, span: s.span * DEG, r0, amp, n: (TAU_RAD * r0) / (s.pitch * u), phi: i * 1.7, tang: s.tang * u, phi2: i * 2.3 + 0.5, width });
  });
  return out;
}

/** The inner and outer radius a noodle's body reaches, thickness included, for the clearance checks. */
export const noodleReach = (n: Noodle): [number, number] => [n.r0 - n.amp - n.width / 2, n.r0 + n.amp + n.width / 2];

/** A point on a noodle at fraction `s` (0 to 1) of its run, round a centre. */
export function noodlePoint(n: Noodle, s: number, cx: number, cy: number): [number, number] {
  const th = n.a0 + s * n.span;
  const ph = th * n.n;
  const r = n.r0 + n.amp * Math.sin(ph + n.phi);
  // The sideways swing turns the point round the bowl by an angle; past pitch / 2 pi it loops back on itself.
  const tt = th + (n.tang / n.r0) * Math.cos(ph + n.phi2);
  return [cx + r * Math.cos(tt), cy + r * Math.sin(tt)];
}

// ---- colours ---------------------------------------------------------------------------------------------------

const BROTH_NEAR = "#c8782b";
const BROTH_MID = "#b4601f";
const BROTH_EDGE = "#8a4214";
const LACQUER = "#7d2418";
const LACQUER_DARK = "#561409";
const CREAM = "#f8f0dc";
const NOODLE = "#f6e0a0";
const NOODLE_EDGE = "#c99a3e";
const TOFU = "#fbf3df";

// ---- drawing the pieces ----------------------------------------------------------------------------------------

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU_RAD);
}

function drawEgg(g: CanvasRenderingContext2D) {
  g.fillStyle = "rgba(50,16,0,0.26)";
  ellipse(g, 2.5, 3.5, 25, 19);
  g.fill();
  const white = g.createRadialGradient(-6, -6, 3, 0, 0, 26);
  white.addColorStop(0, "#fffaf0");
  white.addColorStop(0.7, "#f6ecd2");
  white.addColorStop(1, "#e7c88e");
  g.fillStyle = white;
  g.strokeStyle = "#cfa768";
  g.lineWidth = 1;
  ellipse(g, 0, 0, 25, 19);
  g.fill();
  g.stroke();
  const yolk = g.createRadialGradient(-2, 0, 1, 1, 2, 12);
  yolk.addColorStop(0, "#ffd45a");
  yolk.addColorStop(1, "#ee9412");
  g.fillStyle = yolk;
  ellipse(g, 1, 2, 11, 9.5);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)";
  ellipse(g, -3, -1.5, 3.6, 2.2, -0.5);
  g.fill();
}

function drawScallion(g: CanvasRenderingContext2D) {
  for (const [x, y, r] of [[-10, -4, 0.3], [9, -7, -0.4], [2, 10, 0.9]] as const) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.fillStyle = "rgba(40,20,0,0.22)";
    ellipse(g, 1.2, 1.8, 9.5, 7);
    g.fill();
    g.fillStyle = "#79b153";
    g.strokeStyle = "#4b7d33";
    g.lineWidth = 1;
    ellipse(g, 0, 0, 9.5, 7);
    g.fill();
    g.stroke();
    g.fillStyle = "#e9f4c6";
    ellipse(g, 0, 0, 5.6, 3.8);
    g.fill();
    g.strokeStyle = "#a3cb7a";
    ellipse(g, 0, 0, 3.2, 2);
    g.stroke();
    g.restore();
  }
}

function drawSprig(g: CanvasRenderingContext2D) {
  g.strokeStyle = "#3f7a37";
  g.lineWidth = 1.7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-24, 3);
  g.quadraticCurveTo(0, -4, 24, 2);
  g.stroke();
  // Three leaves of our own: a broad middle lobe between two small side lobes, each with a pale vein.
  for (const [x, y, r, s] of [[-14, 0, -1.1, 1], [2, -1, 1.15, 1], [16, 1.5, -0.95, 1.1]] as const) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.scale(s, s);
    g.fillStyle = "rgba(30,50,0,0.2)";
    ellipse(g, 9.6, 1.4, 8, 4.4);
    g.fill();
    g.fillStyle = "#4f9a3c";
    ellipse(g, 8, 0, 8, 4.4);
    g.fill();
    ellipse(g, 6.5, -4.6, 5.6, 3.2, -0.7);
    g.fill();
    ellipse(g, 6.5, 4.6, 5.6, 3.2, 0.7);
    g.fill();
    g.strokeStyle = "rgba(220,245,180,0.7)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(14, 0);
    g.moveTo(5, 0);
    g.lineTo(9, -4);
    g.moveTo(5, 0);
    g.lineTo(9, 4);
    g.stroke();
    g.restore();
  }
}

function drawNori(g: CanvasRenderingContext2D) {
  g.fillStyle = "rgba(30,16,0,0.3)";
  g.beginPath();
  g.roundRect(-21, -12, 46, 30, 3);
  g.fill();
  const sheet = g.createLinearGradient(-23, -15, 23, 15);
  sheet.addColorStop(0, "#34462f");
  sheet.addColorStop(1, "#1d2a1d");
  g.fillStyle = sheet;
  g.beginPath();
  g.roundRect(-23, -15, 46, 30, 3);
  g.fill();
  // Fine grain across the sheet, and a pale curl at one corner.
  g.strokeStyle = "rgba(150,185,140,0.22)";
  g.lineWidth = 0.7;
  g.beginPath();
  for (let y = -12; y <= 12; y += 4) {
    g.moveTo(-21, y + (y % 8 ? 0.6 : -0.4));
    g.lineTo(21, y + (y % 8 ? -0.5 : 0.7));
  }
  g.stroke();
  g.fillStyle = "rgba(190,220,170,0.2)";
  g.beginPath();
  g.moveTo(23, -15);
  g.lineTo(23, -5);
  g.lineTo(13, -15);
  g.closePath();
  g.fill();
}

function drawSpoon(g: CanvasRenderingContext2D) {
  // The handle first, tapering from the neck to a rounded end, then the head over it.
  g.fillStyle = "rgba(40,16,0,0.25)";
  g.beginPath();
  g.moveTo(16, -2);
  g.lineTo(84, -3);
  g.arc(84, 1.5, 4.5, -Math.PI / 2, Math.PI / 2);
  g.lineTo(16, 8);
  g.closePath();
  g.fill();
  g.fillStyle = CREAM;
  g.strokeStyle = "#cbb98f";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(16, -4);
  g.lineTo(84, -4.5);
  g.arc(84, 0, 4.5, -Math.PI / 2, Math.PI / 2);
  g.lineTo(16, 4);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = LACQUER;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(60, 0);
  g.lineTo(78, 0);
  g.stroke();
  g.fillStyle = "rgba(40,16,0,0.25)";
  ellipse(g, 2, 3, 25, 17);
  g.fill();
  g.fillStyle = CREAM;
  g.strokeStyle = "#cbb98f";
  ellipse(g, 0, 0, 25, 17);
  g.fill();
  g.stroke();
  const inner = g.createRadialGradient(-5, -4, 1, 0, 0, 19);
  inner.addColorStop(0, "#dc9a40");
  inner.addColorStop(1, "#b2601f");
  g.fillStyle = inner;
  ellipse(g, 1, 1, 20, 12.5);
  g.fill();
  g.fillStyle = "rgba(255,235,190,0.5)";
  ellipse(g, -7, -3.5, 6, 2.2, -0.3);
  g.fill();
}

function drawSticks(g: CanvasRenderingContext2D) {
  g.lineCap = "round";
  for (const [y0, y1, col, lit] of [[-4.5, -6, "#b98446", "#d9a868"], [5, 4, "#9b6a33", "#bd8d52"]] as const) {
    g.strokeStyle = "rgba(40,16,0,0.25)";
    g.lineWidth = 4.4;
    g.beginPath();
    g.moveTo(-60, y0 + 1.6);
    g.lineTo(60, y1 + 1.6);
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-60, y0);
    g.lineTo(60, y1);
    g.stroke();
    g.strokeStyle = lit;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-58, y0 - 1);
    g.lineTo(58, y1 - 1);
    g.stroke();
  }
}

/** A lens of broth fat: a pale ring with a bright arc, and nothing in it, so it never reads as a mark. */
function drawOil(g: CanvasRenderingContext2D) {
  g.strokeStyle = "rgba(255,226,160,0.42)";
  g.lineWidth = 1.4;
  ellipse(g, 0, 0, 14, 8.5);
  g.stroke();
  g.strokeStyle = "rgba(255,244,214,0.6)";
  g.lineWidth = 1.8;
  g.lineCap = "round";
  g.beginPath();
  g.ellipse(0, 0, 11, 6, 0, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
}

const DRAWERS: Record<Kind, (g: CanvasRenderingContext2D) => void> = { egg: drawEgg, scallion: drawScallion, sprig: drawSprig, nori: drawNori, spoon: drawSpoon, sticks: drawSticks, oil: drawOil };

function drawPieces(g: CanvasRenderingContext2D, list: readonly Placed[], u: number, warp: Warp | null) {
  for (const p of list) {
    const [x, y] = warp ? warp.fwd(p.x, p.y) : [p.x, p.y];
    g.save();
    g.translate(x, y);
    g.rotate(p.rot);
    g.scale(u, u);
    DRAWERS[p.kind](g);
    g.restore();
  }
}

// ---- drawing the vessel and the broth ------------------------------------------------------------------------

/** Where the table's shadow, the lacquer and the ledge go for a bowl or a pot; both draw the same layers. */
function drawVessel(g: CanvasRenderingContext2D, rim: ReturnType<typeof rimOf>, shape: (grow: number) => Path2D, cx: number, cy: number, reach: number) {
  // The vessel's soft shadow on the table, down and to the right of it.
  g.save();
  const sh = g.createRadialGradient(cx + 6, cy + 10, reach * 0.9, cx + 6, cy + 10, reach * 1.12);
  sh.addColorStop(0, "rgba(60,30,10,0.34)");
  sh.addColorStop(1, "rgba(60,30,10,0)");
  g.fillStyle = sh;
  g.fillRect(cx - reach * 1.2, cy - reach * 1.2, reach * 2.4, reach * 2.4);
  g.restore();
  const lac = g.createLinearGradient(cx - reach, cy - reach, cx + reach, cy + reach);
  lac.addColorStop(0, "#9a3020");
  lac.addColorStop(1, LACQUER_DARK);
  g.fillStyle = lac;
  g.fill(shape(rim.total));
  g.strokeStyle = "rgba(255,226,170,0.5)";
  g.lineWidth = 1;
  g.stroke(shape(rim.total - 0.5));
  g.strokeStyle = "rgba(230,170,90,0.7)";
  g.lineWidth = Math.max(1, rim.lacquer * 0.14);
  g.stroke(shape(rim.ledge + rim.lacquer * 0.28));
  g.fillStyle = CREAM;
  g.fill(shape(rim.ledge));
}

/** A ring of small scallops on the ledge, in a faint warm brown, as a glazed band. */
function ledgeBand(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, ledge: number) {
  const n = Math.max(24, Math.round((r * TAU_RAD) / 11));
  g.strokeStyle = "rgba(180,130,70,0.55)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU_RAD, b = ((i + 1) / n) * TAU_RAD;
    g.moveTo(cx + (r + ledge * 0.5) * Math.cos(a), cy + (r + ledge * 0.5) * Math.sin(a));
    g.arc(cx, cy, r + ledge * 0.5, a, b);
  }
  g.stroke();
}

function drawBowl(f: SurfaceFrame, b: { cx: number; cy: number; r: number }) {
  const { ctx: g, w, h } = f;
  const rim = rimOf(w, h);
  const circle = (grow: number) => {
    const p = new Path2D();
    p.arc(b.cx, b.cy, b.r + grow, 0, TAU_RAD);
    return p;
  };
  drawVessel(g, rim, circle, b.cx, b.cy, b.r + rim.total);
  ledgeBand(g, b.cx, b.cy, b.r, 0 + rim.ledge * 0.5);
  // The broth, darker toward the wall, with a wide soft light from the upper left.
  g.save();
  g.clip(circle(0));
  const broth = g.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r);
  broth.addColorStop(0, BROTH_NEAR);
  broth.addColorStop(0.7, BROTH_MID);
  broth.addColorStop(1, BROTH_EDGE);
  g.fillStyle = broth;
  g.fillRect(b.cx - b.r, b.cy - b.r, b.r * 2, b.r * 2);
  const wall = g.createRadialGradient(b.cx, b.cy, b.r * 0.86, b.cx, b.cy, b.r);
  wall.addColorStop(0, "rgba(40,10,0,0)");
  wall.addColorStop(1, "rgba(40,10,0,0.5)");
  g.fillStyle = wall;
  g.fillRect(b.cx - b.r, b.cy - b.r, b.r * 2, b.r * 2);
  g.translate(b.cx - b.r * 0.35, b.cy - b.r * 0.45);
  g.scale(1, 0.55);
  const sheen = g.createRadialGradient(0, 0, 0, 0, 0, b.r * 0.6);
  sheen.addColorStop(0, "rgba(255,226,160,0.2)");
  sheen.addColorStop(1, "rgba(255,226,160,0)");
  g.fillStyle = sheen;
  g.fillRect(-b.r, -b.r, b.r * 2, b.r * 2);
  g.restore();
}

function drawPot(f: SurfaceFrame, p: ReturnType<typeof potOf>) {
  const { ctx: g, w, h } = f;
  const rim = rimOf(w, h);
  const rect = (grow: number) => {
    const path = new Path2D();
    path.roundRect(p.x0 - grow, p.y0 - grow, p.x1 - p.x0 + grow * 2, p.y1 - p.y0 + grow * 2, p.r + grow);
    return path;
  };
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  const reach = Math.max(p.x1 - p.x0, p.y1 - p.y0) / 2 + rim.total;
  if (p.wide) {
    // Two loop handles on the pot's sides, in the same lacquer, drawn first so the rim lies over their roots.
    g.lineCap = "round";
    for (const s of [-1, 1] as const) {
      const x = s < 0 ? p.x0 - rim.total : p.x1 + rim.total;
      const y = cy;
      const path = new Path2D();
      path.moveTo(x - s * 3, y - 26);
      path.bezierCurveTo(x + s * 40, y - 28, x + s * 40, y + 28, x - s * 3, y + 26);
      g.strokeStyle = "rgba(60,30,10,0.28)";
      g.lineWidth = 11;
      g.save();
      g.translate(3, 4);
      g.stroke(path);
      g.restore();
      g.strokeStyle = LACQUER;
      g.lineWidth = 10;
      g.stroke(path);
      g.strokeStyle = "rgba(255,200,140,0.35)";
      g.lineWidth = 1.6;
      g.save();
      g.translate(0, -2);
      g.stroke(path);
      g.restore();
    }
  }
  drawVessel(g, rim, rect, cx, cy, reach);
}

// ---- the world in the broth ------------------------------------------------------------------------------------

/** Parallels at world-fixed latitudes, each swaying in longitude, spaced about 9 px apart on screen: a noodle's strands. */
const STEPS = [30, 20, 10, 5, 2.5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.025];
function strandLines(f: SurfaceFrame): { type: "MultiLineString"; coordinates: [number, number][][] } {
  const k = f.proj.scale();
  const want = 10 / (k * DEG);
  const step = STEPS.slice().reverse().find((s) => s >= want * 0.9) ?? STEPS[0]!;
  const globe = f.mode === "3d";
  const half = Math.min(globe ? 92 : 180, (Math.max(f.w, f.h) / (k * DEG)) * 0.8 + 6);
  const vh = Math.min(90, (Math.max(f.w, f.h) / (k * DEG)) * 0.8 + 6);
  const lonStep = Math.max(step * 0.9, 0.002);
  const i0 = Math.ceil((f.lat - vh) / step), i1 = Math.floor((f.lat + vh) / step);
  const lines: [number, number][][] = [];
  const wave = step * 7;
  for (let i = i0; i <= i1; i++) {
    const lat0 = i * step;
    if (Math.abs(lat0) > 89) continue;
    const pts: [number, number][] = [];
    const j0 = Math.floor((f.lon - half) / lonStep), j1 = Math.ceil((f.lon + half) / lonStep);
    for (let j = j0; j <= j1; j++) {
      const lon = j * lonStep;
      pts.push([lon, lat0 + step * 0.28 * Math.sin((TAU_RAD * lon) / wave + i * 1.3)]);
    }
    lines.push(pts);
  }
  return { type: "MultiLineString", coordinates: lines };
}

/** The land, ice, lakes and coasts as paths for this frame, through the frame's view (the sway included). */
function worldPaths(f: SurfaceFrame) {
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  return { path, land: path(f.map.land), coast: path(f.map.coast), lakes: path(f.map.lakes) };
}

/**
 * Land as noodle on the globe (strands across it) or tofu on the map (a soft lit edge), cut by the coastline alone, with
 * a pale froth along every shore.
 */
function paintLand(f: SurfaceFrame, g: CanvasRenderingContext2D, fast: boolean) {
  const { theme: t } = f;
  const globe = f.mode === "3d";
  const { path, land, coast, lakes } = worldPaths(f);
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = t.graticule;
  g.lineWidth = 0.7;
  g.stroke(path({ type: "MultiLineString", coordinates: graticule() }));
  // A pale froth along every shore. While the broth sways, one stroke does, since wide strokes are the dear part.
  g.strokeStyle = "rgba(255,236,190,0.26)";
  g.lineWidth = fast ? 6 : 9;
  g.stroke(coast);
  if (!fast) {
    g.strokeStyle = "rgba(255,236,190,0.28)";
    g.lineWidth = 4.5;
    g.stroke(coast);
  }
  g.fillStyle = globe ? NOODLE : TOFU;
  g.fill(land);
  g.save();
  g.clip(land);
  if (globe) {
    const strands = path(strandLines(f));
    g.strokeStyle = "rgba(190,140,50,0.5)";
    g.lineWidth = 1.1;
    g.stroke(strands);
    if (!fast) {
      g.strokeStyle = "rgba(255,250,224,0.55)";
      g.lineWidth = 0.5;
      g.save();
      g.translate(-0.6, -0.8);
      g.stroke(strands);
      g.restore();
    }
  } else {
    // Tofu: a lit rim just inside the coast and a faint warm shade across it, so each shape reads as a soft block.
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 5;
    g.stroke(coast);
    if (!fast) {
      g.strokeStyle = "rgba(210,170,100,0.16)";
      g.lineWidth = 14;
      g.stroke(coast);
      // A faint grain through the block, the same world-fixed lines as the noodle's, so wide stretches of land are not blank.
      g.strokeStyle = "rgba(200,160,95,0.16)";
      g.lineWidth = 0.9;
      g.stroke(path(strandLines(f)));
    }
  }
  g.restore();
  if (f.map.ice) {
    g.fillStyle = t.ice;
    g.fill(path(f.map.ice));
  }
  g.fillStyle = t.lake;
  g.fill(lakes);
  if (f.zoom >= 2) {
    g.strokeStyle = t.river;
    g.lineWidth = 0.8;
    g.stroke(path(f.map.rivers));
  }
  g.strokeStyle = t.coast;
  g.lineWidth = t.coastWidth;
  g.stroke(coast);
  g.lineWidth = t.coastWidth * 0.7;
  g.stroke(lakes);
}

/** The graticule's lines every 20 degrees, as plain coordinates so they go through the same view as the land. */
function graticule(): [number, number][][] {
  const out: [number, number][][] = [];
  for (let lat = -80; lat <= 80; lat += 20) {
    const l: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 4) l.push([lon, lat]);
    out.push(l);
  }
  for (let lon = -180; lon < 180; lon += 20) {
    const l: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 4) l.push([lon, lat]);
    out.push(l);
  }
  return out;
}

/** The ripples and the soft shadow the floating globe makes in the broth, drawn under it. */
const RIPPLES: readonly { dr: number; a0: number; span: number }[] = [
  { dr: 5, a0: 200, span: 120 },
  { dr: 5, a0: 350, span: 70 },
  { dr: 11, a0: 20, span: 100 },
  { dr: 11, a0: 160, span: 50 },
  { dr: 18, a0: 100, span: 75 },
  { dr: 18, a0: 270, span: 90 },
];

function drawRipples(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, Rb: number, warp: Warp | null) {
  const sh = g.createRadialGradient(cx + R * 0.04, cy + R * 0.06, R * 0.96, cx + R * 0.04, cy + R * 0.06, R * 1.1);
  sh.addColorStop(0, "rgba(50,14,0,0.45)");
  sh.addColorStop(1, "rgba(50,14,0,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.arc(cx + R * 0.04, cy + R * 0.06, R * 1.1, 0, TAU_RAD);
  g.fill();
  g.lineCap = "round";
  g.lineWidth = 1.8;
  for (const r of RIPPLES) {
    const rr = R + r.dr;
    if (rr + 3 > Rb - 6) continue;
    g.strokeStyle = r.dr < 10 ? "rgba(255,232,176,0.55)" : "rgba(255,232,176,0.32)";
    g.beginPath();
    const n = Math.max(8, Math.round((r.span * DEG * rr) / 5));
    for (let i = 0; i <= n; i++) {
      const a = (r.a0 + (r.span * i) / n) * DEG;
      const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
      const [px, py] = warp ? warp.fwd(x, y) : [x, y];
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  }
}

function drawNoodles(g: CanvasRenderingContext2D, list: readonly Noodle[], cx: number, cy: number, warp: Warp | null) {
  g.lineCap = "round";
  g.lineJoin = "round";
  const paths = list.map((n) => {
    const p = new Path2D();
    const steps = Math.max(40, Math.round((n.span * n.r0) / 3));
    for (let i = 0; i <= steps; i++) {
      const [x, y] = noodlePoint(n, i / steps, cx, cy);
      const [px, py] = warp ? warp.fwd(x, y) : [x, y];
      if (i) p.lineTo(px, py);
      else p.moveTo(px, py);
    }
    return p;
  });
  g.save();
  g.translate(2, 3);
  g.strokeStyle = "rgba(40,12,0,0.3)";
  list.forEach((n, i) => {
    g.lineWidth = n.width + 1;
    g.stroke(paths[i]!);
  });
  g.restore();
  list.forEach((n, i) => {
    g.strokeStyle = NOODLE_EDGE;
    g.lineWidth = n.width + 1.6;
    g.stroke(paths[i]!);
    g.strokeStyle = NOODLE;
    g.lineWidth = n.width;
    g.stroke(paths[i]!);
    g.strokeStyle = "rgba(255,250,222,0.7)";
    g.lineWidth = Math.max(1, n.width * 0.28);
    g.save();
    g.translate(-0.5, -0.8);
    g.stroke(paths[i]!);
    g.restore();
  });
}

/** The globe: the sea as a deeper, clearer broth, the noodle land, a froth ring and a soft highlight. */
function paintGlobe(f: SurfaceFrame, g: CanvasRenderingContext2D, fast: boolean) {
  const { proj } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const sphere = new Path2D();
  geoPath(f.view as never, pathContext(sphere))({ type: "Sphere" } as never);
  g.save();
  g.clip(sphere);
  const sea = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.02);
  sea.addColorStop(0, "#e2a444");
  sea.addColorStop(0.6, f.theme.ocean);
  sea.addColorStop(1, "#8f5019");
  g.fillStyle = sea;
  g.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
  paintLand(f, g, fast);
  const limb = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
  limb.addColorStop(0, "rgba(60,20,0,0)");
  limb.addColorStop(1, "rgba(60,20,0,0.42)");
  g.fillStyle = limb;
  g.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
  g.translate(cx - R * 0.38, cy - R * 0.5);
  g.rotate(-0.5);
  g.scale(1, 0.5);
  const spec = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
  spec.addColorStop(0, "rgba(255,246,220,0.3)");
  spec.addColorStop(1, "rgba(255,246,220,0)");
  g.fillStyle = spec;
  g.fillRect(-R * 0.6, -R * 0.6, R * 1.2, R * 1.2);
  g.restore();
  g.strokeStyle = "rgba(255,236,190,0.85)";
  g.lineWidth = 2;
  g.stroke(sphere);
  g.strokeStyle = "rgba(90,40,10,0.7)";
  g.lineWidth = 0.8;
  g.stroke(sphere);
}

/** The broth in the pot with the map on it, clipped to the pot, with its wall's shade round the edge. */
function paintBroth(f: SurfaceFrame, g: CanvasRenderingContext2D, plate: Path2D, p: ReturnType<typeof potOf>, fast: boolean) {
  g.save();
  g.clip(plate);
  const sea = g.createLinearGradient(0, p.y0, 0, p.y1);
  sea.addColorStop(0, "#d28a30");
  sea.addColorStop(1, f.theme.ocean);
  g.fillStyle = sea;
  g.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
  paintLand(f, g, fast);
  const sheen = g.createLinearGradient(p.x0, p.y0, p.x0 + (p.x1 - p.x0) * 0.4, p.y0 + (p.y1 - p.y0) * 0.6);
  sheen.addColorStop(0, "rgba(255,236,190,0.16)");
  sheen.addColorStop(1, "rgba(255,236,190,0)");
  g.fillStyle = sheen;
  g.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
  g.strokeStyle = "rgba(110,48,10,0.3)";
  g.lineWidth = 20;
  g.stroke(plate);
  g.restore();
}

// ---- steam ---------------------------------------------------------------------------------------------------

interface Wisp {
  /** Where it starts, as a share of the free ring (globe) or of a margin (pot), and its angle or height. */
  at: number;
  /** Seconds for one rise, where in it the wisp starts, and how far it sways. */
  period: number;
  phase: number;
  sway: number;
}

export const WISPS: readonly Wisp[] = [
  { at: 0.04, period: 11, phase: 0.1, sway: 9 },
  { at: 0.19, period: 13, phase: 0.55, sway: 12 },
  { at: 0.35, period: 10, phase: 0.8, sway: 8 },
  { at: 0.52, period: 14, phase: 0.3, sway: 11 },
  { at: 0.68, period: 12, phase: 0.95, sway: 10 },
  { at: 0.84, period: 10.5, phase: 0.45, sway: 9 },
];

/** How strongly a wisp shows at a moment, 0 to its top; it comes up and fades over its whole rise, slowly. */
export const STEAM_ALPHA = 0.16;
export function wispAlpha(wp: Pick<Wisp, "period" | "phase">, time: number): number {
  const p = time / wp.period + wp.phase;
  const e = Math.sin(Math.PI * (p - Math.floor(p)));
  return STEAM_ALPHA * e * e;
}

/** Soft steam, drawn after everything else but clipped away from the world, so it never lies over a place. */
function drawSteam(f: SurfaceFrame, time: number, hole: { kind: "disc"; cx: number; cy: number; r: number } | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }, bases: [number, number][]) {
  const { ctx: g, w, h } = f;
  const u = unitOf(w, h);
  g.save();
  const keep = new Path2D();
  keep.rect(0, 0, w, h);
  if (hole.kind === "disc") keep.arc(hole.cx, hole.cy, hole.r + GAP, 0, TAU_RAD);
  else keep.roundRect(hole.x0 - GAP, hole.y0 - GAP, hole.x1 - hole.x0 + 2 * GAP, hole.y1 - hole.y0 + 2 * GAP, 30);
  g.clip(keep, "evenodd");
  g.lineCap = "round";
  g.strokeStyle = "#fff9ee";
  WISPS.forEach((wp, i) => {
    const b = bases[i];
    if (!b) return;
    const a = wispAlpha(wp, time);
    const p = time / wp.period + wp.phase;
    const rise = (p - Math.floor(p)) * 120 * u;
    const sx = Math.sin(time * 0.5 + i * 2) * wp.sway * u;
    const x = b[0] + sx, y = b[1] - rise;
    const path = new Path2D();
    path.moveTo(x, y + 40 * u);
    path.bezierCurveTo(x - 22 * u, y + 20 * u, x + 22 * u, y - 8 * u, x - 4 * u, y - 40 * u);
    for (const [lw, k] of [[17, 0.3], [10, 0.5], [5, 0.9]] as const) {
      g.globalAlpha = a * k;
      g.lineWidth = lw * u;
      g.stroke(path);
    }
  });
  g.restore();
}

/** Where each wisp starts: on the bowl's free ring at fixed angles, or in the pot's margins on a wide screen. */
export function wispBases(w: number, h: number, hole: { kind: "disc"; cx: number; cy: number; r: number; rb: number } | { kind: "rect" }): [number, number][] {
  if (hole.kind === "disc") {
    const mid = (hole.r + hole.rb) / 2;
    return WISPS.map((wp, i): [number, number] => {
      const a = (-170 + wp.at * 340 + i * 7) * DEG;
      return [hole.cx + Math.cos(a) * mid, hole.cy + Math.sin(a) * mid];
    });
  }
  const p = potOf(w, h);
  if (!p.wide) return [];
  return WISPS.map((wp, i): [number, number] => {
    const left = i % 2 === 0;
    return [left ? p.x0 / 2 : (p.x1 + w) / 2, p.y0 + (0.25 + wp.at * 0.65) * (p.y1 - p.y0)];
  });
}

// ---- the frame ------------------------------------------------------------------------------------------------

export class SoupCache {
  wobble = new Wobble();
  picture = new Picture();
  /** Counts frames while the broth sways, so each is drawn fresh instead of from the kept copy. */
  frames = 0;
  disc?: { key: string; pieces: Placed[]; noodles: Noodle[] };
  rect?: { key: string; pieces: Placed[] };
}

/** Milliseconds between frames: about 30 a second while the broth sways, 8 a second for the steam alone. */
export const SWAY_FRAME_MS = 33;
export const STEAM_FRAME_MS = 125;

export function drawSoup(f: SurfaceFrame, cache: SoupCache): SurfaceResult {
  const { w, h, ctx } = f;
  const still = !!f.still;
  const time = motionTime();
  const u = pieceUnit(w, h);
  const warp = f.warp ?? null;
  const swaying = cache.wobble.active && !!warp;
  const key = `${viewKey(f)}|${swaying ? `s${++cache.frames}` : "rest"}`;
  const next = still ? 0 : swaying ? SWAY_FRAME_MS : STEAM_FRAME_MS;

  if (f.mode === "3d") {
    const R = Math.round(f.proj.scale());
    const [cx, cy] = f.proj.translate();
    const bowl = bowlOf(w, h, R);
    const dk = `${w}|${h}|${R}|${Math.round(cx)}|${Math.round(cy)}`;
    if (cache.disc?.key !== dk) cache.disc = { key: dk, pieces: placeDisc(w, h, cx, cy, R, bowl.r), noodles: placeNoodles(w, h, R, bowl.r) };
    const { pieces, noodles } = cache.disc;
    drawBowl(f, { cx, cy, r: bowl.r });
    cachedPicture(cache.picture, f, key, (g) => {
      drawRipples(g, cx, cy, f.proj.scale(), bowl.r, warp);
      drawNoodles(g, noodles, cx, cy, warp);
      drawPieces(g, pieces, u, warp);
      paintGlobe(f, g, swaying);
    });
    drawSteam(f, time, { kind: "disc", cx, cy, r: f.proj.scale() }, wispBases(w, h, { kind: "disc", cx, cy, r: R, rb: bowl.r }));
    ctx.globalAlpha = 1;
    return { next };
  }

  const p = potOf(w, h);
  const rk = `${w}|${h}`;
  if (cache.rect?.key !== rk) cache.rect = { key: rk, pieces: placeRect(w, h) };
  drawPot(f, p);
  const plate = new Path2D();
  plate.roundRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, p.r);
  cachedPicture(cache.picture, f, key, (g) => {
    drawPieces(g, cache.rect!.pieces, u, null);
    paintBroth(f, g, plate, p, swaying);
  });
  drawSteam(f, time, { kind: "rect", x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 }, wispBases(w, h, { kind: "rect" }));
  ctx.globalAlpha = 1;
  const m = 3;
  return { inside: (x, y) => x > p.x0 + m && y > p.y0 + m && x < p.x1 - m && y < p.y1 - m, clip: plate, next };
}
