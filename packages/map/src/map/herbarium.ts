// Garden (id herbarium, formerly Herbarium): a very detailed, whimsical garden, a bright meadow town of
// flower beds under a soft sky. Everything is our own drawing of ordinary flowers, leaves and small animals.
//
// The land is a flower meadow. Under it lie big overlapping patches of green, then small flowers and grass tufts, then
// larger things: clumps of flowers on stems, bushes in bloom, ferns, big leaves, mossy mounds. All of it sits on
// jittered grids of longitude and latitude whose step follows the zoom, so the texture is tied to the world and cut by
// the coastline. A cell's greens and its flowers come from its latitude band (blended over about ten degrees), the
// relief layer's mountains and the ice, and a fixed hash; never from any political unit. No green is red, and the
// red-ish flowers are few and small, so no region reads red.
//
// The sea is calm sky-water: a pale turquoise that deepens toward the bottom, soft light, glints and ripples on the
// world's grid, paler shallows with ripple lines round every coast and, near coasts, a few light reeds and small pads.
// At fixed open-sea spots (`SPOTS`, test/herbarium.test.ts) float small islets of grass and flowers with an animal of
// our own drawing on each, a pond with a dragonfly, butterflies or bees, each drawn inside the open water round its
// spot and nowhere else, so nothing comes near land or a place. In Globe view the world is a small garden planet in a
// soft sky, with giant flowers, a leafy planet with a ring of petals and a flowering planetoid laid round it, sized to
// the room left and left out when there is too little, never over the ball, the Key or the zoom buttons (`placeAround`).
//
// Gentle motion, at about eleven frames a second, never in a hidden tab and none for reduced motion (the view and
// `ambient.ts` hold it): butterflies flutter, bees circle, a dragonfly hovers, petals drift and giant flowers sway,
// each inside its own tested circle; stars in the globe's sky twinkle slowly. Nothing flashes (`twinkle`, tested).
// The still picture is kept and only what moves is redrawn. Markers never move with it, and there is no text on the
// canvas. The view draws markers as usual and this file only adds each one's soft shadow under it.

import { geoPath } from "d3-geo";
import { motionTime, StillLayer, stillMotion } from "./ambient.ts";
import { clamp, fromCentre, landPaths, pxPerDeg, RAD, type SeaSpot, wideCoast } from "./handmade.ts";
import { hash2, offscreen, pathContext, type SurfaceFrame, type SurfaceResult, type SurfaceSpot } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;
const TAU = Math.PI * 2;

// ---- Colours --------------------------------------------------------------------------------------------------------

/** The greens a patch of ground can be, from the Equator to the poles. None of them is red. */
export const GROUND = {
  emerald: "#55b45a",
  fern: "#3f9a52",
  lime: "#9ad063",
  meadow: "#86c65f",
  clover: "#62ab55",
  gold: "#c4d46a",
  straw: "#d8d98a",
  mint: "#7cc4a0",
  teal: "#58a98a",
  frost: "#d9eee6",
  snow: "#f0f8f4",
  moss: "#6f9a55",
  hill: "#89ab62",
} as const;
export type Ground = keyof typeof GROUND;

export type FloraKind = "daisy" | "poppy" | "tulip" | "bluebell" | "clover" | "lavender" | "sunflower" | "blossom" | "orchid" | "forgetmenot" | "snowdrop" | "tuft" | "frost";
export type FeatureKind = "bush" | "fern" | "leaf" | "clump" | "none";

/** One flower's colours, each with its share. Red-ish ones are rare and small on purpose. */
type Palette = readonly (readonly [string, number])[];
export const PALETTES: Record<Exclude<FloraKind, "tuft" | "frost">, Palette> = {
  daisy: [["#ffffff", 0.6], ["#fff3c4", 0.2], ["#ffe3f0", 0.2]],
  poppy: [["#f7a23b", 0.4], ["#f27fa9", 0.32], ["#f9d24c", 0.2], ["#e9735a", 0.08]],
  tulip: [["#f4a6c6", 0.26], ["#f8d24a", 0.24], ["#f6a14a", 0.18], ["#b58be0", 0.16], ["#fff1d6", 0.12], ["#e86d88", 0.04]],
  bluebell: [["#6f8de8", 0.4], ["#8a7be0", 0.3], ["#5aa2e6", 0.3]],
  clover: [["#e9a8d4", 0.5], ["#f6e1f0", 0.3], ["#ffffff", 0.2]],
  lavender: [["#a98be0", 0.4], ["#8f78d4", 0.3], ["#c1a8ee", 0.3]],
  sunflower: [["#f9c825", 0.6], ["#f7b52c", 0.4]],
  blossom: [["#ffd1e3", 0.35], ["#ffffff", 0.25], ["#ffe27a", 0.25], ["#d9c4f5", 0.15]],
  orchid: [["#e45fa8", 0.3], ["#f08ac0", 0.3], ["#f6a04a", 0.15], ["#ffd35a", 0.15], ["#b77be0", 0.1]],
  forgetmenot: [["#9ccaf5", 0.6], ["#b9dcf7", 0.4]],
  snowdrop: [["#ffffff", 0.7], ["#eaf6fb", 0.3]],
};

/** Whether a #rrggbb colour reads as red: the garden keeps these to a few small flowers. */
export function isReddish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return (n >> 16) >= 200 && ((n >> 8) & 255) <= 125 && (n & 255) <= 125;
}

interface Band {
  /** The band's upper edge, in degrees from the Equator. */
  to: number;
  ground: readonly (readonly [Ground, number])[];
  flora: readonly (readonly [FloraKind, number])[];
  feature: readonly (readonly [FeatureKind, number])[];
  /** Bushes and big leaves: dark, middle and light. */
  bush: readonly [string, string, string];
}

/**
 * Latitude bands by their upper edge: lush greens and orchids near the Equator, golden-green with sunflowers and
 * poppies in the warm belts, a flower meadow of daisies, tulips and clover in the middle latitudes, cool blue-greens
 * with bluebells and lavender further out, pale frosted green and snowdrops toward the poles. Only latitude.
 */
export const BANDS: readonly Band[] = [
  {
    to: 14,
    ground: [["emerald", 0.35], ["fern", 0.3], ["lime", 0.25], ["meadow", 0.1]],
    flora: [["orchid", 0.2], ["blossom", 0.16], ["poppy", 0.12], ["daisy", 0.08], ["clover", 0.1], ["tuft", 0.34]],
    feature: [["leaf", 0.36], ["fern", 0.2], ["bush", 0.22], ["clump", 0.22]],
    bush: ["#2f8a4c", "#3f9f55", "#5bb862"],
  },
  {
    to: 33,
    ground: [["gold", 0.35], ["lime", 0.25], ["straw", 0.2], ["meadow", 0.2]],
    flora: [["sunflower", 0.12], ["poppy", 0.2], ["daisy", 0.12], ["lavender", 0.12], ["blossom", 0.1], ["tuft", 0.34]],
    feature: [["bush", 0.34], ["clump", 0.4], ["fern", 0.1], ["leaf", 0.16]],
    bush: ["#6f9a40", "#82ae4c", "#9cc45c"],
  },
  {
    to: 52,
    ground: [["meadow", 0.4], ["lime", 0.25], ["clover", 0.2], ["emerald", 0.15]],
    flora: [["daisy", 0.2], ["tulip", 0.14], ["poppy", 0.12], ["clover", 0.16], ["bluebell", 0.1], ["lavender", 0.06], ["tuft", 0.22]],
    feature: [["bush", 0.4], ["clump", 0.38], ["fern", 0.22]],
    bush: ["#3f8f4d", "#4fa253", "#62b45b"],
  },
  {
    to: 66,
    ground: [["mint", 0.35], ["teal", 0.3], ["clover", 0.2], ["meadow", 0.15]],
    flora: [["bluebell", 0.22], ["lavender", 0.14], ["daisy", 0.14], ["forgetmenot", 0.14], ["clover", 0.1], ["tuft", 0.26]],
    feature: [["fern", 0.34], ["bush", 0.34], ["clump", 0.32]],
    bush: ["#3a8570", "#4a9a80", "#62b094"],
  },
  {
    to: 91,
    ground: [["frost", 0.45], ["mint", 0.25], ["snow", 0.2], ["teal", 0.1]],
    flora: [["snowdrop", 0.25], ["forgetmenot", 0.2], ["daisy", 0.15], ["tuft", 0.4]],
    feature: [["bush", 0.4], ["fern", 0.3], ["clump", 0.3]],
    bush: ["#5aa08c", "#78b8a2", "#9ccfbb"],
  },
];
const MOUNTAIN_GROUND: readonly (readonly [Ground, number])[] = [["moss", 0.45], ["hill", 0.35], ["clover", 0.2]];
const MOUNTAIN_FLORA: readonly (readonly [FloraKind, number])[] = [["tuft", 0.5], ["bluebell", 0.15], ["daisy", 0.15], ["forgetmenot", 0.2]];
const ICE_GROUND: readonly (readonly [Ground, number])[] = [["snow", 0.6], ["frost", 0.4]];
/** How far the bands blend into each other, in degrees of latitude. */
export const BLEND = 10;

function pick<T>(mix: readonly (readonly [T, number])[], h: number): T {
  let acc = 0;
  for (const [v, share] of mix) {
    acc += share;
    if (h < acc) return v;
  }
  return mix[mix.length - 1]![0];
}

/** The band a latitude falls in once the first hash has moved its edge by up to half of `BLEND` either way. */
export function bandOf(lat: number, h1: number): Band {
  const a = Math.abs(lat) + (h1 - 0.5) * BLEND;
  return BANDS.find((b) => a < b.to) ?? BANDS[BANDS.length - 1]!;
}

/**
 * A patch's green from its latitude, whether it lies on a mountain or on ice, and two fixed hashes in [0, 1). The
 * first hash moves a band's edge, so neighbouring bands mix over about ten degrees instead of meeting at a line.
 */
export function groundAt(lat: number, h1: number, h2: number, mountain: boolean, ice: boolean): Ground {
  if (ice) return pick(ICE_GROUND, h2);
  if (mountain) return pick(MOUNTAIN_GROUND, h2);
  return pick(bandOf(lat, h1).ground, h2);
}

/** What grows in a cell: the same rules as the ground, from latitude, relief and ice only. */
export function floraAt(lat: number, h1: number, h2: number, mountain: boolean, ice: boolean): FloraKind {
  if (ice) return "frost";
  if (mountain) return pick(MOUNTAIN_FLORA, h2);
  return pick(bandOf(lat, h1).flora, h2);
}

/** The larger thing in a cell of the feature grid. */
export function featureAt(lat: number, h1: number, h2: number, mountain: boolean, ice: boolean): FeatureKind {
  if (ice) return "none";
  if (mountain) return h2 < 0.5 ? "none" : "clump";
  return pick(bandOf(lat, h1).feature, h2);
}

// ---- The grids ------------------------------------------------------------------------------------------------------

/** Grid steps in degrees, each dividing 180, so a cell stays at the same place on the world at a given step. */
const STEPS = [0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 30] as const;

/** The grid step that makes a cell about `px` pixels across on screen at `pxDeg` pixels per degree. */
export function gridStep(pxDeg: number, px = 20): number {
  const want = px / Math.max(1e-6, pxDeg);
  for (const s of STEPS) if (s >= want) return s;
  return STEPS[STEPS.length - 1]!;
}

/** One cell of a grid: where it lies (lon, lat), its turn, its size, a kind number and three hashes. */
export interface Cell {
  lon: number;
  lat: number;
  turn: number;
  size: number;
  h1: number;
  h2: number;
  h3: number;
}

/** The cell (i, j) at a step: always the same for the same step, cell and salt, so the garden is tied to the world. */
export function cellAt(step: number, i: number, j: number, salt = 0): Cell {
  const a = hash2(i * 7 + 3 + salt, j * 13 + 1 + salt * 2);
  const b = hash2(i * 11 + 5 + salt * 3, j * 3 + 7);
  const c = hash2(i * 5 + 9, j * 17 + 2 + salt);
  const d = hash2(i * 19 + 1 + salt, j * 7 + 11);
  return {
    lon: (i + 0.5 + (a - 0.5) * 0.8) * step - 180,
    lat: (j + 0.5 + (b - 0.5) * 0.8) * step - 90,
    turn: c * TAU,
    size: 0.7 + d * 0.45,
    h1: hash2(i * 3 + 17 + salt, j * 5 + 29),
    h2: hash2(i * 23 + 41, j * 29 + 3 + salt * 5),
    h3: hash2(i * 31 + 7 + salt * 2, j * 37 + 13),
  };
}

/** The span of longitude (from the view's centre) and latitude the frame can show, a step wider all round. */
function visibleBox(f: SurfaceFrame, step: number): { lat0: number; lat1: number; dl: number } {
  const R = f.proj.scale();
  if (f.mode === "3d") {
    const reach = Math.hypot(f.w, f.h) / 2;
    const a = reach >= R ? 90 : Math.asin(reach / R) / RAD;
    const lat0 = Math.max(-90, f.lat - a - step), lat1 = Math.min(90, f.lat + a + step);
    const edge = Math.max(Math.abs(lat0), Math.abs(lat1));
    const dl = edge >= 89 || a >= 89 ? 180 : Math.min(180, a / Math.cos(edge * RAD) + step * 2);
    return { lat0, lat1, dl };
  }
  let lat0 = 90, lat1 = -90, dl = 0;
  const inv = f.proj.invert!;
  for (let k = 0; k <= 12; k++) {
    for (const [x, y] of [
      [(f.w * k) / 12, 0],
      [(f.w * k) / 12, f.h],
      [0, (f.h * k) / 12],
      [f.w, (f.h * k) / 12],
    ] as const) {
      const q = inv([x, y]);
      if (!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      lat0 = Math.min(lat0, q[1]);
      lat1 = Math.max(lat1, q[1]);
      dl = Math.max(dl, Math.abs(((q[0] - f.lon + 540) % 360) - 180));
    }
  }
  if (lat1 < lat0) return { lat0: -90, lat1: 90, dl: 180 };
  return { lat0: Math.max(-90, lat0 - step), lat1: Math.min(90, lat1 + step), dl: f.zoom < 1.8 ? 180 : Math.min(180, dl + step * 2) };
}

/**
 * Calls `visit` for every cell of a grid in view, with its screen position and its width on screen. On the globe,
 * cells on the far side are left out and the rest shrink toward the rim, where the ball's surface turns away.
 */
function eachCell(f: SurfaceFrame, step: number, salt: number, pad: number, visit: (c: Cell, i: number, j: number, x: number, y: number, cellPx: number) => void) {
  const pxDeg = pxPerDeg(f.proj);
  const box = visibleBox(f, step);
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const j0 = Math.floor((box.lat0 + 90) / step), j1 = Math.ceil((box.lat1 + 90) / step);
  const cols = Math.round(360 / step);
  const iMid = Math.floor((f.lon + 180) / step);
  const half = Math.ceil(box.dl / step) + 1;
  const span = Math.min(cols, half * 2 + 1);
  for (let j = j0; j <= j1; j++) {
    for (let k = 0; k < span; k++) {
      const i = (((iMid - Math.floor(span / 2) + k) % cols) + cols) % cols;
      const c = cellAt(step, i, j, salt);
      if (c.lat < -90 || c.lat > 90) continue;
      let fore = 1;
      if (globe) {
        const a = c.lat * RAD, b = f.lat * RAD;
        const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((c.lon - f.lon) * RAD);
        if (cosc < 0.02) continue;
        fore = Math.max(0.35, Math.sqrt(cosc));
      }
      const q = f.proj([c.lon, c.lat]);
      if (!q) continue;
      const cellPx = step * pxDeg * fore;
      const m = cellPx * pad;
      if (q[0] < -m || q[1] < -m || q[0] > f.w + m || q[1] > f.h + m) continue;
      if (globe && Math.hypot(q[0] - cx, q[1] - cy) > R + m) continue;
      visit(c, i, j, q[0], q[1], cellPx);
    }
  }
}

/** The grid cells (at `step`) that hold one of the relief layer's mountains, kept per step while the relief is the same. */
function mountainCells(f: SurfaceFrame, cache: HerbariumCache, step: number, reach = 1): Set<number> {
  let held = cache.peaks;
  if (!held || held.of !== f.relief) cache.peaks = held = { of: f.relief, steps: new Map() };
  const steps = held.steps;
  const mapKey = step * 10 + reach / 10;
  const hit = steps.get(mapKey);
  if (hit) return hit;
  const cells = new Set<number>();
  for (const [lon, lat] of f.relief?.peaks ?? []) {
    const i = Math.floor((lon + 180) / step), j = Math.floor((lat + 90) / step);
    // A mountain covers its own cell and the one on either side, so a range reads as a band rather than single hills.
    for (let a = -reach; a <= reach; a++) cells.add((i + a) * 4096 + j);
  }
  steps.set(mapKey, cells);
  return cells;
}

// ---- Drawing flowers in batches --------------------------------------------------------------------------------------

const GREEN = { deep: "#2f8a4c", mid: "#58b45a", light: "#86cf6a", lime: "#a9dc6c", leaf: "#6bbd5e" } as const;

function grab(m: Map<string, Path2D>, c: string): Path2D {
  let p = m.get(c);
  if (!p) m.set(c, (p = new Path2D()));
  return p;
}

/** Many flowers' parts gathered by colour and drawn in a few fills, so a bed of thousands costs little. */
class Batch {
  stem = new Path2D();
  veins = new Path2D();
  shadow = new Path2D();
  private leaves = new Map<string, Path2D>();
  private petals = new Map<string, Path2D>();
  private centres = new Map<string, Path2D>();
  private blades = new Map<string, Path2D>();
  leaf(c: string) {
    return grab(this.leaves, c);
  }
  petal(c: string) {
    return grab(this.petals, c);
  }
  centre(c: string) {
    return grab(this.centres, c);
  }
  blade(c: string) {
    return grab(this.blades, c);
  }
  /** Draws everything: `k` is the length of one pixel in the current units. */
  flush(g: CanvasRenderingContext2D, k = 1, outline = true) {
    g.lineJoin = "round";
    g.lineCap = "round";
    g.fillStyle = "rgba(30,84,46,0.2)";
    g.fill(this.shadow);
    g.lineWidth = 1.2 * k;
    for (const [c, p] of this.blades) {
      g.strokeStyle = c;
      g.stroke(p);
    }
    g.lineWidth = 1.1 * k;
    g.strokeStyle = "rgba(52,128,62,0.92)";
    g.stroke(this.stem);
    g.lineWidth = 0.6 * k;
    for (const [c, p] of this.leaves) {
      g.fillStyle = c;
      g.fill(p);
      g.strokeStyle = "rgba(24,88,48,0.42)";
      g.stroke(p);
    }
    g.lineWidth = 0.5 * k;
    g.strokeStyle = "rgba(24,88,48,0.38)";
    g.stroke(this.veins);
    g.lineWidth = 0.55 * k;
    for (const [c, p] of this.petals) {
      g.fillStyle = c;
      g.fill(p);
      if (!outline) continue;
      g.strokeStyle = "rgba(120,72,96,0.32)";
      g.stroke(p);
    }
    for (const [c, p] of this.centres) {
      g.fillStyle = c;
      g.fill(p);
    }
  }
}

/** A leaf's outline into `p`: base at -s, tip at +s along the turn, `wd` its width for its length. */
function leafOutline(p: Path2D, x: number, y: number, turn: number, s: number, wd: number) {
  const c = Math.cos(turn) * s, sn = Math.sin(turn) * s;
  const w1 = wd * 1.45, w2 = wd * 1.25;
  p.moveTo(x - c, y - sn);
  p.bezierCurveTo(x - 0.7 * c + w1 * sn, y - 0.7 * sn - w1 * c, x + 0.45 * c + w2 * sn, y + 0.45 * sn - w2 * c, x + c, y + sn);
  p.bezierCurveTo(x + 0.45 * c - w2 * sn, y + 0.45 * sn + w2 * c, x - 0.7 * c - w1 * sn, y - 0.7 * sn + w1 * c, x - c, y - sn);
  p.closePath();
}

/** A leaf's midrib and, when large enough, its side veins into `p`. */
function leafVeins(p: Path2D, x: number, y: number, turn: number, s: number, wd: number, fine = true) {
  const c = Math.cos(turn), sn = Math.sin(turn);
  const at = (u: number, v: number): [number, number] => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
  const m0 = at(-1.1, 0), m1 = at(0.85, 0);
  p.moveTo(m0[0], m0[1]);
  p.lineTo(m1[0], m1[1]);
  if (!fine) return;
  for (const u of [-0.5, -0.05, 0.38]) {
    const o = at(u, 0);
    for (const side of [-1, 1]) {
      const e = at(u + 0.32, side * wd * 0.8);
      p.moveTo(o[0], o[1]);
      p.lineTo(e[0], e[1]);
    }
  }
}

function disc(p: Path2D, x: number, y: number, r: number) {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

function ellipsePath(p: Path2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  p.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  p.ellipse(x, y, rx, ry, rot, 0, TAU);
}

/** `n` petals round a centre, each a leaf shape from `r0` to `r1` out. */
function petalRing(p: Path2D, x: number, y: number, n: number, r0: number, r1: number, wd: number, turn: number) {
  const mid = (r0 + r1) / 2, half = (r1 - r0) / 2;
  for (let i = 0; i < n; i++) {
    const a = turn + (i * TAU) / n;
    leafOutline(p, x + Math.cos(a) * mid, y + Math.sin(a) * mid, a, half, wd);
  }
}

/** A four-pointed glint with concave sides. */
function sparkle(p: Path2D, x: number, y: number, r: number) {
  const q = r * 0.22;
  p.moveTo(x, y - r);
  p.lineTo(x + q, y - q);
  p.lineTo(x + r, y);
  p.lineTo(x + q, y + q);
  p.lineTo(x, y + r);
  p.lineTo(x - q, y + q);
  p.lineTo(x - r, y);
  p.lineTo(x - q, y - q);
  p.closePath();
}

const colourOf = (pal: Palette, h: number) => pick(pal, h);

type FlowerFn = (b: Batch, x: number, y: number, s: number, t: number, h: number) => void;

const daisy: FlowerFn = (b, x, y, s, t, h) => {
  petalRing(b.petal(colourOf(PALETTES.daisy, h)), x, y, 10, s * 0.22, s, 0.26, t);
  disc(b.centre("#f5c02e"), x, y, s * 0.3);
};

const poppy: FlowerFn = (b, x, y, s, t, h) => {
  petalRing(b.petal(colourOf(PALETTES.poppy, h)), x, y, 5, s * 0.05, s, 0.95, t);
  disc(b.centre("#efe38a"), x, y, s * 0.2);
};

const blossom: FlowerFn = (b, x, y, s, t, h) => {
  petalRing(b.petal(colourOf(PALETTES.blossom, h)), x, y, 5, s * 0.1, s, 0.95, t);
  disc(b.centre("#f2b632"), x, y, s * 0.2);
};

const orchid: FlowerFn = (b, x, y, s, t, h) => {
  const c = colourOf(PALETTES.orchid, h);
  petalRing(b.petal(c), x, y, 5, s * 0.05, s, 0.8, t);
  petalRing(b.petal("#fff0f6"), x, y, 3, s * 0.05, s * 0.5, 0.6, t + 0.6);
  disc(b.centre("#f5c43a"), x, y, s * 0.13);
};

const forgetmenot: FlowerFn = (b, x, y, s, t, h) => {
  petalRing(b.petal(colourOf(PALETTES.forgetmenot, h)), x, y, 5, s * 0.1, s * 0.9, 1, t);
  disc(b.centre("#f7d94c"), x, y, s * 0.2);
};

const sunflower: FlowerFn = (b, x, y, s, t, h) => {
  petalRing(b.petal(colourOf(PALETTES.sunflower, h)), x, y, 13, s * 0.45, s, 0.3, t);
  petalRing(b.petal("#e8a41c"), x, y, 13, s * 0.4, s * 0.82, 0.3, t + TAU / 26);
  disc(b.centre("#8d5a2b"), x, y, s * 0.46);
  disc(b.centre("#b57b3a"), x, y, s * 0.26);
};

const clover: FlowerFn = (b, x, y, s, t, h) => {
  for (let i = 0; i < 3; i++) {
    const a = t + (i * TAU) / 3 + Math.PI / 2;
    ellipsePath(b.leaf(GREEN.leaf), x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55 + s * 0.2, s * 0.5, s * 0.4, a);
  }
  petalRing(b.petal(colourOf(PALETTES.clover, h)), x, y - s * 0.1, 8, s * 0.05, s * 0.45, 0.55, t);
};

const tulip: FlowerFn = (b, x, y, s, t, h) => {
  const c = colourOf(PALETTES.tulip, h);
  const lean = Math.sin(t) * 0.25;
  const bx = x - Math.sin(lean) * s * 1.5, by = y + Math.cos(lean) * s * 1.5;
  b.stem.moveTo(bx, by);
  b.stem.lineTo(x, y + s * 0.3);
  for (const sd of [-1, 1]) {
    const a = -Math.PI / 2 + sd * 0.75 + lean * 0.5;
    leafOutline(b.leaf(GREEN.light), bx + Math.cos(a) * s * 0.55, by + Math.sin(a) * s * 0.55, a, s * 0.55, 0.3);
  }
  const half = s * 0.62;
  for (const da of [0, -0.55, 0.55]) {
    const a = -Math.PI / 2 + lean + da;
    leafOutline(b.petal(c), x + Math.cos(a) * half, y + s * 0.3 + Math.sin(a) * half, a, half, 0.62);
  }
};

const bluebell: FlowerFn = (b, x, y, s, t, h) => {
  const c = colourOf(PALETTES.bluebell, h);
  const dir = Math.cos(t) < 0 ? -1 : 1;
  const p0: [number, number] = [x - dir * s * 0.2, y + s * 1.3];
  const cp: [number, number] = [x + dir * s * 0.6, y - s * 0.1];
  const p1: [number, number] = [x + dir * s * 0.45, y - s * 0.95];
  b.stem.moveTo(...p0);
  b.stem.quadraticCurveTo(...cp, ...p1);
  for (const u of [0.5, 0.68, 0.86]) {
    const v = 1 - u;
    const px = v * v * p0[0] + 2 * v * u * cp[0] + u * u * p1[0];
    const py = v * v * p0[1] + 2 * v * u * cp[1] + u * u * p1[1];
    const a = Math.PI / 2 - dir * 0.5;
    leafOutline(b.petal(c), px + Math.cos(a) * s * 0.28, py + Math.sin(a) * s * 0.28, a, s * 0.3, 0.8);
  }
  leafOutline(b.leaf(GREEN.light), p0[0] + dir * s * 0.1, p0[1] - s * 0.35, -Math.PI / 2 + dir * 0.5, s * 0.6, 0.2);
};

const lavender: FlowerFn = (b, x, y, s, t, h) => {
  const c = colourOf(PALETTES.lavender, h);
  const lean = Math.sin(t) * 0.18 * s;
  b.stem.moveTo(x - lean, y + s * 1.3);
  b.stem.lineTo(x + lean * 0.4, y - s * 0.1);
  for (let i = 0; i < 7; i++) {
    const yy = y - s * 0.95 + i * s * 0.12;
    const side = i % 2 ? 1 : -1;
    const a = -Math.PI / 2 + side * 0.7;
    leafOutline(b.petal(c), x + side * s * 0.1 + lean * 0.4, yy, a, s * 0.2, 0.5);
  }
  leafOutline(b.petal(c), x + lean * 0.4, y - s * 1.05, -Math.PI / 2, s * 0.2, 0.5);
};

const snowdrop: FlowerFn = (b, x, y, s, t, h) => {
  const c = colourOf(PALETTES.snowdrop, h);
  const dir = Math.cos(t) < 0 ? -1 : 1;
  b.stem.moveTo(x - dir * s * 0.1, y + s * 1.2);
  b.stem.quadraticCurveTo(x - dir * s * 0.1, y - s * 0.4, x + dir * s * 0.2, y - s * 0.5);
  leafOutline(b.petal(c), x + dir * s * 0.25, y - s * 0.2, Math.PI / 2 + dir * 0.2, s * 0.42, 0.75);
  leafOutline(b.leaf(GREEN.light), x - dir * s * 0.35, y + s * 0.7, -Math.PI / 2 - dir * 0.4, s * 0.55, 0.2);
};

const frost: FlowerFn = (b, x, y, s) => {
  sparkle(b.petal("#ffffff"), x, y, s * 0.6);
};

/** A tuft of grass: three to five blades leaning out from one point, in two greens. */
function tuft(b: Batch, x: number, y: number, s: number, t: number, h: number, pale: boolean) {
  const c = pale ? (h < 0.5 ? "#a9d6c3" : "#c4e6d6") : h < 0.5 ? "#3f9a52" : "#6fbf62";
  const p = b.blade(c);
  const n = 3 + Math.floor(h * 3);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42 + Math.sin(t + i) * 0.1;
    const len = s * (1.1 + ((i * 37) % 5) * 0.12);
    p.moveTo(x, y + s * 0.5);
    p.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + s * 0.5 + Math.sin(a) * len * 0.6, x + Math.cos(a) * len * 0.9 + Math.sin(t) * s * 0.2, y + s * 0.5 + Math.sin(a) * len);
  }
}

const FLOWERS: Record<Exclude<FloraKind, "tuft">, FlowerFn> = { daisy, poppy, blossom, orchid, forgetmenot, sunflower, clover, tulip, bluebell, lavender, snowdrop, frost };

/** One small flower or tuft of a kind, at (x, y) with radius s. */
function drawFlora(b: Batch, kind: FloraKind, x: number, y: number, s: number, t: number, h: number, pale: boolean) {
  if (kind === "tuft") tuft(b, x, y, s, t, h, pale);
  else FLOWERS[kind](b, x, y, s, t, h);
}

/** A flower on a stem with a leaf, for the flowers that grow as a bare head. */
const HEADS = new Set<FloraKind>(["daisy", "poppy", "blossom", "orchid", "forgetmenot", "sunflower", "clover"]);
function stemmed(b: Batch, kind: FloraKind, x: number, y: number, s: number, t: number, h: number) {
  if (HEADS.has(kind)) {
    const lean = Math.sin(t) * 0.5 * s;
    b.stem.moveTo(x + lean, y + s * 2.1);
    b.stem.quadraticCurveTo(x + lean * 0.2, y + s * 1.1, x, y + s * 0.3);
    leafOutline(b.leaf(GREEN.mid), x + lean * 0.6 + s * 0.5, y + s * 1.5, -0.5, s * 0.55, 0.28);
    leafOutline(b.leaf(GREEN.light), x + lean * 0.8 - s * 0.45, y + s * 1.75, Math.PI + 0.5, s * 0.5, 0.28);
  }
  drawFlora(b, kind, x, y, s, t, h, false);
}

/** A frond: a curved stalk with paired leaflets shortening toward the tip. */
function frond(b: Batch, x: number, y: number, s: number, t: number, dark: string, light: string) {
  const c = Math.cos(t), sn = Math.sin(t);
  const at = (u: number, v: number): [number, number] => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
  const p0 = at(0, 0.95), cp = at(0.5, 0), p1 = at(-0.1, -0.95);
  b.stem.moveTo(...p0);
  b.stem.quadraticCurveTo(...cp, ...p1);
  const N = 9;
  for (let i = 0; i < N; i++) {
    const u = 0.1 + (i / N) * 0.86, v = 1 - u;
    const qx = v * v * p0[0] + 2 * v * u * cp[0] + u * u * p1[0];
    const qy = v * v * p0[1] + 2 * v * u * cp[1] + u * u * p1[1];
    const dx = 2 * v * (cp[0] - p0[0]) + 2 * u * (p1[0] - cp[0]);
    const dy = 2 * v * (cp[1] - p0[1]) + 2 * u * (p1[1] - cp[1]);
    const a0 = Math.atan2(dy, dx);
    const len = s * 0.5 * (1 - u * 0.75);
    for (const side of [-1, 1]) {
      const a = a0 + side * (1.05 + (i % 2) * 0.08);
      leafOutline(b.leaf(side < 0 ? dark : light), qx + Math.cos(a) * len * 0.5, qy + Math.sin(a) * len * 0.5, a, len * 0.5, 0.32);
    }
  }
}

/** A bush in bloom: round lumps of leaves in three greens, loose leaves over them and blossoms of the cell's flower. */
function bush(b: Batch, x: number, y: number, s: number, t: number, h: number, tones: readonly [string, string, string], flora: FloraKind) {
  ellipsePath(b.shadow, x + s * 0.1, y + s * 0.7, s * 1.05, s * 0.26);
  const lumps: [number, number, number][] = [
    [-0.72, 0.2, 0.4],
    [-0.38, -0.04, 0.48],
    [0.04, -0.2, 0.54],
    [0.44, -0.04, 0.48],
    [0.76, 0.22, 0.38],
    [-0.22, 0.3, 0.44],
    [0.3, 0.32, 0.44],
  ];
  for (const [ox, oy, r] of lumps) ellipsePath(b.leaf(tones[0]), x + ox * s, y + oy * s, r * s, r * s * 0.86);
  for (const [ox, oy, r] of lumps) ellipsePath(b.leaf(tones[1]), x + ox * s - r * s * 0.12, y + oy * s - r * s * 0.14, r * s * 0.72, r * s * 0.62);
  for (const [ox, oy, r] of lumps) ellipsePath(b.leaf(tones[2]), x + ox * s - r * s * 0.26, y + oy * s - r * s * 0.32, r * s * 0.34, r * s * 0.26);
  // Loose leaves over the lumps, so the bush reads as foliage and not as a dome.
  for (let i = 0; i < 9; i++) {
    const q = hash2(i * 3 + h * 50, 5), r = hash2(i * 7 + 2, h * 40);
    leafOutline(b.leaf(i % 3 ? tones[2] : tones[1]), x + (q - 0.5) * s * 1.7, y + (r - 0.62) * s * 0.9, t + i * 1.9, s * 0.15, 0.4);
  }
  const bare = flora === "tuft" || flora === "frost" || flora === "sunflower" || flora === "tulip" || flora === "bluebell" || flora === "lavender" || flora === "snowdrop";
  const kind: FloraKind = bare ? "blossom" : flora;
  for (let i = 0; i < 5; i++) {
    const a = t + i * 1.3;
    drawFlora(b, kind, x + Math.cos(a) * s * (0.2 + ((i * 53) % 5) * 0.12), y - s * 0.12 + Math.sin(a) * s * 0.3, s * 0.26, a, (h + i * 0.23) % 1, false);
  }
}

/** A broad leaf with a midrib and side veins, standing on a short stalk. */
function bigLeaf(b: Batch, x: number, y: number, s: number, t: number, tones: readonly [string, string, string]) {
  const a = -Math.PI / 2 + Math.sin(t) * 0.7;
  leafOutline(b.leaf(tones[1]), x + Math.cos(a) * s * 0.9, y + Math.sin(a) * s * 0.9, a, s * 0.95, 0.46);
  leafOutline(b.leaf(tones[2]), x + Math.cos(a + 0.5) * s * 0.55, y + Math.sin(a + 0.5) * s * 0.55 + s * 0.15, a + 0.5, s * 0.6, 0.34);
  leafVeins(b.veins, x + Math.cos(a) * s * 0.9, y + Math.sin(a) * s * 0.9, a, s * 0.95, 0.46);
}

/** A clump of three or four of the cell's flower on stems, a little taller than the small flowers round it. */
function clump(b: Batch, flora: FloraKind, x: number, y: number, s: number, t: number, h: number) {
  const kind: FloraKind = flora === "tuft" || flora === "frost" ? "daisy" : flora;
  const n = 3 + (h > 0.5 ? 1 : 0);
  ellipsePath(b.shadow, x, y + s * 1.1, s * 1.1, s * 0.3);
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * s * 0.75, oy = Math.abs(i - (n - 1) / 2) * s * 0.28 - s * 0.2;
    stemmed(b, kind, x + ox, y + oy, s * (0.62 - Math.abs(i - (n - 1) / 2) * 0.06), t + i * 1.3, (h + i * 0.31) % 1);
  }
}

// ---- The meadow -----------------------------------------------------------------------------------------------------

/** The land's flowers, from big patches of green down to single blooms, tied to the world's grid. */
function drawMeadow(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D, land: Path2D) {
  const pxDeg = pxPerDeg(f.proj);
  const k = clamp(Math.min(f.w, f.h) / 720, 0.8, 1.15);
  const stepG = gridStep(pxDeg, 34 * k), stepD = gridStep(pxDeg, 17 * k), stepS = gridStep(pxDeg, 15 * k), stepF = gridStep(pxDeg, 50 * k);
  const near = (lon: number, lat: number, d: number) => f.isLand(lon, lat) || f.isLand(lon + d, lat) || f.isLand(lon - d, lat) || f.isLand(lon, lat + d) || f.isLand(lon, lat - d);
  g.save();
  g.clip(land);
  // The ground: big overlapping patches of green that cover every part of the land, then smaller lighter and darker ones.
  const peaksG = mountainCells(f, cache, stepG);
  const patches = new Map<Ground, Path2D>();
  eachCell(f, stepG, 11, 1.2, (c, i, j, x, y, cp) => {
    if (!near(c.lon, c.lat, stepG * 0.5)) return;
    const tone = groundAt(c.lat, c.h1, c.h2, peaksG.has(i * 4096 + j), f.isIce(c.lon, c.lat));
    let p = patches.get(tone);
    if (!p) patches.set(tone, (p = new Path2D()));
    ellipsePath(p, x, y, cp * (0.8 + c.size * 0.2), cp * (0.7 + c.size * 0.15), c.turn);
  });
  for (const [tone, p] of patches) {
    g.fillStyle = GROUND[tone];
    g.fill(p);
  }
  const peaksD = mountainCells(f, cache, stepD);
  const dapples = new Map<Ground, Path2D>();
  eachCell(f, stepD, 23, 1, (c, i, j, x, y, cp) => {
    if (c.h3 < 0.25 || !f.isLand(c.lon, c.lat)) return;
    const tone = groundAt(c.lat, c.h2, c.h1, peaksD.has(i * 4096 + j), f.isIce(c.lon, c.lat));
    let p = dapples.get(tone);
    if (!p) dapples.set(tone, (p = new Path2D()));
    ellipsePath(p, x, y, cp * 0.62 * c.size, cp * 0.4 * c.size, c.turn);
  });
  g.globalAlpha = 0.55;
  for (const [tone, p] of dapples) {
    g.fillStyle = GROUND[tone];
    g.fill(p);
  }
  g.globalAlpha = 1;
  // The small flowers and tufts of grass.
  const small = new Batch();
  const peaksS = mountainCells(f, cache, stepS, 0);
  eachCell(f, stepS, 3, 1.1, (c, i, j, x, y, cp) => {
    if (c.h3 < 0.1 || !f.isLand(c.lon, c.lat)) return;
    const ice = f.isIce(c.lon, c.lat);
    const kind = floraAt(c.lat, c.h1, c.h2, peaksS.has(i * 4096 + j), ice);
    const pale = ice || Math.abs(c.lat) > 62;
    drawFlora(small, kind, x, y, cp * 0.4 * c.size, c.turn, c.h3, pale);
  });
  small.flush(g, 1, false);
  // The larger things: clumps, bushes, ferns, big leaves, and mossy mounds on the mountains.
  const big = new Batch();
  const peaksF = mountainCells(f, cache, stepF, 0);
  const mounds = new Path2D(), moundLight = new Path2D();
  eachCell(f, stepF, 5, 1.2, (c, i, j, x, y, cp) => {
    if (c.h3 > 0.72 || !f.isLand(c.lon, c.lat)) return;
    const mountain = peaksF.has(i * 4096 + j);
    const ice = f.isIce(c.lon, c.lat);
    const kind = featureAt(c.lat, c.h1, c.h2, mountain, ice);
    if (kind === "none") return;
    const s = cp * 0.31 * c.size;
    const band = bandOf(c.lat, c.h1);
    const flora = floraAt(c.lat, c.h2, c.h1, false, false);
    if (mountain) {
      // A mound: a round hill in two greens with a few alpine flowers on top.
      ellipsePath(big.shadow, x + s * 0.1, y + s * 0.62, s * 1.1, s * 0.24);
      ellipsePath(mounds, x, y + s * 0.2, s * 1.05, s * 0.72);
      ellipsePath(moundLight, x - s * 0.28, y - s * 0.12, s * 0.58, s * 0.36);
      tuft(big, x + s * 0.3, y + s * 0.3, s * 0.3, c.turn, c.h3, false);
      tuft(big, x - s * 0.45, y + s * 0.34, s * 0.26, c.turn + 1, c.h2, false);
      drawFlora(big, "forgetmenot", x - s * 0.15, y - s * 0.38, s * 0.2, c.turn, c.h3, false);
      drawFlora(big, "daisy", x + s * 0.3, y - s * 0.15, s * 0.2, c.turn, c.h2, false);
      return;
    }
    if (kind === "bush") bush(big, x, y, s, c.turn, c.h3, band.bush, flora);
    else if (kind === "fern") frond(big, x, y, s * 1.1, c.turn * 0.25 - 0.4, band.bush[0], band.bush[2]);
    else if (kind === "leaf") bigLeaf(big, x, y + s * 0.5, s, c.turn, band.bush);
    else clump(big, flora, x, y, s, c.turn, c.h3);
  });
  g.fillStyle = "#78a85a";
  g.fill(mounds);
  g.strokeStyle = "rgba(40,100,56,0.6)";
  g.lineWidth = 0.8;
  g.stroke(mounds);
  g.fillStyle = "#a8cf7c";
  g.fill(moundLight);
  big.flush(g, 1);
  g.restore();
}

// ---- The sea --------------------------------------------------------------------------------------------------------

/** How big the screen is next to the design's usual 720 pixels, for sizes that should shrink on a phone. */
const screenK = (f: SurfaceFrame) => clamp(Math.min(f.w, f.h) / 720, 0.8, 1.15);

/**
 * Pale shallows round every coast, in four steps, and two thin white ripple lines outside them, the outer one
 * broken: each ring is a wide stroke with a slightly narrower one rubbed out of it on a layer of its own, so only the
 * ring's outer edge is left. The land laid over it hides the half on land.
 */
/**
 * A layer of the frame's size at one pixel per CSS pixel, cleared. The shallows are soft bands and pale rings, the
 * widest strokes on the page (up to 150 px), and at a phone's two or three device pixels per CSS pixel they cost
 * 200 ms a frame while dragging; at one they look the same and cost a fourth to a ninth of that.
 */
function lowLayer(slot: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | undefined, w: number, h: number) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (!slot || slot.canvas.width !== W || slot.canvas.height !== H) {
    const [canvas, g] = offscreen(w, h, 1);
    slot = { canvas, g };
  }
  slot.g.setTransform(1, 0, 0, 1, 0, 0);
  slot.g.globalCompositeOperation = "source-over";
  slot.g.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
  slot.g.lineJoin = "round";
  slot.g.lineCap = "round";
  return slot;
}

function shallows(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D, coast: Path2D) {
  const { w, h } = f;
  const soft = wideCoast(f, coast);
  const k = clamp(0.85 + f.zoom * 0.15, 1, 1.8) * screenK(f);
  const bands = (cache.bands = lowLayer(cache.bands, w, h));
  for (const [d, a] of [
    [32, 0.22],
    [17, 0.28],
    [6, 0.42],
  ] as const) {
    bands.g.strokeStyle = `rgba(226,249,244,${a})`;
    bands.g.lineWidth = d * k * 2;
    bands.g.stroke(soft);
  }
  g.drawImage(bands.canvas, 0, 0, w, h);
  // The rings are cut out of their own layer, so the cut never reaches the bands.
  const { canvas, g: rg } = (cache.rings = lowLayer(cache.rings, w, h));
  for (const [d, dash] of [
    [44, true],
    [28, false],
  ] as const) {
    const at = d * k;
    rg.globalCompositeOperation = "source-over";
    rg.setLineDash(dash ? [7, 7] : []);
    rg.strokeStyle = "rgba(255,255,255,0.7)";
    rg.lineWidth = at * 2 + 1.1;
    rg.stroke(soft);
    rg.setLineDash([]);
    rg.globalCompositeOperation = "destination-out";
    rg.strokeStyle = "#000";
    rg.lineWidth = at * 2 - 1.1;
    rg.stroke(soft);
  }
  rg.globalCompositeOperation = "source-over";
  g.drawImage(canvas, 0, 0, w, h);
}

/** Glints, ripples, and near coasts a few light reeds and small pads with a lily, all on the world's grid. */
function seaGrid(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const pxDeg = pxPerDeg(f.proj);
  const k = screenK(f);
  const step = gridStep(pxDeg, 36 * k);
  const glints = new Path2D(), ripples = new Path2D();
  const b = new Batch();
  const d = step * 0.9;
  eachCell(f, step, 31, 1, (c, _i, _j, x, y, cp) => {
    if (f.isLand(c.lon, c.lat)) return;
    const coastal = f.isLand(c.lon + d, c.lat) || f.isLand(c.lon - d, c.lat) || f.isLand(c.lon, c.lat + d) || f.isLand(c.lon, c.lat - d);
    const s = cp * 0.16 * c.size;
    if (coastal) {
      if (c.h1 < 0.22) {
        // Reeds: a few slender stalks leaning from one point, in a light green.
        for (let i = 0; i < 4; i++) {
          const lean = (i - 1.5) * 0.35 + Math.sin(c.turn) * 0.2;
          b.blade("#6cb86a").moveTo(x, y + s * 0.7);
          b.blade("#6cb86a").quadraticCurveTo(x + lean * s * 1.2, y - s * 0.3, x + lean * s * 2, y - s * (1.7 + (i % 2) * 0.5));
        }
      } else if (c.h2 < 0.2) {
        // A small pad, light green with a notch, and sometimes a pink lily on it.
        const r = s * 1.1, a0 = c.turn;
        const p = b.leaf("#a9dc90");
        p.moveTo(x, y);
        p.arc(x, y, r, a0 + 0.35, a0 + TAU - 0.35);
        p.closePath();
        if (c.h3 < 0.45) petalRing(b.petal("#f7a8cf"), x, y, 6, r * 0.1, r * 0.6, 0.6, c.turn);
        if (c.h3 < 0.45) disc(b.centre("#f6d34a"), x, y, r * 0.14);
      }
      return;
    }
    if (c.h1 < 0.32) sparkle(glints, x, y, s * 0.8);
    else if (c.h1 < 0.58) {
      const w = s * 1.9;
      for (const o of [0, s * 0.7]) {
        ripples.moveTo(x - w + o * 0.4, y + o);
        ripples.quadraticCurveTo(x - w / 2 + o * 0.4, y + o - w * 0.28, x + o * 0.4, y + o);
        ripples.quadraticCurveTo(x + w / 2 + o * 0.4, y + o + w * 0.28, x + w + o * 0.4, y + o);
      }
    }
  });
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fill(glints);
  g.lineWidth = 1.1;
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,255,255,0.62)";
  g.stroke(ripples);
  b.flush(g, 1);
}

/** Soft light on the water: broad pale patches, fixed to the screen like light through a sky. */
function sunlight(g: CanvasRenderingContext2D, w: number, h: number) {
  const patches: [number, number, number, number][] = [
    [0.18, 0.2, 0.42, 0.2],
    [0.7, 0.12, 0.36, 0.16],
    [0.46, 0.55, 0.5, 0.12],
    [0.9, 0.7, 0.4, 0.16],
    [0.1, 0.85, 0.36, 0.14],
  ];
  for (const [fx, fy, fr, a] of patches) {
    const x = fx * w, y = fy * h, r = fr * Math.max(w, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// ---- Fixed open-sea spots: islets, a pond, and small animals of our own drawing ---------------------------------------

export type SpotKind = "rabbit" | "hedgehog" | "snail" | "songbird" | "ladybird" | "butterflies" | "bees" | "pond";

/**
 * The spots at sea with the radius, in degrees, of open water round each (tested like the handmade designs' doodles:
 * the whole circle off land in both basemaps and 3 degrees clear of every place, and no two circles touch). Each is
 * drawn, and everything on it moves, inside a circle a little smaller than its open water, so none reaches land.
 */
export const SPOTS: readonly SeaSpot[] = [
  { kind: "ladybird", lon: -150, lat: -57, r: 16 },
  { kind: "rabbit", lon: -44, lat: 28, r: 14 },
  { kind: "butterflies", lon: 168, lat: 38, r: 13, flip: true },
  { kind: "hedgehog", lon: 82, lat: -20, r: 12 },
  { kind: "bees", lon: -130, lat: 8, r: 11 },
  { kind: "pond", lon: -100, lat: -42, r: 11 },
  { kind: "snail", lon: 102, lat: -54, r: 10, flip: true },
  { kind: "rabbit", lon: -140, lat: 40, r: 10, flip: true },
  { kind: "songbird", lon: 52, lat: -36, r: 9 },
  { kind: "butterflies", lon: -176, lat: 12, r: 9 },
  { kind: "pond", lon: -24, lat: -12, r: 8 },
  { kind: "hedgehog", lon: -44, lat: -42, r: 8, flip: true },
  { kind: "snail", lon: -100, lat: -62, r: 7 },
];
/** How much of a spot's open water the drawing spans, from its centre: the drawing and its motion stay inside this circle. */
export const SPOT_FILL = 0.8;

const OUTLINE = "rgba(84,58,40,0.72)";

function el(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string, stroke?: string, lw = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.stroke();
  }
}

function shape(g: CanvasRenderingContext2D, p: Path2D, fill: string, stroke?: string, lw = 0) {
  g.fillStyle = fill;
  g.fill(p);
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.stroke(p);
  }
}

/** A floating islet of grass in the water, with a few flowers on it, drawn in a unit circle: `px` is one pixel. */
function islet(g: CanvasRenderingContext2D, px: number, flora: readonly FloraKind[], seed: number) {
  g.lineJoin = "round";
  g.lineCap = "round";
  el(g, 0.04, 0.72, 0.84, 0.22, 0, "rgba(36,110,150,0.22)");
  g.lineWidth = px * 1.2;
  g.strokeStyle = "rgba(255,255,255,0.78)";
  g.beginPath();
  g.ellipse(0, 0.66, 0.98, 0.3, 0, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.beginPath();
  g.ellipse(0, 0.68, 0.84, 0.24, 0, 0, TAU);
  g.stroke();
  const under = new Path2D();
  under.moveTo(-0.72, 0.44);
  under.bezierCurveTo(-0.7, 0.72, -0.28, 0.9, 0, 0.92);
  under.bezierCurveTo(0.28, 0.9, 0.7, 0.72, 0.72, 0.44);
  under.closePath();
  shape(g, under, "#a98458", "rgba(96,68,40,0.8)", px * 1.3);
  g.lineWidth = px * 1.1;
  g.strokeStyle = "rgba(96,68,40,0.7)";
  g.beginPath();
  for (const [x, y, dx] of [
    [-0.3, 0.8, -0.05],
    [0, 0.92, 0.02],
    [0.3, 0.82, 0.07],
  ] as const) {
    g.moveTo(x, y);
    g.quadraticCurveTo(x + dx, y + 0.08, x + dx * 1.6, y + 0.18);
  }
  g.stroke();
  el(g, 0, 0.42, 0.74, 0.27, 0, "#8fd466", "#4a9a4b", px * 1.4);
  el(g, -0.1, 0.38, 0.5, 0.15, 0, "rgba(255,255,255,0.22)");
  const b = new Batch();
  const rim = [-0.62, -0.38, -0.12, 0.14, 0.4, 0.62];
  rim.forEach((x, i) => {
    const y = 0.42 + Math.sqrt(Math.max(0, 1 - (x / 0.74) ** 2)) * 0.2;
    const h = hash2(seed + i * 5, i * 3 + 1);
    tuft(b, x, y - 0.05, 0.075, h * 6, h, false);
  });
  flora.forEach((kind, i) => {
    const x = -0.55 + (i * 1.1) / Math.max(1, flora.length - 1);
    const y = 0.4 + Math.sin(i * 2.2 + seed) * 0.06 + 0.05;
    drawFlora(b, kind, x, y, 0.085, i * 1.3 + seed, (hash2(seed, i + 9) + i * 0.17) % 1, false);
  });
  b.flush(g, px);
}

/** A rabbit sitting on the islet, facing right. `t` is the motion clock in seconds. */
function rabbit(g: CanvasRenderingContext2D, px: number, t: number) {
  const lw = px * 1.3;
  const twitch = Math.pow(Math.max(0, Math.sin(t * 0.9)), 8) * 0.14;
  g.lineJoin = "round";
  el(g, -0.43, 0.14, 0.09, 0.09, 0, "#fffaf0", OUTLINE, lw);
  el(g, -0.04, 0.12, 0.38, 0.27, -0.05, "#d9bf9a", OUTLINE, lw);
  el(g, -0.2, 0.2, 0.2, 0.17, 0, "#e8d3b0", "rgba(84,58,40,0.35)", lw * 0.7);
  for (const [ex, ey, rot, w] of [
    [0.22, -0.5, -0.1 - twitch, 0.07],
    [0.36, -0.48, 0.14 + twitch, 0.065],
  ] as const) {
    el(g, ex, ey, w, 0.27, rot, "#d9bf9a", OUTLINE, lw);
    el(g, ex, ey + 0.02, w * 0.5, 0.2, rot, "#f2b6c0");
  }
  el(g, 0.3, -0.12, 0.2, 0.17, 0, "#e0c8a2", OUTLINE, lw);
  el(g, 0.22, 0.31, 0.09, 0.05, 0, "#e8d3b0", OUTLINE, lw);
  el(g, 0.4, -0.15, 0.03, 0.035, 0, "#2c2a28");
  el(g, 0.49, -0.09, 0.025, 0.02, 0, "#e98fa3");
  g.lineWidth = px * 0.9;
  g.strokeStyle = "rgba(84,58,40,0.6)";
  g.beginPath();
  g.moveTo(0.5, -0.07);
  g.lineTo(0.5, -0.03);
  g.moveTo(0.5, -0.03);
  g.quadraticCurveTo(0.46, 0, 0.42, -0.01);
  g.stroke();
}

/** A hedgehog on the islet, facing right, its back a dome of spines. */
function hedgehog(g: CanvasRenderingContext2D, px: number, t: number) {
  const lw = px * 1.3;
  g.lineJoin = "round";
  g.lineCap = "round";
  const body = new Path2D();
  body.ellipse(-0.04, 0.16, 0.42, 0.3, 0, Math.PI * 0.95, Math.PI * 2.05);
  body.closePath();
  shape(g, body, "#8b6a4c", OUTLINE, lw);
  g.lineWidth = px * 1.4;
  for (let i = 0; i < 30; i++) {
    const a = Math.PI * (1 + i / 29);
    const cx = -0.04 + Math.cos(a) * 0.4, cy = 0.16 + Math.sin(a) * 0.28;
    g.strokeStyle = i % 2 ? "#5d4631" : "#b08e6a";
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a - 0.2) * 0.11, cy + Math.sin(a - 0.2) * 0.13);
    g.stroke();
  }
  const face = new Path2D();
  face.moveTo(0.3, -0.02);
  face.quadraticCurveTo(0.5, 0.04, 0.6, 0.18 + Math.sin(t * 2) * 0.012);
  face.quadraticCurveTo(0.5, 0.3, 0.3, 0.32);
  face.closePath();
  shape(g, face, "#ebd0a8", OUTLINE, lw);
  el(g, 0.6, 0.18 + Math.sin(t * 2) * 0.012, 0.04, 0.035, 0, "#3a2c24");
  el(g, 0.44, 0.1, 0.03, 0.03, 0, "#2c2a28");
  el(g, 0.1, 0.4, 0.09, 0.05, 0, "#ebd0a8", OUTLINE, lw);
  el(g, -0.3, 0.4, 0.09, 0.05, 0, "#ebd0a8", OUTLINE, lw);
}

/** A snail on the islet: a spiral shell, a pale body and two feelers that sway. */
function snail(g: CanvasRenderingContext2D, px: number, t: number) {
  const lw = px * 1.3;
  g.lineJoin = "round";
  g.lineCap = "round";
  const sway = Math.sin(t * 1.7) * 0.12;
  const bodyP = new Path2D();
  bodyP.moveTo(-0.55, 0.38);
  bodyP.quadraticCurveTo(-0.2, 0.28, 0.2, 0.3);
  bodyP.quadraticCurveTo(0.42, 0.3, 0.46, 0.1);
  bodyP.quadraticCurveTo(0.5, -0.04, 0.58, 0.02);
  bodyP.quadraticCurveTo(0.62, 0.16, 0.6, 0.38);
  bodyP.closePath();
  shape(g, bodyP, "#d9cdb2", OUTLINE, lw);
  g.beginPath();
  for (const s of [-1, 1]) {
    const a = -0.5 + s * 0.35 + sway;
    g.moveTo(0.52 + s * 0.03, 0);
    g.lineTo(0.52 + s * 0.03 + Math.sin(a) * 0.24, -Math.cos(a) * 0.24);
  }
  g.lineWidth = px * 1.2;
  g.strokeStyle = OUTLINE;
  g.stroke();
  for (const s of [-1, 1]) {
    const a = -0.5 + s * 0.35 + sway;
    el(g, 0.52 + s * 0.03 + Math.sin(a) * 0.25, -Math.cos(a) * 0.25, 0.03, 0.03, 0, "#d9cdb2", OUTLINE, px);
  }
  el(g, -0.08, 0.02, 0.34, 0.32, 0, "#ecaa5e", "#9a5f2a", lw);
  g.beginPath();
  const turns = 2.4;
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * turns * TAU, r = 0.03 + (i / 40) * 0.25;
    const x = -0.08 + Math.cos(a) * r, y = 0.02 + Math.sin(a) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.lineWidth = px * 1.7;
  g.strokeStyle = "#a9622b";
  g.stroke();
}

/** A small bird on a flowering branch, facing right: blue back, pale belly, a bobbing head. */
function songbird(g: CanvasRenderingContext2D, px: number, t: number) {
  const lw = px * 1.3;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.lineWidth = px * 3;
  g.strokeStyle = "#8a6a46";
  g.beginPath();
  g.moveTo(-0.7, 0.42);
  g.quadraticCurveTo(0, 0.2, 0.7, 0.3);
  g.stroke();
  const b = new Batch();
  leafOutline(b.leaf(GREEN.light), -0.42, 0.28, -0.7, 0.14, 0.4);
  leafOutline(b.leaf(GREEN.mid), 0.5, 0.2, -2.2, 0.14, 0.4);
  drawFlora(b, "blossom", -0.58, 0.33, 0.07, 0.3, 0.1, false);
  drawFlora(b, "blossom", 0.62, 0.25, 0.07, 0.8, 0.5, false);
  b.flush(g, px);
  const bob = Math.sin(t * 2.6) * 0.03;
  g.lineWidth = px * 1.4;
  g.strokeStyle = "#c58a3a";
  g.beginPath();
  g.moveTo(-0.04, 0.2);
  g.lineTo(-0.04, 0.3);
  g.moveTo(0.08, 0.2);
  g.lineTo(0.08, 0.29);
  g.stroke();
  el(g, -0.34, 0.1, 0.21, 0.05, 0.35, "#4a8bc8", OUTLINE, lw);
  el(g, 0.02, 0.0, 0.27, 0.21, -0.25, "#6fb1e8", OUTLINE, lw);
  el(g, 0.06, 0.07, 0.17, 0.11, -0.25, "#f6e7a6");
  el(g, -0.08, -0.04, 0.17, 0.09, -0.5, "#4a8bc8", OUTLINE, lw * 0.8);
  el(g, 0.22, -0.2 + bob, 0.14, 0.13, 0, "#6fb1e8", OUTLINE, lw);
  const beak = new Path2D();
  beak.moveTo(0.33, -0.23 + bob);
  beak.lineTo(0.46, -0.19 + bob);
  beak.lineTo(0.33, -0.16 + bob);
  beak.closePath();
  shape(g, beak, "#f0a23a", OUTLINE, px);
  el(g, 0.26, -0.23 + bob, 0.025, 0.025, 0, "#2c2a28");
}

/** A ladybird on a big leaf, large enough to read as a drawing and nothing like a marker. */
function ladybird(g: CanvasRenderingContext2D, px: number, t: number) {
  const lw = px * 1.4;
  g.lineJoin = "round";
  g.lineCap = "round";
  const walk = Math.sin(t * 0.6) * 0.1;
  const leaf = new Path2D();
  leafOutline(leaf, 0, 0.3, -0.12, 0.92, 0.5);
  shape(g, leaf, "#7cc86a", "#3f8f4d", lw);
  const veins = new Path2D();
  leafVeins(veins, 0, 0.3, -0.12, 0.92, 0.5);
  g.lineWidth = px * 1.1;
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.stroke(veins);
  g.save();
  g.translate(walk, 0.12 + walk * 0.1);
  g.rotate(-0.1);
  g.strokeStyle = "#2a2622";
  g.lineWidth = px * 1.6;
  g.beginPath();
  for (const lx of [-0.18, 0, 0.18]) {
    g.moveTo(lx, 0.05);
    g.lineTo(lx - 0.06, 0.34);
    g.moveTo(lx, 0.05);
    g.lineTo(lx + 0.06, 0.34);
  }
  g.moveTo(0.46, -0.1);
  g.quadraticCurveTo(0.56 + Math.sin(t * 2) * 0.03, -0.3, 0.68, -0.28);
  g.moveTo(0.48, -0.02);
  g.quadraticCurveTo(0.6, -0.12, 0.7, -0.02);
  g.stroke();
  const body = new Path2D();
  body.ellipse(0, 0.04, 0.46, 0.36, 0, Math.PI, TAU);
  body.closePath();
  shape(g, body, "#e0443a", "#2a2622", lw);
  const head = new Path2D();
  head.ellipse(0.38, 0.04, 0.16, 0.2, 0, -Math.PI / 2, Math.PI / 2);
  head.closePath();
  shape(g, head, "#2a2622");
  g.lineWidth = px * 1.4;
  g.strokeStyle = "#2a2622";
  g.beginPath();
  g.moveTo(0.02, 0.04);
  g.lineTo(0.02, -0.32);
  g.stroke();
  for (const [dx, dy, r] of [
    [-0.3, -0.07, 0.07],
    [-0.2, -0.22, 0.065],
    [-0.1, -0.1, 0.06],
    [0.18, -0.12, 0.07],
    [0.14, -0.26, 0.055],
    [0.3, -0.12, 0.05],
  ] as const) {
    el(g, dx, dy, r, r, 0, "#2a2622");
  }
  g.restore();
}

/** A butterfly seen from above, centred at (x, y), `sc` wide per unit, its wings open to `flapX` of full width. */
function butterfly(g: CanvasRenderingContext2D, px: number, x: number, y: number, sc: number, flapX: number, rot: number, wing: string, wing2: string) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(sc, sc);
  const k = px / sc;
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const sd of [-1, 1]) {
    g.save();
    g.scale(sd * flapX, 1);
    const up = new Path2D();
    up.moveTo(0.05, -0.05);
    up.bezierCurveTo(0.4, -1.0, 1.25, -0.85, 1.08, -0.2);
    up.bezierCurveTo(0.96, 0.14, 0.35, 0.12, 0.05, 0);
    up.closePath();
    shape(g, up, wing, "rgba(60,40,50,0.7)", k * 1.1);
    const lo = new Path2D();
    lo.moveTo(0.05, 0.02);
    lo.bezierCurveTo(0.7, 0.05, 1.0, 0.5, 0.7, 0.86);
    lo.bezierCurveTo(0.42, 1.0, 0.1, 0.6, 0.05, 0.12);
    lo.closePath();
    shape(g, lo, wing2, "rgba(60,40,50,0.7)", k * 1.1);
    el(g, 0.72, -0.4, 0.14, 0.1, -0.5, "rgba(255,255,255,0.75)");
    el(g, 0.5, 0.52, 0.09, 0.07, 0, "rgba(255,255,255,0.7)");
    g.restore();
  }
  g.strokeStyle = "rgba(60,40,50,0.8)";
  g.lineWidth = k * 1.1;
  g.beginPath();
  g.moveTo(-0.02, -0.4);
  g.quadraticCurveTo(-0.3, -0.75, -0.38, -0.9);
  g.moveTo(0.02, -0.4);
  g.quadraticCurveTo(0.3, -0.75, 0.38, -0.9);
  g.stroke();
  el(g, 0, 0.1, 0.07, 0.5, 0, "#4a3340");
  g.restore();
}

/** A bee seen from above, turned by `rot`, wings buzzing. */
function bee(g: CanvasRenderingContext2D, px: number, x: number, y: number, sc: number, rot: number, t: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(sc, sc);
  const k = px / sc;
  const wob = 0.35 + 0.25 * Math.sin(t * 13);
  for (const sd of [-1, 1]) el(g, 0.02, sd * 0.4, 0.5, 0.22, sd * wob, "rgba(235,248,255,0.8)", "rgba(80,100,120,0.5)", k);
  const body = new Path2D();
  body.ellipse(0, 0, 0.62, 0.4, 0, 0, TAU);
  g.save();
  g.clip(body);
  g.fillStyle = "#f6c32d";
  g.fillRect(-1, -1, 2, 2);
  g.fillStyle = "#3a2c1e";
  g.fillRect(-0.3, -1, 0.2, 2);
  g.fillRect(0.12, -1, 0.2, 2);
  g.restore();
  g.lineWidth = k * 1.2;
  g.strokeStyle = "#3a2c1e";
  g.stroke(body);
  el(g, 0.66, 0, 0.2, 0.18, 0, "#3a2c1e");
  g.restore();
}

/** A dragonfly seen from above, flying to the right. */
function dragonfly(g: CanvasRenderingContext2D, px: number, x: number, y: number, sc: number, rot: number, t: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(sc, sc);
  const k = px / sc;
  g.lineJoin = "round";
  g.lineCap = "round";
  const beat = Math.sin(t * 11) * 0.1;
  for (const [wx, sd, len] of [
    [0.2, -1, 0.62],
    [0.2, 1, 0.62],
    [-0.05, -1, 0.56],
    [-0.05, 1, 0.56],
  ] as const) {
    el(g, wx, sd * (len * 0.5 + 0.04), 0.3, len * 0.36, sd * (0.35 + beat) * (wx > 0.1 ? 1 : -1), "rgba(200,236,248,0.78)", "rgba(40,100,130,0.65)", k * 1.1);
  }
  g.lineWidth = k * 3.2;
  g.strokeStyle = "#2aa5a0";
  g.beginPath();
  g.moveTo(0.4, 0);
  g.lineTo(-0.9, 0);
  g.stroke();
  g.lineWidth = k * 1.2;
  g.strokeStyle = "#13706c";
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const bx = 0.2 - i * 0.2;
    g.moveTo(bx, -0.06);
    g.lineTo(bx, 0.06);
  }
  g.stroke();
  el(g, 0.5, 0, 0.14, 0.14, 0, "#2aa5a0", "#13706c", k);
  g.restore();
}

/** A pond: a few pads, a pink lily, and reeds, in the water. */
function pond(g: CanvasRenderingContext2D, px: number, t: number) {
  g.lineJoin = "round";
  g.lineCap = "round";
  const pulse = 0.5 + 0.12 * Math.sin(t * 0.8);
  g.lineWidth = px * 1.2;
  for (const [r, a] of [
    [0.9, 0.78 * pulse],
    [0.7, 0.55 * pulse],
  ] as const) {
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.ellipse(0, 0.2, r, r * 0.42, 0, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = "#5fae62";
  g.lineWidth = px * 1.8;
  g.beginPath();
  for (const [x, lean, h] of [
    [-0.74, -0.15, 0.9],
    [-0.64, 0.06, 0.7],
    [-0.54, -0.04, 0.55],
    [0.7, 0.12, 0.8],
    [0.6, -0.08, 0.6],
  ] as const) {
    g.moveTo(x, 0.5);
    g.quadraticCurveTo(x + lean * 0.4, 0.5 - h * 0.5, x + lean, 0.5 - h);
  }
  g.stroke();
  for (const [x, y, r, rot] of [
    [-0.28, 0.42, 0.34, 0.5],
    [0.34, 0.5, 0.28, 2.6],
    [0.05, 0.12, 0.24, 4.2],
  ] as const) {
    const p = new Path2D();
    p.moveTo(x, y);
    p.ellipse(x, y, r, r * 0.55, 0, rot + 0.4, rot + TAU - 0.4);
    p.closePath();
    shape(g, p, "#a9dc90", "#4a9a4b", px * 1.2);
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = px;
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + 0.9 + i * 1.0;
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.44);
    }
    g.stroke();
  }
  const b = new Batch();
  petalRing(b.petal("#f7a8cf"), 0.05, 0.1, 8, 0.02, 0.2, 0.55, 0.2);
  petalRing(b.petal("#fdd2e6"), 0.05, 0.1, 6, 0.01, 0.12, 0.55, 0.5);
  disc(b.centre("#f6d34a"), 0.05, 0.1, 0.04);
  b.flush(g, px);
}

/** A big flower on an islet, with two small ones, for the spot the bees visit. */
function bloom(g: CanvasRenderingContext2D, px: number, _t: number) {
  const b = new Batch();
  b.stem.moveTo(-0.1, 0.45);
  b.stem.quadraticCurveTo(-0.06, 0.05, -0.1, -0.2);
  leafOutline(b.leaf(GREEN.mid), -0.3, 0.2, -2.6, 0.22, 0.32);
  leafOutline(b.leaf(GREEN.light), 0.1, 0.22, -0.5, 0.2, 0.32);
  sunflower(b, -0.1, -0.38, 0.38, 0.2, 0.3);
  tulip(b, 0.45, 0.2, 0.15, 0.4, 0.05);
  daisy(b, -0.5, 0.3, 0.12, 0.3, 0.1);
  b.flush(g, px);
}

type SpotArt = { flora: readonly FloraKind[]; still?: (g: CanvasRenderingContext2D, px: number, seed: number) => void; live: (g: CanvasRenderingContext2D, px: number, t: number) => void };

/** Where a flutterer, a bee or a petal is at time `t` for the k-th of its kind: always inside the spot's circle. */
export function flutterAt(t: number, k: number): { x: number; y: number; a: number } {
  const x = 0.36 * Math.cos(0.55 * t + k * 2.4) + 0.08 * Math.cos(1.7 * t + k);
  const y = -0.12 + 0.3 * Math.sin(0.7 * t + k * 1.3) + 0.06 * Math.sin(2.1 * t + k * 2);
  const dx = -0.36 * 0.55 * Math.sin(0.55 * t + k * 2.4), dy = 0.3 * 0.7 * Math.cos(0.7 * t + k * 1.3);
  return { x, y, a: Math.atan2(dy, dx) };
}
export function petalAt(t: number, k: number): { x: number; y: number; a: number } {
  return {
    x: 0.5 * Math.cos(0.31 * t + k * 2.4) + 0.12 * Math.cos(0.8 * t + k),
    y: 0.42 * Math.sin(0.27 * t + k * 1.9) + 0.1 * Math.sin(0.7 * t + 2 * k),
    a: t * 0.9 + k * 2,
  };
}
export function beeAt(t: number, k: number): { x: number; y: number; a: number } {
  const cx = 0.3 * Math.cos(k * 2.1), cy = -0.15 + 0.2 * Math.sin(k * 1.7);
  const a = t * 2.2 + k * 2;
  return { x: cx + 0.17 * Math.cos(a), y: cy + 0.13 * Math.sin(a), a: a + Math.PI / 2 };
}
export function dragonAt(t: number, k: number): { x: number; y: number; a: number } {
  return { x: 0.3 * Math.sin(0.5 * t + k), y: -0.3 + 0.16 * Math.sin(0.9 * t + k * 2), a: 0.2 * Math.cos(0.5 * t + k) };
}

/** The wing's width as a share of full, flapping about 1.7 times a second, a move of shape and never of light. */
export const FLAP_HZ = 1.7;
export const flap = (t: number, phase = 0) => 0.3 + 0.7 * Math.abs(Math.cos(Math.PI * FLAP_HZ * t + phase));
/** How far a giant flower leans, in radians, a slow sway. */
export const sway = (t: number, phase: number, amp = 0.045) => amp * Math.sin(t * 0.9 + phase);
/** The brightness of a star in the globe's sky, as a share of full: a slow, small swing. */
export const twinkle = (t: number, phase: number) => 0.78 + 0.16 * Math.sin((TAU * t) / 5 + phase);

const BUTTERFLY_COLOURS: readonly [string, string][] = [
  ["#f6a33a", "#ffd45a"],
  ["#78b6f2", "#c4e0ff"],
  ["#f48fb7", "#ffd0e2"],
  ["#b58be0", "#e0cdf6"],
];

function petals(g: CanvasRenderingContext2D, px: number, t: number, n: number) {
  const colours = ["#f7a8cf", "#ffffff", "#ffe27a"];
  for (let k = 0; k < n; k++) {
    const p = petalAt(t, k + 1);
    const q = new Path2D();
    leafOutline(q, 0, 0, 0, 0.065, 0.6);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.a);
    g.fillStyle = colours[k % colours.length]!;
    g.fill(q);
    g.lineWidth = px * 0.8;
    g.strokeStyle = "rgba(120,72,96,0.35)";
    g.stroke(q);
    g.restore();
  }
}

function flutterers(g: CanvasRenderingContext2D, px: number, t: number, n: number, first: number) {
  for (let k = 0; k < n; k++) {
    const p = flutterAt(t, k + first);
    const [c1, c2] = BUTTERFLY_COLOURS[(k + first) % BUTTERFLY_COLOURS.length]!;
    butterfly(g, px, p.x, p.y, 0.2, flap(t, k * 1.7), p.a + Math.PI / 2, c1, c2);
  }
}

const ART: Record<SpotKind, SpotArt> = {
  rabbit: { flora: ["daisy", "clover", "blossom", "tulip"], live: (g, px, t) => { rabbit(g, px, t); petals(g, px, t, 3); } },
  hedgehog: { flora: ["bluebell", "daisy", "clover", "poppy"], live: (g, px, t) => { hedgehog(g, px, t); petals(g, px, t, 3); } },
  snail: { flora: ["forgetmenot", "daisy", "blossom"], live: (g, px, t) => { snail(g, px, t); petals(g, px, t, 3); } },
  songbird: { flora: ["lavender", "daisy", "blossom"], live: (g, px, t) => { songbird(g, px, t); petals(g, px, t, 3); } },
  ladybird: { flora: [], live: (g, px, t) => { ladybird(g, px, t); petals(g, px, t, 2); } },
  butterflies: { flora: ["tulip", "poppy", "blossom", "lavender"], live: (g, px, t) => { flutterers(g, px, t, 3, 0); petals(g, px, t, 3); } },
  bees: {
    flora: [],
    still: (g, px) => {
      islet(g, px, ["clover", "daisy", "blossom"], 7);
    },
    live: (g, px, t) => {
      bloom(g, px, t);
      for (let k = 0; k < 3; k++) {
        const p = beeAt(t, k + 1);
        bee(g, px, p.x, p.y, 0.1, p.a, t + k);
      }
      petals(g, px, t, 2);
    },
  },
  pond: {
    flora: [],
    still: () => {},
    live: (g, px, t) => {
      pond(g, px, t);
      const p = dragonAt(t, 1);
      dragonfly(g, px, p.x, p.y, 0.28, p.a, t);
      petals(g, px, t, 2);
    },
  },
};

/** Whether a spot's art stands on an islet of its own: the ladybird's leaf, the pond's pads and the pond's water do not. */
const OWN_GROUND = new Set<SpotKind>(["ladybird", "pond"]);

/** One spot centred at (x, y), spanning a circle of radius `u` pixels, optionally mirrored: the still part. */
export function drawSpotStill(g: CanvasRenderingContext2D, spot: SeaSpot, x: number, y: number, u: number, alpha = 1) {
  if (u < 8) return;
  const kind = spot.kind as SpotKind;
  if (OWN_GROUND.has(kind)) return;
  const art = ART[kind];
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(spot.flip ? -u : u, u);
  if (art.still) art.still(g, 1 / u, spot.lon);
  else islet(g, 1 / u, art.flora, Math.round(Math.abs(spot.lon + spot.lat)));
  g.restore();
}

/** The moving part of a spot: the animal, the butterflies, the bees, the drifting petals. */
export function drawSpotLive(g: CanvasRenderingContext2D, spot: SeaSpot, x: number, y: number, u: number, t: number, alpha = 1) {
  if (u < 8) return;
  const kind = spot.kind as SpotKind;
  // The ladybird is drawn only large enough to stand clear of the biggest marker.
  if (kind === "ladybird" && u < 24) return;
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(spot.flip ? -u : u, u);
  g.lineJoin = "round";
  g.lineCap = "round";
  ART[kind].live(g, 1 / u, t);
  g.restore();
}

/** The spots in view with their screen position, their drawn radius and how far they fade on the globe's far side. */
function spotsInView(f: SurfaceFrame): { s: SeaSpot; x: number; y: number; u: number; alpha: number }[] {
  const pxDeg = pxPerDeg(f.proj);
  const out: { s: SeaSpot; x: number; y: number; u: number; alpha: number }[] = [];
  for (const s of SPOTS) {
    let alpha = 1;
    if (f.mode === "3d") {
      const deg = fromCentre(f, s.lon, s.lat);
      if (deg > 75) continue;
      if (deg > 55) alpha = (75 - deg) / 20;
    }
    const p = f.proj([s.lon, s.lat]);
    if (!p) continue;
    const u = Math.min(150, SPOT_FILL * s.r * pxDeg);
    if (p[0] < -u || p[0] > f.w + u || p[1] < -u || p[1] > f.h + u) continue;
    out.push({ s, x: p[0], y: p[1], u, alpha });
  }
  return out;
}

// ---- The globe: a small garden planet in a soft sky ---------------------------------------------------------------------

/** The halo's radius for a ball of radius R: the soft light round the planet that nothing is laid over. */
export const haloRadius = (R: number) => R * 1.1;

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 116, h: 64 };
export const ZOOM_BOX = { w: 76, h: 112 };

export type SkyKind = "sunflower" | "tulips" | "daisy" | "bluebell" | "planetoid" | "leafplanet" | "vine";

/** Something laid in the sky round the globe: a giant flower, a planet or a vine in a circle of radius s. */
export interface Placed {
  kind: SkyKind;
  x: number;
  y: number;
  s: number;
  turn: number;
  flip: boolean;
}

/** Whether the square round a circle overlaps a box: stricter than the circle, so a corner never comes close. */
function hitsBox(x: number, y: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;
}

/** Where things may lie round the globe, by direction from its centre (screen degrees, y down), in turn of choice. */
const AROUND: readonly [number, SkyKind, number, boolean][] = [
  [160, "sunflower", -0.5, false],
  [-22, "leafplanet", 0.35, false],
  [128, "planetoid", 0.2, false],
  [-58, "tulips", 0.5, true],
  [22, "daisy", -0.4, true],
  [205, "vine", -0.3, false],
  [-135, "bluebell", 0.3, false],
  [92, "bluebell", -0.2, true],
];

/** The gap between the halo and anything laid beside it, and the frame's margin, in pixels. */
const GAP = 10;
const MARGIN = 8;
/** The most things laid round the globe. */
export const MAX_AROUND = 6;

/**
 * The things laid in the sky round a globe of radius R at (cx, cy) in a frame w by h, sized from the ball at its
 * widest zoom (`baseR`). Each sits in the room left between the halo and the frame's edge, shrinks to fit it and is
 * left out when there is too little, so none ever comes near the ball, the Key, the zoom buttons or another. The same
 * frame and ball always get the same things.
 */
export function placeAround(w: number, h: number, cx: number, cy: number, R: number, baseR: number): Placed[] {
  const out: Placed[] = [];
  const M = haloRadius(R);
  const cap = clamp(baseR * 0.42, 24, 120);
  for (const [deg, kind, turn, flip] of AROUND) {
    if (out.length >= MAX_AROUND) break;
    const a = deg * RAD;
    const dx = Math.cos(a), dy = Math.sin(a);
    const x0 = cx + dx * (M + GAP), y0 = cy + dy * (M + GAP);
    if (x0 < MARGIN || y0 < MARGIN || x0 > w - MARGIN || y0 > h - MARGIN) continue;
    // The largest circle along this direction, touching the halo's gap, that stays inside the frame's margin.
    const fit = (room: number, d: number) => (room - MARGIN) / (1 + Math.abs(d));
    const s = Math.min(cap, fit(dx < 0 ? x0 : w - x0, dx), fit(dy < 0 ? y0 : h - y0, dy));
    if (s < 20) continue;
    const x = cx + dx * (M + GAP + s), y = cy + dy * (M + GAP + s);
    if (hitsBox(x, y, s + 4, 0, 0, KEY_BOX.w, KEY_BOX.h)) continue;
    if (hitsBox(x, y, s + 4, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + s + GAP)) continue;
    out.push({ kind, x, y, s, turn, flip });
  }
  return out;
}

/** A thick curved stem from `p0` through `cp` to `p1`, in the current units. */
function stem(g: CanvasRenderingContext2D, p0: [number, number], cp: [number, number], p1: [number, number], width: number) {
  g.lineWidth = width;
  g.strokeStyle = "#4fa35a";
  g.beginPath();
  g.moveTo(...p0);
  g.quadraticCurveTo(...cp, ...p1);
  g.stroke();
}

function giantLeaf(b: Batch, x: number, y: number, turn: number, s: number) {
  leafOutline(b.leaf(GREEN.mid), x, y, turn, s, 0.34);
  leafVeins(b.veins, x, y, turn, s, 0.34);
}

/** A planet's sphere in unit space: grass and flowers under a soft light, clipped to a disc. */
function planet(g: CanvasRenderingContext2D, px: number, cx: number, cy: number, r: number, seed: number, leafy: boolean) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.clip();
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
  gr.addColorStop(0, leafy ? "#7fcf74" : "#b9ec82");
  gr.addColorStop(0.6, leafy ? "#3f9a52" : "#6fc05c");
  gr.addColorStop(1, leafy ? "#276f45" : "#3f9a52");
  g.fillStyle = gr;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  const b = new Batch();
  for (let i = 0; i < 22; i++) {
    const a = hash2(seed + i, 3) * TAU, d = Math.sqrt(hash2(seed + i, 7)) * r * 0.92;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const sz = r * 0.2 * Math.sqrt(Math.max(0.2, 1 - (d / r) ** 2));
    if (leafy) leafOutline(b.leaf(i % 2 ? GREEN.light : GREEN.deep), x, y, a + 1, sz * 1.5, 0.4);
    else {
      const kinds: FloraKind[] = ["daisy", "blossom", "poppy", "clover", "forgetmenot", "tuft"];
      drawFlora(b, kinds[i % kinds.length]!, x, y, sz * 0.8, a, hash2(seed, i), false);
    }
  }
  b.flush(g, px);
  const sh = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r * 1.05);
  sh.addColorStop(0, "rgba(255,255,255,0.18)");
  sh.addColorStop(0.55, "rgba(255,255,255,0)");
  sh.addColorStop(1, "rgba(20,70,60,0.38)");
  g.fillStyle = sh;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.restore();
  g.lineWidth = px * 1.3;
  g.strokeStyle = "rgba(36,110,70,0.8)";
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.stroke();
}

/** A sky item in its unit circle at time t. The sway turns it about its foot. */
function skyItem(g: CanvasRenderingContext2D, kind: SkyKind, px: number, t: number, phase: number) {
  g.lineJoin = "round";
  g.lineCap = "round";
  const lean = sway(t, phase);
  const b = new Batch();
  switch (kind) {
    case "sunflower": {
      g.save();
      g.translate(0, 0.95);
      g.rotate(lean);
      g.translate(0, -0.95);
      stem(g, [0, 0.98], [0.1, 0.3], [-0.08, -0.25], 0.07);
      giantLeaf(b, -0.34, 0.45, Math.PI + 0.55, 0.3);
      giantLeaf(b, 0.3, 0.3, -0.5, 0.26);
      b.flush(g, px);
      const h = new Batch();
      sunflower(h, -0.08, -0.4, 0.52, 0.2, 0.3);
      h.flush(g, px);
      g.restore();
      break;
    }
    case "tulips": {
      g.save();
      g.translate(0, 0.95);
      g.rotate(lean);
      g.translate(0, -0.95);
      stem(g, [-0.2, 0.98], [-0.3, 0.3], [-0.28, -0.2], 0.06);
      stem(g, [0.2, 0.98], [0.36, 0.5], [0.32, 0.1], 0.06);
      giantLeaf(b, -0.05, 0.62, -1.9, 0.42);
      giantLeaf(b, 0.05, 0.7, -1.1, 0.4);
      b.flush(g, px);
      const h = new Batch();
      for (const [x, y, s, c] of [
        [-0.28, -0.32, 0.4, 0],
        [0.32, -0.04, 0.34, 0.4],
      ] as const) {
        // Tulips bigger than the small ones: the same cup of three petals on a short neck.
        const cup = c ? "#f8d24a" : "#f4a6c6";
        const half = s * 0.62;
        for (const da of [0, -0.55, 0.55]) {
          const a = -Math.PI / 2 + da;
          leafOutline(h.petal(cup), x + Math.cos(a) * half, y + s * 0.3 + Math.sin(a) * half, a, half, 0.62);
        }
      }
      h.flush(g, px);
      g.restore();
      break;
    }
    case "daisy": {
      g.save();
      g.translate(0, 0.95);
      g.rotate(lean);
      g.translate(0, -0.95);
      stem(g, [0, 0.98], [-0.12, 0.4], [0, -0.2], 0.06);
      giantLeaf(b, -0.3, 0.55, Math.PI + 0.7, 0.28);
      giantLeaf(b, 0.28, 0.4, -0.6, 0.26);
      b.flush(g, px);
      const h = new Batch();
      petalRing(h.petal("#ffffff"), 0, -0.4, 18, 0.16, 0.52, 0.22, 0.2);
      petalRing(h.petal("#fff7de"), 0, -0.4, 14, 0.12, 0.4, 0.22, 0.3);
      disc(h.centre("#f5c02e"), 0, -0.4, 0.18);
      disc(h.centre("#e8a41c"), 0, -0.4, 0.09);
      h.flush(g, px);
      g.restore();
      const p = flutterAt(t, 2 + phase);
      butterfly(g, px, p.x * 0.8 + 0.2, p.y * 0.6 - 0.3, 0.17, flap(t, phase), p.a + Math.PI / 2, "#f48fb7", "#ffd0e2");
      break;
    }
    case "bluebell": {
      g.save();
      g.translate(0, 0.95);
      g.rotate(lean);
      g.translate(0, -0.95);
      stem(g, [-0.3, 0.98], [0.1, 0.2], [0.42, -0.35], 0.055);
      giantLeaf(b, -0.5, 0.7, -1.5, 0.34);
      giantLeaf(b, -0.15, 0.78, -0.9, 0.3);
      b.flush(g, px);
      const h = new Batch();
      for (let i = 0; i < 6; i++) {
        const u = 0.38 + i * 0.12, v = 1 - u;
        const x = v * v * -0.3 + 2 * v * u * 0.1 + u * u * 0.42;
        const y = v * v * 0.98 + 2 * v * u * 0.2 + u * u * -0.35;
        const a = Math.PI / 2 - 0.5;
        leafOutline(h.petal(i % 2 ? "#6f8de8" : "#8a7be0"), x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, a, 0.13 - i * 0.008, 0.8);
      }
      h.flush(g, px);
      g.restore();
      break;
    }
    case "planetoid": {
      planet(g, px, 0, 0.1, 0.56, 11, false);
      // Small flowers growing out of the rim, leaning with the breeze.
      g.save();
      g.translate(0, 0.1);
      const h = new Batch();
      for (const [a, kind] of [
        [-1.9, "tulip"],
        [-1.25, "daisy"],
        [-0.6, "poppy"],
      ] as const) {
        const x = Math.cos(a + lean) * 0.6, y = Math.sin(a + lean) * 0.6;
        drawFlora(h, kind, x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, 0.13, a + Math.PI / 2, 0.2, false);
      }
      h.flush(g, px);
      g.restore();
      petals(g, px, t, 3);
      break;
    }
    case "leafplanet": {
      const ring = (front: boolean) => {
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * TAU;
          const y = Math.sin(a);
          if (front !== y > 0) continue;
          const x = Math.cos(a) * 0.98, yy = 0.05 + y * 0.24;
          const q = new Path2D();
          leafOutline(q, 0, 0, 0, 0.07, 0.6);
          g.save();
          g.translate(x, yy);
          g.rotate(a + Math.PI / 2 - 0.35);
          g.fillStyle = ["#f7a8cf", "#ffffff", "#ffe27a"][i % 3]!;
          g.fill(q);
          g.lineWidth = px * 0.8;
          g.strokeStyle = "rgba(120,72,96,0.35)";
          g.stroke(q);
          g.restore();
        }
      };
      g.save();
      g.translate(0, 0.05);
      g.rotate(-0.35);
      g.translate(0, -0.05);
      ring(false);
      g.restore();
      planet(g, px, 0, 0.05, 0.46, 29, true);
      g.save();
      g.translate(0, 0.05);
      g.rotate(-0.35);
      g.translate(0, -0.05);
      ring(true);
      g.restore();
      break;
    }
    case "vine": {
      g.save();
      g.translate(0, 0.95);
      g.rotate(lean * 1.5);
      g.translate(0, -0.95);
      g.lineWidth = 0.04;
      g.strokeStyle = "#55a85a";
      g.beginPath();
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const a = u * TAU * 2.3 + 0.6, r = 0.08 + u * 0.78;
        const x = Math.cos(a) * r * 0.9, y = -0.05 + Math.sin(a) * r * 0.85 + (1 - u) * 0.15;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
        if (i % 6 === 3) pts.push([x, y, a]);
      }
      g.stroke();
      pts.forEach(([x, y, a], i) => {
        leafOutline(b.leaf(i % 2 ? GREEN.light : GREEN.mid), x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, a + (i % 2 ? 1.2 : -1.2), 0.15, 0.4);
      });
      b.flush(g, px);
      const h = new Batch();
      pts.forEach(([x, y, a], i) => {
        if (i % 3 === 1) drawFlora(h, (["blossom", "poppy", "daisy"] as const)[((i / 3) | 0) % 3]!, x, y, 0.09, a, 0.2 + i * 0.1, false);
      });
      h.flush(g, px);
      g.restore();
      break;
    }
  }
}

/** One sky item drawn live: translated to its place, scaled to its circle and mirrored if it flips. */
function drawSkyItem(g: CanvasRenderingContext2D, it: Placed, t: number) {
  g.save();
  g.translate(it.x, it.y);
  g.scale(it.flip ? -it.s : it.s, it.s);
  skyItem(g, it.kind, 1 / it.s, t, it.turn * 3);
  g.restore();
}

/** Stars in the sky's soft light: fixed positions as shares of the frame, clear of the halo, the items and the buttons. */
const STARS: readonly [number, number][] = Array.from({ length: 26 }, (_, i) => [hash2(i * 3 + 1, 5), hash2(i * 7 + 2, 9)]);
export function starsFor(w: number, h: number, cx: number, cy: number, R: number, around: readonly Placed[]): { x: number; y: number; r: number; phase: number }[] {
  const out: { x: number; y: number; r: number; phase: number }[] = [];
  STARS.forEach(([fx, fy], i) => {
    const x = fx * w, y = fy * h;
    const r = 3 + hash2(i, 31) * 3;
    if (Math.hypot(x - cx, y - cy) < haloRadius(R) + 12 + r) return;
    if (hitsBox(x, y, r + 4, 0, 0, KEY_BOX.w, KEY_BOX.h) || hitsBox(x, y, r + 4, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) return;
    if (around.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + r + 6)) return;
    out.push({ x, y, r, phase: i * 1.7 });
  });
  return out;
}

/** The sky: soft blue deepening upward to cream at the horizon, a warm light high in a corner, and a few clouds. */
function sky(g: CanvasRenderingContext2D, w: number, h: number) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#9fc6f2");
  gr.addColorStop(0.55, "#d6d4f6");
  gr.addColorStop(1, "#fde3d2");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.14, h * 0.08, 0, w * 0.14, h * 0.08, Math.max(w, h) * 0.7);
  sun.addColorStop(0, "rgba(255,249,214,0.8)");
  sun.addColorStop(1, "rgba(255,249,214,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  for (const [fx, fy, fr] of [
    [0.14, 0.7, 0.2],
    [0.84, 0.28, 0.18],
    [0.62, 0.9, 0.22],
    [0.3, 0.16, 0.14],
  ] as const) {
    const x = fx * w, y = fy * h, r = fr * Math.max(w, h);
    g.save();
    g.translate(x, y);
    g.scale(1, 0.4);
    const c = g.createRadialGradient(0, 0, 0, 0, 0, r);
    c.addColorStop(0, "rgba(255,255,255,0.7)");
    c.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = c;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
}

// ---- The frame ------------------------------------------------------------------------------------------------------

export class HerbariumCache {
  world = new StillLayer();
  rings?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D };
  bands?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D };
  peaks?: { of: unknown; steps: Map<number, Set<number>> };
  around?: { key: string; items: Placed[]; stars: ReturnType<typeof starsFor> };
}

/** The sea's colour: pale turquoise that deepens toward the bottom of the frame. */
function seaFill(g: CanvasRenderingContext2D, f: SurfaceFrame, cx: number, cy: number, R: number) {
  if (f.mode === "3d") {
    const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.38, R * 0.05, cx, cy, R * 1.12);
    gr.addColorStop(0, "#c8eef5");
    gr.addColorStop(0.55, "#98d6ea");
    gr.addColorStop(1, "#68b7d8");
    g.fillStyle = gr;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    return;
  }
  const gr = g.createLinearGradient(0, 0, 0, f.h);
  gr.addColorStop(0, "#bfe8f4");
  gr.addColorStop(1, "#86c9e2");
  g.fillStyle = gr;
  g.fillRect(0, 0, f.w, f.h);
  sunlight(g, f.w, f.h);
}

function paint(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D) {
  const { w, h, mode } = f;
  const globe = mode === "3d";
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const sphere = new Path2D();
  geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  if (globe) {
    sky(g, w, h);
    // The planet's soft halo, then the ball.
    const halo = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, haloRadius(R) * 1.05);
    halo.addColorStop(0, "rgba(255,255,255,0.55)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = halo;
    g.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    g.save();
    g.clip(sphere);
    seaFill(g, f, cx, cy, R);
    g.restore();
  } else seaFill(g, f, cx, cy, R);
  const { land, coast, ice } = landPaths(f, f.map);
  g.save();
  if (globe) g.clip(sphere);
  shallows(f, cache, g, coast);
  seaGrid(f, g);
  for (const v of spotsInView(f)) drawSpotStill(g, v.s, v.x, v.y, v.u, v.alpha);
  g.fillStyle = f.theme.land;
  g.fill(land);
  drawMeadow(f, cache, g, land);
  if (ice) {
    g.fillStyle = "rgba(244,251,249,0.5)";
    g.fill(ice);
  }
  const path = geoPath(f.proj, g);
  if (f.zoom >= 2) {
    g.beginPath();
    path(f.map.rivers);
    g.lineWidth = 1.1;
    g.strokeStyle = "rgba(120,200,225,0.85)";
    g.stroke();
  }
  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = "#b4e4f2";
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(60,140,170,0.7)";
  g.stroke();
  // The shore: a pale sandy rim inside the coast, then a fine deep green line.
  g.save();
  g.clip(land);
  g.lineJoin = "round";
  g.lineWidth = 5 * screenK(f);
  g.strokeStyle = "rgba(247,236,190,0.9)";
  g.stroke(coast);
  g.restore();
  g.lineJoin = "round";
  g.lineWidth = f.theme.coastWidth;
  g.strokeStyle = f.theme.coast;
  g.stroke(coast);
  if (globe) {
    // Lit from the upper left like a small planet: a soft light there and a cool shade toward the rim.
    const sh = g.createRadialGradient(cx - R * 0.36, cy - R * 0.4, R * 0.08, cx, cy, R * 1.02);
    sh.addColorStop(0, "rgba(255,255,255,0.22)");
    sh.addColorStop(0.5, "rgba(255,255,255,0)");
    sh.addColorStop(0.82, "rgba(30,90,120,0.1)");
    sh.addColorStop(1, "rgba(24,70,110,0.34)");
    g.fillStyle = sh;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  g.restore();
  if (globe) {
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.stroke(sphere);
  }
}

/** The moving part: spot animals and petals, the sky's giant flowers and stars. Returns whether anything was drawn. */
function live(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D, t: number): boolean {
  let any = false;
  const globe = f.mode === "3d";
  if (globe) {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    const key = `${f.w}|${f.h}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
    if (cache.around?.key !== key) {
      const items = placeAround(f.w, f.h, cx, cy, R, R / Math.max(1, f.zoom));
      cache.around = { key, items, stars: starsFor(f.w, f.h, cx, cy, R, items) };
    }
    for (const s of cache.around.stars) {
      const p = new Path2D();
      sparkle(p, s.x, s.y, s.r);
      g.fillStyle = `rgba(255,255,255,${twinkle(t, s.phase)})`;
      g.fill(p);
      any = true;
    }
    for (const it of cache.around.items) {
      drawSkyItem(g, it, t);
      any = true;
    }
  }
  for (const v of spotsInView(f)) {
    drawSpotLive(g, v.s, v.x, v.y, v.u, t, v.alpha);
    any = true;
  }
  return any;
}

/** Milliseconds between frames of the garden's motion: about eleven a second. */
export const FRAME_MS = 90;

/**
 * Each marker's short soft shadow on the ground, down and to the right of its head. Drawn under the markers in one
 * fill, so the markers themselves are untouched.
 */
export function pinShadows(g: CanvasRenderingContext2D, spots: readonly SurfaceSpot[]) {
  if (!spots.length) return;
  const p = new Path2D();
  for (const s of spots) {
    const x = s.x + s.r * 0.42, y = s.y + s.r * 0.55;
    p.moveTo(x + s.r * 1.02, y);
    p.ellipse(x, y, s.r * 1.02, s.r * 0.78, 0.5, 0, TAU);
  }
  g.save();
  g.fillStyle = "rgba(24,70,50,0.24)";
  g.fill(p);
  g.restore();
}

export function drawHerbarium(f: SurfaceFrame, cache: HerbariumCache): SurfaceResult {
  cache.world.draw(f, (g) => paint(f, cache, g));
  const t = motionTime();
  const moved = live(f, cache, f.ctx, t);
  const next = moved && !stillMotion() ? FRAME_MS : 0;
  return { under: (spots) => pinShadows(f.ctx, spots), next };
}
