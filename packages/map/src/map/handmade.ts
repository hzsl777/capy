// What the four handmade designs of decision 76 share: Pop-up Book (popup.ts), Toy Train Set (trainset.ts),
// Chalkboard (chalk.ts) and Sketchbook (sketch.ts). Places, arcs and tuning stay in the view, as in every design.

import { geoDistance, geoPath, type GeoProjection } from "d3-geo";
import type { Basemap } from "./basemap.ts";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

/** A fixed spot in open sea with the radius, in degrees, of open water around it (tested like the scenery). */
export interface SeaSpot {
  kind: string;
  lon: number;
  lat: number;
  r: number;
  flip?: boolean;
}

/** Degrees to radians. */
export const RAD = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One number for a cell of a whole-degree grid, for sets of cells. */
export const cellKey = (i: number, j: number) => (i + 1024) * 4096 + (j + 1024);

const ids = new WeakMap<object, number>();
let nextId = 1;
/** A number that names an object for as long as it lives, so a cache can tell two basemaps apart. */
export function idOf(o: object | undefined): number {
  if (!o) return 0;
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
}

/** The static part of a frame, kept while the view holds still so a moving train or a boiling line is cheap. */
export class StillLayer {
  key = "";
  seen = "";
  canvas?: HTMLCanvasElement;
  g?: CanvasRenderingContext2D;
}

/**
 * Draws the part of a frame that only changes when the view does. While the view moves it is drawn straight onto
 * the map; once two frames in a row share a view (the design's own motion asking for its next frame), it is drawn
 * once into an offscreen canvas and copied from there.
 */
export function stillLayer(f: SurfaceFrame, cache: StillLayer, extra: string, draw: (g: CanvasRenderingContext2D) => void) {
  const key = `${f.mode}:${f.w}:${f.h}:${f.dpr}:${f.lon}:${f.lat}:${f.zoom}:${f.cam?.sin ?? ""}:${idOf(f.map)}:${idOf(f.relief)}:${extra}`;
  if (cache.key === key && cache.canvas) {
    f.ctx.drawImage(cache.canvas, 0, 0, f.w, f.h);
    return;
  }
  if (cache.seen !== key) {
    cache.seen = key;
    draw(f.ctx);
    return;
  }
  const W = Math.max(1, Math.round(f.w * f.dpr)), H = Math.max(1, Math.round(f.h * f.dpr));
  if (!cache.canvas || !cache.g || cache.canvas.width !== W || cache.canvas.height !== H) {
    [cache.canvas, cache.g] = offscreen(f.w, f.h, f.dpr);
  } else {
    cache.g.setTransform(1, 0, 0, 1, 0, 0);
    cache.g.clearRect(0, 0, W, H);
    cache.g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  }
  draw(cache.g);
  cache.key = key;
  f.ctx.drawImage(cache.canvas, 0, 0, f.w, f.h);
}

/** A canvas drawn once and kept until its key changes: skies, frames, table tops. */
export function once(cache: { key?: string; canvas?: HTMLCanvasElement }, key: string, w: number, h: number, dpr: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  if (cache.key !== key || !cache.canvas) {
    const [c, g] = offscreen(w, h, dpr);
    draw(g);
    cache.canvas = c;
    cache.key = key;
  }
  return cache.canvas;
}

const patterns = new Map<string, { ctx: CanvasRenderingContext2D; p: CanvasPattern }>();
/**
 * Specks of one ink scattered over a small tile, repeated: paper grain, felt, chalk dust. Drawn in canvas pixels,
 * so it stays fine at any zoom.
 */
export function speckle(ctx: CanvasRenderingContext2D, dpr: number, ink: string, count: number, size: [number, number], seed: number, tile = 96): CanvasPattern {
  const key = `${ink}:${count}:${size}:${seed}:${tile}:${dpr}`;
  const hit = patterns.get(key);
  if (hit && hit.ctx === ctx) return hit.p;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(tile * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = ink;
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const w = size[0] + rnd() * (size[1] - size[0]);
    g.globalAlpha = 0.35 + rnd() * 0.65;
    g.fillRect(rnd() * tile, rnd() * tile, w, Math.max(0.6, w * (0.4 + rnd() * 0.6)));
  }
  const p = ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  patterns.set(key, { ctx, p });
  return p;
}

/**
 * Short soft strokes running across a tile, repeated without a seam: brush marks in paint, grain in wood, the
 * sweep of an eraser. `len` is the range of their lengths and `width` of their thickness, in pixels.
 */
export function streaks(ctx: CanvasRenderingContext2D, dpr: number, ink: string, count: number, len: [number, number], width: [number, number], seed: number, tile = 160, slant = 0.08): CanvasPattern {
  const key = `streaks:${ink}:${count}:${len}:${width}:${seed}:${tile}:${slant}:${dpr}`;
  const hit = patterns.get(key);
  if (hit && hit.ctx === ctx) return hit.p;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(tile * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.strokeStyle = ink;
  g.lineCap = "round";
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * tile, y = rnd() * tile, l = len[0] + rnd() * (len[1] - len[0]);
    const a = (rnd() - 0.5) * slant * 2;
    g.lineWidth = width[0] + rnd() * (width[1] - width[0]);
    g.globalAlpha = 0.3 + rnd() * 0.7;
    for (const ox of [-tile, 0, tile])
      for (const oy of [-tile, 0, tile]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + l * 0.5, y + oy + l * a * 0.5 - 1, x + ox + l * Math.cos(a), y + oy + l * Math.sin(a));
        g.stroke();
      }
  }
  const p = ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  patterns.set(key, { ctx, p });
  return p;
}

/** Parallel strokes over a tile at an angle: hatching in chalk or pencil, a little uneven so it looks drawn. */
export function hatch(ctx: CanvasRenderingContext2D, dpr: number, ink: string, gap: number, angle: number, width: number, seed: number): CanvasPattern {
  const key = `hatch:${ink}:${gap}:${angle}:${width}:${seed}:${dpr}`;
  const hit = patterns.get(key);
  if (hit && hit.ctx === ctx) return hit.p;
  const tile = gap * 12;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(tile * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.strokeStyle = ink;
  g.lineCap = "round";
  const rnd = seeded(seed);
  // Lines at 45 degrees either way repeat across the tile's edges without a seam.
  const dir = angle >= 0 ? 1 : -1;
  for (let i = -12; i < 24; i++) {
    const o = i * gap;
    g.lineWidth = width * (0.7 + rnd() * 0.6);
    g.globalAlpha = 0.55 + rnd() * 0.45;
    // Each stroke stops short here and there, as a hand lifts off the paper.
    const cut = rnd();
    g.beginPath();
    if (dir > 0) {
      g.moveTo(o, tile);
      g.lineTo(o + tile * (cut < 0.2 ? 0.55 : 1), tile - tile * (cut < 0.2 ? 0.55 : 1));
    } else {
      g.moveTo(o, 0);
      g.lineTo(o + tile * (cut < 0.2 ? 0.6 : 1), tile * (cut < 0.2 ? 0.6 : 1));
    }
    g.stroke();
  }
  const p = ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  patterns.set(key, { ctx, p });
  return p;
}

/** Whether a point is on the globe's near side. */
export function facing(f: SurfaceFrame, lon: number, lat: number, margin = 0.02): boolean {
  const a = lat * RAD, b = f.lat * RAD;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * RAD) > margin;
}

/**
 * Where something standing on the ground at a place is drawn: its foot on screen, how tall a unit of height looks
 * there (`k`, straight up the screen), and the camera's scale. On the tilted map the tilt sets `k`. On the globe
 * things stand up the screen like pieces popping out of a page, shorter toward the rim, where the ground under
 * them is foreshortened, and left out close to it.
 */
export function standAt(f: SurfaceFrame, lon: number, lat: number): { x: number; y: number; s: number; k: number } | null {
  if (f.mode === "3d" && !facing(f, lon, lat, 0.3)) return null;
  const p = f.proj([lon, lat]);
  if (!p) return null;
  if (f.mode === "3d") {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    const rho = Math.hypot(p[0] - cx, p[1] - cy) / R;
    return { x: p[0], y: p[1], s: 1, k: 0.75 * Math.sqrt(Math.max(0, 1 - rho * rho)) };
  }
  const [x, y, s] = f.tp(p[0], p[1], 0);
  return { x, y, s, k: f.cam ? f.cam.sin : 1 };
}

/** Pixels per degree of latitude at the current scale. */
export const pxPerDeg = (proj: GeoProjection) => proj.scale() * RAD;

/** The flat map's offset below the frame's centre where the tilted camera's scale is `s`. */
export function vAtScale(f: SurfaceFrame, s: number): number {
  const c = f.cam!;
  return (c.d * (1 - 1 / s)) / c.sin;
}

/** Screen y of a flat-map offset below the frame's centre, under the tilted camera. */
export function yAtV(f: SurfaceFrame, v: number): number {
  const c = f.cam!;
  return c.cy + (v * c.cos * c.d) / (c.d - v * c.sin);
}

/** The flat map's offset below the frame's centre that the tilted camera shows at screen offset `yo`. */
export function vAtScreen(f: SurfaceFrame, yo: number): number {
  const c = f.cam!;
  return (yo * c.d) / (c.d * c.cos + yo * c.sin);
}

/**
 * Projects the land, coast and ice for this frame. Under the tilted camera they are cut at the draw distance
 * first, since the camera's formula folds points back past the horizon.
 */
export function landPaths(f: SurfaceFrame, map: Basemap): { land: Path2D; coast: Path2D; ice: Path2D | null } {
  const land = new Path2D();
  const coast = new Path2D();
  const ice = map.ice ? new Path2D() : null;
  const ext = f.proj.clipExtent();
  if (f.cam) {
    const c = f.cam;
    const reach = f.w / 2 / c.far + 40;
    f.proj.clipExtent([
      [c.cx - reach, c.cy + vAtScale(f, c.far)],
      [c.cx + reach, c.cy + vAtScreen(f, f.h / 2 + 40)],
    ]);
  }
  const view = f.view as unknown as GeoProjection;
  geoPath(view, pathContext(land) as never)(map.land);
  geoPath(view, pathContext(coast) as never)(map.coast);
  if (ice && map.ice) geoPath(view, pathContext(ice) as never)(map.ice);
  f.proj.clipExtent(ext);
  return { land, coast, ice };
}

/**
 * The coast from the light basemap, for wide soft strokes (shallows, washes, ripples) where the detailed coast
 * adds nothing visible and costs much more to stroke. The same path as `coast` when the light basemap is in use.
 */
export function wideCoast(f: SurfaceFrame, coast: Path2D): Path2D {
  if (f.map === f.low) return coast;
  const out = new Path2D();
  const ext = f.proj.clipExtent();
  if (f.cam) {
    const c = f.cam;
    const reach = f.w / 2 / c.far + 40;
    f.proj.clipExtent([
      [c.cx - reach, c.cy + vAtScale(f, c.far)],
      [c.cx + reach, c.cy + vAtScreen(f, f.h / 2 + 40)],
    ]);
  }
  geoPath(f.view as unknown as GeoProjection, pathContext(out) as never)(f.low.coast);
  f.proj.clipExtent(ext);
  return out;
}

/** Degrees from the view's centre to a spot, for fading things toward the globe's rim. */
export const fromCentre = (f: SurfaceFrame, lon: number, lat: number) => geoDistance([lon, lat], [f.lon, f.lat]) / RAD;

// ---- doodles: little line drawings in open sea, in chalk or pencil ---------------------------------------------

/**
 * Wave marks, a sailboat and two gulls, drawn in chalk on Chalkboard and in pencil on Sketchbook, at spots with
 * open sea all round (test/handmade.test.ts). Each is drawn as wide as its open water, so it never reaches land.
 * No text, and nothing filled, so none reads as a place.
 */
export const DOODLES: readonly SeaSpot[] = [
  { kind: "waves", lon: -42, lat: 24, r: 11 },
  { kind: "gulls", lon: -152, lat: 40, r: 11 },
  { kind: "boat", lon: -24, lat: -34, r: 11 },
  { kind: "waves", lon: -1, lat: -32, r: 8 },
  { kind: "waves", lon: 86, lat: -42, r: 11 },
  { kind: "boat", lon: 52, lat: -36, r: 8 },
  { kind: "waves", lon: -138, lat: -38, r: 11 },
  { kind: "gulls", lon: -120, lat: -14, r: 11 },
  { kind: "boat", lon: 160, lat: 40, r: 7.5 },
  { kind: "gulls", lon: 82, lat: -16, r: 11 },
  { kind: "waves", lon: -2, lat: -56, r: 11 },
  { kind: "waves", lon: -168, lat: 6, r: 8 },
  { kind: "boat", lon: -96, lat: -32, r: 11 },
  { kind: "waves", lon: 122, lat: -54, r: 11 },
  { kind: "gulls", lon: -112, lat: -58, r: 11 },
];

/** The doodles as paths in local units, made on first use (tests import this file without a canvas). */
let doodlePaths: Record<string, Path2D> | null = null;
const makeDoodles = (): Record<string, Path2D> => {
  const wave = (y: number, x0: number, x1: number) => {
    let d = `M${x0} ${y}`;
    const n = 4;
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      d += `Q${x + step / 4} ${y - 0.14} ${x + step / 2} ${y}T${x + step} ${y}`;
    }
    return d;
  };
  return {
    waves: new Path2D(wave(-0.32, -0.9, 0.5) + wave(0, -0.5, 0.95) + wave(0.32, -0.95, 0.3)),
    boat: new Path2D(
      "M-0.85 0.1Q0 0.62 0.85 0.1ZM0 0.12V-0.95M0.06 -0.9L0.72 0.02H0.06M-0.06 -0.72L-0.58 0.02H-0.06" +
        wave(0.62, -0.95, 0.95),
    ),
    gulls: new Path2D("M-0.8 -0.1Q-0.55 -0.42 -0.28 -0.12Q-0.02 -0.42 0.24 -0.1M0.1 0.35Q0.3 0.1 0.52 0.34Q0.72 0.1 0.92 0.33"),
  };
};

/** The doodles in view, stroked in one ink. On the globe they fade toward the rim. */
export function drawDoodles(f: SurfaceFrame, g: CanvasRenderingContext2D, ink: string, width: number) {
  const pxDeg = pxPerDeg(f.proj);
  const paths = (doodlePaths ??= makeDoodles());
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = ink;
  for (const d of DOODLES) {
    let alpha = 1;
    if (f.mode === "3d") {
      const deg = fromCentre(f, d.lon, d.lat);
      if (deg > 78) continue;
      if (deg > 60) alpha = (78 - deg) / 18;
    }
    const p = f.proj([d.lon, d.lat]);
    if (!p) continue;
    const u = Math.min(90, 0.5 * d.r * pxDeg);
    if (u < 6 || p[0] < -u || p[0] > f.w + u || p[1] < -u || p[1] > f.h + u) continue;
    g.globalAlpha = alpha;
    g.save();
    g.translate(p[0], p[1]);
    g.scale(u * (d.flip ? -1 : 1), u);
    g.lineWidth = width / u;
    g.stroke(paths[d.kind]!);
    g.restore();
  }
  g.restore();
}
