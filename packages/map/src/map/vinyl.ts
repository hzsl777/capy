// Record Player (vinyl, experimental): after the feel of a 1970s home turntable, and none of any maker's, label's,
// artist's or album's names, logos or art. The reader plays the world like a record.
//
// Globe view is a turntable seen from above, and the record on it really turns. The deck is fixed to the screen: a slab
// of wood, the platter in its well with a strobe of short bars round its rim, the record on the platter, a paper label of
// our own on the spindle, and the tonearm on its pivot. The world is printed on the record: a polar map with the North
// Pole at the spindle, so every groove is a parallel and turning the record is turning the world in longitude. Around
// the pole the parallels are pushed out (`HOLE`) to make room for the label, which covers only the cap round the pole
// where no place lies (tested).
//
// The needle is the reticle. The place under it is the one tuned. The record turns clockwise under it, and the arm
// swings across the record on its pivot, so the needle reaches every latitude: the longitude under the needle is how far
// the record has turned, the latitude is how far the arm has swung (`needleOffset`). Zoomed in, the camera follows the
// needle so it stays on the frame's centre (`viewOf`).
//
// While it plays the record turns at a steady 33 or 45 (`SPIN_DEG`, a little slower than a real deck so the continents
// crossing a point stay well under three a second), and brakes to rest, as a platter does, when a place comes round to
// the needle (`turnToNeedle`). The turning picture is cached as one image and rotated, not redrawn: land is drawn
// once per size, and a frame of the spin is a few image draws.
//
// Map view is the record's sleeve laid on the plinth: the flat map printed on its back in brown ink, the record
// slid half out of it into the margin on a wide screen. Places outside the sleeve are neither drawn nor tuned.
//
// Nothing here carries meaning. The grooves are evenly spaced on screen and never mark a latitude; the sheen on the
// vinyl turns with the record and stays under the land and the markers, faint enough that no turn, however fast,
// swings any spot's brightness by a tenth. The record turns only while it plays, which reduced motion never starts.

import { geoGraticule, geoPath, geoProjection, type GeoProjection } from "d3-geo";
import { SITE_NAME } from "../brand.ts";
import type { Basemap } from "./basemap.ts";
import { offscreen, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * How far the North Pole sits from the spindle, in the record's units (radians on the sphere): colatitude c is drawn
 * at sqrt(c² + HOLE²) from the spindle. It makes room for the centre label; a few tens of degrees out the parallels
 * are spaced almost as on the sphere.
 */
export const HOLE = 0.8;
/** Degrees round the North Pole the needle stays out of. No place lies that far north (test/vinyl.test.ts). */
export const CAP = 6;
/**
 * The centre label's radius, in the record's units: a little inside the hole, so a smooth ring of bare vinyl lies between
 * the label and the first groove, as on a real record, and no marker at the northernmost place touches the label.
 */
export const LABEL_R = HOLE * 0.82;
/** Distance from the spindle, in the record's units, of colatitude `c` (radians). */
export const radiusOf = (c: number) => Math.sqrt(c * c + HOLE * HOLE);
/** The colatitude (radians) drawn at distance `r` from the spindle; 0 inside the hole. */
export const colatOf = (r: number) => Math.sqrt(Math.max(0, r * r - HOLE * HOLE));
/** The record's edge, where the South Pole is drawn. */
export const EDGE_R = radiusOf(Math.PI);
/** How far the needle may go: just short of the label, and to the South Pole at the record's edge. */
export const NEEDLE_LAT: readonly [number, number] = [-89.9, 90 - CAP - 1];
/**
 * Zoom grows the record faster than the globe's scale, since the whole world is laid out flat at the widest zoom and
 * the closest zoom must still part neighbouring towns.
 */
export const ZOOM_POW = 1.6;
/** The brightest the sheen on the vinyl gets over black: under a tenth, so no turn of the record can flash. */
export const SHEEN_MAX = 0.08;
/** Grooves are this many screen pixels apart at every zoom, so they always read as fine grooves. */
export const GROOVE_PX = 3;

/** How fast the record turns while it plays, in degrees a second, at each speed of the switch (45 is a third quicker). */
export const SPIN_DEG: Record<33 | 45, number> = { 33: 110, 45: 150 };
/** The speeds on the deck's switch. */
export const SPEEDS: readonly (33 | 45)[] = [33, 45];
/** The record starts braking when a place on the needle's ring is this many degrees from reaching it. */
export const BRAKE_DEG = 40;

let rpm: 33 | 45 = 33;
/** The deck's speed switch (src/ui/vinyl.ts): how fast the record turns and how fast Replay steps. */
export function setRecordSpeed(s: 33 | 45) {
  rpm = s;
}
export const recordSpeed = () => rpm;
/** Degrees a second the record turns at the switch's speed. */
export const recordSpin = () => SPIN_DEG[rpm];

/** What the label says, kept by the page's controls (src/ui/vinyl.ts). Returns whether the date changed. */
const labelText = { date: "" };
export function setLabelDate(date: string): boolean {
  if (labelText.date === date) return false;
  labelText.date = date;
  return true;
}

/**
 * The record's projection in its own frame, where the pole is at the origin: azimuthal, with each point's distance
 * from the pole pushed out by the hole. The exact pole has no direction and is put at the spindle.
 */
function recordRaw(x: number, y: number): [number, number] {
  const c = Math.acos(clamp(Math.cos(x) * Math.cos(y), -1, 1));
  const sc = Math.sin(c);
  if (sc < 1e-12) return c < 1 ? [0, 0] : [0, -EDGE_R];
  const k = radiusOf(c) / sc;
  return [k * Math.cos(y) * Math.sin(x), k * Math.sin(y)];
}
recordRaw.invert = (x: number, y: number): [number, number] => {
  const r = Math.hypot(x, y);
  if (r < 1e-12) return [0, Math.PI / 2];
  const c = colatOf(r);
  const sc = Math.sin(c);
  return [Math.atan2((x / r) * sc, Math.cos(c)), Math.asin(clamp((y / r) * sc, -1, 1))];
};

// ---- the deck -----------------------------------------------------------------------------------------------------

/** The pivot is this many platter radii from the spindle, and the arm a little shorter, so the needle can reach the label. */
const PIVOT_D = 1.3;
const ARM_SHORT = 0.12;
/** The tonearm's base, in pixels, for an arm of length `L`. */
const baseOf = (L: number) => clamp(L * 0.1, 13, 32);

/**
 * The turntable's layout for a frame, at the widest zoom: the platter's middle on the frame's, and the arm's pivot up
 * to the right of it at the angle that lets the platter be the largest, with room beside the pivot for its base and
 * the counterweight behind it.
 */
export interface Deck {
  w: number;
  h: number;
  /** The spindle at rest, the frame's centre. */
  cx: number;
  cy: number;
  /** The record's and the platter's radii, in pixels at the widest zoom. */
  R: number;
  Rp: number;
  /** The pivot's distance from the spindle, the arm's length from pivot to needle, and the pivot's direction (radians, screen). */
  D: number;
  L: number;
  alpha: number;
  base: number;
}

let lastDeck: Deck | null = null;
export function deckOf(w: number, h: number): Deck {
  if (lastDeck && lastDeck.w === w && lastDeck.h === h) return lastDeck;
  let best = { rp: 0, deg: 38 };
  for (let deg = 24; deg <= 78; deg += 2) {
    const a = deg / DEG;
    let rp = Math.min(w, h) / 2 - 20;
    for (let i = 0; i < 3; i++) {
      const m = baseOf((PIVOT_D - ARM_SHORT) * rp) * 2.3 + 18;
      rp = Math.min(rp, (w / 2 - m) / (PIVOT_D * Math.cos(a)), (h / 2 - m) / (PIVOT_D * Math.sin(a)));
    }
    if (rp > best.rp + 0.5 || (Math.abs(rp - best.rp) <= 0.5 && Math.abs(deg - 38) < Math.abs(best.deg - 38))) best = { rp, deg };
  }
  const Rp = Math.max(30, best.rp);
  const R = Rp - clamp(Rp * 0.043, 6, 40);
  const L = (PIVOT_D - ARM_SHORT) * Rp;
  lastDeck = { w, h, cx: w / 2, cy: h / 2, R, Rp, D: PIVOT_D * Rp, L, alpha: -best.deg / DEG, base: baseOf(L) };
  return lastDeck;
}

/**
 * Where the needle is from the spindle, in pixels at the widest zoom, when it is over latitude `lat`: the point of the
 * arm's arc (a circle round the pivot, as long as the arm) that is as far from the spindle as that latitude's groove.
 * Of the two such points, the one on the near side of the line from the spindle to the pivot, as an arm swings.
 */
export function needleOffset(d: Deck, lat: number): [number, number] {
  const r = (d.R / EDGE_R) * radiusOf((90 - lat) / DEG);
  const ex = Math.cos(d.alpha);
  const ey = Math.sin(d.alpha);
  const a = (r * r - d.L * d.L + d.D * d.D) / (2 * d.D);
  const hh = Math.sqrt(Math.max(0, r * r - a * a));
  return [a * ex - hh * ey, a * ey + hh * ex];
}

/** Zoom over which the camera moves from the whole deck to riding with the needle, which then stays on the frame's centre. */
export const CAM_ZOOM = 0.35;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Where everything is on screen for the needle over `lat` at `zoom`. */
export interface DeckView {
  /** Pixels per record unit. */
  s: number;
  /** How much larger the deck is than at the widest zoom. */
  kappa: number;
  /** The spindle and the needle on screen, and the needle's direction from the spindle. */
  sx: number;
  sy: number;
  nx: number;
  ny: number;
  theta: number;
  /** The needle's offset from the spindle at the widest zoom, which the arm's pivot keeps. */
  ux: number;
  uy: number;
}

export function viewOf(w: number, h: number, lat: number, zoom: number): DeckView {
  const d = deckOf(w, h);
  const [ux, uy] = needleOffset(d, clamp(lat, NEEDLE_LAT[0], NEEDLE_LAT[1]));
  const kappa = Math.pow(Math.max(1, zoom), ZOOM_POW);
  const t = smooth(clamp((zoom - 1) / CAM_ZOOM, 0, 1));
  const sx = d.cx - t * kappa * ux;
  const sy = d.cy - t * kappa * uy;
  return { s: (d.R / EDGE_R) * kappa, kappa, sx, sy, nx: sx + kappa * ux, ny: sy + kappa * uy, theta: Math.atan2(uy, ux), ux, uy };
}

/** Pixels per unit of the record at a zoom. */
export function recordScale(w: number, h: number, zoom: number): number {
  return (deckOf(w, h).R / EDGE_R) * Math.pow(Math.max(1, zoom), ZOOM_POW);
}

/** The record's radius on screen at the widest zoom: the view's base scale in Globe view. */
export const recordBase = (w: number, h: number) => deckOf(w, h).R;

/** Where the needle is on screen: the reticle. */
export function needleAt(w: number, h: number, lat: number, zoom: number): [number, number] {
  const v = viewOf(w, h, lat, zoom);
  return [v.nx, v.ny];
}

/** How far the record is turned on screen, clockwise in radians, from the picture drawn with the needle straight below the spindle at longitude 0. */
export function turnOf(v: DeckView, lon: number): number {
  return v.theta - Math.PI / 2 + lon / DEG;
}

/**
 * The record as the camera sees it: the point at (lon, lat) is under the needle, the record turned so that its
 * meridian runs from the spindle through the needle, east anticlockwise as seen from above the North Pole.
 */
export function recordProjection(lon: number, lat: number, zoom: number, w: number, h: number, extent: [[number, number], [number, number]]): GeoProjection {
  const v = viewOf(w, h, lat, zoom);
  return geoProjection(recordRaw)
    .rotate([-lon, -90, 0])
    .angle(-(v.theta - Math.PI / 2) * DEG)
    .scale(v.s)
    .translate([v.sx, v.sy])
    .clipAngle(179.9)
    .clipExtent(extent)
    .precision(0.5);
}

/**
 * A drag on the record: the record turns with the finger round the spindle, as far as the finger goes round it, and
 * the arm swings by as much as the finger goes in or out, the needle going over the record the way a map's centre goes
 * over a map dragged under it. Grabbed on the label or the platter's rim, the record only turns. `only` keeps one of the
 * two, for the arrow keys: left and right turn the record, up and down swing the arm. Returns the needle's new
 * longitude and latitude.
 */
export function dragRecord(lon: number, lat: number, zoom: number, w: number, h: number, from: readonly [number, number], to: readonly [number, number], only?: "turn" | "swing"): [number, number] {
  const v = viewOf(w, h, lat, zoom);
  const fx = from[0] - v.sx;
  const fy = from[1] - v.sy;
  const tx = to[0] - v.sx;
  const ty = to[1] - v.sy;
  const rf = Math.hypot(fx, fy);
  const rt = Math.hypot(tx, ty);
  if (rf < 1e-6 || rt < 1e-6) return [lon, lat];
  let da = Math.atan2(ty, tx) - Math.atan2(fy, fx);
  da = Math.atan2(Math.sin(da), Math.cos(da));
  let nlat = lat;
  if (only !== "turn" && rf > v.s * LABEL_R && rf < v.s * EDGE_R) {
    const r = v.s * radiusOf((90 - lat) / DEG) - (rt - rf);
    nlat = clamp(90 - colatOf(r / v.s) * DEG, NEEDLE_LAT[0], NEEDLE_LAT[1]);
  }
  return [only === "swing" ? lon : wrap(lon + da * DEG), nlat];
}

/**
 * How many degrees the record must turn, clockwise, to bring the point at (x, y) on screen under the needle, or null
 * when it is not on the needle's ring, within `tol` pixels of the groove the needle is in.
 */
export function turnToNeedle(w: number, h: number, lat: number, zoom: number, x: number, y: number, tol: number): number | null {
  const v = viewOf(w, h, lat, zoom);
  const rn = Math.hypot(v.nx - v.sx, v.ny - v.sy);
  const rs = Math.hypot(x - v.sx, y - v.sy);
  if (Math.abs(rs - rn) > tol || rs < 1e-6) return null;
  let a = v.theta - Math.atan2(y - v.sy, x - v.sx);
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return a * DEG;
}

/** Map view's sleeve: the card inset on the plinth, with room in the side margins for the record on a wide screen. */
export function sleeveOf(w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const wide = w >= 700;
  const mx = wide ? Math.round(clamp(w * 0.09, 56, 140)) : 10;
  const my = wide ? 18 : 10;
  return { x0: mx, y0: my, x1: w - mx, y1: h - (wide ? 22 : 10) };
}

export class VinylCache {
  /** The tonearm and its base, drawn once per arm size. */
  arm?: { key: string; art: HTMLCanvasElement; shade: HTMLCanvasElement; base: HTMLCanvasElement; pad: [number, number, number]; bpad: number; q: number };
  /** The slab and the platter's well, once per frame size. */
  plate?: { key: string; canvas: HTMLCanvasElement };
  /** The turning picture: the record, its label and the strobe, drawn once and rotated. */
  pic?: { key: string; canvas: HTMLCanvasElement; side: number };
  /** The maps the picture was drawn from, which a key cannot hold. */
  picMap?: Basemap;
  /** The sleeve's shadow and the record half out of it, once per frame size. */
  desk?: { key: string; canvas: HTMLCanvasElement };
}

/** The part of a ring round (sx, sy) that can be on screen: its angles and radii, or null when none of it is. */
function onScreen(w: number, h: number, sx: number, sy: number, r0: number, r1: number): { a0: number; a1: number; r0: number; r1: number } | null {
  const m = 4;
  const nx = clamp(sx, -m, w + m);
  const ny = clamp(sy, -m, h + m);
  const near = Math.hypot(nx - sx, ny - sy);
  const corners: [number, number][] = [
    [-m, -m],
    [w + m, -m],
    [w + m, h + m],
    [-m, h + m],
  ];
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - sx, y - sy)));
  const lo = Math.max(r0, near);
  const hi = Math.min(r1, far);
  if (hi <= lo) return null;
  if (near === 0) return { a0: 0, a1: Math.PI * 2, r0: lo, r1: hi };
  // Outside the frame, the frame takes less than half a turn as seen from the centre.
  const base = Math.atan2(ny - sy, nx - sx);
  let a0 = Infinity;
  let a1 = -Infinity;
  for (const [x, y] of corners) {
    let a = Math.atan2(y - sy, x - sx) - base;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
  }
  return { a0: base + a0 - 0.02, a1: base + a1 + 0.02, r0: lo, r1: hi };
}

/** A ring as one path, for filling with the even-odd rule so its middle stays clear. */
function ring(sx: number, sy: number, r0: number, r1: number): Path2D {
  const p = new Path2D();
  p.arc(sx, sy, r1, 0, Math.PI * 2);
  p.moveTo(sx + r0, sy);
  p.arc(sx, sy, r0, 0, Math.PI * 2, true);
  return p;
}

/** Fine concentric grooves round (sx, sy) between two radii, only where they can be seen. */
function grooves(w: number, h: number, sx: number, sy: number, r0: number, r1: number, step: number): Path2D {
  const p = new Path2D();
  const v = onScreen(w, h, sx, sy, r0, r1);
  if (!v) return p;
  const first = r0 + Math.ceil((v.r0 - r0) / step) * step;
  for (let r = first; r <= v.r1; r += step) {
    p.moveTo(sx + r * Math.cos(v.a0), sy + r * Math.sin(v.a0));
    p.arc(sx, sy, r, v.a0, v.a1);
  }
  return p;
}


type Ring = number[][];
type Geo = { type: string; coordinates?: unknown; geometry?: Geo; features?: Geo[]; geometries?: Geo[] };

/** The latitude a polygon's edge along the South Pole is moved to, outside the record's clip round the pole. */
export const POLAR_EDGE = -89.5;

/**
 * A ring whose edge runs along the South Pole (Antarctica's, from -180 to 180 at -90) with that edge drawn a little
 * north of the pole instead, every 10 degrees. On the record the South Pole is the whole edge: the edge at the pole
 * is one point on the sphere, so the clip round it would close the ring on itself and fill the record inside the
 * coast rather than the land between the coast and the edge.
 */
export function polarRing(ring: Ring): Ring {
  if (!ring.some((p) => p[1]! <= -89.99)) return ring;
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    if (p[1]! > -89.99) {
      out.push(p);
      continue;
    }
    let j = i;
    while (j + 1 < ring.length && ring[j + 1]![1]! <= -89.99) j++;
    const a = p[0]!;
    const b = ring[j]![0]!;
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / 10));
    for (let k = 0; k <= n; k++) out.push([a + ((b - a) * k) / n, POLAR_EDGE]);
    i = j;
  }
  return out;
}

const safe = new WeakMap<object, Geo>();
/** Land or ice with every polar edge moved off the pole (`polarRing`), kept per basemap object. */
export function polarSafe(g: Geo): Geo {
  const kept = safe.get(g);
  if (kept) return kept;
  const walk = (o: Geo): Geo => {
    if (o.type === "FeatureCollection") return { ...o, features: o.features!.map(walk) };
    if (o.type === "Feature") return { ...o, geometry: o.geometry && walk(o.geometry) };
    if (o.type === "GeometryCollection") return { ...o, geometries: o.geometries!.map(walk) };
    if (o.type === "Polygon") return { ...o, coordinates: (o.coordinates as Ring[]).map(polarRing) };
    if (o.type === "MultiPolygon") return { ...o, coordinates: (o.coordinates as Ring[][]).map((p) => p.map(polarRing)) };
    return o;
  };
  const out = walk(g);
  safe.set(g, out);
  return out;
}


/**
 * The platter under the record: brushed aluminium, lit from one side and so not turning with the record, and its shadow
 * on the slab. The strobe round its rim is part of the turning picture (`paintRecord`).
 */
function drawPlatter(ctx: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number, R: number, Rp: number) {
  if (!onScreen(w, h, sx, sy, R, Rp + 26)) return;
  const shade = ctx.createRadialGradient(sx + 4, sy + 7, Rp - 4, sx + 4, sy + 7, Rp + 24);
  shade.addColorStop(0, "rgba(10,5,2,0.6)");
  shade.addColorStop(1, "rgba(10,5,2,0)");
  ctx.fillStyle = shade;
  ctx.fill(ring(sx + 4, sy + 7, Rp - 6, Rp + 24), "evenodd");
  const metal = ctx.createConicGradient(-0.6, sx, sy);
  const stops: [number, string][] = [
    [0, "#d9dcdf"],
    [0.1, "#9a9ea3"],
    [0.24, "#eceef0"],
    [0.37, "#8d9196"],
    [0.5, "#d9dcdf"],
    [0.6, "#9a9ea3"],
    [0.74, "#eceef0"],
    [0.87, "#8d9196"],
    [1, "#d9dcdf"],
  ];
  for (const [at, c] of stops) metal.addColorStop(at, c);
  ctx.fillStyle = metal;
  ctx.fill(ring(sx, sy, R - 1, Rp), "evenodd");
  // The rim's edge: a dark line outside and a lit bevel inside.
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(30,30,32,0.75)";
  ctx.beginPath();
  ctx.arc(sx, sy, Rp, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(sx, sy, Rp - 1.2, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * The strobe: round the platter's rim, a row of short dark bars and inside it a row of small dots, turning with the
 * platter as a deck's strobe does. All dark grey on the aluminium and none of them an orange ring, so nothing on it
 * reads as a place.
 */
function paintStrobe(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, Rp: number, rot: number) {
  const band = Rp - R;
  if (band < 7) return;
  g.fillStyle = "rgba(28,28,30,0.8)";
  const p = new Path2D();
  const bars = 180;
  const rb = Rp - band * 0.3;
  const len = band * 0.24;
  const half = Math.min(0.9, ((Math.PI * rb) / bars) * 0.45);
  for (let i = 0; i < bars; i++) {
    const a = rot + (i / bars) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r0 = rb - len / 2;
    const r1 = rb + len / 2;
    p.moveTo(cx + c * r0 - s * half, cy + s * r0 + c * half);
    p.lineTo(cx + c * r1 - s * half, cy + s * r1 + c * half);
    p.lineTo(cx + c * r1 + s * half, cy + s * r1 - c * half);
    p.lineTo(cx + c * r0 + s * half, cy + s * r0 - c * half);
    p.closePath();
  }
  const dots = 216;
  const rd = Rp - band * 0.66;
  const dr = clamp(((Math.PI * rd) / dots) * 0.42, 0.5, 1.4);
  for (let i = 0; i < dots; i++) {
    const a = rot + (i / dots) * Math.PI * 2;
    const x = cx + Math.cos(a) * rd;
    const y = cy + Math.sin(a) * rd;
    p.moveTo(x + dr, y);
    p.arc(x, y, dr, 0, Math.PI * 2);
  }
  g.fill(p);
}

/** Text along a circle of radius `r` round the origin, each letter set upright to the radius; `top` reads clockwise over the top, else left to right under the foot. */
function arcText(g: CanvasRenderingContext2D, text: string, r: number, gap: number, top: boolean) {
  const widths = [...text].map((ch) => g.measureText(ch).width + gap);
  const total = widths.reduce((a, b) => a + b, 0) - gap;
  let at = -total / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i]! - gap;
    const a = (at + w / 2) / r;
    at += widths[i]!;
    g.save();
    if (top) {
      g.rotate(a);
      g.translate(0, -r);
    } else {
      g.rotate(-a);
      g.translate(0, r);
    }
    g.fillText(ch, -w / 2, 0);
    g.restore();
  });
}

/** Whether the label's two fonts are loaded, so the picture is drawn again once they are. */
const fontsReady = () => (typeof document !== "undefined" && document.fonts ? document.fonts.check('10px "Michroma"') && document.fonts.check('600 10px "Jost"') : true);

/**
 * The centre label, our own: paper with an orange band, two printed rings, the site's name round the top, the date round
 * the foot and the speed in the middle, turned `rot` with the record. Drawn on a 100 unit disc scaled to radius `r`.
 */
function paintLabel(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  const k = r / 50;
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(k, k);
  const disc = (rad: number, fill: string) => {
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  };
  disc(50, "#f2e4c2");
  disc(47, "#c9561c");
  disc(44.5, "#f2e4c2");
  g.strokeStyle = "#8f3a14";
  for (const [rad, lw] of [
    [27, 0.8],
    [24.5, 0.4],
  ] as const) {
    g.lineWidth = lw;
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.stroke();
  }
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = "#2a1d14";
  g.font = '6.6px "Michroma", sans-serif';
  arcText(g, SITE_NAME.toUpperCase(), 34, 0.6, true);
  g.fillStyle = "#6b3a1c";
  g.font = '600 5px "Jost", sans-serif';
  arcText(g, labelText.date.toUpperCase(), 39, 0.7, false);
  g.fillStyle = "#c24e17";
  g.font = '7px "Michroma", sans-serif';
  g.textAlign = "center";
  g.fillText(String(rpm), 0, 17);
  disc(3.6, "#a7abaf");
  g.strokeStyle = "#4a4d50";
  g.lineWidth = 0.5;
  g.beginPath();
  g.arc(0, 0, 3.6, 0, Math.PI * 2);
  g.stroke();
  disc(1.6, "#eef0f2");
  g.restore();
}

/** The world's land, ice, lakes, rivers and coasts, through a projection. */
function drawWorld(g: CanvasRenderingContext2D, view: { stream(out: never): unknown }, map: Basemap, zoom: number, ink: { land: string; ice: string; lake: string; river: string; coast: string; coastWidth: number }, polar: boolean) {
  const path = geoPath(view as never, g);
  const fix = polar ? (o: unknown) => polarSafe(o as Geo) : (o: unknown) => o;
  g.beginPath();
  path(fix(map.land) as never);
  g.fillStyle = ink.land;
  g.fill();
  if (map.ice) {
    g.beginPath();
    path(fix(map.ice) as never);
    g.fillStyle = ink.ice;
    g.fill();
  }
  g.beginPath();
  path(map.lakes as never);
  g.fillStyle = ink.lake;
  g.fill();
  if (zoom >= 2) {
    g.beginPath();
    path(map.rivers as never);
    g.strokeStyle = ink.river;
    g.lineWidth = 0.8;
    g.stroke();
  }
  g.lineJoin = "round";
  g.beginPath();
  path(map.coast as never);
  g.strokeStyle = ink.coast;
  g.lineWidth = ink.coastWidth;
  g.stroke();
}

const RECORD = { vinyl: "#0d0c0d", edge: "rgba(210,205,200,0.32)", groove: "rgba(255,250,240,0.055)", runout: "#050505" };

interface Paint {
  /** The spindle in the drawing's own coordinates, the record's, label's and platter's radii, and how far it is turned. */
  cx: number;
  cy: number;
  R: number;
  Rp: number;
  labelR: number;
  rot: number;
  /** The frame to draw into, for leaving out what cannot be seen. */
  w: number;
  h: number;
  /** The record's projection, positioned in the same coordinates. */
  view: { stream(out: never): unknown };
  map: Basemap;
  zoom: number;
  ink: { land: string; ice: string; lake: string; river: string; coast: string; coastWidth: number };
}

/**
 * Everything that turns with the record: the strobe on the platter's rim, the vinyl with its grooves and sheen, the
 * world pressed into it, its edge and the label. Drawn once into a picture that is then rotated, or straight onto the
 * screen when zoomed in past what the picture holds.
 */
function paintRecord(g: CanvasRenderingContext2D, o: Paint) {
  const { cx, cy, R, Rp, labelR, rot, w, h } = o;
  paintStrobe(g, cx, cy, R, Rp, rot);
  const disc = new Path2D();
  disc.arc(cx, cy, R, 0, Math.PI * 2);
  // The vinyl, a little lighter toward the edge where the lead-in catches the light.
  const body = g.createRadialGradient(cx, cy, labelR, cx, cy, R);
  body.addColorStop(0, RECORD.runout);
  body.addColorStop(0.08, RECORD.vinyl);
  body.addColorStop(0.97, "#141314");
  body.addColorStop(1, "#262525");
  g.fillStyle = body;
  g.fill(disc);

  const runout = Math.max(5, (R - labelR) * 0.035);
  const leadIn = Math.max(3, R * 0.012);
  const groovePath = grooves(w, h, cx, cy, labelR + runout, R - leadIn, GROOVE_PX);
  g.strokeStyle = RECORD.groove;
  g.lineWidth = 1;
  g.stroke(groovePath);

  // The sheen: two soft bow-ties of light, turning with the record.
  g.save();
  g.clip(disc);
  const sheen = g.createConicGradient(rot - 0.85, cx, cy);
  for (const [at, a] of [
    [0, 0],
    [0.05, SHEEN_MAX * 0.6],
    [0.09, SHEEN_MAX],
    [0.14, 0],
    [0.5, 0],
    [0.55, SHEEN_MAX * 0.6],
    [0.59, SHEEN_MAX],
    [0.64, 0],
    [1, 0],
  ] as const)
    sheen.addColorStop(at, `rgba(255,248,235,${a})`);
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);

  // The world printed on the record, pressed with the grooves that run across it.
  drawWorld(g, o.view, o.map, o.zoom, o.ink, true);
  g.globalCompositeOperation = "multiply";
  g.strokeStyle = "rgba(120,96,60,0.16)";
  g.stroke(groovePath);
  g.globalCompositeOperation = "source-over";
  g.restore();

  // The record's edge, and the smooth run-out round the label.
  g.lineWidth = 1.2;
  g.strokeStyle = RECORD.edge;
  g.beginPath();
  g.arc(cx, cy, R - 0.6, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,250,240,0.12)";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, labelR + runout, 0, Math.PI * 2);
  g.stroke();
  paintLabel(g, cx, cy, labelR, rot);
}

/**
 * The record's projection for the turning picture: longitude 0 on the meridian that runs straight down from the spindle
 * at (c, c), scale `s`, clipped to a square of `side`. Rotated about the spindle by `turnOf`, it is exactly what
 * `recordProjection` gives (tested), so the markers sit on the land they were printed with.
 */
export function restProjection(s: number, c: number, side: number): GeoProjection {
  return geoProjection(recordRaw)
    .rotate([0, -90, 0])
    .scale(s)
    .translate([c, c])
    .clipAngle(179.9)
    .clipExtent([
      [-4, -4],
      [side + 4, side + 4],
    ])
    .precision(0.5);
}

/** The turning picture for a deck: the record at rest with the needle straight below the spindle at longitude 0, drawn at a finer pixel ratio than the screen's so a turn of it stays sharp. */
function picture(f: SurfaceFrame, cache: VinylCache, d: Deck) {
  const { theme: t } = f;
  const side = Math.ceil(d.Rp * 2 + 6);
  const q = clamp(2400 / side, 1, Math.max(f.dpr, 2));
  const key = [side, q.toFixed(2), labelText.date, rpm, fontsReady(), t.land, t.ice, t.lake, t.river, t.coast, t.coastWidth].join("|");
  if (cache.pic?.key === key && cache.picMap === f.map) return cache.pic;
  const [canvas, g] = offscreen(side, side, q);
  const c = side / 2;
  const s = d.R / EDGE_R;
  const proj = restProjection(s, c, side);
  paintRecord(g, {
    cx: c,
    cy: c,
    R: d.R,
    Rp: d.Rp,
    labelR: s * LABEL_R,
    rot: 0,
    w: side,
    h: side,
    view: proj,
    map: f.map,
    zoom: 1,
    ink: { land: t.land, ice: t.ice, lake: t.lake, river: t.river, coast: t.coast, coastWidth: t.coastWidth },
  });
  cache.picMap = f.map;
  cache.pic = { key, canvas, side };
  return cache.pic;
}

/** A tiny repeatable random, so the slab's grain is the same every time. */
function seeded(seed: number) {
  let a = seed;
  return () => ((a = (a * 16807) % 2147483647) / 2147483647);
}

/**
 * The deck's slab: warm teak with a fine grain and a lit bevel, set on the walnut, with the platter's well in it and a
 * screw at each corner. Drawn once per frame size, under everything else, and never over the record.
 */
function plateLayer(f: SurfaceFrame, cache: VinylCache, d: Deck) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}`;
  if (cache.plate?.key === key) return cache.plate;
  const [canvas, g] = offscreen(w, h, dpr);
  const m = 7;
  const x0 = m;
  const y0 = m;
  const x1 = w - m;
  const y1 = h - m;
  const rad = 14;
  const slab = new Path2D();
  slab.roundRect(x0, y0, x1 - x0, y1 - y0, rad);
  g.save();
  g.shadowColor = "rgba(8,3,0,0.65)";
  g.shadowBlur = 16;
  g.shadowOffsetY = 4;
  g.fillStyle = "#6e4627";
  g.fill(slab);
  g.restore();
  g.save();
  g.clip(slab);
  const top = g.createLinearGradient(0, y0, 0, y1);
  top.addColorStop(0, "#7d5330");
  top.addColorStop(0.5, "#6c4526");
  top.addColorStop(1, "#5f3c20");
  g.fillStyle = top;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const rnd = seeded(7);
  g.lineWidth = 1;
  for (let x = x0; x < x1; x += 3) {
    g.strokeStyle = rnd() < 0.5 ? "rgba(255,225,175,0.06)" : "rgba(30,12,4,0.10)";
    g.beginPath();
    const drift = (rnd() - 0.5) * 2.4;
    g.moveTo(x + 0.5, y0);
    g.bezierCurveTo(x + drift, y0 + (y1 - y0) / 3, x - drift, y0 + ((y1 - y0) * 2) / 3, x + 0.5 + drift * 0.4, y1);
    g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const x = x0 + rnd() * (x1 - x0);
    g.strokeStyle = "rgba(35,14,4,0.16)";
    g.lineWidth = 1 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(x, y0);
    g.bezierCurveTo(x + 6, y0 + (y1 - y0) / 3, x - 6, y0 + ((y1 - y0) * 2) / 3, x + 2, y1);
    g.stroke();
  }
  g.restore();
  // A lit bevel along the top and left edges, a dark one along the bottom and right.
  g.lineWidth = 1.4;
  g.strokeStyle = "rgba(255,226,180,0.35)";
  g.beginPath();
  g.moveTo(x0 + 0.7, y1 - rad);
  g.arcTo(x0 + 0.7, y0 + 0.7, x0 + rad, y0 + 0.7, rad);
  g.lineTo(x1 - rad, y0 + 0.7);
  g.stroke();
  g.strokeStyle = "rgba(20,8,2,0.5)";
  g.beginPath();
  g.moveTo(x1 - 0.7, y0 + rad);
  g.arcTo(x1 - 0.7, y1 - 0.7, x1 - rad, y1 - 0.7, rad);
  g.lineTo(x0 + rad, y1 - 0.7);
  g.stroke();
  // The platter's well: a dark round recess a little wider than the platter, lit along its far lip.
  const well = d.Rp + 9;
  const wg = g.createRadialGradient(d.cx, d.cy, d.Rp - 2, d.cx, d.cy, well);
  wg.addColorStop(0, "#120a05");
  wg.addColorStop(1, "#2a1a0e");
  g.fillStyle = wg;
  g.beginPath();
  g.arc(d.cx, d.cy, well, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.3;
  g.strokeStyle = "rgba(255,226,180,0.30)";
  g.beginPath();
  g.arc(d.cx, d.cy, well + 0.8, Math.PI * 0.1, Math.PI * 0.9);
  g.stroke();
  g.strokeStyle = "rgba(10,4,0,0.7)";
  g.beginPath();
  g.arc(d.cx, d.cy, well - 0.2, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  // A screw at each corner.
  for (const [sx, sy] of [
    [x0 + 14, y0 + 14],
    [x1 - 14, y0 + 14],
    [x0 + 14, y1 - 14],
    [x1 - 14, y1 - 14],
  ] as const) {
    const sg = g.createRadialGradient(sx - 1.2, sy - 1.4, 0.5, sx, sy, 4.4);
    sg.addColorStop(0, "#f4f5f6");
    sg.addColorStop(1, "#7b8085");
    g.fillStyle = sg;
    g.beginPath();
    g.arc(sx, sy, 4.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(30,30,32,0.75)";
    g.lineWidth = 0.9;
    g.stroke();
    g.beginPath();
    g.moveTo(sx - 2.6, sy + 0.8);
    g.lineTo(sx + 2.6, sy - 0.8);
    g.stroke();
  }
  cache.plate = { key, canvas };
  return cache.plate;
}

/** The arm's sizes, from its length. */
function armSize(d: Deck) {
  const { L, base } = d;
  const tube = clamp(L * 0.022, 3.4, 8);
  const hl = clamp(L * 0.15, 26, 64);
  const offset = 0.36;
  const bx = L - hl * Math.cos(offset);
  const by = -hl * Math.sin(offset);
  return { L, base, tube, hl, offset, bx, by, beta: Math.atan2(by, bx), tubeLen: Math.hypot(bx, by) };
}

const metalOf = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, "#f4f5f6");
  m.addColorStop(0.35, "#c3c7cb");
  m.addColorStop(0.7, "#8a8f94");
  m.addColorStop(1, "#5d6166");
  return m;
};

/**
 * The tonearm that swings: a counterweight behind the pivot, a straight silver tube, the pivot's gimbal and a black
 * headshell set at an angle whose stylus rests exactly at (L, 0), with the pivot at the origin. `shadow` paints the same
 * shapes in one translucent shade.
 */
function paintArm(g: CanvasRenderingContext2D, z: ReturnType<typeof armSize>, shadow: boolean) {
  const { base, tube, hl, offset, bx, by, beta, tubeLen } = z;
  const fill = (style: string | CanvasGradient) => (shadow ? "rgba(10,6,3,0.42)" : style);
  // The counterweight behind the pivot, its knurled face in fine lines.
  g.save();
  g.rotate(beta);
  const cw0 = -base * 2.1;
  const cw1 = -base * 0.95;
  const cwh = base * 0.62;
  g.fillStyle = fill(metalOf(g, 0, -cwh, 0, cwh));
  g.beginPath();
  g.roundRect(cw0, -cwh, cw1 - cw0, cwh * 2, base * 0.12);
  g.fill();
  if (!shadow) {
    g.strokeStyle = "rgba(40,40,44,0.45)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = cw0 + 3; x < cw1 - 2; x += 3) {
      g.moveTo(x, -cwh + 1);
      g.lineTo(x, cwh - 1);
    }
    g.stroke();
  }
  // The tube.
  g.fillStyle = fill(metalOf(g, 0, -tube / 2, 0, tube / 2));
  g.beginPath();
  g.roundRect(-base * 0.95, -tube / 2, tubeLen + base * 0.95, tube, tube / 2);
  g.fill();
  g.restore();
  // The pivot's gimbal: a turned silver cylinder seen from above.
  const gim = g.createRadialGradient(-base * 0.25, -base * 0.3, base * 0.05, 0, 0, base * 0.8);
  gim.addColorStop(0, "#fafbfc");
  gim.addColorStop(0.55, "#b7bbbf");
  gim.addColorStop(1, "#5e6267");
  g.fillStyle = fill(gim);
  g.beginPath();
  g.arc(0, 0, base * 0.78, 0, Math.PI * 2);
  g.fill();
  if (!shadow) {
    g.fillStyle = "#2b2b2e";
    g.beginPath();
    g.arc(0, 0, base * 0.26, 0, Math.PI * 2);
    g.fill();
  }
  // The headshell, angled to the tube, with its finger lift; the cartridge under its front and the stylus at the end.
  g.save();
  g.translate(bx, by);
  g.rotate(offset);
  const hw = tube * 2.5;
  g.fillStyle = fill("#151515");
  g.beginPath();
  g.roundRect(-tube * 0.6, -hw / 2, hl * 0.86 + tube * 0.6, hw, tube * 0.6);
  g.fill();
  g.beginPath();
  g.moveTo(hl * 0.08, -hw / 2);
  g.quadraticCurveTo(hl * 0.12, -hw * 1.6, hl * 0.3, -hw * 1.7);
  g.lineTo(hl * 0.32, -hw * 1.45);
  g.quadraticCurveTo(hl * 0.22, -hw * 1.3, hl * 0.26, -hw / 2);
  g.closePath();
  g.fill();
  if (!shadow) {
    g.strokeStyle = "rgba(230,232,235,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(-tube * 0.6 + 0.5, -hw / 2 + 0.5, hl * 0.86 + tube * 0.6 - 1, hw - 1, tube * 0.6);
    g.stroke();
    // The cartridge's body, a lighter block toward the front.
    g.fillStyle = "#3a3633";
    g.fillRect(hl * 0.5, -hw * 0.34, hl * 0.3, hw * 0.68);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(hl * 0.5, -hw * 0.34, hl * 0.3, 1.2);
  }
  // The cantilever: a fine line from the cartridge down to the stylus, which rests at (L, 0) of the arm's frame.
  g.strokeStyle = shadow ? "rgba(10,6,3,0.42)" : "#d9dcdf";
  g.lineWidth = 1.4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(hl * 0.8, 0);
  g.lineTo(hl, 0);
  g.stroke();
  if (!shadow) {
    // The stylus itself, a small bright diamond: the reticle.
    const dd = clamp(tube * 0.55, 2.2, 3.5);
    g.fillStyle = "#fbfbfb";
    g.strokeStyle = "#1a1a1a";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(hl - dd, 0);
    g.lineTo(hl, -dd);
    g.lineTo(hl + dd, 0);
    g.lineTo(hl, dd);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
}

/**
 * The pivot's base, which does not swing: a dark round plate with a turned ring, and beside it, toward the record, the
 * arm rest and the cueing lever. Drawn with the pivot at the origin and its own axis (from the pivot toward the spindle)
 * along +x.
 */
function paintBase(g: CanvasRenderingContext2D, base: number, shadow: boolean) {
  const fill = (style: string | CanvasGradient) => (shadow ? "rgba(10,6,3,0.42)" : style);
  g.beginPath();
  g.arc(0, 0, base * 1.3, 0, Math.PI * 2);
  g.fillStyle = fill("#2a2724");
  g.fill();
  if (!shadow) {
    g.strokeStyle = "rgba(220,220,215,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, base * 1.12, 0, Math.PI * 2);
    g.stroke();
  }
  g.save();
  g.translate(base * 1.0, base * 1.75);
  g.fillStyle = fill(metalOf(g, -base * 0.3, -base * 0.3, base * 0.3, base * 0.3));
  g.beginPath();
  g.roundRect(-base * 0.32, -base * 0.32, base * 0.64, base * 0.64, base * 0.12);
  g.fill();
  g.fillStyle = fill("#1d1b19");
  g.beginPath();
  g.roundRect(-base * 0.12, -base * 1.05, base * 0.24, base * 0.85, base * 0.1);
  g.fill();
  g.fillStyle = fill(metalOf(g, 0, -base * 1.25, 0, -base * 0.95));
  g.beginPath();
  g.roundRect(-base * 0.42, -base * 1.25, base * 0.84, base * 0.3, base * 0.14);
  g.fill();
  g.restore();
}

/** The arm's pictures, drawn once per arm size: the arm and its shadow in the arm's own frame, and the base on the deck's. */
function armLayer(f: SurfaceFrame, cache: VinylCache, d: Deck) {
  const q = Math.max(f.dpr, 2);
  const key = `${d.L.toFixed(1)}|${d.base}|${q}`;
  if (cache.arm?.key === key) return cache.arm;
  const z = armSize(d);
  const padX0 = z.base * 2.3 + 10;
  const padX1 = 16;
  const halfH = Math.max(z.hl * 0.75, z.base * 1.1) + z.tube * 4 + 8;
  const aw = z.L + padX0 + padX1;
  const ah = halfH * 2;
  const [art, ga] = offscreen(aw, ah, q);
  ga.translate(padX0, halfH);
  paintArm(ga, z, false);
  const [shade, gs] = offscreen(aw, ah, q);
  gs.translate(padX0, halfH);
  gs.filter = `blur(${3 * q}px)`;
  paintArm(gs, z, true);
  const bpad = z.base * 3.4 + 12;
  const [base, gb] = offscreen(bpad * 2, bpad * 2, q);
  // The base and its shadow: the shadow is the screen's to cast, so it is offset on screen, not in the base's frame.
  gb.save();
  gb.translate(bpad + 6, bpad + 9);
  gb.rotate(d.alpha + Math.PI);
  gb.filter = `blur(${3 * q}px)`;
  paintBase(gb, z.base, true);
  gb.restore();
  gb.filter = "none";
  gb.save();
  gb.translate(bpad, bpad);
  gb.rotate(d.alpha + Math.PI);
  paintBase(gb, z.base, false);
  gb.restore();
  cache.arm = { key, art, shade, base, pad: [padX0, halfH, aw], bpad, q };
  return cache.arm;
}

/** The arm swung to the needle: its pivot, its base and its stylus on `(v.nx, v.ny)`. */
function drawArm(f: SurfaceFrame, cache: VinylCache, d: Deck, v: DeckView) {
  const { ctx } = f;
  const a = armLayer(f, cache, d);
  const [padX0, halfH, aw] = a.pad;
  // The pivot is where the rigid arm puts it: as far from the needle as the arm is long, in the direction it has at
  // the widest zoom. At that zoom it is the deck's pivot; zoomed in, the camera rides with the arm.
  const ex = Math.cos(d.alpha);
  const ey = Math.sin(d.alpha);
  const px = v.nx + d.D * ex - v.ux;
  const py = v.ny + d.D * ey - v.uy;
  const theta = Math.atan2(-(d.D * ey - v.uy), -(d.D * ex - v.ux));
  ctx.drawImage(a.base, px - a.bpad, py - a.bpad, a.bpad * 2, a.bpad * 2);
  const ah = halfH * 2;
  ctx.save();
  ctx.translate(px + 6, py + 9);
  ctx.rotate(theta);
  ctx.drawImage(a.shade, -padX0, -halfH, aw, ah);
  ctx.restore();
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(theta);
  ctx.drawImage(a.art, -padX0, -halfH, aw, ah);
  ctx.restore();
}

/** Where the arm's pivot is, and the way the arm points from it to the needle, for a deck at rest. */
export function pivotAt(d: Deck, lat: number): { px: number; py: number; theta: number } {
  const [ux, uy] = needleOffset(d, lat);
  const dx = d.D * Math.cos(d.alpha) - ux;
  const dy = d.D * Math.sin(d.alpha) - uy;
  return { px: d.cx + ux + dx, py: d.cy + uy + dy, theta: Math.atan2(-dy, -dx) };
}

function drawRecord(f: SurfaceFrame, cache: VinylCache): SurfaceResult {
  const { ctx, w, h, theme: t } = f;
  const d = deckOf(w, h);
  const v = viewOf(w, h, f.lat, f.zoom);
  const R = d.R * v.kappa;
  const Rp = d.Rp * v.kappa;
  const rot = turnOf(v, f.lon);
  // The slab slides with the camera when it rides along the needle; it is never scaled.
  ctx.drawImage(plateLayer(f, cache, d).canvas, v.sx - d.cx, v.sy - d.cy, w, h);
  drawPlatter(ctx, w, h, v.sx, v.sy, R, Rp);
  if (f.zoom <= 1.0001) {
    const pic = picture(f, cache, d);
    ctx.save();
    ctx.translate(v.sx, v.sy);
    ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pic.canvas, -pic.side / 2, -pic.side / 2, pic.side, pic.side);
    ctx.restore();
  } else {
    paintRecord(ctx, {
      cx: v.sx,
      cy: v.sy,
      R,
      Rp,
      labelR: v.s * LABEL_R,
      rot,
      w,
      h,
      view: f.view as never,
      map: f.map,
      zoom: f.zoom,
      ink: { land: t.land, ice: t.ice, lake: t.lake, river: t.river, coast: t.coast, coastWidth: t.coastWidth },
    });
  }
  drawArm(f, cache, d, v);
  return {};
}


const SLEEVE = { card: "#eee4cb", ink: "#3f2c20", ice: "#a8957c", line: "rgba(70,46,28,0.07)", graticule: "rgba(70,46,28,0.13)", river: "rgba(238,228,203,0.5)" };
const SLEEVE_GRID = geoGraticule().step([30, 30])();

/** The plinth under the sleeve: the sleeve's shadow and, on a wide screen, the record slid half out into the margin. */
function deskLayer(f: SurfaceFrame, cache: VinylCache, b: ReturnType<typeof sleeveOf>) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}`;
  if (cache.desk?.key === key) return cache.desk;
  const [canvas, g] = offscreen(w, h, dpr);
  const sh = b.y1 - b.y0;
  const out = b.x0 - 16;
  if (out >= 40) {
    // The record's centre is under the sleeve, so only the part slid out shows, in the margin.
    const R = sh * 0.46;
    const cx = b.x1 + out - R;
    const cy = (b.y0 + b.y1) / 2;
    g.save();
    g.beginPath();
    g.rect(b.x1 - 2, 0, w - b.x1 + 2, h);
    g.clip();
    const shade = g.createRadialGradient(cx + 4, cy + 8, R - 6, cx + 4, cy + 8, R + 18);
    shade.addColorStop(0, "rgba(20,10,4,0.5)");
    shade.addColorStop(1, "rgba(20,10,4,0)");
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = RECORD.vinyl;
    g.fill();
    g.strokeStyle = RECORD.groove;
    g.lineWidth = 1;
    g.stroke(grooves(w, h, cx, cy, R * 0.4, R - 4, GROOVE_PX));
    const sheen = g.createConicGradient(-0.5, cx, cy);
    sheen.addColorStop(0, "rgba(255,248,235,0)");
    sheen.addColorStop(0.06, `rgba(255,248,235,${SHEEN_MAX})`);
    sheen.addColorStop(0.12, "rgba(255,248,235,0)");
    sheen.addColorStop(1, "rgba(255,248,235,0)");
    g.fillStyle = sheen;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = RECORD.edge;
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  }
  // The sleeve's shadow on the wood.
  g.save();
  g.shadowColor = "rgba(20,10,4,0.55)";
  g.shadowBlur = 18;
  g.shadowOffsetX = 3;
  g.shadowOffsetY = 6;
  g.fillStyle = SLEEVE.card;
  g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  g.restore();
  cache.desk = { key, canvas };
  return cache.desk;
}

function drawSleeve(f: SurfaceFrame, cache: VinylCache): SurfaceResult {
  const { ctx, w, h } = f;
  const b = sleeveOf(w, h);
  ctx.drawImage(deskLayer(f, cache, b).canvas, 0, 0, w, h);
  const card = new Path2D();
  card.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.save();
  ctx.clip(card);
  ctx.fillStyle = SLEEVE.card;
  ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  // Printed in one brown ink: fine lines across the sea, the graticule, the land solid.
  ctx.strokeStyle = SLEEVE.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = b.y0 + 2; y < b.y1; y += GROOVE_PX) {
    ctx.moveTo(b.x0, y + 0.5);
    ctx.lineTo(b.x1, y + 0.5);
  }
  ctx.stroke();
  ctx.beginPath();
  geoPath(f.view as never, ctx)(SLEEVE_GRID as never);
  ctx.strokeStyle = SLEEVE.graticule;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  drawWorld(ctx, f.view as never, f.map, f.zoom, { land: SLEEVE.ink, ice: SLEEVE.ice, lake: SLEEVE.card, river: SLEEVE.river, coast: SLEEVE.ink, coastWidth: 0.8 }, false);
  // The card's worn edges.
  const wear = (x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(120,90,50,0.22)");
    g.addColorStop(1, "rgba(120,90,50,0)");
    return g;
  };
  ctx.fillStyle = wear(b.x0, 0, b.x0 + 14, 0);
  ctx.fillRect(b.x0, b.y0, 14, b.y1 - b.y0);
  ctx.fillStyle = wear(b.x1, 0, b.x1 - 14, 0);
  ctx.fillRect(b.x1 - 14, b.y0, 14, b.y1 - b.y0);
  ctx.fillStyle = wear(0, b.y0, 0, b.y0 + 14);
  ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, 14);
  ctx.fillStyle = wear(0, b.y1, 0, b.y1 - 14);
  ctx.fillRect(b.x0, b.y1 - 14, b.x1 - b.x0, 14);
  ctx.restore();
  // A printed double rule round the back, just inside the card's edge.
  ctx.strokeStyle = "rgba(63,44,32,0.55)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(b.x0 + 7.5, b.y0 + 7.5, b.x1 - b.x0 - 15, b.y1 - b.y0 - 15);
  ctx.lineWidth = 0.6;
  ctx.strokeRect(b.x0 + 10.5, b.y0 + 10.5, b.x1 - b.x0 - 21, b.y1 - b.y0 - 21);
  const m = 3;
  return { inside: (x, y) => x > b.x0 + m && y > b.y0 + m && x < b.x1 - m && y < b.y1 - m, clip: card };
}


export function drawVinyl(f: SurfaceFrame, cache: VinylCache): SurfaceResult {
  const box = f.ctx.canvas.parentElement;
  // The page hides the reticle in Globe view, where the stylus is the reticle.
  if (box && box.dataset.view !== f.mode) box.dataset.view = f.mode;
  return f.mode === "3d" ? drawRecord(f, cache) : drawSleeve(f, cache);
}
