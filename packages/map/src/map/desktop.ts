// Desktop 95 (experimental): the world drawn simply, as a mid-1990s desktop program would, in the sixteen colours of
// an early colour PC screen. Flat green land with a black coast on a navy sea, a band of dithered shallows along every
// shore, a dotted grid of longitude and latitude, olive marks for mountains and dithered white ice. Globe view is the
// same ball on black, its shading done by ordered dithering between each colour and its darker or lighter partner,
// the way a sixteen-colour screen faked a sphere. It is drawn at half resolution (`pixel: 2`) into a small canvas
// that is then snapped to the palette, so every pixel of land and sea is one of the sixteen colours and no edge is
// soft. Nothing moves on its own. No text, and nothing drawn from any political unit.

import { geoDistance, geoGraticule, geoPath } from "d3-geo";
import { pathContext, r1, type SurfaceFrame } from "./surface.ts";

/** The sixteen colours, in the order the old colour cards numbered them. */
export const PALETTE: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0, 128],
  [0, 128, 0],
  [0, 128, 128],
  [128, 0, 0],
  [128, 0, 128],
  [128, 128, 0],
  [192, 192, 192],
  [128, 128, 128],
  [0, 0, 255],
  [0, 255, 0],
  [0, 255, 255],
  [255, 0, 0],
  [255, 0, 255],
  [255, 255, 0],
  [255, 255, 255],
];
export const BLACK = 0, NAVY = 1, GREEN = 2, TEAL = 3, OLIVE = 6, SILVER = 7, GRAY = 8, BLUE = 9, LIME = 10, WHITE = 15;
const hex = (i: number) => `#${PALETTE[i]!.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * The colours the land and sea may come out as. A soft edge between two of them snaps to the nearer one, and a tie
 * goes to the earlier in this list, so a blend of land, sea and coast reads as coast.
 */
export const MAP_COLOURS: readonly number[] = [BLACK, NAVY, GREEN, GRAY, SILVER, WHITE, BLUE, OLIVE, LIME, TEAL];

/** Each colour's darker partner, for the globe's shadow side: the step a sixteen-colour screen had. */
export const DARKER: Readonly<Record<number, number>> = { [BLACK]: BLACK, [NAVY]: BLACK, [GREEN]: BLACK, [GRAY]: BLACK, [SILVER]: GRAY, [WHITE]: SILVER, [BLUE]: NAVY, [OLIVE]: BLACK, [LIME]: GREEN, [TEAL]: BLACK };
/** Each colour's lighter partner, for the globe's lit side. */
export const LIGHTER: Readonly<Record<number, number>> = { [BLACK]: BLACK, [NAVY]: BLUE, [GREEN]: LIME, [GRAY]: SILVER, [SILVER]: WHITE, [WHITE]: WHITE, [BLUE]: BLUE, [OLIVE]: OLIVE, [LIME]: LIME, [TEAL]: TEAL };

/** A 4x4 ordered-dither matrix: sixteen thresholds spread so every level is an even pattern. */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The nearest allowed colour for every colour, at five bits a channel: 32,768 entries, built once. */
export function buildLut(allowed: readonly number[] = MAP_COLOURS): Uint8Array {
  const lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
        let best = allowed[0]!, bestD = Infinity;
        for (const i of allowed) {
          const p = PALETTE[i]!;
          const d = (p[0] - R) ** 2 + (p[1] - G) ** 2 + (p[2] - B) ** 2;
          // Strictly nearer only, so a tie keeps the earlier colour.
          if (d < bestD - 1e-9) {
            bestD = d;
            best = i;
          }
        }
        lut[(r << 10) | (g << 5) | b] = best;
      }
    }
  }
  return lut;
}

let LUT: Uint8Array | null = null;

/** Light from the upper left and a little in front, as the old programs lit a ball. */
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((x) => x / n) as [number, number, number];
})();

/**
 * How dark and how light the sphere is at a point given as a share of its radius from the centre (x right, y down),
 * each from 0 to 1: dark grows toward the lower right limb, light only in a small spot at the upper left.
 */
export function shadeAt(nx: number, ny: number): { dark: number; light: number } {
  const d2 = nx * nx + ny * ny;
  if (d2 >= 1) return { dark: 0, light: 0 };
  const nz = Math.sqrt(1 - d2);
  const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  const dark = Math.min(1, Math.max(0, (0.42 - lit) / 0.62));
  const light = Math.min(1, Math.max(0, (lit - 0.9) / 0.1)) * 0.5;
  return { dark, light };
}

/**
 * Snaps every pixel to the palette and, inside the globe's disc (in pixels), dithers its shading: each pixel steps to
 * its darker partner where the shade passes the pixel's threshold in the 4x4 matrix, and twice past it to the partner's
 * partner, so the shadow falls off in even patterns as on a sixteen-colour screen. Works in place.
 */
export function quantize(px: Uint8ClampedArray, width: number, height: number, globe: { cx: number; cy: number; r: number } | null) {
  const lut = (LUT ??= buildLut());
  const r2 = globe ? globe.r * globe.r : 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const by = (y & 3) * 4;
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4;
      let c = lut[((px[i]! >> 3) << 10) | ((px[i + 1]! >> 3) << 5) | (px[i + 2]! >> 3)]!;
      if (globe) {
        const dx = x + 0.5 - globe.cx, dy = y + 0.5 - globe.cy;
        if (dx * dx + dy * dy < r2) {
          const s = shadeAt(dx / globe.r, dy / globe.r);
          const t = (BAYER4[by + (x & 3)]! + 0.5) / 16;
          const level = s.dark * 2;
          if (level > t) c = DARKER[c] ?? c;
          if (level - 1 > t) c = DARKER[c] ?? c;
          if (s.light > t) c = LIGHTER[c] ?? c;
        }
      }
      const p = PALETTE[c]!;
      px[i] = p[0];
      px[i + 1] = p[1];
      px[i + 2] = p[2];
      px[i + 3] = 255;
    }
  }
}

const SPHERE = { type: "Sphere" } as const;
/** A grid every fifteen degrees, drawn dotted like a paint program's guide lines. */
const GRID = geoGraticule().step([15, 15])();

export class DesktopCache {
  canvas?: HTMLCanvasElement;
  g?: CanvasRenderingContext2D;
  patterns = new Map<string, CanvasPattern>();
  size = "";
}

/** A two-colour checkerboard at one canvas pixel per square: the 50% dither of the old screens. */
function checker(cache: DesktopCache, a: number, b: number, dpr: number): CanvasPattern {
  const key = `${a}:${b}:${dpr}`;
  let p = cache.patterns.get(key);
  if (p) return p;
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const g = c.getContext("2d")!;
  g.fillStyle = hex(a);
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = hex(b);
  g.fillRect(0, 0, 1, 1);
  g.fillRect(1, 1, 1, 1);
  p = cache.g!.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  cache.patterns.set(key, p);
  return p;
}

export function drawDesktop(f: SurfaceFrame, cache: DesktopCache) {
  const { ctx, w, h, dpr, proj, mode } = f;
  const globe = mode === "3d";
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const size = `${W}x${H}:${dpr}`;
  if (!cache.canvas || !cache.g || cache.size !== size) {
    cache.canvas = document.createElement("canvas");
    cache.canvas.width = W;
    cache.canvas.height = H;
    // Read back every frame to snap it to the palette, so it lives in memory rather than on the graphics card.
    cache.g = cache.canvas.getContext("2d", { willReadFrequently: true })!;
    cache.patterns.clear();
    cache.size = size;
  }
  const g = cache.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Outside the world: a grey workspace in Map view, black space round the ball.
  g.fillStyle = hex(globe ? BLACK : GRAY);
  g.fillRect(0, 0, W, H);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  /** One canvas pixel, in the CSS pixels the paths are drawn in. */
  const px = 1 / dpr;
  const path = geoPath(proj, g);

  const sphere = new Path2D();
  geoPath(proj, pathContext(sphere))(SPHERE);
  g.fillStyle = hex(NAVY);
  g.fill(sphere);
  g.save();
  g.clip(sphere);

  // The grid: dotted blue lines over the sea, under the land.
  g.beginPath();
  path(GRID);
  g.setLineDash([px, px]);
  g.strokeStyle = hex(BLUE);
  g.lineWidth = px;
  g.stroke();
  g.setLineDash([]);

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);

  // Shallows: a band of navy and blue in a checkerboard along every shore; the land covers its inner half.
  g.lineJoin = "round";
  g.strokeStyle = checker(cache, NAVY, BLUE, dpr);
  g.lineWidth = px * 6;
  g.stroke(coast);

  g.fillStyle = hex(GREEN);
  g.fill(land);
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    g.fillStyle = checker(cache, WHITE, SILVER, dpr);
    g.fill(ice);
  }
  const lakes = new Path2D();
  geoPath(proj, pathContext(lakes))(f.map.lakes);
  g.fillStyle = hex(NAVY);
  g.fill(lakes);
  // Rivers only once zoomed in, where a one-pixel line reads as a river rather than a scratch.
  if (f.zoom >= 2.5) {
    const rivers = new Path2D();
    geoPath(proj, pathContext(rivers))(f.map.rivers);
    g.strokeStyle = hex(BLUE);
    g.lineWidth = px;
    g.stroke(rivers);
  }
  peaks(f, g, px, globe);
  g.strokeStyle = hex(BLACK);
  g.lineWidth = px;
  g.stroke(coast);
  g.stroke(lakes);
  g.restore();

  if (globe) {
    g.strokeStyle = hex(BLACK);
    g.lineWidth = px;
    g.stroke(sphere);
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  const [cx, cy] = proj.translate();
  quantize(img.data, W, H, globe ? { cx: cx * dpr, cy: cy * dpr, r: proj.scale() * dpr } : null);
  g.putImageData(img, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache.canvas, 0, 0);
  ctx.restore();
}

/** Mountains from the relief layer as small olive peaks, two pixel strokes each. */
function peaks(f: SurfaceFrame, g: CanvasRenderingContext2D, px: number, globe: boolean) {
  const list = f.relief?.peaks;
  // The whole world stays flat colour; mountains show once zoomed in, where they read as mountains, not speckle.
  if (!list || f.zoom < 2) return;
  const { w, h, proj } = f;
  const centre: [number, number] = [-proj.rotate()[0], -proj.rotate()[1]];
  const s = px * (f.zoom >= 3 ? 3 : 2);
  const out: string[] = [];
  for (const [lon, lat] of list) {
    if (globe && geoDistance([lon, lat], centre) > Math.PI / 2 - 0.05) continue;
    const p = proj([lon, lat]);
    if (!p || p[0] < -6 || p[1] < -6 || p[0] > w + 6 || p[1] > h + 6) continue;
    out.push(`M${r1(p[0] - s)} ${r1(p[1] + s / 2)}L${r1(p[0])} ${r1(p[1] - s / 2)}L${r1(p[0] + s)} ${r1(p[1] + s / 2)}`);
  }
  g.strokeStyle = hex(OLIVE);
  g.lineWidth = px;
  g.stroke(new Path2D(out.join("")));
}
