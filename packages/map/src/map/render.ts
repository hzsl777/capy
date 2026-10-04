// First Render (id render): after the feel of the first computer-animated music videos of the
// mid-1980s, and nothing else from them: no people or figures, no names, no frames or art. Untextured polygons, each
// flat-shaded by one hard light with no smoothing, in saturated colours, in a room built from a few big flat planes.
//
// Globe view: the world is a low-poly ball, an icosphere of a few hundred faces. A face is land when most of the
// points sampled under it are land, and is coloured from a fixed list by its latitude and a fixed hash, never by any
// political unit; the sea faces are cobalt. It floats in a room: the teal wallpaper is the map's CSS background, the
// canvas adds a floor of checked tiles in perspective, a skirting block, the ball's hard shadow and, where there is
// room, a red umbrella lamp standing beside the ball. The lamp is decoration only and never comes near the ball, so it
// is never over a place (`placeLamp`, tested); its shade turns very slowly, and not at all for reduced motion.
//
// Map view: the world as flat facets on a screen set into the wall in a chunky two-tone bevel. The facets are cut
// from a jittered grid of longitude and latitude fixed to the world, so they move with the map; the sea is cobalt
// facets, the land is green and mustard facets cut by the real coastline, with their dark edges faintly showing.
// Places outside the screen are neither drawn nor tuned.
//
// Markers, arcs and tuning go through the view's projection as in every design, and nothing here moves them.

import { geoPath, geoRotation, type GeoProjection } from "d3-geo";
import { drawPart, motionTime, StillLayer } from "./ambient.ts";
import { hash2, offscreen, pathContext, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

type V3 = [number, number, number];
type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The one hard light, from the upper left and in front: x right, y up, z toward the reader. */
export const LIGHT: V3 = norm([-0.55, 0.62, 0.6]);
/** How bright a face is under the light: a floor of ambient light, then the light's share, with no smoothing. */
export const AMBIENT = 0.46;
export const DIFFUSE = 0.7;
export function facetLight(n: V3): number {
  return AMBIENT + DIFFUSE * Math.max(0, dot(n, LIGHT));
}

/** The palette, after the reference's feel: cobalt sea, greens and mustard land, mint-white snow, tomato red. */
export const COBALT: RGB = [42, 79, 192];
const LAND_GREENS: RGB[] = [
  [47, 154, 69],
  [63, 174, 74],
  [86, 180, 72],
  [121, 192, 65],
];
const MUSTARD: RGB = [224, 168, 42];
const PALE_GREEN: RGB = [134, 201, 143];
const SNOW: RGB = [232, 244, 238];
const TOMATO: RGB = [216, 57, 43];
const NAVY = "#16204f";

const rgb = (c: RGB, b: number) => `rgb(${Math.round(clamp(c[0] * b, 0, 255))},${Math.round(clamp(c[1] * b, 0, 255))},${Math.round(clamp(c[2] * b, 0, 255))})`;

/**
 * A land face's colour from its latitude and a fixed hash only: deep greens near the Equator, mustard mixed with
 * green in the dry belts, greens in the middle latitudes, pale green toward the poles. Never by any political unit.
 */
export function landColour(lat: number, h: number): RGB {
  const a = Math.abs(lat);
  if (a < 14) return LAND_GREENS[h < 0.5 ? 0 : 1]!;
  if (a < 36) return h < 0.6 ? MUSTARD : LAND_GREENS[3]!;
  if (a < 54) return LAND_GREENS[h < 0.5 ? 2 : 1]!;
  return PALE_GREEN;
}

// ---- The icosphere -------------------------------------------------------------------------------------------

export interface Icosphere {
  verts: V3[];
  faces: [number, number, number][];
}

const SPHERES = new Map<number, Icosphere>();

/**
 * An icosphere: the icosahedron's twenty faces, each cut into four `level` times with the new corners pushed out to the
 * unit sphere. Every face is wound so its normal points outward. The same level always gives the same ball.
 */
export function icosphere(level: number): Icosphere {
  const have = SPHERES.get(level);
  if (have) return have;
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: V3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as V3[]
  ).map(norm);
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mids.get(k);
      if (i === undefined) {
        const p = verts[a]!, q = verts[b]!;
        i = verts.push(norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])) - 1;
        mids.set(k, i);
      }
      return i;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  // Wind every face outward, whatever the list above started with.
  faces = faces.map(([a, b, c]) => {
    const A = verts[a]!, B = verts[b]!, C = verts[c]!;
    const n = cross(sub(B, A), sub(C, A));
    return dot(n, [A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]]) < 0 ? [a, c, b] : [a, b, c];
  });
  const out = { verts, faces };
  SPHERES.set(level, out);
  return out;
}

/** A point on the unit sphere as longitude and latitude in degrees (x toward 0,0, z toward the North Pole). */
export function lonLatOf(v: V3): [number, number] {
  return [(Math.atan2(v[1], v[0]) * 180) / Math.PI, (Math.asin(clamp(v[2], -1, 1)) * 180) / Math.PI];
}

/**
 * The ball's level for a globe of radius R on screen: fine enough that a face's edge is about 30 to 60 pixels, so the
 * facets always show and the ball stays a few hundred faces at the usual size.
 */
export function levelFor(R: number): number {
  return clamp(Math.round(Math.log2((R * 1.107) / 42)), 2, 5);
}

/**
 * Which faces are land, and the colour of each: a face is land when at least four of seven points under it (its
 * corners, its centre and three points between) are land. Snow where its centre is ice or near a pole.
 */
export function classifyFaces(level: number, isLand: (lon: number, lat: number) => boolean, isIce: (lon: number, lat: number) => boolean): { land: boolean[]; colour: RGB[] } {
  const { verts, faces } = icosphere(level);
  const land: boolean[] = [];
  const colour: RGB[] = [];
  faces.forEach(([a, b, c], i) => {
    const A = verts[a]!, B = verts[b]!, C = verts[c]!;
    const m: V3 = norm([A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]]);
    const pts: V3[] = [A, B, C, m, norm([A[0] + m[0], A[1] + m[1], A[2] + m[2]]), norm([B[0] + m[0], B[1] + m[1], B[2] + m[2]]), norm([C[0] + m[0], C[1] + m[1], C[2] + m[2]])];
    let n = 0;
    for (const p of pts) if (isLand(...lonLatOf(p))) n++;
    const [lon, lat] = lonLatOf(m);
    const isL = n >= 4;
    land.push(isL);
    if (!isL) colour.push(COBALT);
    else if (isIce(lon, lat) || Math.abs(lat) > 66) colour.push(SNOW);
    else colour.push(landColour(lat, hash2(i, level * 31 + 7)));
  });
  return { land, colour };
}

// ---- The room around the ball ---------------------------------------------------------------------------------

/** Where the wall meets the floor, as a share of the frame's height. */
const HORIZON = 0.7;

/** The lamp beside the ball: the centre of its pole, the floor it stands on, and the shade's half-width. */
export interface Lamp {
  x: number;
  floor: number;
  s: number;
}

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 140, h: 104 };
export const ZOOM_BOX = { w: 104, h: 140 };

/** Everything the lamp draws, its shade at its widest. */
export function lampBox(l: Lamp): { x0: number; y0: number; x1: number; y1: number } {
  const rimC = l.floor - l.s * 0.14 - l.s * 2.5;
  return { x0: l.x - l.s - 2, y0: rimC - l.s * 0.62 - 2, x1: l.x + l.s + 2, y1: l.floor + l.s * 0.12 + 2 };
}

/**
 * The lamp for a frame, standing on the floor to the ball's left, sized from the ball at its widest zoom (`baseR`).
 * It shrinks a little to fit the room left beside the ball and is left out when there is too little, so it never
 * comes near the ball, the Key or the frame's edge. The same frame and ball always get the same lamp.
 */
export function placeLamp(w: number, h: number, cx: number, cy: number, R: number, baseR: number): Lamp | null {
  const yh = h * HORIZON;
  const floor = yh + (h - yh) * 0.4;
  const gap = Math.max(16, R * 0.1);
  const room = cx - R - gap - 10;
  let s = clamp(baseR * 0.36, 16, 64);
  if (room < 2 * s) s = room / 2;
  if (s < 16) return null;
  // Nearer the ball than the wall's end, so the two read as one scene.
  const x = cx - R - gap - s - Math.max(0, room - 2 * s) * 0.3;
  const l = { x, floor, s };
  const b = lampBox(l);
  if (b.x0 < 6 || b.y0 < 6 || b.y1 > h - 4) return null;
  if (b.x0 < KEY_BOX.w && b.y0 < KEY_BOX.h) return null;
  if (b.x1 > w - ZOOM_BOX.w && b.y1 > h - ZOOM_BOX.h) return null;
  // Clear of the ball: the box's nearest point to its centre is outside the ball by the gap.
  const nx = clamp(cx, b.x0, b.x1), ny = clamp(cy, b.y0, b.y1);
  if (Math.hypot(nx - cx, ny - cy) < R + gap * 0.5) return null;
  return l;
}

/** The shade's eight facets and how long it takes to turn once, in seconds: slow enough to be barely seen. */
export const SHADE_SIDES = 8;
export const SHADE_TURN_S = 90;
/** The shade's slope: its normals lean this far from straight up. */
const SHADE_LEAN = 0.5;

/** Each shade facet's brightness at a moment, front facets and back alike, in a fixed order. */
export function shadeLight(time: number): number[] {
  const th = (time / SHADE_TURN_S) * Math.PI * 2;
  const out: number[] = [];
  for (let i = 0; i < SHADE_SIDES; i++) {
    const a = th + ((i + 0.5) / SHADE_SIDES) * Math.PI * 2;
    // x right, y up, z toward the reader: the facet's normal leans out toward its own side.
    out.push(facetLight([Math.cos(a) * Math.sin(SHADE_LEAN), Math.cos(SHADE_LEAN), Math.sin(a) * Math.sin(SHADE_LEAN)]));
  }
  return out;
}

function poly(g: CanvasRenderingContext2D, pts: [number, number][]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** The lamp: a squat six-sided base, a two-tone pole and an eight-sided umbrella shade turned to `time`. */
function drawLamp(g: CanvasRenderingContext2D, l: Lamp, time: number) {
  const { x, floor, s } = l;
  g.save();
  g.lineJoin = "round";
  g.lineWidth = 1;
  g.strokeStyle = NAVY;
  // The base: the front three sides of a hexagonal slab and its top.
  const bt = floor - s * 0.14;
  const rx = s * 0.5, ry = s * 0.13;
  const hex = (y: number) => Array.from({ length: 6 }, (_, i) => [x + rx * Math.cos((i / 6) * Math.PI * 2), y + ry * Math.sin((i / 6) * Math.PI * 2)] as [number, number]);
  const top = hex(bt), bot = hex(floor);
  for (let i = 0; i < 3; i++) {
    const j = i + 1;
    poly(g, [top[i]!, top[j]!, bot[j]!, bot[i]!]);
    const n: V3 = [Math.cos(((i + 0.5) / 6) * Math.PI * 2), 0, Math.sin(((i + 0.5) / 6) * Math.PI * 2)];
    g.fillStyle = rgb(COBALT, facetLight(n));
    g.fill();
    g.stroke();
  }
  poly(g, top);
  g.fillStyle = rgb(COBALT, facetLight([0, 1, 0]));
  g.fill();
  g.stroke();
  // The pole, lit on its left.
  const pw = Math.max(3, s * 0.1);
  const rimC = bt - s * 2.5;
  g.fillStyle = rgb(MUSTARD, facetLight(norm([-1, 0, 1])));
  g.fillRect(x - pw / 2, rimC, pw / 2, bt - rimC);
  g.fillStyle = rgb(MUSTARD, facetLight(norm([1, 0, 1])));
  g.fillRect(x, rimC, pw / 2, bt - rimC);
  g.strokeRect(x - pw / 2, rimC, pw, bt - rimC);
  // The shade: eight flat facets from the rim up to its peak, the back ones first so the front ones cover them.
  const apex: [number, number] = [x, rimC - s * 0.55];
  const th = (time / SHADE_TURN_S) * Math.PI * 2;
  const rim = (i: number): [number, number] => {
    const a = th + (i / SHADE_SIDES) * Math.PI * 2;
    return [x + s * Math.cos(a), rimC + s * 0.22 * Math.sin(a)];
  };
  const light = shadeLight(time);
  const order = Array.from({ length: SHADE_SIDES }, (_, i) => i).sort((a, b) => Math.sin(th + ((a + 0.5) / SHADE_SIDES) * Math.PI * 2) - Math.sin(th + ((b + 0.5) / SHADE_SIDES) * Math.PI * 2));
  for (const i of order) {
    poly(g, [apex, rim(i), rim(i + 1)]);
    g.fillStyle = rgb(TOMATO, light[i]!);
    g.fill();
    g.stroke();
  }
  g.restore();
}

/** The room: a floor of checked tiles in perspective, the skirting block along the wall, and the ball's hard shadow. */
function roomLayer(f: SurfaceFrame, cache: RenderCache, cx: number, cy: number, R: number): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  if (cache.room?.key === key) return cache.room.canvas;
  const [canvas, g] = offscreen(w, h, dpr);
  const yh = Math.round(h * HORIZON);
  // The floor: tiles a fixed size on the floor, seen from a fixed eye, so rows narrow toward the wall.
  const near = 2.4;
  const F = (h - yh) * near;
  const S = (w * near) / 7;
  const A: RGB = [169, 211, 195];
  const B: RGB = [140, 192, 173];
  g.fillStyle = rgb(B, 1);
  g.fillRect(0, yh, w, h - yh);
  for (let d = near; d < near + 60; d += 1) {
    const ya = yh + F / (d + 1), yb = yh + F / d;
    if (yb - ya < 1.2) break;
    const cols = Math.ceil(((w / 2) * (d + 1)) / S) + 1;
    for (let u = -cols; u < cols; u++) {
      if ((u + Math.round(d)) % 2 === 0) continue;
      poly(g, [
        [w / 2 + (u * S) / d, yb],
        [w / 2 + ((u + 1) * S) / d, yb],
        [w / 2 + ((u + 1) * S) / (d + 1), ya],
        [w / 2 + (u * S) / (d + 1), ya],
      ]);
      g.fillStyle = rgb(A, 1);
      g.fill();
    }
  }
  // The skirting: a cobalt block along the foot of the wall, its top face catching the light.
  const sk = Math.round(clamp(h * 0.03, 7, 18));
  g.fillStyle = rgb(COBALT, facetLight([0, 0, 1]));
  g.fillRect(0, yh - sk, w, sk);
  g.fillStyle = rgb(COBALT, facetLight([0, 1, 0]));
  g.fillRect(0, yh - sk, w, 3);
  g.fillStyle = NAVY;
  g.fillRect(0, yh, w, 1.5);
  // The ball's shadow, a hard flat polygon on the floor straight below it.
  const ys = Math.max(yh + (h - yh) * 0.55, cy + R + (h - cy - R) * 0.45);
  if (ys < h + 4) {
    const rx = R * 0.82, ry = Math.max(4, (h - yh) * 0.07 + R * 0.02);
    const pts = Array.from({ length: 16 }, (_, i) => [cx + rx * Math.cos((i / 16) * Math.PI * 2), ys + ry * Math.sin((i / 16) * Math.PI * 2)] as [number, number]);
    poly(g, pts);
    g.fillStyle = "rgba(18,58,62,0.4)";
    g.fill();
  }
  cache.room = { key, canvas };
  return canvas;
}

/** The ball: every face turned toward the reader, flat-shaded by the one light, its edges faintly darker. */
function paintBall(f: SurfaceFrame, cache: RenderCache, g: CanvasRenderingContext2D) {
  const { proj } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const level = levelFor(R);
  const ball = icosphere(level);
  if (cache.faces?.level !== level || cache.faces.isLand !== f.isLand) cache.faces = { level, isLand: f.isLand, ...classifyFaces(level, f.isLand, f.isIce) };
  const { colour } = cache.faces;
  const rot = geoRotation(proj.rotate() as [number, number, number]);
  // Each corner in the view's space: x right, y up, z toward the reader, as d3's orthographic projection has it.
  const view: V3[] = ball.verts.map((v) => {
    const [l, p] = rot(lonLatOf(v));
    const lr = (l * Math.PI) / 180, pr = (p * Math.PI) / 180;
    return [Math.cos(pr) * Math.sin(lr), Math.sin(pr), Math.cos(pr) * Math.cos(lr)];
  });
  const buckets = new Map<string, Path2D>();
  const edges = new Path2D();
  ball.faces.forEach(([a, b, c], i) => {
    const A = view[a]!, B = view[b]!, C = view[c]!;
    const n = norm(cross(sub(B, A), sub(C, A)));
    if (n[2] <= 0) return;
    const key = rgb(colour[i]!, Math.round(facetLight(n) * 40) / 40);
    let p = buckets.get(key);
    if (!p) buckets.set(key, (p = new Path2D()));
    const tri = [A, B, C].map((v) => [cx + R * v[0], cy - R * v[1]] as const);
    for (const q of [p, edges]) {
      q.moveTo(tri[0]![0], tri[0]![1]);
      q.lineTo(tri[1]![0], tri[1]![1]);
      q.lineTo(tri[2]![0], tri[2]![1]);
      q.closePath();
    }
  });
  g.save();
  g.lineJoin = "round";
  // A stroke in each face's own colour closes the hairline seams between faces.
  g.lineWidth = 0.9;
  for (const [c, p] of buckets) {
    g.fillStyle = g.strokeStyle = c;
    g.fill(p);
    g.stroke(p);
  }
  g.strokeStyle = "rgba(14,22,60,0.22)";
  g.lineWidth = 0.7;
  g.stroke(edges);
  g.restore();
}

// ---- The screen in Map view -----------------------------------------------------------------------------------

/** The screen set into the wall: its outer edge, and the bevel's width inside it. Even margins, so its centre is the frame's. */
export function screenOf(w: number, h: number): { x0: number; y0: number; x1: number; y1: number; bevel: number } {
  const wide = w >= 520 && h >= 360;
  const m = wide ? 26 : 8;
  return { x0: m, y0: m, x1: w - m, y1: h - m, bevel: wide ? 16 : 9 };
}

/** The bevel round the screen: two light sides toward the light, two dark sides away from it, and a hard shadow. */
function bevelLayer(f: SurfaceFrame, cache: RenderCache): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const key = `bevel|${w}|${h}|${dpr}`;
  if (cache.room?.key === key) return cache.room.canvas;
  const [canvas, g] = offscreen(w, h, dpr);
  const s = screenOf(w, h);
  const b = s.bevel;
  const o = { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  const i = { x0: o.x0 + b, y0: o.y0 + b, x1: o.x1 - b, y1: o.y1 - b };
  const sh = Math.max(4, b * 0.45);
  g.fillStyle = "rgba(16,58,60,0.45)";
  g.fillRect(o.x0 + sh, o.y0 + sh, o.x1 - o.x0, o.y1 - o.y0);
  const mint: RGB = [169, 211, 195];
  const sides: [[number, number][], V3][] = [
    [[[o.x0, o.y0], [o.x1, o.y0], [i.x1, i.y0], [i.x0, i.y0]], norm([0, 1, 0.8])],
    [[[o.x0, o.y0], [i.x0, i.y0], [i.x0, i.y1], [o.x0, o.y1]], norm([-1, 0, 0.8])],
    [[[o.x1, o.y0], [o.x1, o.y1], [i.x1, i.y1], [i.x1, i.y0]], norm([1, 0, 0.8])],
    [[[o.x0, o.y1], [i.x0, i.y1], [i.x1, i.y1], [o.x1, o.y1]], norm([0, -1, 0.8])],
  ];
  g.lineJoin = "round";
  g.lineWidth = 1;
  g.strokeStyle = NAVY;
  for (const [pts, n] of sides) {
    poly(g, pts);
    g.fillStyle = rgb(mint, facetLight(n) * 1.05);
    g.fill();
    g.stroke();
  }
  g.lineWidth = 2;
  g.strokeRect(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
  cache.room = { key, canvas };
  return canvas;
}

/**
 * The facet grid's step in degrees for a zoom: a facet's side about 20 to 45 pixels on screen. Every step divides 90,
 * so the grid has a row at each pole.
 */
export function gridStep(pxPerDeg: number): number {
  let step = 10;
  while (step * pxPerDeg > 45 && step > 0.16) step /= 2;
  return step;
}

/**
 * A corner of the facet grid: a fixed grid of longitude and latitude at `step` degrees, each corner nudged by a fixed
 * hash so the facets are irregular. The grid wraps round the world, so corner i and corner i + 360 / step are the same
 * point a turn apart, and the poles stay put.
 */
export function gridPoint(step: number, i: number, j: number): [number, number] {
  const n = Math.round(360 / step);
  const ii = ((i % n) + n) % n;
  const salt = Math.round(Math.log2(64 / step));
  const lat = j * step;
  const pole = Math.abs(lat) >= 90 - 1e-9;
  const jx = (hash2(ii + salt * 101, j + 17) - 0.5) * 0.6 * step;
  const jy = pole ? 0 : (hash2(ii + 53, j + salt * 59) - 0.5) * 0.6 * step;
  return [i * step + jx, clamp(lat + jy, -90, 90)];
}

/** A corner's height for shading, the same every time for the same corner. */
function gridHeight(step: number, i: number, j: number, salt: number): number {
  const n = Math.round(360 / step);
  const ii = ((i % n) + n) % n;
  return hash2(ii * 3 + salt, j * 7 + Math.round(64 / step));
}

/** The flat world on the screen: cobalt facets, then the land's facets cut by the coast, ice, lakes and the coast. */
function paintScreen(f: SurfaceFrame, g: CanvasRenderingContext2D, inner: { x0: number; y0: number; x1: number; y1: number }) {
  const { proj, map, w } = f;
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(proj as GeoProjection, pathContext(p))(o as never);
    return p;
  };
  g.save();
  g.beginPath();
  g.rect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
  g.clip();
  g.fillStyle = rgb(COBALT, 1);
  g.fillRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);

  const pxPerDeg = (proj.scale() * Math.PI) / 180;
  const step = gridStep(pxPerDeg);
  const n = Math.round(360 / step);
  const halfLon = Math.min(180, ((w / 2) / pxPerDeg) * 2.2 + step * 2);
  const halfLat = ((f.h / 2) / pxPerDeg) * 1.4 + step * 2;
  const i0 = Math.floor((f.lon - halfLon) / step);
  const i1 = halfLon >= 180 ? i0 + n : Math.ceil((f.lon + halfLon) / step);
  const j0 = Math.max(-Math.round(90 / step), Math.floor((f.lat - halfLat) / step));
  const j1 = Math.min(Math.round(90 / step), Math.ceil((f.lat + halfLat) / step));
  const cols = i1 - i0 + 1;
  const pt: { x: number; y: number; lon: number; lat: number }[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [lon, lat] = gridPoint(step, i, j);
      const [x, y] = proj([lon, lat]) ?? [NaN, NaN];
      pt.push({ x, y, lon, lat });
    }
  }
  const at = (i: number, j: number) => pt[(j - j0) * cols + (i - i0)]!;
  type Tri = { a: [number, number]; b: [number, number]; c: [number, number]; lat: number; ia: [number, number][] };
  const tris: Tri[] = [];
  const pad = 60;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1), p11 = at(i + 1, j + 1);
      const xs = [p00.x, p10.x, p01.x, p11.x], ys = [p00.y, p10.y, p01.y, p11.y];
      if (xs.some((v) => !Number.isFinite(v)) || ys.some((v) => !Number.isFinite(v))) continue;
      // A cell the map's cut runs through would stretch across the screen; the cobalt underneath shows instead.
      if (Math.max(...xs) - Math.min(...xs) > w * 0.5) continue;
      if (Math.max(...xs) < inner.x0 - pad || Math.min(...xs) > inner.x1 + pad || Math.max(...ys) < inner.y0 - pad || Math.min(...ys) > inner.y1 + pad) continue;
      const lat = (p00.lat + p11.lat) / 2;
      const flip = hash2(((i % n) + n) % n, j * 3 + 1) < 0.5;
      const ids: [number, number][][] = flip
        ? [[[i, j], [i + 1, j], [i + 1, j + 1]], [[i, j], [i + 1, j + 1], [i, j + 1]]]
        : [[[i, j], [i + 1, j], [i, j + 1]], [[i + 1, j], [i + 1, j + 1], [i, j + 1]]];
      for (const t of ids) {
        const [A, B, C] = t.map(([u, v]) => at(u, v));
        tris.push({ a: [A!.x, A!.y], b: [B!.x, B!.y], c: [C!.x, C!.y], lat, ia: t });
      }
    }
  }
  /** A facet's light from its corners' fixed heights: on the map, x is east, y north and z up. */
  const lightOf = (t: Tri, amp: number, salt: number) => {
    const v = t.ia.map(([u, vv]) => {
      const p = at(u, vv);
      return [p.lon, p.lat, gridHeight(step, u, vv, salt) * step * amp] as V3;
    });
    let nrm = norm(cross(sub(v[1]!, v[0]!), sub(v[2]!, v[0]!)));
    if (nrm[2] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    return Math.round(facetLight(nrm) * 25) / 25;
  };
  const fillTris = (list: Tri[], colourOf: (t: Tri) => string, edge: string) => {
    const buckets = new Map<string, Path2D>();
    const edges = new Path2D();
    for (const t of list) {
      const c = colourOf(t);
      let p = buckets.get(c);
      if (!p) buckets.set(c, (p = new Path2D()));
      for (const q of [p, edges]) {
        q.moveTo(t.a[0], t.a[1]);
        q.lineTo(t.b[0], t.b[1]);
        q.lineTo(t.c[0], t.c[1]);
        q.closePath();
      }
    }
    g.lineJoin = "round";
    g.lineWidth = 0.8;
    for (const [c, p] of buckets) {
      g.fillStyle = g.strokeStyle = c;
      g.fill(p);
      g.stroke(p);
    }
    g.strokeStyle = edge;
    g.lineWidth = 0.6;
    g.stroke(edges);
  };
  // The sea: cobalt facets with gentle relief, so the light catches them unevenly.
  fillTris(tris, (t) => rgb(COBALT, 0.82 + (lightOf(t, 0.5, 3) - AMBIENT) * 0.42), "rgba(10,18,70,0.32)");
  // The land: green and mustard facets inside the coast, steeper so the light breaks them up more.
  const land = path(map.land);
  g.save();
  g.clip(land);
  g.fillStyle = rgb(LAND_GREENS[1]!, 0.95);
  g.fillRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
  const near = tris.filter((t) => {
    const ll = t.ia.map(([u, v]) => at(u, v));
    return ll.some((p) => f.isLand(p.lon, p.lat)) || f.isLand((ll[0]!.lon + ll[1]!.lon + ll[2]!.lon) / 3, (ll[0]!.lat + ll[1]!.lat + ll[2]!.lat) / 3) || step <= 1;
  });
  fillTris(
    near,
    (t) => {
      const i = t.ia[0]!;
      const c = Math.abs(t.lat) > 66 ? SNOW : landColour(t.lat, hash2(((i[0] % n) + n) % n, i[1] * 5 + 2));
      return rgb(c, 0.55 + (lightOf(t, 1.1, 9) - AMBIENT) * 0.75 + 0.1);
    },
    "rgba(12,30,24,0.24)",
  );
  if (map.ice) {
    const ice = path(map.ice);
    g.save();
    g.clip(ice);
    fillTris(
      near.filter((t) => Math.abs(t.lat) > 45),
      (t) => rgb(SNOW, 0.8 + (lightOf(t, 1.1, 9) - AMBIENT) * 0.3),
      "rgba(30,60,70,0.2)",
    );
    g.restore();
  }
  g.restore();
  const lakes = path(map.lakes);
  g.fillStyle = rgb(COBALT, 1.08);
  g.fill(lakes);
  if (f.zoom >= 2) {
    g.strokeStyle = rgb(COBALT, 1.08);
    g.lineWidth = 0.9;
    g.stroke(path(map.rivers));
  }
  g.strokeStyle = NAVY;
  g.lineJoin = "round";
  g.lineWidth = 1.1;
  g.stroke(path(map.coast));
  g.lineWidth = 0.8;
  g.stroke(lakes);
  g.restore();
  // A thin dark line where the picture meets the bevel.
  g.strokeStyle = NAVY;
  g.lineWidth = 1.5;
  g.strokeRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
}

// ---- The frame ---------------------------------------------------------------------------------------------------

/** Milliseconds between frames while the lamp's shade turns: eight a second is plenty for so slow a turn. */
export const LAMP_FRAME_MS = 125;

export class RenderCache {
  world = new StillLayer();
  room?: { key: string; canvas: HTMLCanvasElement };
  faces?: { level: number; isLand: (lon: number, lat: number) => boolean; land: boolean[]; colour: RGB[] };
  lamp?: { key: string; lamp: Lamp | null };
}

export function drawRender(f: SurfaceFrame, cache: RenderCache): SurfaceResult {
  const { ctx, w, h, proj, mode } = f;
  if (mode === "3d") {
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    drawPart(f, roomLayer(f, cache, cx, cy, R), 0, h * HORIZON - 24, w, h);
    const lk = `${w}|${h}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
    if (cache.lamp?.key !== lk) cache.lamp = { key: lk, lamp: placeLamp(w, h, cx, cy, R, R / Math.max(1, f.zoom)) };
    const lamp = cache.lamp.lamp;
    if (lamp) drawLamp(ctx, lamp, motionTime());
    const k = R + 3;
    cache.world.draw(f, (g) => paintBall(f, cache, g), [cx - k, cy - k, cx + k, cy + k]);
    return { next: lamp && !f.still ? LAMP_FRAME_MS : 0 };
  }
  const s = screenOf(w, h);
  const inner = { x0: s.x0 + s.bevel, y0: s.y0 + s.bevel, x1: s.x1 - s.bevel, y1: s.y1 - s.bevel };
  ctx.drawImage(bevelLayer(f, cache), 0, 0, w, h);
  cache.world.draw(f, (g) => paintScreen(f, g, inner), [inner.x0 - 1, inner.y0 - 1, inner.x1 + 1, inner.y1 + 1]);
  const clip = new Path2D();
  clip.rect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
  const m = 3;
  return { inside: (x, y) => x > inner.x0 + m && y > inner.y0 + m && x < inner.x1 - m && y < inner.y1 - m, clip };
}
