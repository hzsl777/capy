// Record Player (vinyl, experimental): after the feel of a 1970s home turntable, and none of any maker's, label's,
// artist's or album's names, logos or art. The reader plays the world like a record.
//
// Globe view is the turntable seen from above. The world is the record: a polar map with the North Pole at the
// spindle, so every groove is a parallel and turning the record is turning the world in longitude. The tonearm is
// fixed to the screen and its needle is the reticle, at the frame's centre; the record turns under it, and slides
// under it toward or away from the spindle to reach other latitudes, so the camera rides with the arm. Dragging
// round the platter turns the record under the finger; the map's own idle spin turns it clockwise, as a record turns,
// until a place comes under the needle. Around the pole the parallels are pushed out a little to make room for the
// paper centre label (`HOLE`), which covers only the cap round the pole where no place lies (tested). The label is
// the page's, under the canvas, so the canvas leaves a hole for it and every marker is drawn over it.
//
// Map view is the record's sleeve laid on the plinth: the flat map printed on its back in brown ink, the record
// slid half out of it into the margin on a wide screen. Places outside the sleeve are neither drawn nor tuned.
//
// Nothing here carries meaning. The grooves are evenly spaced on screen and never mark a latitude; the sheen on the
// vinyl moves only as the record is turned and stays under the land and the markers, faint enough that no turn, however
// fast, swings any spot's brightness by a tenth. Nothing moves on its own: the record turns only with the map's own
// idle spin, which reduced motion already stops.

import { geoGraticule, geoPath, geoProjection, type GeoProjection } from "d3-geo";
import { offscreen, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * How far the North Pole sits from the spindle, in the record's units (radians on the sphere): colatitude c is drawn
 * at sqrt(c² + HOLE²) from the spindle. It makes room for the centre label; a few tens of degrees out the parallels
 * are spaced almost as on the sphere.
 */
export const HOLE = 0.32;
/** Degrees round the North Pole under the centre label. No place lies that far north (test/vinyl.test.ts). */
export const CAP = 6;
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

/** Pixels per unit of the record at a zoom, with `base` the record's radius on screen at the widest zoom. */
export function recordScale(base: number, zoom: number): number {
  return (base * Math.pow(zoom, ZOOM_POW)) / EDGE_R;
}

/** Where the spindle is on screen: straight above the needle at the frame's centre, by the needle's latitude. */
export function spindleY(h: number, lat: number, s: number): number {
  return h / 2 - s * radiusOf((90 - lat) / DEG);
}

/**
 * The record as the camera on the tonearm sees it: the meridian of `lon` runs straight down from the spindle through
 * the needle, east to its right as seen from above the North Pole, and the point at (lon, lat) is under the needle.
 */
export function recordProjection(lon: number, lat: number, base: number, zoom: number, w: number, h: number, extent: [[number, number], [number, number]]): GeoProjection {
  const s = recordScale(base, zoom);
  return geoProjection(recordRaw)
    .rotate([-lon, -90, 0])
    .scale(s)
    .translate([w / 2, spindleY(h, lat, s)])
    .clipAngle(179.9)
    .clipExtent(extent)
    .precision(0.5);
}

/**
 * A drag on the record: the point under the finger at `from` stays under it at `to`. The record turns about the
 * spindle and slides along the line through the needle, the only ways the camera on the arm lets it move. Grabbed on
 * the label or the platter's rim, the record only turns. Returns the needle's new longitude and latitude.
 */
export function dragRecord(lon: number, lat: number, s: number, w: number, h: number, from: readonly [number, number], to: readonly [number, number]): [number, number] {
  const cx = w / 2;
  const cy = h / 2;
  const sy = spindleY(h, lat, s);
  const grabbed = lon + Math.atan2(from[0] - cx, from[1] - sy) * DEG;
  const rho = Math.hypot(from[0] - cx, from[1] - sy);
  let nlat = lat;
  if (rho > s * radiusOf(CAP / DEG) && rho < s * EDGE_R) {
    const ax = clamp(to[0] - cx, -rho * 0.999, rho * 0.999);
    const d = Math.sqrt(rho * rho - ax * ax);
    // Of the two places the spindle could be, the one nearer where it was, so the record never jumps.
    const ny = Math.abs(to[1] - d - sy) <= Math.abs(to[1] + d - sy) ? to[1] - d : to[1] + d;
    const r = (cy - ny) / s;
    nlat = r <= radiusOf((CAP + 1) / DEG) ? NEEDLE_LAT[1] : 90 - colatOf(r) * DEG;
    nlat = clamp(nlat, NEEDLE_LAT[0], NEEDLE_LAT[1]);
  }
  const ny = spindleY(h, nlat, s);
  return [wrap(grabbed - Math.atan2(to[0] - cx, to[1] - ny) * DEG), nlat];
}

/** The tonearm, fixed to the screen: its pivot up and to the right of the needle, which rests on the frame's centre. */
export const ARM_ANGLE = 35 / DEG;
export function armOf(w: number, h: number): { nx: number; ny: number; px: number; py: number; L: number; base: number } {
  const ca = Math.cos(ARM_ANGLE);
  const sa = Math.sin(ARM_ANGLE);
  // Room for the pivot's base and the counterweight behind it inside the frame.
  const L = Math.max(60, Math.min((w / 2 - 10) / (ca * 1.26), (h / 2 - 10) / (sa * 1.26), 520));
  const nx = w / 2;
  const ny = h / 2;
  return { nx, ny, px: nx + L * ca, py: ny - L * sa, L, base: clamp(L * 0.1, 13, 32) };
}

/** Map view's sleeve: the card inset on the plinth, with room in the side margins for the record on a wide screen. */
export function sleeveOf(w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const wide = w >= 700;
  const mx = wide ? Math.round(clamp(w * 0.09, 56, 140)) : 10;
  const my = wide ? 18 : 10;
  return { x0: mx, y0: my, x1: w - mx, y1: h - (wide ? 22 : 10) };
}

export class VinylCache {
  /** The tonearm, drawn once per frame size. */
  arm?: { key: string; canvas: HTMLCanvasElement; box: [number, number, number, number] };
  /** The sleeve's shadow and the record half out of it, once per frame size. */
  desk?: { key: string; canvas: HTMLCanvasElement };
  /** What the page's centre label was last told, so it is touched only when the record moves. */
  labelAt = "";
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

/**
 * The platter under the record: brushed aluminium whose reflections turn with it, and the strobe's rows of short bars
 * round its rim. Bars, never dots, so nothing on it reads as a place.
 */
function drawPlatter(ctx: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number, R: number, Rp: number, turn: number) {
  if (!onScreen(w, h, sx, sy, R, Rp + 26)) return;
  // Its shadow on the plinth.
  const shade = ctx.createRadialGradient(sx + 4, sy + 7, Rp - 4, sx + 4, sy + 7, Rp + 24);
  shade.addColorStop(0, "rgba(20,10,4,0.55)");
  shade.addColorStop(1, "rgba(20,10,4,0)");
  ctx.fillStyle = shade;
  ctx.fill(ring(sx + 4, sy + 7, Rp - 6, Rp + 24), "evenodd");
  const rim = ring(sx, sy, R - 1, Rp);
  const metal = ctx.createConicGradient(turn - 0.6, sx, sy);
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
  ctx.fill(rim, "evenodd");
  // The rim's edge: a dark line outside and a lit bevel inside.
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(30,30,32,0.7)";
  ctx.beginPath();
  ctx.arc(sx, sy, Rp, 0, Math.PI * 2);
  ctx.stroke();
  const band = Rp - R;
  if (band < 7) return;
  // The strobe: two rows of short dark bars round the rim, turning with the platter.
  ctx.fillStyle = "rgba(28,28,30,0.78)";
  const p = new Path2D();
  for (const [n, r, len] of [
    [180, Rp - band * 0.3, band * 0.24],
    [216, Rp - band * 0.66, band * 0.24],
  ] as const) {
    const half = Math.min(0.9, ((Math.PI * r) / n) * 0.45);
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = r - len / 2;
      const r1 = r + len / 2;
      p.moveTo(sx + c * r0 - s * half, sy + s * r0 + c * half);
      p.lineTo(sx + c * r1 - s * half, sy + s * r1 + c * half);
      p.lineTo(sx + c * r1 + s * half, sy + s * r1 - c * half);
      p.lineTo(sx + c * r0 + s * half, sy + s * r0 - c * half);
      p.closePath();
    }
  }
  ctx.fill(p);
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

/** The world's land, ice, lakes, rivers and coasts, as projected for this frame. */
function drawWorld(f: SurfaceFrame, ctx: CanvasRenderingContext2D, ink: { land: string; ice: string; lake: string; river: string; coast: string; coastWidth: number }) {
  const path = geoPath(f.view as never, ctx);
  const polar = f.mode === "3d" ? (g: unknown) => polarSafe(g as Geo) : (g: unknown) => g;
  ctx.beginPath();
  path(polar(f.map.land) as never);
  ctx.fillStyle = ink.land;
  ctx.fill();
  if (f.map.ice) {
    ctx.beginPath();
    path(polar(f.map.ice) as never);
    ctx.fillStyle = ink.ice;
    ctx.fill();
  }
  ctx.beginPath();
  path(f.map.lakes as never);
  ctx.fillStyle = ink.lake;
  ctx.fill();
  if (f.zoom >= 2) {
    ctx.beginPath();
    path(f.map.rivers as never);
    ctx.strokeStyle = ink.river;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.lineJoin = "round";
  ctx.beginPath();
  path(f.map.coast as never);
  ctx.strokeStyle = ink.coast;
  ctx.lineWidth = ink.coastWidth;
  ctx.stroke();
}

/**
 * The tonearm: its base and pivot, a counterweight behind it, a straight silver tube, and a black headshell set at an
 * angle whose stylus rests exactly on the frame's centre. Beside the base, the arm rest and the cueing lever. Drawn once
 * per frame size into its own layer with a soft shadow on the record.
 */
function armLayer(f: SurfaceFrame, cache: VinylCache) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}`;
  if (cache.arm?.key === key) return cache.arm;
  const a = armOf(w, h);
  const [canvas, g] = offscreen(w, h, dpr);
  const { base, L } = a;
  // In the arm's own frame: the pivot at the origin, the needle at (L, 0).
  const theta = Math.atan2(a.ny - a.py, a.nx - a.px);
  const tube = clamp(L * 0.022, 3.4, 8);
  const hl = clamp(L * 0.15, 26, 64);
  const offset = 0.36;
  const bx = L - hl * Math.cos(offset);
  const by = -hl * Math.sin(offset);
  const beta = Math.atan2(by, bx);
  const tubeLen = Math.hypot(bx, by);

  const metal = (x0: number, y0: number, x1: number, y1: number) => {
    const m = g.createLinearGradient(x0, y0, x1, y1);
    m.addColorStop(0, "#f4f5f6");
    m.addColorStop(0.35, "#c3c7cb");
    m.addColorStop(0.7, "#8a8f94");
    m.addColorStop(1, "#5d6166");
    return m;
  };

  const paint = (shadow: boolean) => {
    g.save();
    g.translate(a.px, a.py);
    g.rotate(theta);
    const fill = (style: string | CanvasGradient) => (shadow ? "rgba(10,6,3,0.42)" : style);
    // The base: a dark round plinth plate with a turned ring.
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
    // The arm rest and the cueing lever, beside the base toward the record.
    g.save();
    g.translate(base * 1.0, base * 1.75);
    g.fillStyle = fill(metal(-base * 0.3, -base * 0.3, base * 0.3, base * 0.3));
    g.beginPath();
    g.roundRect(-base * 0.32, -base * 0.32, base * 0.64, base * 0.64, base * 0.12);
    g.fill();
    g.fillStyle = fill("#1d1b19");
    g.beginPath();
    g.roundRect(-base * 0.12, -base * 1.05, base * 0.24, base * 0.85, base * 0.1);
    g.fill();
    g.fillStyle = fill(metal(0, -base * 1.25, 0, -base * 0.95));
    g.beginPath();
    g.roundRect(-base * 0.42, -base * 1.25, base * 0.84, base * 0.3, base * 0.14);
    g.fill();
    g.restore();
    // The counterweight behind the pivot, its knurled face in fine lines.
    g.save();
    g.rotate(beta);
    const cw0 = -base * 2.1;
    const cw1 = -base * 0.95;
    const cwh = base * 0.62;
    g.fillStyle = fill(metal(0, -cwh, 0, cwh));
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
    g.fillStyle = fill(metal(0, -tube / 2, 0, tube / 2));
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
    // The cantilever: a fine line from the cartridge down to the stylus, which rests on the frame's centre.
    g.strokeStyle = shadow ? "rgba(10,6,3,0.42)" : "#d9dcdf";
    g.lineWidth = 1.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(hl * 0.8, 0);
    g.lineTo(hl, 0);
    g.stroke();
    if (!shadow) {
      // The stylus itself, a small bright diamond exactly on the frame's centre: the reticle.
      const d = clamp(tube * 0.55, 2.2, 3.5);
      g.fillStyle = "#fbfbfb";
      g.strokeStyle = "#1a1a1a";
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(hl - d, 0);
      g.lineTo(hl, -d);
      g.lineTo(hl + d, 0);
      g.lineTo(hl, d);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.restore();
    g.restore();
  };
  g.save();
  g.translate(6, 9);
  g.filter = "blur(3px)";
  paint(true);
  g.restore();
  g.filter = "none";
  paint(false);
  const m = base * 2.6 + 12;
  const box: [number, number, number, number] = [Math.min(a.nx, a.px) - m, Math.min(a.ny, a.py) - m, Math.max(a.nx, a.px) + m, Math.max(a.ny, a.py) + m];
  cache.arm = { key, canvas, box };
  return cache.arm;
}

/** Puts the page's centre label on the spindle, turned with the record and sized to the hole it shows through. */
function placeLabel(box: HTMLElement | null, cache: VinylCache, show: boolean, x = 0, y = 0, r = 0, turn = 0) {
  const el = box?.querySelector<HTMLElement>(".x-vinyl-label");
  if (!el) return;
  const at = show ? `${x.toFixed(1)}|${y.toFixed(1)}|${r.toFixed(2)}|${turn.toFixed(2)}` : "off";
  if (at === cache.labelAt) return;
  cache.labelAt = at;
  el.hidden = !show;
  if (show) el.style.transform = `translate(${(x - 50).toFixed(1)}px, ${(y - 50).toFixed(1)}px) rotate(${turn.toFixed(2)}deg) scale(${(r / 50).toFixed(4)})`;
}

const RECORD = { vinyl: "#0d0c0d", edge: "rgba(210,205,200,0.32)", groove: "rgba(255,250,240,0.055)", runout: "#050505" };

function drawRecord(f: SurfaceFrame, cache: VinylCache, box: HTMLElement | null): SurfaceResult {
  const { ctx, w, h, proj, theme: t } = f;
  const s = proj.scale();
  const [sx, sy] = proj.translate() as [number, number];
  const R = s * EDGE_R;
  const labelR = s * radiusOf(CAP / DEG);
  const Rp = R + clamp(R * 0.045, 6, 40);
  // The record turns clockwise as the longitude under the needle grows, as a record turns.
  const turn = f.lon / DEG;

  drawPlatter(ctx, w, h, sx, sy, R, Rp, turn);

  // The vinyl: a ring round the label's hole, a little lighter toward the edge where the lead-in catches the light.
  const disc = ring(sx, sy, labelR, R);
  const body = ctx.createRadialGradient(sx, sy, labelR, sx, sy, R);
  body.addColorStop(0, RECORD.runout);
  body.addColorStop(0.08, RECORD.vinyl);
  body.addColorStop(0.97, "#141314");
  body.addColorStop(1, "#262525");
  ctx.fillStyle = body;
  ctx.fill(disc, "evenodd");

  const runout = Math.max(5, (R - labelR) * 0.035);
  const leadIn = Math.max(3, R * 0.012);
  const groovePath = grooves(w, h, sx, sy, labelR + runout, R - leadIn, GROOVE_PX);
  ctx.strokeStyle = RECORD.groove;
  ctx.lineWidth = 1;
  ctx.stroke(groovePath);

  // The sheen: two soft bow-ties of light, turning with the record.
  ctx.save();
  ctx.clip(disc, "evenodd");
  const sheen = ctx.createConicGradient(turn - 0.85, sx, sy);
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
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // The world printed on the record, pressed with the grooves that run across it.
  drawWorld(f, ctx, { land: t.land, ice: t.ice, lake: t.lake, river: t.river, coast: t.coast, coastWidth: t.coastWidth });
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "rgba(120,96,60,0.16)";
  ctx.stroke(groovePath);
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  // The record's edge, and the smooth run-out round the label.
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = RECORD.edge;
  ctx.beginPath();
  ctx.arc(sx, sy, R - 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,250,240,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, labelR + runout, 0, Math.PI * 2);
  ctx.stroke();

  const arm = armLayer(f, cache);
  const [x0, y0, x1, y1] = arm.box;
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(w, Math.ceil(x1));
  const by1 = Math.min(h, Math.ceil(y1));
  if (bx1 > bx0 && by1 > by0) ctx.drawImage(arm.canvas, bx0 * f.dpr, by0 * f.dpr, (bx1 - bx0) * f.dpr, (by1 - by0) * f.dpr, bx0, by0, bx1 - bx0, by1 - by0);

  placeLabel(box, cache, true, sx, sy, labelR, f.lon);
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
  drawWorld(f, ctx, { land: SLEEVE.ink, ice: SLEEVE.ice, lake: SLEEVE.card, river: SLEEVE.river, coast: SLEEVE.ink, coastWidth: 0.8 });
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
  // The page hides the reticle in Globe view, where the stylus is the reticle, and shows the label only there.
  if (box && box.dataset.view !== f.mode) box.dataset.view = f.mode;
  if (f.mode === "3d") return drawRecord(f, cache, box);
  placeLabel(box, cache, false);
  return drawSleeve(f, cache);
}
