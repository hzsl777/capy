// What the designs that draw land and sea their own way share (decision 70): Night Drive (neon.ts), Cross Stitch
// (stitch.ts) and Rose Window (glass.ts). The view hands each one a frame; places, arcs and tuning stay in the view.

import type { GeoStream, GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import type { Basemap, Relief } from "./basemap.ts";

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
  /**
   * Decision 76: milliseconds for a design's own motion (the toy train, the pencil's line boil). Held at 0 for
   * readers who ask for reduced motion, with `still` set, so nothing moves.
   */
  time?: number;
  still?: boolean;
  /** Where a drag passed on screen over the last moments, oldest first, with the time of each point (Chalkboard). */
  trail?: readonly { x: number; y: number; t: number }[];
  /** Every place ever shown, so drawn things keep clear of them (Toy Train Set's trees). Only grows. */
  anchors?: ReadonlyMap<string, [number, number]>;
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
