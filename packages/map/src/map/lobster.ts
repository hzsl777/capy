// Lobster (id lobster, experimental): a seaside lobster shack and a lobster boat of our own. Nothing is copied from any
// restaurant, brand, fishery or place: the lobster, the boat, the pots, the rope and the chart are our own drawings, and
// nothing here carries a name, a logo or lettering.
//
// Map view is a nautical sheet: a pale chart sea stepped darker toward every coast, a fine graticule over the water,
// soundings (small plus marks, decoration only, never numbers) in water well clear of land and of every place, sage land
// in a dark coast with a sandy shore, and at fixed, tested open-sea spots our own drawings: a lobster boat seen from
// above, a lobster, a pot under the water and a compass rose with no letters. Globe view is the same chart as a ball
// lying on a dock of weathered boards inside a coil of rope, with a lobster, pots, a coil and an oar laid on the boards
// round it where there is room. Lobster red is only on the lobster (and in the page's chrome), never on the land.
// Nothing moves.

import { geoDistance, geoGraticule, geoPath } from "d3-geo";
import { hash2, offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The palette: pale chart water, sage land, harbour ink, weathered grey boards, manila rope, lobster red. */
export const LB = {
  /** The sea, lightest in deep water and darker toward the coast, as a chart tints its shallows. */
  deep: "#dbeaea",
  mid: "#c3dcdf",
  shallow: "#aacdd3",
  near: "#8fbcc6",
  land: "#b7c3a6",
  shore: "#dcd6b8",
  peak: "#85957a",
  ice: "#f4f8f7",
  coast: "#2d464c",
  ink: "#32535b",
  river: "#6fa5b2",
  graticule: "rgba(45,70,76,0.2)",
  sounding: "rgba(45,80,92,0.5)",
  red: "#c8321e",
  redDark: "#8d2214",
  redLight: "#e25a3f",
  wood: "#8b7656",
  woodDark: "#4b3e2a",
  woodLight: "#a8946f",
  rope: "#cdb98e",
  ropeDark: "#8a7a55",
  cream: "#f0ede0",
  hullGreen: "#3d6b5f",
  boards: ["#7a776e", "#6f6d65", "#85827a", "#76736b", "#6b6961"],
  seam: "#33322e",
};

// ---- our own drawings, as path text in local units -----------------------------------------------------------------

type Pt = [number, number];

const f3 = (v: number) => Math.round(v * 1000) / 1000;
const P = (p: Pt) => `${f3(p[0])} ${f3(p[1])}`;
const poly = (pts: Pt[], close = true) => pts.map((p, i) => (i ? "L" : "M") + P(p)).join("") + (close ? "Z" : "");

/** Points round an ellipse, turned by `rot` (clockwise on screen, since y runs down). */
function ell(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 32): Pt[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    return [cx + x * c - y * s, cy + x * s + y * c] as Pt;
  });
}

/** Points along a cubic, both ends included. */
function bez(a: Pt, b: Pt, c: Pt, d: Pt, n = 14): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, m = 1 - t;
    const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
    return [w[0]! * a[0] + w[1]! * b[0] + w[2]! * c[0] + w[3]! * d[0], w[0]! * a[1] + w[1]! * b[1] + w[2]! * c[1] + w[3]! * d[1]] as Pt;
  });
}

/** Points turned about the origin by `rot`, scaled by `k`, then moved. */
function turn(pts: Pt[], rot: number, tx = 0, ty = 0, k = 1): Pt[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([x, y]) => [k * (x * c - y * s) + tx, k * (x * s + y * c) + ty] as Pt);
}

/** The left side of a symmetric outline given down its right side: the right side, then its mirror back up. */
const sym = (right: Pt[]): Pt[] => [...right, ...right.map(([x, y]) => [-x, y] as Pt).reverse()];

/** One filled or stroked piece of a drawing; widths and dashes are in local units. */
export interface Part {
  d: string;
  fill?: string;
  stroke?: string;
  w?: number;
  dash?: number[];
}

export type Kind = "boat" | "lobster" | "pot" | "rose" | "coil" | "oar";

/** A claw: the palm and two fingers, the movable one opened a little, turned to point out and forward from the wrist. */
function claw(side: number, k: number): Part[] {
  const wrist: Pt = [side * 0.3, -0.5];
  const ang = side * 0.5;
  const palm = ell(0, -0.12, 0.1, 0.15, 0, 20);
  const finger: Pt[] = [[-0.09, -0.18], [-0.105, -0.3], [-0.08, -0.42], [-0.015, -0.5], [-0.03, -0.38], [-0.025, -0.27], [0, -0.2]];
  const other = finger.map(([x, y]) => [-x, y] as Pt);
  // The movable finger turns open about the palm's top.
  const open = turn(other.map(([x, y]) => [x, y + 0.2] as Pt), 0.22).map(([x, y]) => [x, y - 0.2] as Pt);
  const put = (pts: Pt[]) => turn(pts, ang, wrist[0], wrist[1], k);
  const body = { fill: LB.red, stroke: LB.redDark, w: 0.014 };
  return [
    { d: poly(put(finger)), ...body },
    { d: poly(put(open)), ...body },
    { d: poly(put(palm)), ...body },
    { d: poly(put(ell(-0.02, -0.15, 0.04, 0.07, 0.3, 14))), fill: "rgba(255,255,255,0.22)" },
  ];
}

/** A lobster seen from above, head up, claws and feelers forward, tail fan behind, about 2 units long. */
function lobster(): Part[] {
  const out: Part[] = [];
  const body = { fill: LB.red, stroke: LB.redDark, w: 0.014 };
  for (const s of [-1, 1]) {
    // Feelers: a long pair and a short pair.
    out.push({ d: poly(bez([s * 0.05, -0.58], [s * 0.12, -0.8], [s * 0.3, -0.88], [s * 0.5, -0.9]), false), stroke: LB.redDark, w: 0.02 });
    out.push({ d: poly(bez([s * 0.03, -0.58], [s * 0.05, -0.68], [s * 0.09, -0.74], [s * 0.13, -0.78]), false), stroke: LB.redDark, w: 0.015 });
  }
  // Walking legs: four a side, each bent once.
  let legs = "";
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -0.26 + i * 0.065;
      legs += poly([[s * 0.16, y], [s * (0.36 + 0.02 * i), y - 0.03 + 0.02 * i], [s * 0.5, y + 0.09 + 0.05 * i]], false);
    }
  }
  out.push({ d: legs, stroke: LB.redDark, w: 0.026 });
  // The tail fan: the middle plate and two pairs of side plates.
  for (const [cx, cy, rx, ry, rot] of [[0, 0.85, 0.075, 0.14, 0], [-0.13, 0.84, 0.07, 0.14, 0.34], [0.13, 0.84, 0.07, 0.14, -0.34], [-0.21, 0.79, 0.06, 0.12, 0.66], [0.21, 0.79, 0.06, 0.12, -0.66]] as const) {
    out.push({ d: poly(ell(cx, cy, rx, ry, rot, 18)), ...body });
  }
  // Six segments of tail, each overlapping the last.
  for (let i = 0; i < 6; i++) out.push({ d: poly(ell(0, 0.16 + 0.1 * i, 0.19 - 0.012 * i, 0.068, 0, 22)), ...body });
  // The shell over the head and chest: a rostrum, then a body that narrows toward the tail.
  const right = [...bez([0, -0.64], [0.07, -0.56], [0.2, -0.42], [0.2, -0.2], 10), ...bez([0.2, -0.2], [0.2, -0.05], [0.17, 0.06], [0.12, 0.12], 8).slice(1), ...bez([0.12, 0.12], [0.07, 0.16], [0.03, 0.16], [0, 0.16], 5).slice(1)];
  const shell = sym(right.slice(0, -1));
  out.push({ d: poly(shell), ...body });
  out.push({ d: poly(bez([-0.19, -0.14], [-0.08, -0.1], [0.08, -0.1], [0.19, -0.14], 10), false), stroke: LB.redDark, w: 0.012 });
  out.push({ d: poly(ell(-0.05, -0.3, 0.05, 0.16, 0.16, 16)), fill: "rgba(255,255,255,0.2)" });
  // Arms from the shoulders to the wrists.
  for (const s of [-1, 1]) {
    const arm = poly(bez([s * 0.14, -0.34], [s * 0.2, -0.44], [s * 0.26, -0.5], [s * 0.3, -0.5], 8), false);
    out.push({ d: arm, stroke: LB.redDark, w: 0.09 });
    out.push({ d: arm, stroke: LB.red, w: 0.062 });
  }
  out.push(...claw(-1, 1), ...claw(1, 0.88));
  return out;
}

/** A lobster pot from above, about 1.3 by 0.85: a wooden frame, slats across, a bridle to a ring and a line trailing off. */
function pot(): Part[] {
  const out: Part[] = [];
  const hw = 0.64, hh = 0.41;
  const frame: Pt[] = [[-hw + 0.06, -hh], [hw - 0.06, -hh], [hw, -hh + 0.06], [hw, hh - 0.06], [hw - 0.06, hh], [-hw + 0.06, hh], [-hw, hh - 0.06], [-hw, -hh + 0.06]];
  out.push({ d: poly(frame), fill: LB.wood, stroke: LB.woodDark, w: 0.03 });
  // Slats across the short way, and a darker rail along each long side.
  let slats = "";
  for (let i = -5; i <= 5; i++) slats += poly([[i * 0.108, -hh + 0.02], [i * 0.108, hh - 0.02]], false);
  out.push({ d: slats, stroke: LB.woodDark, w: 0.016 });
  out.push({ d: poly([[-hw + 0.05, -hh + 0.07], [hw - 0.05, -hh + 0.07]], false) + poly([[-hw + 0.05, hh - 0.07], [hw - 0.05, hh - 0.07]], false), stroke: LB.woodDark, w: 0.05 });
  out.push({ d: poly([[-hw + 0.1, -hh + 0.07], [hw - 0.1, -hh + 0.07]], false) + poly([[-hw + 0.1, hh - 0.07], [hw - 0.1, hh - 0.07]], false), stroke: LB.woodLight, w: 0.02 });
  // The bridle from the four corners to a ring, and the line off to one side.
  const ring: Pt = [0, 0];
  out.push({ d: poly([[-hw + 0.04, -hh + 0.04], ring], false) + poly([[hw - 0.04, -hh + 0.04], ring], false) + poly([[-hw + 0.04, hh - 0.04], ring], false) + poly([[hw - 0.04, hh - 0.04], ring], false), stroke: LB.rope, w: 0.03 });
  out.push({ d: poly(ell(0, 0, 0.07, 0.07, 0, 16)), stroke: LB.rope, w: 0.035 });
  out.push({ d: poly(bez([0.05, -0.05], [0.3, -0.5], [0.6, -0.4], [0.88, -0.58], 12), false), stroke: LB.rope, w: 0.03 });
  return out;
}

/** A lobster boat from above, bow up: a cream hull, a forward wheelhouse, pots stacked aft, a boom, a bow wave and a wake. */
function boat(): Part[] {
  const out: Part[] = [];
  // The wake first, so the hull covers its start.
  out.push({ d: poly([[-0.27, 0.74], [-0.46, 0.95]], false) + poly([[0.27, 0.74], [0.46, 0.95]], false) + poly([[-0.06, 0.78], [-0.08, 0.88]], false) + poly([[0.06, 0.8], [0.08, 0.92]], false), stroke: "rgba(255,255,255,0.85)", w: 0.035 });
  const right = [...bez([0, -1.0], [0.16, -0.78], [0.3, -0.5], [0.3, -0.1], 12), ...bez([0.3, -0.1], [0.3, 0.2], [0.3, 0.5], [0.3, 0.64], 6).slice(1), ...bez([0.3, 0.64], [0.3, 0.7], [0.28, 0.73], [0.24, 0.73], 4).slice(1)];
  const hull = [...right, ...right.map(([x, y]) => [-x, y] as Pt).reverse()];
  out.push({ d: poly(hull), fill: LB.cream, stroke: LB.ink, w: 0.03 });
  // The deck, a smaller hull inside it.
  const deck = hull.map(([x, y]) => [x * 0.76, (y + 0.13) * 0.86 - 0.13] as Pt);
  out.push({ d: poly(deck), fill: LB.hullGreen });
  // Pots stacked at the stern, in two columns and three rows.
  for (const x of [-0.12, 0.12]) {
    for (const y of [0.3, 0.43, 0.56]) out.push({ d: poly([[x - 0.09, y - 0.055], [x + 0.09, y - 0.055], [x + 0.09, y + 0.055], [x - 0.09, y + 0.055]]), fill: LB.wood, stroke: LB.woodDark, w: 0.016 });
  }
  // The wheelhouse and the dark line of its windows.
  out.push({ d: poly([[-0.2, -0.4], [0.2, -0.4], [0.2, -0.04], [-0.2, -0.04]]), fill: LB.cream, stroke: LB.ink, w: 0.026 });
  out.push({ d: poly([[-0.15, -0.33], [0.15, -0.33]], false), stroke: LB.ink, w: 0.04 });
  out.push({ d: poly([[-0.15, -0.12], [0.15, -0.12]], false), stroke: LB.ink, w: 0.02 });
  // The boom that hauls the pots, out over the side.
  out.push({ d: poly([[0.2, -0.1], [0.44, 0.1]], false), stroke: LB.ink, w: 0.03 });
  // A bow wave.
  out.push({ d: poly([[0, -0.99], [-0.2, -0.82]], false) + poly([[0, -0.99], [0.2, -0.82]], false), stroke: "rgba(255,255,255,0.9)", w: 0.035 });
  return out;
}

/** A compass rose with no letters: rings and ticks, eight points half in light and half in shade, a small north flag. */
function rose(): Part[] {
  const out: Part[] = [];
  out.push({ d: poly(ell(0, 0, 0.95, 0.95, 0, 48)), fill: "rgba(246,241,226,0.55)", stroke: LB.ink, w: 0.014 });
  out.push({ d: poly(ell(0, 0, 0.84, 0.84, 0, 48)), stroke: LB.ink, w: 0.01 });
  let ticks = "";
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    const r0 = i % 4 === 0 ? 0.84 : 0.88;
    ticks += poly([[Math.sin(a) * r0, -Math.cos(a) * r0], [Math.sin(a) * 0.95, -Math.cos(a) * 0.95]], false);
  }
  out.push({ d: ticks, stroke: LB.ink, w: 0.01 });
  const point = (i: number, len: number) => {
    const a = (i / 8) * TAU;
    const tip: Pt = [Math.sin(a) * len, -Math.cos(a) * len];
    const bl: Pt = [Math.sin(a - Math.PI / 8) * 0.17, -Math.cos(a - Math.PI / 8) * 0.17];
    const br: Pt = [Math.sin(a + Math.PI / 8) * 0.17, -Math.cos(a + Math.PI / 8) * 0.17];
    out.push({ d: poly([tip, [0, 0], bl]), fill: LB.cream, stroke: LB.ink, w: 0.01 });
    out.push({ d: poly([tip, [0, 0], br]), fill: "#6f9ba3", stroke: LB.ink, w: 0.01 });
  };
  for (const i of [1, 3, 5, 7]) point(i, 0.56);
  for (const i of [0, 2, 4, 6]) point(i, 0.8);
  out.push({ d: poly(ell(0, 0, 0.07, 0.07, 0, 16)), stroke: LB.ink, w: 0.012 });
  // The north flag, outside the rings.
  out.push({ d: poly([[0, -1.06], [-0.07, -0.96], [0.07, -0.96]]), fill: LB.ink });
  return out;
}

/** A coil of rope from above: one length wound round in a spiral, its end lying free. */
function coil(): Part[] {
  const out: Part[] = [];
  const pts: Pt[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * TAU * 2.6 - 1.2;
    const r = 0.2 + 0.58 * t;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const tail = bez(pts[pts.length - 1]!, [-0.82, 0.17], [-0.98, -0.1], [-0.86, -0.4], 8);
  const d = poly([...pts, ...tail.slice(1)], false);
  out.push({ d, stroke: LB.ropeDark, w: 0.15 });
  out.push({ d, stroke: LB.rope, w: 0.11 });
  out.push({ d, stroke: "rgba(255,255,255,0.35)", w: 0.11, dash: [0.03, 0.07] });
  return out;
}

/** An oar lying on the boards: a long shaft and a flat blade. */
function oar(): Part[] {
  const blade = [...bez([0.4, -0.06], [0.6, -0.14], [0.9, -0.14], [1.02, 0], 8), ...bez([1.02, 0], [0.9, 0.14], [0.6, 0.14], [0.4, 0.06], 8).slice(1)];
  return [
    { d: poly([[-1.0, -0.035], [0.42, -0.04], [0.42, 0.04], [-1.0, 0.035]]), fill: LB.woodLight, stroke: LB.woodDark, w: 0.02 },
    { d: poly(blade), fill: LB.woodLight, stroke: LB.woodDark, w: 0.025 },
    { d: poly([[0.5, 0], [0.98, 0]], false), stroke: LB.woodDark, w: 0.012 },
  ];
}

const MAKERS: Record<Kind, () => Part[]> = { boat, lobster, pot, rose, coil, oar };
const made = new Map<Kind, Part[]>();

/** The parts of one drawing, made once. */
export function shapeParts(kind: Kind): Part[] {
  let p = made.get(kind);
  if (!p) made.set(kind, (p = MAKERS[kind]()));
  return p;
}

/** Every point a path's text names, for a test to bound a drawing. */
export function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}

/**
 * How far a drawing reaches from its centre, in its own units, with the widest stroke's half width: a drawing at `u`
 * pixels a unit stays inside a circle of `REACH * u` pixels.
 */
export const REACH = 1.2;

interface Compiled {
  part: Part;
  path: Path2D;
}
const compiled = new Map<Kind, Compiled[]>();
const compile = (kind: Kind) => {
  let c = compiled.get(kind);
  if (!c) compiled.set(kind, (c = shapeParts(kind).map((part) => ({ part, path: new Path2D(part.d) }))));
  return c;
};

/**
 * Draws one drawing at the origin of the context's current transform, which the caller has scaled to `u` pixels a unit.
 * `shadow` fills it in one tone. A line is never thinner than a pixel.
 */
function drawShape(ctx: CanvasRenderingContext2D, kind: Kind, u: number, shadow?: string) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const { part, path } of compile(kind)) {
    const lw = Math.max(0.7 / u, part.w ?? 0.02);
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.strokeStyle = shadow;
      ctx.lineWidth = lw;
      if (part.fill) ctx.fill(path);
      else ctx.stroke(path);
      continue;
    }
    if (part.fill) {
      ctx.fillStyle = part.fill;
      ctx.fill(path);
    }
    if (part.stroke) {
      ctx.strokeStyle = part.stroke;
      ctx.lineWidth = lw;
      ctx.setLineDash(part.dash ?? []);
      ctx.stroke(path);
    }
  }
  ctx.setLineDash([]);
}

// ---- the drawings at sea ---------------------------------------------------------------------------------------------

/** A fixed spot in open sea with the radius, in degrees, of open water all round it (tested). */
export interface SeaSpot {
  kind: "boat" | "lobster" | "pot" | "rose";
  lon: number;
  lat: number;
  r: number;
  /** Which way the drawing points, in radians clockwise from up. */
  rot: number;
  flip?: boolean;
}

/**
 * Drawings at spots whose whole circle of radius `r` is open sea, at least 3 degrees from every place
 * (test/lobster.test.ts). Each is drawn no wider than its open water, so it never reaches land or a place at any zoom.
 */
export const SEA: readonly SeaSpot[] = [
  { kind: "boat", lon: -152, lat: -52, r: 20, rot: 0.9 },
  { kind: "lobster", lon: -16, lat: -52, r: 20, rot: -0.5 },
  { kind: "boat", lon: 64, lat: -44, r: 20, rot: -1.2 },
  { kind: "pot", lon: -104, lat: -28, r: 20, rot: 0.3 },
  { kind: "rose", lon: -140, lat: 4, r: 20, rot: 0 },
  { kind: "boat", lon: 168, lat: 32, r: 20, rot: 2.3 },
  { kind: "pot", lon: 120, lat: -52, r: 14, rot: -0.4, flip: true },
  { kind: "pot", lon: 84, lat: -12, r: 14, rot: 0.6 },
  { kind: "lobster", lon: -44, lat: 24, r: 14, rot: 2.6, flip: true },
  { kind: "boat", lon: -148, lat: 40, r: 14, rot: -2.4 },
];

/** The share of the open water's radius a drawing may use; with REACH, its farthest point stays well inside. */
export const SEA_FILL = 0.7;
/** The largest a drawing grows on screen, in pixels a unit, so a close view shows a boat, not a wall of hull. */
const SEA_MAX_U = 110;

/** Pixels a unit for a drawing whose open water spans `r` degrees at `pxDeg` pixels a degree: inside it at every zoom. */
export function seaUnit(r: number, pxDeg: number): number {
  return Math.min(SEA_MAX_U, (SEA_FILL * r * pxDeg) / REACH);
}

/** Whether a point is on the globe's near side, by the cosine of its angle from the view's centre. */
function facingCos(f: SurfaceFrame, lon: number, lat: number): number {
  const a = lat * RAD, b = f.lat * RAD;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * RAD);
}

function drawSea(f: SurfaceFrame) {
  const { ctx, proj } = f;
  const pxDeg = proj.scale() * RAD;
  for (const s of SEA) {
    let k = 1;
    if (f.mode === "3d") {
      // Foreshortened toward the rim, and left out near it, so nothing is squeezed against the limb.
      const c = facingCos(f, s.lon, s.lat);
      if (c < 0.45) continue;
      k = c;
    }
    const p = proj([s.lon, s.lat]);
    if (!p) continue;
    const u = seaUnit(s.r, pxDeg) * k;
    const reach = u * REACH;
    if (u < 14 || p[0] < -reach || p[0] > f.w + reach || p[1] < -reach || p[1] > f.h + reach) continue;
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(s.rot);
    ctx.scale(s.flip ? -u : u, u);
    // A pot lies under the water: seen through it, a little paler.
    if (s.kind === "pot") ctx.globalAlpha = 0.78;
    drawShape(ctx, s.kind, u);
    ctx.restore();
  }
}

// ---- soundings: decoration only ----------------------------------------------------------------------------------------

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Grid steps for soundings in degrees, coarse to fine. */
const SOUND_STEPS = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02];

/** The grid step for a map drawn at `pxDeg` pixels a degree: the largest that keeps its cells under 70 pixels. */
export function soundStep(pxDeg: number): number {
  for (const s of SOUND_STEPS) if (s * pxDeg <= 70) return s;
  return SOUND_STEPS[SOUND_STEPS.length - 1]!;
}

/** How far a sounding keeps from land and from every place, in degrees: 14 pixels, between half a cell and 3 degrees. */
export function soundClear(step: number, pxDeg: number): number {
  return Math.min(3, Math.max(14 / pxDeg, step * 0.5));
}

export interface Sounding {
  lon: number;
  lat: number;
  /** A longer mark, now and then. */
  big: boolean;
}

/**
 * The soundings in a window of longitude and latitude, from a jittered grid fixed to the world: a cell keeps its mark by
 * a hash of where it is (a little over a third of them), and loses it when land, ice or a place is within `clear`
 * degrees. Nothing here reads data, and the same window always gives the same marks.
 */
export function soundings(box: { lon0: number; lon1: number; lat0: number; lat1: number }, step: number, clear: number, blocked: (lon: number, lat: number, clear: number) => boolean): Sounding[] {
  const out: Sounding[] = [];
  const ix0 = Math.floor(box.lon0 / step), ix1 = Math.ceil(box.lon1 / step);
  const iy0 = Math.floor(Math.max(-84, box.lat0) / step), iy1 = Math.ceil(Math.min(84, box.lat1) / step);
  // A cell's hash uses its column's place in one turn of the world, so the same cell keeps its mark wherever the window starts.
  const cols = Math.round(360 / step);
  for (let ix = ix0; ix <= ix1; ix++) {
    const wx = ((ix % cols) + cols) % cols;
    for (let iy = iy0; iy <= iy1; iy++) {
      if (hash2(wx * 7 + 3, iy * 13 + step * 1000) > 0.38) continue;
      const lon = wrapLon((ix + 0.2 + 0.6 * hash2(wx, iy + 17)) * step);
      const lat = (iy + 0.2 + 0.6 * hash2(wx + 29, iy)) * step;
      if (blocked(lon, lat, clear)) continue;
      out.push({ lon, lat, big: hash2(wx + 5, iy + 11) > 0.7 });
    }
  }
  return out;
}

/** Places and land, as the view knows them, for the sounding grid: eight points and the centre, and a grid of the places. */
const ring9: [number, number][] = [[0, 0], ...Array.from({ length: 8 }, (_, i): [number, number] => [Math.cos((i / 8) * TAU), Math.sin((i / 8) * TAU)])];

class PlaceGrid {
  private size = 0;
  private cells = new Set<string>();
  private count = -1;
  at(f: SurfaceFrame, size: number, lon: number, lat: number): boolean {
    const n = f.anchors?.size ?? 0;
    if (n !== this.count || size !== this.size) {
      this.count = n;
      this.size = size;
      this.cells.clear();
      for (const [alon, alat] of f.anchors?.values() ?? []) this.cells.add(`${Math.floor(alon / size)},${Math.floor(alat / size)}`);
    }
    const cx = Math.floor(lon / size), cy = Math.floor(lat / size);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (this.cells.has(`${cx + dx},${cy + dy}`)) return true;
    return false;
  }
}

function drawSoundings(f: SurfaceFrame, grid: PlaceGrid) {
  const { ctx, w, h, proj } = f;
  const pxDeg = proj.scale() * RAD;
  const step = soundStep(pxDeg);
  const clear = soundClear(step, pxDeg);
  // The window of the world in view: the frame's reach in degrees, with room for the projection's curve.
  const halfLon = Math.min(180, (w / 2 / pxDeg) * 1.4 + step), halfLat = Math.min(90, (h / 2 / pxDeg) * 1.4 + step);
  const globe = f.mode === "3d";
  const box = globe
    ? { lon0: f.lon - 95, lon1: f.lon + 95, lat0: f.lat - 95, lat1: f.lat + 95 }
    : { lon0: f.lon - halfLon, lon1: f.lon + halfLon, lat0: f.lat - halfLat, lat1: f.lat + halfLat };
  if (globe) {
    // Zoomed in, only the part of the sphere the frame shows.
    const reach = Math.min(95, (Math.hypot(w, h) / 2 / pxDeg) * 1.2 + step);
    box.lon0 = f.lon - reach / Math.max(0.2, Math.cos(f.lat * RAD));
    box.lon1 = f.lon + reach / Math.max(0.2, Math.cos(f.lat * RAD));
    box.lat0 = f.lat - reach;
    box.lat1 = f.lat + reach;
    box.lon0 = Math.max(box.lon0, f.lon - 180);
    box.lon1 = Math.min(box.lon1, f.lon + 180);
  }
  const blocked = (lon: number, lat: number, c: number) => {
    for (const [dx, dy] of ring9) {
      const x = lon + dx * c, y = lat + dy * c;
      if (f.isLand(x, y) || f.isIce(x, y)) return true;
    }
    return grid.at(f, Math.max(c, 0.01), lon, lat);
  };
  const marks = soundings(box, step, clear, blocked);
  const c: [number, number] = [f.lon, f.lat];
  const path = new Path2D();
  const s = clamp(2 + Math.log2(Math.max(1, f.zoom)) * 0.25, 2, 3.2);
  for (const m of marks) {
    const lon = m.lon;
    if (globe && geoDistance(c, [lon, m.lat]) > Math.PI / 2 - 0.12) continue;
    const p = proj([lon, m.lat]);
    if (!p || p[0] < -6 || p[1] < -6 || p[0] > w + 6 || p[1] > h + 6) continue;
    const k = m.big ? s * 1.35 : s;
    path.moveTo(p[0] - k, p[1]);
    path.lineTo(p[0] + k, p[1]);
    path.moveTo(p[0], p[1] - k);
    path.lineTo(p[0], p[1] + k);
  }
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = LB.sounding;
  ctx.stroke(path);
  ctx.restore();
}

// ---- land and sea ------------------------------------------------------------------------------------------------------

const GRATICULE_STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1];

/** The graticule's step: the smallest of the usual steps that keeps its lines at least 60 pixels apart. */
export function graticuleStep(pxDeg: number): number {
  for (let i = GRATICULE_STEPS.length - 1; i >= 0; i--) if (GRATICULE_STEPS[i]! * pxDeg >= 60) return GRATICULE_STEPS[i]!;
  return GRATICULE_STEPS[0]!;
}

/** The chart: banded water, graticule, soundings and drawings at sea, then the land, its shore, peaks, lakes and coast. */
function paintWorld(f: SurfaceFrame, globe: boolean, grid: PlaceGrid) {
  const { ctx, w, h } = f;
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  const land = path(f.map.land);
  const coast = path(f.map.coast);
  const lakes = path(f.map.lakes);
  // The wide bands come from the light basemap, where detail adds nothing.
  const wide = f.map === f.low ? coast : path(f.low.coast);
  const zk = clamp(Math.sqrt(f.zoom), 1, 2.4) * clamp(Math.min(w, h) / 720, 0.6, 1);

  // Water tinted darker toward the coast, as a chart tints its shallows.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = LB.mid;
  ctx.lineWidth = 40 * zk;
  ctx.stroke(wide);
  ctx.strokeStyle = LB.shallow;
  ctx.lineWidth = 22 * zk;
  ctx.stroke(wide);
  ctx.strokeStyle = LB.near;
  ctx.lineWidth = 9 * zk;
  ctx.stroke(wide);
  ctx.restore();

  // The graticule, over the water only: land is drawn over it.
  const pxDeg = f.proj.scale() * RAD;
  const gs = graticuleStep(pxDeg);
  ctx.save();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = LB.graticule;
  ctx.setLineDash([]);
  ctx.stroke(path(geoGraticule().step([gs, gs]).extent([[-180, -90], [180, 90]])()));
  ctx.restore();

  drawSoundings(f, grid);
  drawSea(f);

  // The land: sage, with a sandy shore inside the coast, small hill marks from the relief layer, and white ice.
  ctx.fillStyle = LB.land;
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  ctx.lineJoin = "round";
  ctx.strokeStyle = LB.shore;
  ctx.lineWidth = 6 * zk;
  ctx.stroke(wide);
  if (f.map.ice) {
    ctx.fillStyle = LB.ice;
    ctx.fill(path(f.map.ice));
  }
  if (f.relief) {
    const s = clamp(2.2 * Math.sqrt(f.zoom), 2.2, 6) * clamp(Math.min(w, h) / 720, 0.7, 1);
    const cc: [number, number] = [f.lon, f.lat];
    const hills = new Path2D();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && geoDistance(cc, [lon, lat]) > Math.PI / 2 - 0.05) continue;
      if (f.isIce(lon, lat)) continue;
      const p = f.proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      // Open chevrons, never round, so none reads as a place.
      hills.moveTo(p[0] - s, p[1] + s * 0.5);
      hills.lineTo(p[0], p[1] - s * 0.7);
      hills.lineTo(p[0] + s, p[1] + s * 0.5);
    }
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = LB.peak;
    ctx.stroke(hills);
  }
  ctx.restore();

  ctx.fillStyle = LB.shallow;
  ctx.fill(lakes);
  if (f.zoom >= 2) {
    ctx.strokeStyle = LB.river;
    ctx.lineWidth = 0.9;
    ctx.stroke(path(f.map.rivers));
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = LB.coast;
  ctx.lineWidth = 1.05 * clamp(Math.sqrt(f.zoom), 1, 1.7);
  ctx.stroke(coast);
  ctx.lineWidth = 0.7;
  ctx.stroke(lakes);
  ctx.restore();
}

// ---- Globe view: the dock ------------------------------------------------------------------------------------------------

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 120, h: 70 };
export const ZOOM_BOX = { w: 76, h: 120 };
/** The least room kept between a laid-out piece and the globe's coil, the frame's edge, the buttons and other pieces. */
export const GAP = 10;

/** The rope coil round the globe: the radius it starts at, the width of each turn and how many turns. */
export function coilOf(R: number): { inner: number; width: number; turns: number; outer: number } {
  const width = clamp(R * 0.05, 9, 17);
  const inner = R + 4;
  const turns = 3;
  return { inner, width, turns, outer: inner + turns * width + 2 };
}

export type DockKind = "lobster" | "pot" | "coil" | "oar";

export interface Piece {
  kind: DockKind;
  x: number;
  y: number;
  rot: number;
  /** Pixels a unit. */
  u: number;
}

/** The pieces tried for places on the boards, in order: a share of the frame across and down, and how it lies. */
const CANDIDATES: readonly { kind: DockKind; fx: number; fy: number; rot: number; k: number }[] = [
  { kind: "lobster", fx: 0.1, fy: 0.5, rot: -0.55, k: 1 },
  { kind: "pot", fx: 0.91, fy: 0.42, rot: 0.25, k: 0.9 },
  { kind: "coil", fx: 0.1, fy: 0.84, rot: 0, k: 0.8 },
  { kind: "oar", fx: 0.88, fy: 0.84, rot: -0.35, k: 1 },
  { kind: "pot", fx: 0.1, fy: 0.16, rot: -0.3, k: 0.8 },
  { kind: "lobster", fx: 0.9, fy: 0.15, rot: 2.3, k: 0.8 },
  { kind: "coil", fx: 0.5, fy: 0.95, rot: 0.5, k: 0.5 },
  { kind: "oar", fx: 0.5, fy: 0.05, rot: 0.1, k: 0.9 },
];

const circleBox = (x: number, y: number, r: number, b: { x0: number; y0: number; x1: number; y1: number }) => {
  const nx = clamp(x, b.x0, b.x1), ny = clamp(y, b.y0, b.y1);
  return Math.hypot(x - nx, y - ny) < r;
};

/**
 * The things laid on the dock round the globe, for a frame with the globe at (cx, cy) of radius R. A piece is a circle of
 * `REACH * u`; it must lie inside the frame, `GAP` clear of the coil, the Key's corner, the zoom buttons' corner and every
 * piece before it, and one with too little room is tried smaller twice, then left out. The same frame always gets the same
 * pieces, and nothing is ever laid over the globe.
 */
export function placeDock(w: number, h: number, cx: number, cy: number, R: number): Piece[] {
  const out: Piece[] = [];
  const clearR = coilOf(R).outer + GAP;
  const base = clamp(Math.min(w, h) / 11, 28, 62);
  const key = { x0: 0, y0: 0, x1: KEY_BOX.w, y1: KEY_BOX.h };
  const zoom = { x0: w - ZOOM_BOX.w, y0: h - ZOOM_BOX.h, x1: w, y1: h };
  for (const c of CANDIDATES) {
    for (const shrink of [1, 0.8, 0.64]) {
      const u = base * c.k * shrink;
      const r = u * REACH;
      const x = c.fx * w, y = c.fy * h;
      if (x - r < GAP / 2 || x + r > w - GAP / 2 || y - r < GAP / 2 || y + r > h - GAP / 2) continue;
      if (Math.hypot(x - cx, y - cy) < clearR + r) continue;
      if (circleBox(x, y, r + GAP, key) || circleBox(x, y, r + GAP, zoom)) continue;
      if (out.some((o) => Math.hypot(x - o.x, y - o.y) < o.u * REACH + r + GAP)) continue;
      out.push({ kind: c.kind, x, y, rot: c.rot, u });
      break;
    }
  }
  return out;
}

/** Boards of weathered grey wood, laid in rows with staggered joints, nail heads and grain, from a fixed seed. */
function paintDock(g: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = seeded(7127);
  g.fillStyle = LB.boards[1]!;
  g.fillRect(0, 0, w, h);
  const bh = clamp(h / 15, 40, 64);
  let row = 0;
  for (let y = 0; y < h; y += bh, row++) {
    let x = -rnd() * 200;
    while (x < w) {
      const len = 220 + rnd() * 260;
      const tone = LB.boards[Math.floor(rnd() * LB.boards.length)]!;
      g.fillStyle = tone;
      g.fillRect(x, y, len, bh);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x, y, len, bh * 0.35);
      // Grain: long faint lines that bend a little.
      g.lineWidth = 0.8;
      for (let i = 0; i < 7; i++) {
        const gy = y + 4 + rnd() * (bh - 8);
        g.strokeStyle = `rgba(30,28,24,${(0.07 + rnd() * 0.1).toFixed(3)})`;
        g.beginPath();
        g.moveTo(x, gy);
        const bend = (rnd() - 0.5) * 3;
        g.bezierCurveTo(x + len * 0.3, gy + bend, x + len * 0.7, gy - bend, x + len, gy + (rnd() - 0.5) * 2);
        g.stroke();
      }
      // Two nails at each end, square heads that have gone dark.
      for (const nx of [x + 10, x + len - 14]) {
        for (const ny of [y + bh * 0.28, y + bh * 0.72]) {
          g.fillStyle = "rgba(30,28,26,0.75)";
          g.fillRect(nx, ny - 1.5, 3, 3);
          g.fillStyle = "rgba(255,255,255,0.16)";
          g.fillRect(nx, ny - 1.5, 3, 1);
        }
      }
      // The joint.
      g.fillStyle = LB.seam;
      g.fillRect(x + len - 1.5, y, 2, bh);
      x += len;
    }
    // The seam under the row, with a pale lip above it.
    g.fillStyle = LB.seam;
    g.fillRect(0, y + bh - 2, w, 2.5);
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.fillRect(0, y + bh - 3.5, w, 1);
  }
  // Dusk toward the corners.
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, "rgba(20,24,26,0)");
  v.addColorStop(1, "rgba(20,24,26,0.5)");
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

/** The coil: turns of rope round the globe, each a dark underlay, a twisted manila lay and a pale highlight. */
function drawCoil(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  const k = coilOf(R);
  ctx.save();
  ctx.lineCap = "butt";
  for (let i = 0; i < k.turns; i++) {
    const r = k.inner + k.width * (i + 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = LB.ropeDark;
    ctx.lineWidth = k.width + 1.5;
    ctx.stroke();
    ctx.strokeStyle = LB.rope;
    ctx.lineWidth = k.width - 1.5;
    ctx.stroke();
    // The lay of the strands: short dashes across the rope, each ring offset from the last.
    ctx.strokeStyle = "rgba(90,74,46,0.5)";
    ctx.lineWidth = k.width - 1.5;
    ctx.setLineDash([1.6, k.width * 0.42]);
    ctx.lineDashOffset = i * 2.1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r - k.width * 0.22, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(f: SurfaceFrame, c: LobsterCache) {
  const { ctx, w, h, dpr, proj } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  // The boards, kept as one picture per size.
  const dk = `${w}x${h}x${dpr}`;
  if (c.dockKey !== dk || !c.dock) {
    const [cv, g] = offscreen(w, h, dpr);
    paintDock(g, w, h);
    c.dock = cv;
    c.dockKey = dk;
  }
  ctx.drawImage(c.dock, 0, 0, w, h);

  // Pieces first, so the coil and the ball are always over them and never under a piece.
  const pk = `${w}|${h}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  if (c.piecesKey !== pk) {
    c.pieces = placeDock(w, h, cx, cy, R);
    c.piecesKey = pk;
  }
  for (const p of c.pieces) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.u, p.u);
    ctx.save();
    ctx.translate(0.07, 0.09);
    drawShape(ctx, p.kind, p.u, "rgba(10,12,12,0.3)");
    ctx.restore();
    drawShape(ctx, p.kind, p.u);
    ctx.restore();
  }

  drawCoil(ctx, cx, cy, R);

  // The ball's shadow on the boards, inside the coil, then the ball.
  const sh = ctx.createRadialGradient(cx + R * 0.05, cy + R * 0.07, R * 0.86, cx + R * 0.05, cy + R * 0.07, R * 1.07);
  sh.addColorStop(0, "rgba(10,14,16,0.5)");
  sh.addColorStop(1, "rgba(10,14,16,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(cx + R * 0.05, cy + R * 0.07, R * 1.07, 0, TAU);
  ctx.fill();

  const ball = new Path2D();
  ball.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = LB.deep;
  ctx.fill(ball);
  ctx.save();
  ctx.clip(ball);
  paintWorld(f, true, c.grid);
  const rim = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.4, cx, cy, R);
  rim.addColorStop(0, "rgba(255,255,255,0.08)");
  rim.addColorStop(0.7, "rgba(30,60,70,0.1)");
  rim.addColorStop(1, "rgba(25,50,60,0.5)");
  ctx.fillStyle = rim;
  ctx.fill(ball);
  ctx.restore();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = LB.coast;
  ctx.stroke(ball);
}

// ---- Map view: the sheet -------------------------------------------------------------------------------------------------

function drawSheet(f: SurfaceFrame, c: LobsterCache) {
  const { ctx, w, h } = f;
  ctx.fillStyle = LB.deep;
  ctx.fillRect(0, 0, w, h);
  paintWorld(f, false, c.grid);
}

/** What Lobster keeps between frames: the boards as one picture, and where the pieces lie for the size they were laid for. */
export class LobsterCache {
  dock?: HTMLCanvasElement;
  dockKey = "";
  pieces: Piece[] = [];
  piecesKey = "";
  grid = new PlaceGrid();
}

export function drawLobster(f: SurfaceFrame, cache: LobsterCache) {
  if (f.mode === "3d") drawBall(f, cache);
  else drawSheet(f, cache);
}
