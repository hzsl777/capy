// Zine (id zine): after the feel of a zine printed on a stencil duplicator in two or three spot
// inks on warm recycled paper, a little out of register, and none of any maker's, shop's or zine's names, logos,
// lettering or art. Only the inks: fluorescent pink, medium blue and, sparingly, yellow, with purple wherever pink
// and blue overprint (each ink multiplies over what is under it, as ink on paper does).
//
// The map is printed in two passes. The blue pass is the land as a coarse halftone dot screen, fuller on mountains
// and finer on ice; the pink pass is the coastline, printed one or two pixels off from the land the way a second
// drum never quite lines up, and a light pink dot screen in the shallows that fades out to bare paper. The globe is
// the same ball of paper with its shading as a coarse blue halftone, the dots growing toward the lower right limb,
// a pink rim printed off register and a pink halftone shadow behind it. Paper-coloured specks knock tiny holes in
// the ink, as stencil-printed ink takes unevenly on rough paper, and the odd dark fleck sits in the paper.
//
// Every dot screen is a pattern fill, never a dot drawn at a time: each tone is one small tile repeated. In Map view
// the screens are fixed to the world (anchored at a point on the map), so they travel with the land when it is
// dragged; on the globe they are fixed to the ball's centre like a printed picture of a ball. The shading's tones are
// a few nested zones each filled with its own screen, so it costs the same at every zoom. Nothing moves on its own.
// No text, and nothing is cut from any political unit.

import { geoPath, type GeoProjection } from "d3-geo";
import { pathContext, seeded, type SurfaceFrame } from "./surface.ts";

/**
 * The inks and the paper. The blue is a medium blue with some red in it: a brighter, greener blue has no red to keep
 * where it multiplies over the pink, so the overprint would come out navy rather than purple.
 */
export const PINK = "#ff48b0";
export const BLUE = "#3255a4";
export const YELLOW = "#ffe800";
export const PAPER = "#f4efe4";
/** The page round the printed sheet: the same stock, a shade warmer where it was handled. */
export const PAGE = "#ece5d5";

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const rgbHex = (c: readonly number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** One ink printed over another: each channel multiplied, as two transparent inks on paper. */
export function overprint(a: string, b: string): string {
  const x = hexRgb(a), y = hexRgb(b);
  return rgbHex(x.map((v, i) => (v * y[i]!) / 255));
}

/**
 * How far the pink pass sits from the blue, in CSS pixels: a little right and down, more on a big screen, never more
 * than two pixels, so a coast reads as one coast printed twice rather than two coasts.
 */
export function misregister(w: number, h: number): [number, number] {
  const k = Math.min(1, Math.max(0, (Math.min(w, h) - 360) / 540));
  return [1 + k * 0.8, 0.8 + k * 0.6];
}

/**
 * A dot screen: the side of its square tile (CSS px), each dot's radius (CSS px), and its angle: "diag" puts a dot at
 * the tile's corners and one in its middle, the 45-degree screen; "square" a dot at the corners only, the screen
 * square to the page. Two inks at two angles, as a printer sets them, so the pink and blue dots never line up.
 */
export interface Screen {
  pitch: number;
  r: number;
  grid: "diag" | "square";
}

/** The share of paper a screen covers with ink, from 0 to 1. */
export function coverage(s: Screen): number {
  return Math.min(1, ((s.grid === "diag" ? 2 : 1) * Math.PI * s.r * s.r) / (s.pitch * s.pitch));
}

/** The land's screens: coarser when the world is small, so the continents still read as dots, never as grey. */
export function landScreens(R: number): { land: Screen; peak: Screen; ice: Screen; shallow: Screen; shallow2: Screen; shade: number } {
  const pitch = R < 170 ? 7 : R < 320 ? 8.5 : 10;
  const sea = pitch * 0.6;
  return {
    land: { pitch, r: pitch * 0.24, grid: "diag" },
    peak: { pitch, r: pitch * 0.31, grid: "diag" },
    ice: { pitch, r: pitch * 0.14, grid: "diag" },
    shallow: { pitch: sea, r: sea * 0.27, grid: "square" },
    shallow2: { pitch: sea, r: sea * 0.17, grid: "square" },
    shade: pitch * 1.15,
  };
}

/**
 * How much a screen's tile is stretched so a whole number of tiles spans the world's width (CSS px) in Map view:
 * when the map is dragged across the 180th meridian the anchor jumps by exactly one world, and the dots must land
 * where they were. The stretch is under half a tile across the world, so the dots keep their size. 1 on the globe.
 */
export function worldFit(tile: number, world: number): number {
  if (!(world > tile)) return 1;
  return world / Math.round(world / tile) / tile;
}

/**
 * The globe's shading, light from the upper left: how dark the ball is at a point given as a share of its radius from
 * the centre (x right, y down), from 0 on the lit side to 1 at the far limb, and 0 outside the ball.
 */
export function shadeAt(nx: number, ny: number): number {
  const d2 = nx * nx + ny * ny;
  if (d2 >= 1) return 0;
  const nz = Math.sqrt(1 - d2);
  const lit = (nx * -0.48 + ny * -0.56 + nz * 0.675) / Math.hypot(0.48, 0.56, 0.675);
  return Math.min(1, Math.max(0, (0.5 - lit) / 0.95));
}

/**
 * The shading's tones as nested zones: zone k is the part of the ball outside a circle centred toward the light
 * (`ox`, `oy`, `rr` as shares of the ball's radius), filled with dots of radius `r` (as a share of the screen's pitch).
 * Every circle is centred at the same point on the lit side and reaches a little further across the ball than the one
 * before, so each zone lies inside the one before and the dots grow step by step toward the lower right limb, the
 * way a halftone of a gradient prints, as a crescent like the shadow's.
 */
export const SHADE_ZONES: readonly { ox: number; oy: number; rr: number; r: number }[] = (() => {
  const u = [0.48 / Math.hypot(0.48, 0.56), 0.56 / Math.hypot(0.48, 0.56)];
  const a = 0.6;
  return [0.3, 0.45, 0.6, 0.72, 0.83, 0.92].map((d, i) => ({ ox: -a * u[0]!, oy: -a * u[1]!, rr: a + d, r: 0.1 + i * 0.064 }));
})();

/** Whether a point (shares of the ball's radius) lies in a shading zone. */
export function inZone(z: { ox: number; oy: number; rr: number }, nx: number, ny: number): boolean {
  return nx * nx + ny * ny < 1 && (nx - z.ox) ** 2 + (ny - z.oy) ** 2 > z.rr * z.rr;
}

/**
 * Where the dot screens are anchored (CSS px). Map view: at 0 degrees, 0 degrees on the map, so a drag carries the
 * dots with the land under them. Globe view: the ball's centre, like a printed picture of a ball.
 */
export function screenAnchor(proj: GeoProjection, globe: boolean): [number, number] {
  const [cx, cy] = proj.translate();
  if (globe) return [cx, cy];
  return proj([0, 0]) ?? [cx, cy];
}

export class ZineCache {
  tiles = new Map<string, HTMLCanvasElement>();
}

/** A screen's tile in device pixels, with the dots at its corners cut by its edges so it repeats seamlessly. */
function screenTile(cache: ZineCache, s: Screen, ink: string, dpr: number): HTMLCanvasElement {
  const n = Math.max(2, Math.round(s.pitch * dpr));
  const r = s.r * dpr;
  const key = `dots:${s.grid}:${n}:${r.toFixed(2)}:${ink}`;
  let c = cache.tiles.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = ink;
  g.beginPath();
  const corners: [number, number][] = [[0, 0], [n, 0], [0, n], [n, n]];
  if (s.grid === "diag") corners.push([n / 2, n / 2]);
  for (const [x, y] of corners) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
  cache.tiles.set(key, c);
  return c;
}

/**
 * Specks: a tile of small marks scattered from a fixed seed, `density` of them per 100 square pixels. Paper-coloured
 * specks knock holes in the ink; dark ones are flecks in the paper.
 */
function speckTile(cache: ZineCache, ink: string, density: number, size: number, dpr: number, seed: number): HTMLCanvasElement {
  const n = Math.round(160 * dpr);
  const key = `speck:${ink}:${density}:${size}:${n}:${seed}`;
  let c = cache.tiles.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const rnd = seeded(seed);
  const count = Math.round(((160 * 160) / 100) * density);
  g.fillStyle = ink;
  g.beginPath();
  for (let i = 0; i < count; i++) {
    const x = rnd() * n, y = rnd() * n;
    const r = (0.35 + rnd() * size) * dpr;
    g.moveTo(x + r, y);
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
  }
  g.fill();
  cache.tiles.set(key, c);
  return c;
}

/**
 * A pattern of a tile, anchored at a point (CSS px), turned by `angle` degrees and stretched by `fit`, one tile pixel
 * per device pixel before the stretch.
 */
function anchored(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, at: [number, number], angle: number, dpr: number, fit = 1): CanvasPattern {
  const p = ctx.createPattern(tile, "repeat")!;
  p.setTransform(new DOMMatrix().translate(at[0], at[1]).rotate(angle).scale(fit / dpr));
  return p;
}

export function drawZine(f: SurfaceFrame, cache: ZineCache) {
  const { ctx, w, h, dpr, proj, mode } = f;
  const globe = mode === "3d";
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  const scr = landScreens(globe ? R : R * 1.6);
  const at = screenAnchor(proj, globe);
  const off = misregister(w, h);
  // The flat map is plate carree, so the world is 2 pi times the scale wide.
  const world = globe ? 0 : 2 * Math.PI * R;
  const screen = (s: Screen, ink: string) => {
    const tile = screenTile(cache, s, ink, dpr);
    return anchored(ctx, tile, at, 0, dpr, worldFit(tile.width / dpr, world));
  };

  const sphere = new Path2D();
  geoPath(proj, pathContext(sphere))({ type: "Sphere" });

  // The page, with a few flecks in the paper.
  ctx.fillStyle = globe ? PAPER : PAGE;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = anchored(ctx, speckTile(cache, "rgba(60,48,40,0.55)", 0.05, 0.5, dpr, 11), [0, 0], 0, dpr);
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  if (globe) {
    // The ball's shadow on the page, a pink halftone a little down and right; the ball covers most of it.
    const sh = new Path2D();
    sh.arc(cx + R * 0.05, cy + R * 0.07, R, 0, Math.PI * 2);
    ctx.fillStyle = anchored(ctx, screenTile(cache, { pitch: scr.shade, r: scr.shade * 0.2, grid: "square" }, PINK, dpr), [cx, cy], 15, dpr);
    ctx.fill(sh);
  }
  ctx.restore();

  // The sheet or the ball: bare paper.
  ctx.fillStyle = PAPER;
  ctx.fill(sphere);
  ctx.save();
  ctx.clip(sphere);

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);

  ctx.globalCompositeOperation = "multiply";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Pink pass, under the land: the shallows, a finer screen nearest the shore fading to a sparser one, then paper.
  // Clipped to the sea, so no pink shows between the land's blue dots.
  ctx.save();
  const sea = new Path2D();
  sea.rect(-10, -10, w + 20, h + 20);
  sea.addPath(land);
  ctx.clip(sea, "evenodd");
  const band = Math.min(26, Math.max(10, R * 0.05));
  ctx.strokeStyle = screen(scr.shallow2, PINK);
  ctx.lineWidth = band * 2;
  ctx.stroke(coast);
  ctx.strokeStyle = screen(scr.shallow, PINK);
  ctx.lineWidth = band;
  ctx.stroke(coast);
  ctx.restore();

  // Blue pass: the land as a dot screen over a faint tint of the same ink.
  ctx.fillStyle = "rgba(50,85,164,0.07)";
  ctx.fill(land);
  ctx.fillStyle = screen(scr.land, BLUE);
  ctx.fill(land);
  peaks(f, ctx, land, screen(scr.peak, BLUE), globe);
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PAPER;
    ctx.fill(ice);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = screen(scr.ice, BLUE);
    ctx.fill(ice);
  }
  const lakes = new Path2D();
  geoPath(proj, pathContext(lakes))(f.map.lakes);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = PAPER;
  ctx.fill(lakes);
  ctx.globalCompositeOperation = "multiply";

  // Pink pass: the coast, the lakes' shores and, once zoomed in, the rivers, all water in the one ink, off register
  // from the blue.
  ctx.save();
  ctx.translate(off[0], off[1]);
  if (f.zoom >= 2.5) {
    const rivers = new Path2D();
    geoPath(proj, pathContext(rivers))(f.map.rivers);
    ctx.strokeStyle = "rgba(255,72,176,0.85)";
    ctx.lineWidth = 1;
    ctx.stroke(rivers);
  }
  ctx.strokeStyle = PINK;
  ctx.lineWidth = R < 170 ? 1 : 1.3;
  ctx.stroke(coast);
  ctx.lineWidth = 0.8;
  ctx.stroke(lakes);
  ctx.restore();

  if (globe) {
    // The ball's shading, a coarse blue halftone at its own angle, the dots growing toward the lower right limb.
    for (const z of SHADE_ZONES) {
      const zone = new Path2D();
      zone.arc(cx, cy, R, 0, Math.PI * 2);
      zone.arc(cx + z.ox * R, cy + z.oy * R, z.rr * R, 0, Math.PI * 2);
      ctx.fillStyle = anchored(ctx, screenTile(cache, { pitch: scr.shade, r: scr.shade * z.r, grid: "square" }, "rgba(50,85,164,0.6)", dpr), [cx, cy], 30, dpr);
      ctx.fill(zone, "evenodd");
    }
  }

  // The ink takes unevenly: paper-coloured specks over everything printed, fixed to the same place as the screens.
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = anchored(ctx, speckTile(cache, PAPER, 2.2, 0.6, dpr, 5), at, 0, dpr);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // The sheet's edge or the ball's rim: a thin blue line, and the pink pass off register from it.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1;
  ctx.stroke(sphere);
  ctx.translate(globe ? Math.max(2, R * 0.008) : off[0] + 0.6, globe ? -Math.max(1.5, R * 0.006) : off[1] + 0.6);
  ctx.strokeStyle = PINK;
  ctx.lineWidth = globe ? 2.2 : 1.6;
  ctx.stroke(sphere);
  ctx.restore();
}

/** Mountains from the relief layer: the blue pass's fuller screen in a small round patch on each peak, kept to land. */
function peaks(f: SurfaceFrame, ctx: CanvasRenderingContext2D, land: Path2D, ink: CanvasPattern, globe: boolean) {
  const list = f.relief?.peaks;
  if (!list) return;
  const { w, h, proj } = f;
  const R = proj.scale();
  const rr = Math.min(9, Math.max(2.5, R * 0.009));
  const out: string[] = [];
  for (const [lon, lat] of list) {
    if (globe && !facing(f, lon, lat)) continue;
    const p = proj([lon, lat]);
    if (!p || p[0] < -rr || p[1] < -rr || p[0] > w + rr || p[1] > h + rr) continue;
    out.push(`M${(p[0] + rr).toFixed(1)} ${p[1].toFixed(1)}a${rr} ${rr} 0 1 0 ${-2 * rr} 0a${rr} ${rr} 0 1 0 ${2 * rr} 0Z`);
  }
  if (!out.length) return;
  ctx.save();
  ctx.clip(land);
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(out.join("")));
  ctx.restore();
}

function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}
