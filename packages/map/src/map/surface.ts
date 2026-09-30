// What the designs that draw land and sea their own way share (decision 70): Night Drive (neon.ts), Cross Stitch
// (stitch.ts) and Rose Window (glass.ts). The view hands each one a frame; places, arcs and tuning stay in the view.

import type { GeoStream, GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import type { Basemap, Relief } from "./basemap.ts";
import type { Warp } from "./warp.ts";

/** The tilted camera over the flat map (see `Cam` in view.ts). */
export interface SurfaceCam {
  cx: number;
  cy: number;
  sin: number;
  cos: number;
  d: number;
  far: number;
}

/**
 * One frame. The projection is the flat map or the globe as usual; under a tilted camera, `tp` takes a point on the
 * flat map to the screen, raised `lift` pixels, with the camera's scale there.
 */
export interface SurfaceFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  mode: ViewMode;
  theme: Theme;
  proj: GeoProjection;
  cam: SurfaceCam | null;
  tp: (x: number, y: number, lift: number) => [number, number, number];
  /** The projection as the camera sees it: the flat map tilted, or `proj` itself. */
  view: { stream(out: GeoStream): GeoStream };
  zoom: number;
  lon: number;
  lat: number;
  /** The basemap for this scale: the detailed one once zoomed in. */
  map: Basemap;
  /** The light basemap, for what is drawn coarsely at any scale. */
  low: Basemap;
  relief?: Relief;
  isLand: (lon: number, lat: number) => boolean;
  isIce: (lon: number, lat: number) => boolean;
  /** Decision 75: the time for designs that move (ms), whether the reader asked for no motion, and the picture's warp. */
  now?: number;
  still?: boolean;
  warp?: Warp | null;
  /** Decision 76: the time for handmade designs' motion (ms), held at 0 for reduced motion. */
  time?: number;
  /** Where a drag passed on screen over the last moments, oldest first, with the time of each point (Chalkboard). */
  trail?: readonly { x: number; y: number; t: number }[];
  /** Every place ever shown, so drawn things keep clear of them (Toy Train Set's trees). Only grows. */
  anchors?: ReadonlyMap<string, [number, number]>;
}

/** A marker as the view places it this frame, for designs that light markers up (Radar Sweep's glow). */
export interface SurfaceSpot {
  x: number;
  y: number;
  r: number;
  fresh: boolean;
}

/**
 * What a design that frames the map hands back to the view (decision 75): where markers can be seen (`inside`, with
 * `clip` as the same area), anything drawn under the markers once they are placed (`under`), and anything laid over
 * the whole picture afterwards (`over`), such as scanlines or the glass of a screen.
 */
export interface SurfaceResult {
  inside?: (x: number, y: number) => boolean;
  clip?: Path2D;
  under?: (spots: SurfaceSpot[]) => void;
  over?: () => void;
}

/** d3 draws into anything canvas-like; a Path2D only lacks beginPath, which a fresh path doesn't need. */
export function pathContext(p: Path2D) {
  return { beginPath() {}, moveTo: p.moveTo.bind(p), lineTo: p.lineTo.bind(p), arc: p.arc.bind(p), closePath: p.closePath.bind(p) };
}

/** A fixed pseudo-random sequence, so every load draws the same picture. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A fixed pseudo-random value in [0, 1) for two integers. */
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** An offscreen canvas at the frame's resolution, drawn in CSS pixels. */
export function offscreen(w: number, h: number, dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  return [c, g];
}

export const r1 = (v: number) => Math.round(v * 10) / 10;

/** A picture that changes only when the view moves (decision 75), kept for designs that animate over it. */
export class Picture {
  key = "";
  seen = "";
  canvas?: HTMLCanvasElement;
  g?: CanvasRenderingContext2D;
  size = "";
}

/**
 * Draws a picture that changes only when the view moves: straight onto the frame while the view is moving, and into
 * a kept copy once the same view comes round twice, so a sweep or a wave over a still map redraws with one image.
 */
export function cachedPicture(p: Picture, f: SurfaceFrame, key: string, draw: (g: CanvasRenderingContext2D) => void) {
  const { ctx, w, h, dpr } = f;
  if (p.key === key && p.canvas) {
    ctx.drawImage(p.canvas, 0, 0, w, h);
    return;
  }
  if (p.seen !== key) {
    p.seen = key;
    ctx.save();
    draw(ctx);
    ctx.restore();
    return;
  }
  const size = `${w}:${h}:${dpr}`;
  if (!p.canvas || !p.g || p.size !== size) {
    [p.canvas, p.g] = offscreen(w, h, dpr);
    p.size = size;
  } else {
    p.g.setTransform(1, 0, 0, 1, 0, 0);
    p.g.clearRect(0, 0, p.canvas.width, p.canvas.height);
    p.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  p.g.save();
  draw(p.g);
  p.g.restore();
  p.key = key;
  ctx.drawImage(p.canvas, 0, 0, w, h);
}
