// Folding Cube (id fold): after the feel of an early-2000s cube console's menu, where a small purple cube tumbles in
// and opens out. Globe view puts the world on a cube: each face holds a sixth of the sphere as seen from its centre
// (a gnomonic projection onto the face, the classic cube map), and the cube turns as the globe does, the reticle's
// place always facing the reader. Map view lays the same six faces flat as the cube's cross-shaped net: Europe and
// Africa in the middle with the Arctic above and the Antarctic below, the Americas to the left, Asia and the Pacific
// to the right. Switching views folds or unfolds it. No maker's or console's name, logo, sounds or art, and no text.
//
// Faces are cut by the cube, never by any political unit. Places, arcs and tuning stay in the view, which asks this
// module where a place lands (`foldPlace`); a place on a face turned away is neither drawn nor tuned.

import { geoGnomonic, geoGraticule, geoPath, type GeoStream } from "d3-geo";
import type { Basemap } from "./basemap.ts";
import type { Theme, ViewMode } from "../themes.ts";
import { pathContext } from "./surface.ts";

export type V3 = [number, number, number];
/** A rotation as a unit quaternion: w, x, y, z. */
export type Quat = [number, number, number, number];

interface FaceDef {
  /** The outward normal, and the face's own east and up, in world space (x toward 0,0; y toward 90E,0; z north). */
  n: V3;
  e: V3;
  up: V3;
  /** d3's rotation that puts the face's centre in the middle of a gnomonic projection with east right and up up. */
  rotate: [number, number, number];
  /** The face's centre in the flat net, in face half-widths: the middle face at 0,0, each face two units across. */
  net: [number, number];
}

/** The six faces in hinge order: middle, east, back, west, north, south (test/fold.test.ts checks the rotations). */
export const FACES: readonly FaceDef[] = [
  { n: [1, 0, 0], e: [0, 1, 0], up: [0, 0, 1], rotate: [0, 0, 0], net: [0, 0] },
  { n: [0, 1, 0], e: [-1, 0, 0], up: [0, 0, 1], rotate: [-90, 0, 0], net: [2, 0] },
  { n: [-1, 0, 0], e: [0, -1, 0], up: [0, 0, 1], rotate: [180, 0, 0], net: [4, 0] },
  { n: [0, -1, 0], e: [1, 0, 0], up: [0, 0, 1], rotate: [90, 0, 0], net: [-2, 0] },
  { n: [0, 0, 1], e: [0, 1, 0], up: [-1, 0, 0], rotate: [0, -90, 0], net: [0, 2] },
  { n: [0, 0, -1], e: [0, 1, 0], up: [1, 0, 0], rotate: [0, 90, 0], net: [0, -2] },
];

const RAD = Math.PI / 180;
/** The eye's pull in Globe view, per cube half-width: a mild perspective, so the cube reads as a solid. */
const PERSP = 0.2;
/** A face turned further than this from the eye is too thin to show its places (the cosine of the angle). */
const PLACE_FACING = 0.12;
/** How long the views take to fold into each other, and the opening's tumble and opening out (ms, under 2 s). */
export const TURN_MS = 900;
const TUMBLE_MS = 750;
const OPEN_MS = 950;
export const INTRO_MS = TUMBLE_MS + OPEN_MS;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function unit(lon: number, lat: number): V3 {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

/** Which face a direction falls on: the axis it leans along most. */
export function faceOf(p: V3): number {
  const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
  if (az >= ax && az >= ay) return p[2] > 0 ? 4 : 5;
  if (ax >= ay) return p[0] > 0 ? 0 : 2;
  return p[1] > 0 ? 1 : 3;
}

/** A direction's point on its face, from -1 to 1 across and up: where the ray from the centre meets the face. */
export function faceLocal(i: number, p: V3): [number, number] {
  const f = FACES[i]!;
  const pn = dot(p, f.n);
  return [dot(p, f.e) / pn, dot(p, f.up) / pn];
}

/** A place's point in the flat net. */
export function netPoint(lon: number, lat: number): [number, number] {
  const p = unit(lon, lat);
  const i = faceOf(p);
  const [u, v] = faceLocal(i, p);
  const [nx, ny] = FACES[i]!.net;
  return [nx + u, ny + v];
}

/** The nearest point of the net's cross: the row of four faces round the equator, and the column through the poles. */
export function clampNet(x: number, y: number): [number, number] {
  const inRow = x >= -3 && x <= 5 && y >= -1 && y <= 1;
  const inCol = x >= -1 && x <= 1 && y >= -3 && y <= 3;
  if (inRow || inCol) return [x, y];
  const a: [number, number] = [clamp(x, -3, 5), clamp(y, -1, 1)];
  const b: [number, number] = [clamp(x, -1, 1), clamp(y, -3, 3)];
  return Math.hypot(a[0] - x, a[1] - y) <= Math.hypot(b[0] - x, b[1] - y) ? a : b;
}

/** The longitude and latitude at a point of the net (clamped onto it first). */
export function netInvert(x: number, y: number): [number, number] {
  [x, y] = clampNet(x, y);
  let i = FACES.findIndex((f) => Math.abs(x - f.net[0]) <= 1 && Math.abs(y - f.net[1]) <= 1);
  if (i < 0) i = 0;
  const f = FACES[i]!;
  const p = add(add(f.n, f.e, x - f.net[0]), f.up, y - f.net[1]);
  const r = Math.hypot(p[0], p[1], p[2]);
  return [Math.atan2(p[1], p[0]) / RAD, Math.asin(clamp(p[2] / r, -1, 1)) / RAD];
}

// ---- rotations ----------------------------------------------------------------------------------------------------

const IDENTITY: Quat = [1, 0, 0, 0];

export function axisAngle(axis: V3, a: number): Quat {
  const r = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(a / 2) / r;
  return [Math.cos(a / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  let ka = 1 - t;
  let kb = t;
  if (d < 0.9995) {
    const th = Math.acos(d);
    const s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  const q: Quat = [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb, a[3] * ka + bb[3] * kb];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

type M3 = [number, number, number, number, number, number, number, number, number];

function matOf(q: Quat): M3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function quatOf(m: M3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

const apply = (m: M3, p: V3): V3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

// ---- poses --------------------------------------------------------------------------------------------------------

/**
 * Where the six faces are and how the camera sees them. The faces hang off the middle one by hinges opened `theta`
 * (0 flat, a right angle folded into the cube) in the net's own frame: x right, y up, z toward the reader, the middle
 * face at the origin. `q` turns that frame to the camera's about the point `c`; `k` is pixels per face half-width,
 * `persp` the eye's pull, and `ox`, `oy` move the whole picture (the opening's fall).
 */
export interface Pose {
  q: Quat;
  c: V3;
  theta: number;
  k: number;
  persp: number;
  ox: number;
  oy: number;
}

/** The cube's centre in the net's frame once folded: one half-width behind the middle face. */
const CUBE_CENTRE: V3 = [0, 0, -1];

/** Pixels per face half-width at zoom 1: the whole cross in Map view, a cube about the globe's size in Globe view. */
export function foldBase(mode: ViewMode, w: number, h: number): number {
  return mode === "3d" ? Math.min(w, h) * 0.25 : Math.min(w / 8.5, h / 6.5);
}

/**
 * The view at rest. Map view: the net flat and facing the reader, moved so the centre's place is under the reticle.
 * Globe view: the folded cube turned so the centre's place faces the reader, which puts it under the reticle too.
 */
export function restingPose(mode: ViewMode, lon: number, lat: number, k: number): Pose {
  if (mode === "2d") {
    const [x, y] = netPoint(lon, lat);
    return { q: IDENTITY, c: [x, y, 0], theta: 0, k, persp: 0, ox: 0, oy: 0 };
  }
  const l = lon * RAD;
  const f = lat * RAD;
  // The camera's right, up and toward-the-reader axes in world space, as the orthographic globe has them.
  const e: V3 = [-Math.sin(l), Math.cos(l), 0];
  const n: V3 = [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)];
  const d: V3 = [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
  // The folded net's axes in world space: its x is the middle face's east, its y north, its z the face's normal.
  const cols: V3[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
  const m = [0, 1, 2].flatMap((r) => cols.map((col) => dot([e, n, d][r]!, col))) as M3;
  return { q: quatOf(m), c: CUBE_CENTRE, theta: Math.PI / 2, k, persp: PERSP, ox: 0, oy: 0 };
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    q: slerp(a.q, b.q, t),
    c: [l(a.c[0], b.c[0]), l(a.c[1], b.c[1]), l(a.c[2], b.c[2])],
    theta: l(a.theta, b.theta),
    k: Math.exp(l(Math.log(a.k), Math.log(b.k))),
    persp: l(a.persp, b.persp),
    ox: l(a.ox, b.ox),
    oy: l(a.oy, b.oy),
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** A fall that lands with two small bounces. */
function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/** The small cube seen from above and to the right, as it lands: the middle, east and north faces showing. */
const LANDED: Quat = qmul(axisAngle([1, 0, 0], 0.42), axisAngle([0, 1, 0], -0.62));
const TUMBLE_AXIS: V3 = [1, 0.55, 0.3];

/**
 * The opening (ms since it began): a small cube tumbles in from above, lands with a bounce, then opens out into the
 * view at rest, unfolding into the net for Map view or growing into the cube for Globe view.
 */
export function introPose(rest: Pose, ms: number, w: number, h: number): Pose {
  const small = Math.min(w, h) * 0.075;
  const landed: Pose = { q: LANDED, c: CUBE_CENTRE, theta: Math.PI / 2, k: small, persp: PERSP, ox: 0, oy: 0 };
  if (ms < TUMBLE_MS) {
    const t = ms / TUMBLE_MS;
    const spin = (1 - easeOut(t)) * Math.PI * 2.4;
    return {
      ...landed,
      q: qmul(LANDED, axisAngle(TUMBLE_AXIS, spin)),
      ox: -w * 0.16 * (1 - easeOut(t)),
      oy: -(h / 2 + small * 2.5) * (1 - bounce(t)),
    };
  }
  return blendPose(landed, rest, easeInOut(clamp((ms - TUMBLE_MS) / OPEN_MS, 0, 1)));
}

/** Between the two views (t from 0 at `from` to 1 at `to`): the faces fold up or open out as the cube turns. */
export function turnPose(from: Pose, to: Pose, t: number): Pose {
  return blendPose(from, to, easeInOut(clamp(t, 0, 1)));
}

/** A face's centre and its across and up axes in the net's frame, hinged open `theta`. */
function hinged(theta: number): { o: V3; u: V3; v: V3 }[] {
  const c = Math.cos(theta), s = Math.sin(theta);
  const c2 = Math.cos(2 * theta), s2 = Math.sin(2 * theta);
  const X: V3 = [1, 0, 0];
  const Y: V3 = [0, 1, 0];
  const uE: V3 = [c, 0, -s];
  const uB: V3 = [c2, 0, -s2];
  const uW: V3 = [c, 0, s];
  const vN: V3 = [0, c, -s];
  const vS: V3 = [0, c, s];
  return [
    { o: [0, 0, 0], u: X, v: Y },
    { o: add(X, uE), u: uE, v: Y },
    { o: add(add(X, uE, 2), uB), u: uB, v: Y },
    { o: add([-1, 0, 0], uW, -1), u: uW, v: Y },
    { o: add(Y, vN), u: X, v: vN },
    { o: add([0, -1, 0], vS, -1), u: X, v: vS },
  ];
}

/** A pose worked out for drawing: face points to the screen, and how squarely each face meets the eye. */
export class Camera {
  private m: M3;
  private faces: { o: V3; u: V3; v: V3; n: V3 }[];
  /** For each face: the cosine between its normal and the way to the eye; above 0 it faces the reader. */
  readonly facing: number[];
  /** For each face: its centre's depth toward the reader, for drawing far faces first. */
  readonly depth: number[];

  constructor(
    readonly pose: Pose,
    readonly w: number,
    readonly h: number,
  ) {
    this.m = matOf(pose.q);
    this.faces = hinged(pose.theta).map((f) => ({ ...f, n: cross(f.u, f.v) }));
    this.facing = [];
    this.depth = [];
    for (const f of this.faces) {
      const o = this.view(f.o);
      const n = apply(this.m, f.n);
      const eye: V3 = pose.persp > 1e-6 ? [-o[0], -o[1], 1 / pose.persp - o[2]] : [0, 0, 1];
      this.facing.push(dot(n, eye) / (Math.hypot(...eye) || 1));
      this.depth.push(o[2]);
    }
  }

  private view(p: V3): V3 {
    const c = this.pose.c;
    return apply(this.m, [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  }

  /**
   * A point on face `i`, `u` across and `v` up (each -1 to 1), on the screen; with `grow`, the same point on a cube that
   * much larger round the folded cube's centre (the glass shell).
   */
  at(i: number, u: number, v: number, grow = 0): [number, number] {
    const f = this.faces[i]!;
    let p: V3 = [f.o[0] + f.u[0] * u + f.v[0] * v, f.o[1] + f.u[1] * u + f.v[1] * v, f.o[2] + f.u[2] * u + f.v[2] * v];
    if (grow) p = add(CUBE_CENTRE, add(p, CUBE_CENTRE, -1), 1 + grow);
    const q = this.view(p);
    const { k, persp, ox, oy } = this.pose;
    const s = 1 / Math.max(0.25, 1 - q[2] * persp);
    return [this.w / 2 + ox + q[0] * k * s, this.h / 2 + oy - q[1] * k * s];
  }

  /** The face's normal as the camera sees it. */
  normal(i: number): V3 {
    return apply(this.m, this.faces[i]!.n);
  }
}

/** Where a place is drawn, or null when its face is turned away or too thin to read. */
export function foldPlace(cam: Camera, lon: number, lat: number): { x: number; y: number; s: number } | null {
  const p = unit(lon, lat);
  const i = faceOf(p);
  if (cam.facing[i]! < PLACE_FACING) return null;
  const [u, v] = faceLocal(i, p);
  const [x, y] = cam.at(i, u, v);
  return { x, y, s: 1 };
}

// ---- drawing ------------------------------------------------------------------------------------------------------

const GRID = geoGraticule().step([15, 15])();
/** Light from the upper left and in front, as on a glossy menu. */
const LIGHT: V3 = (() => {
  const l: V3 = [-0.45, 0.65, 0.6];
  const r = Math.hypot(...l);
  return [l[0] / r, l[1] / r, l[2] / r];
})();

export interface FoldFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  theme: Theme;
  map?: Basemap;
  zoom: number;
  cam: Camera;
  /** The cube at rest in Globe view, rather than turning between views or opening (draws its glass shell). */
  globe: boolean;
}

/** Face corners in drawing order, as across and up. */
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function quad(cam: Camera, i: number, grow = 0): Path2D {
  const p = new Path2D();
  CORNERS.forEach(([u, v], j) => {
    const [x, y] = cam.at(i, u, v, grow);
    if (j === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  });
  p.closePath();
  return p;
}

function onScreen(cam: Camera, i: number): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of CORNERS) {
    const [x, y] = cam.at(i, u, v);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 > -8 && y1 > -8 && x0 < cam.w + 8 && y0 < cam.h + 8;
}

/**
 * The world's lines on face `i`: the face's own gnomonic projection, clipped to the face's square, then carried onto
 * the screen by the pose. Straight lines on the face stay straight on the screen, so d3's resampling on the face holds.
 */
function facePath(cam: Camera, i: number, ctx: CanvasRenderingContext2D | ReturnType<typeof pathContext>) {
  const S = Math.max(40, cam.pose.k * 1.25);
  const proj = geoGnomonic()
    .rotate(FACES[i]!.rotate)
    .scale(S)
    .translate([0, 0])
    .clipAngle(57)
    .clipExtent([
      [-S, -S],
      [S, S],
    ])
    .precision(0.5);
  const onto = (out: GeoStream): GeoStream => ({
    point: (x, y) => {
      const [sx, sy] = cam.at(i, x / S, -y / S);
      out.point(sx, sy);
    },
    lineStart: () => out.lineStart(),
    lineEnd: () => out.lineEnd(),
    polygonStart: () => out.polygonStart(),
    polygonEnd: () => out.polygonEnd(),
    sphere: () => out.sphere?.(),
  });
  return geoPath({ stream: (out: GeoStream) => proj.stream(onto(out)) } as never, ctx as never);
}

/** Draws the cube or its net. Faces turned away show their plain inside while the cube folds; at rest none show. */
export function drawFold(f: FoldFrame) {
  const { ctx, cam, theme: t, map, w, h } = f;
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => cam.depth[a]! - cam.depth[b]!);
  const flat = cam.pose.theta < 0.02;
  const visible = order.filter((i) => (flat ? onScreen(cam, i) : cam.facing[i]! > 0 || !f.globe));

  // A soft shadow under the cube on the stage, or under the flat net.
  ctx.save();
  if (flat) {
    const all = new Path2D();
    for (const i of visible) all.addPath(quad(cam, i));
    ctx.shadowColor = "rgba(6, 2, 20, 0.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#1c1146";
    ctx.fill(all);
  } else {
    const { k, ox, oy } = cam.pose;
    const cx = w / 2 + ox;
    const ground = h / 2 + k * 2.05;
    const lift = Math.min(1, Math.max(0, -oy / (h * 0.6)));
    const r = k * 2 * (1 - lift * 0.5);
    const g = ctx.createRadialGradient(cx, ground, 0, cx, ground, r);
    g.addColorStop(0, `rgba(4, 0, 18, ${0.5 * (1 - lift)})`);
    g.addColorStop(1, "rgba(4, 0, 18, 0)");
    ctx.translate(cx, ground);
    ctx.scale(1, 0.22);
    ctx.translate(-cx, -ground);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, ground - r, r * 2, r * 2);
  }
  ctx.restore();

  const glass = f.globe ? 0.075 : 0;
  // The glass shell's far walls, faintly, behind the world cube.
  if (glass) {
    for (const i of order) {
      if (cam.facing[i]! > 0) continue;
      const p = quad(cam, i, glass);
      ctx.fillStyle = "rgba(190, 170, 255, 0.07)";
      ctx.fill(p);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(205, 188, 255, 0.35)";
      ctx.stroke(p);
    }
  }

  const maxRank = f.zoom < 1.8 ? 4 : f.zoom < 3.5 ? 5 : 9;
  for (const i of visible) {
    const sq = quad(cam, i);
    if (cam.facing[i]! <= 0) {
      // The inside of the box, seen while it folds.
      ctx.fillStyle = "#24155e";
      ctx.fill(sq);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(196, 178, 255, 0.6)";
      ctx.stroke(sq);
      continue;
    }
    ctx.save();
    ctx.clip(sq);
    ctx.fillStyle = t.ocean;
    ctx.fill(sq);
    if (map) {
      const lines = new Path2D();
      facePath(cam, i, pathContext(lines))(GRID);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = t.graticule;
      ctx.stroke(lines);
      const land = new Path2D();
      facePath(cam, i, pathContext(land))(map.land);
      const coast = new Path2D();
      facePath(cam, i, pathContext(coast))(map.coast);
      // Light shallows along every coast, then the land like a raised lavender tile.
      ctx.lineJoin = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = t.shallows ?? t.waterline;
      ctx.stroke(coast);
      ctx.fillStyle = t.land;
      ctx.fill(land);
      if (map.ice) {
        const ice = new Path2D();
        facePath(cam, i, pathContext(ice))(map.ice);
        ctx.fillStyle = t.ice;
        ctx.fill(ice);
      }
      const lakes = new Path2D();
      facePath(cam, i, pathContext(lakes))(map.lakes);
      ctx.fillStyle = t.lake;
      ctx.fill(lakes);
      const rivers = new Path2D();
      const draw = facePath(cam, i, pathContext(rivers));
      for (const r of map.rivers.features) if ((r.properties?.r ?? 9) <= maxRank) draw(r);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = t.river;
      ctx.stroke(rivers);
      ctx.lineWidth = t.coastWidth;
      ctx.strokeStyle = t.coast;
      ctx.stroke(coast);
    }
    // Faces turned from the light are a little darker, and a gloss runs down from each face's upper left corner.
    const lit = dot(cam.normal(i), LIGHT);
    const dim = Math.max(0, 0.6 - lit) * 0.45;
    if (dim > 0.005) {
      ctx.fillStyle = `rgba(14, 6, 46, ${dim.toFixed(3)})`;
      ctx.fill(sq);
    }
    const [gx0, gy0] = cam.at(i, -1, 1);
    const [gx1, gy1] = cam.at(i, 0.2, -0.2);
    const gloss = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    gloss.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    gloss.addColorStop(0.55, "rgba(255, 255, 255, 0.04)");
    gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gloss;
    ctx.fill(sq);
    ctx.restore();
    // Lavender edges, a lighter line inside a darker one, like a moulded plastic rim.
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(40, 22, 104, 0.9)";
    ctx.stroke(sq);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#cdbcff";
    ctx.stroke(sq);
  }

  // The glass shell's near walls: a faint tint, a sheen, and pale edges, so the world cube sits inside clear glass.
  if (glass) {
    for (const i of order) {
      if (cam.facing[i]! <= 0) continue;
      const p = quad(cam, i, glass);
      ctx.fillStyle = "rgba(200, 182, 255, 0.06)";
      ctx.fill(p);
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(226, 214, 255, 0.75)";
      ctx.stroke(p);
    }
  }
}

/** A great circle from one place to others, as screen lines broken wherever it leaves a face shown or jumps a cut. */
export function foldArc(cam: Camera, interp: (t: number) => [number, number], into: Path2D) {
  const n = 48;
  const jump = Math.min(cam.w, cam.h) * 0.25;
  let last: { x: number; y: number } | null = null;
  for (let j = 0; j <= n; j++) {
    const [lon, lat] = interp(j / n);
    const p = foldPlace(cam, lon, lat);
    if (!p) {
      last = null;
      continue;
    }
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < jump) into.lineTo(p.x, p.y);
    else into.moveTo(p.x, p.y);
    last = p;
  }
}
