// Block World: the world built from square blocks, after the feel of a blocky sandbox game, with none of its
// characters, names or art. The frame is a grid of blocks fixed to the screen with one block under the reticle.
// Land blocks are grass-topped, sand along warm coasts and in deserts, stone on mountains with snow on the highest,
// and snow toward the poles and on ice. Where a block stands above the one in front of it (below it on screen) its
// front face shows: dirt under the grass, the sand's side, the stone's side. The sea is translucent blue blocks,
// paler over the shallows. Every block of a kind shares one pixel texture, as in the games. Outside the world is a
// sky with square clouds and a square sun. No text, and markers stay the view's.

import { geoPath } from "d3-geo";
import { hash2, offscreen, type SurfaceFrame } from "./surface.ts";

export interface BlockGrid {
  /** Block size in CSS pixels, a multiple of 4 so each texture pixel is two screen pixels across. */
  s: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

/** The block grid for a frame: a block's centre sits at (or within a pixel of) the frame's centre. */
export function blockGrid(w: number, h: number): BlockGrid {
  const s = w < 560 ? 12 : 16;
  const even = (v: number) => Math.round(v / 2) * 2;
  const x0 = even(((((w / 2 - s / 2) % s) + s) % s) - s);
  const y0 = even(((((h / 2 - s / 2) % s) + s) % s) - s);
  return { s, x0, y0, cols: Math.ceil((w - x0) / s), rows: Math.ceil((h - y0) / s) };
}

// Block kinds. The sea is 0; land kinds carry a height, which sets the front faces.
const SEA = 0;
const SHALLOW = 1;
const GRASS = 2;
const SAND = 3;
const SNOW = 4;
const STONE = 5;
const PEAK = 6;
const HEIGHT = [0, 0, 1, 1, 1, 2, 3];

/** How many texture pixels a block has on each side: two screen pixels each. */
const texels = (s: number) => s / 2;

/** `glass`: water laid over the texture, so the bed shows through it as through the games' translucent water. */
type Tex = { base: string; specks: [string, number][]; bevel: boolean; top?: string; drip?: boolean; glass?: string };

// Top faces: a base colour with pixels of lighter and darker shades at fixed pseudo-random spots.
const TOPS: Record<number, Tex> = {
  // Water over a bed of gravel in the deep and of sand in the shallows.
  [SEA]: { base: "#55607a", specks: [["#3a4560", 0.32], ["#7a8398", 0.22]], bevel: false, glass: "rgba(38,84,200,0.74)" },
  [SHALLOW]: { base: "#e0d196", specks: [["#b8a468", 0.3], ["#f2e8bd", 0.2]], bevel: false, glass: "rgba(48,128,232,0.55)" },
  [GRASS]: { base: "#63a83a", specks: [["#579a31", 0.26], ["#74ba47", 0.2]], bevel: true },
  [SAND]: { base: "#e0d196", specks: [["#d3c283", 0.24], ["#ece0ad", 0.2]], bevel: true },
  [SNOW]: { base: "#f2f6fa", specks: [["#dfe7ef", 0.24]], bevel: true },
  [STONE]: { base: "#8e8e8e", specks: [["#7b7b7b", 0.26], ["#a2a2a2", 0.2], ["#666666", 0.05]], bevel: true },
  [PEAK]: { base: "#f7f9fc", specks: [["#e2e9f1", 0.22]], bevel: true },
};
// Front faces: dirt under a lip of grass or snow, the sand's side, the stone's side.
const DIRT: [string, number][] = [["#6f4522", 0.24], ["#9a6636", 0.2]];
const SIDES: Record<number, Tex> = {
  [GRASS]: { base: "#86562a", specks: DIRT, bevel: false, top: "#5b9c33", drip: true },
  [SAND]: { base: "#c9b87a", specks: [["#bba96b", 0.26], ["#d8c88c", 0.18]], bevel: false },
  [SNOW]: { base: "#86562a", specks: DIRT, bevel: false, top: "#eef3f8", drip: true },
  [STONE]: { base: "#6c6c6c", specks: [["#5c5c5c", 0.26], ["#7e7e7e", 0.2]], bevel: false },
  [PEAK]: { base: "#6c6c6c", specks: [["#5c5c5c", 0.26], ["#7e7e7e", 0.2]], bevel: false, top: "#eef3f8", drip: true },
};

function texture(s: number, t: Tex, seed: number): HTMLCanvasElement {
  const n = texels(s);
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = t.base;
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = hash2(x + seed * 17, y + seed * 31);
      let acc = 0;
      for (const [colour, share] of t.specks) {
        acc += share;
        if (r < acc) {
          g.fillStyle = colour;
          g.fillRect(x * 2, y * 2, 2, 2);
          break;
        }
      }
    }
  if (t.glass) {
    g.fillStyle = t.glass;
    g.fillRect(0, 0, s, s);
    // Ripples on the surface: short pale streaks two texture pixels long.
    g.fillStyle = "rgba(255,255,255,0.16)";
    for (let y = 0; y < n; y++) for (let x = 0; x < n - 1; x++) if (hash2(x + seed * 7, y + seed * 13) < 0.07) g.fillRect(x * 2, y * 2, 4, 2);
  }
  if (t.top) {
    // A lip of the top's colour one texture pixel deep, dripping a pixel further in places, so the dirt shows below.
    g.fillStyle = t.top;
    g.fillRect(0, 0, s, 2);
    if (t.drip) for (let x = 0; x < n; x++) if (hash2(x, seed) < 0.4) g.fillRect(x * 2, 2, 2, 2);
  }
  if (t.bevel) {
    // A lighter top and left edge and a darker bottom and right edge, so each block reads on its own.
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(0, 0, s, 2);
    g.fillRect(0, 2, 2, s - 2);
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.fillRect(0, s - 2, s, 2);
    g.fillRect(s - 2, 0, 2, s - 2);
  } else if (!t.top) {
    // Water: a faint line along each block's top, so the sea reads as blocks too.
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.fillRect(0, 0, s, 2);
  }
  return c;
}

export class BlocksCache {
  small?: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  tex?: { s: number; ctx: CanvasRenderingContext2D; tops: Map<number, CanvasPattern>; sides: Map<number, CanvasPattern> };
  sky?: { key: string; canvas: HTMLCanvasElement };
}

function patterns(f: SurfaceFrame, cache: BlocksCache, s: number) {
  if (cache.tex?.s === s && cache.tex.ctx === f.ctx) return cache.tex;
  const tops = new Map<number, CanvasPattern>();
  const sides = new Map<number, CanvasPattern>();
  for (const [k, t] of Object.entries(TOPS)) tops.set(Number(k), f.ctx.createPattern(texture(s, t, Number(k)), "repeat")!);
  for (const [k, t] of Object.entries(SIDES)) sides.set(Number(k), f.ctx.createPattern(texture(s, t, Number(k) + 40), "repeat")!);
  cache.tex = { s, ctx: f.ctx, tops, sides };
  return cache.tex;
}

/**
 * The sky around the world: a blue gradient, square clouds in two layers and a square sun, drawn once per frame
 * size into an offscreen canvas.
 */
function sky(f: SurfaceFrame, cache: BlocksCache) {
  const { ctx, w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}`;
  if (cache.sky?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#6f9cf5");
    grad.addColorStop(0.7, "#a9c8fb");
    grad.addColorStop(1, "#c4dafc");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const u = w < 560 ? 6 : 8;
    // The sun: a pale square in a softer square halo, top right.
    const sx = Math.round(w * 0.86 / u) * u, sy = Math.round(h * 0.1 / u) * u;
    g.fillStyle = "rgba(255,250,210,0.35)";
    g.fillRect(sx - u * 4, sy - u * 4, u * 8, u * 8);
    g.fillStyle = "#fff8c8";
    g.fillRect(sx - u * 2.5, sy - u * 2.5, u * 5, u * 5);
    // Clouds: flat slabs built from blocks, each a few rows of blocks with a shaded underside.
    const rnd = (a: number, b: number) => hash2(a, b);
    for (let i = 0; i < 14; i++) {
      const cx = Math.round((rnd(i, 1) * (w + 200) - 100) / u) * u;
      const cy = Math.round((rnd(i, 2) * h * 0.95) / u) * u;
      const len = 5 + Math.floor(rnd(i, 3) * 9);
      const rows = 2 + Math.floor(rnd(i, 4) * 2);
      for (let r = 0; r < rows; r++) {
        const inset = r === 0 ? Math.floor(rnd(i, 5 + r) * 3) + 1 : Math.floor(rnd(i, 5 + r) * 2);
        const span = len - inset - Math.floor(rnd(i, 9 + r) * 2);
        g.fillStyle = r === rows - 1 ? "rgba(220,230,244,0.92)" : "rgba(255,255,255,0.92)";
        g.fillRect(cx + inset * u, cy + r * u, Math.max(2, span) * u, u);
      }
    }
    cache.sky = { key, canvas };
  }
  ctx.drawImage(cache.sky.canvas, 0, 0, w, h);
}

const SPHERE = { type: "Sphere" } as const;

export function drawBlocks(f: SurfaceFrame, cache: BlocksCache) {
  const { ctx, w, h, proj, mode } = f;
  const globe = mode === "3d";
  const { s, x0, y0, cols, rows } = blockGrid(w, h);
  const [gx, gy] = proj.translate();
  const R = proj.scale();
  sky(f, cache);

  // Which blocks belong to the world: inside the sphere's disc on the globe, inside the sheet on the map.
  let inWorld: (x: number, y: number) => boolean;
  if (globe) inWorld = (x, y) => Math.hypot(x - gx, y - gy) < R - 1;
  else {
    const [[bx0, by0], [bx1, by1]] = geoPath(proj).bounds(SPHERE);
    inWorld = (x, y) => x > bx0 && x < bx1 && y > by0 && y < by1;
  }

  // Which blocks are land, and of what kind: the basemap drawn at one pixel per block and read back.
  if (!cache.small) {
    const canvas = document.createElement("canvas");
    cache.small = { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true })! };
  }
  const { canvas: sc, ctx: sg } = cache.small;
  if (sc.width !== cols || sc.height !== rows) {
    sc.width = cols;
    sc.height = rows;
  } else {
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, cols, rows);
  }
  sg.setTransform(1 / s, 0, 0, 1 / s, -x0 / s, -y0 / s);
  const small = geoPath(proj, sg);
  const base = proj.scale() < 1500 ? f.low : f.map;
  sg.beginPath();
  small(base.land);
  sg.fillStyle = "#00ff00";
  sg.fill();
  sg.globalCompositeOperation = "source-atop";
  // Relief points lie about a degree apart along ranges and across deserts. Deserts are dabbed into the small
  // canvas as sand (cyan); peaks are counted per block below.
  const perDegree = (R * Math.PI) / 180;
  const at = (lon: number, lat: number) => (globe && !facing(f, lon, lat) ? null : proj([lon, lat]));
  if (f.relief) {
    sg.fillStyle = "#00ffff";
    const r = Math.max(s * 0.5, 0.8 * perDegree);
    for (const [lon, lat] of f.relief.dunes) {
      const p = at(lon, lat);
      if (p) sg.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    }
  }
  if (base.ice) {
    sg.beginPath();
    small(base.ice);
    sg.fillStyle = "#0000ff";
    sg.fill();
  }
  // Large lakes are water blocks.
  sg.globalCompositeOperation = "destination-out";
  sg.beginPath();
  small(base.lakes);
  sg.fill();
  sg.globalCompositeOperation = "source-over";
  sg.setTransform(1, 0, 0, 1, 0, 0);
  const px = sg.getImageData(0, 0, cols, rows).data;

  const n = cols * rows;
  const kind = new Int8Array(n).fill(-1);
  const cx = (i: number) => x0 + (i + 0.5) * s;
  const cy = (j: number) => y0 + (j + 0.5) * s;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!inWorld(cx(i), cy(j))) continue;
      const k = j * cols + i;
      const o = k * 4;
      if (px[o + 3]! < 110) {
        kind[k] = SEA;
        continue;
      }
      const g = px[o + 1]!, b = px[o + 2]!;
      if (b > 180 && g < 120) kind[k] = SNOW;
      else if (b > 180) kind[k] = SAND;
      else kind[k] = GRASS;
    }
  // Mountains: every block within about half a degree of a peak point is stone. Where points crowd (several
  // ranges side by side, as in the highest mountains) and away from the tropics, the stone wears a snow cap.
  if (f.relief) {
    const count = new Uint8Array(n);
    const reach = Math.max(0, Math.round((0.45 * perDegree) / s));
    const cold = new Uint8Array(n);
    for (const [lon, lat] of f.relief.peaks) {
      const p = at(lon, lat);
      if (!p) continue;
      const i = Math.floor((p[0] - x0) / s), j = Math.floor((p[1] - y0) / s);
      for (let dj = -reach; dj <= reach; dj++)
        for (let di = -reach; di <= reach; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const k = jj * cols + ii;
          if (count[k]! < 255) count[k]!++;
          if (Math.abs(lat) >= 28) cold[k] = 1;
        }
    }
    // A single range crosses a block with about one point per 1.1 degrees of it; a little more is a crowd.
    const crowd = Math.max(2, Math.ceil((1.3 * s) / perDegree / 1.1));
    for (let k = 0; k < n; k++) {
      if (kind[k] !== GRASS && kind[k] !== SAND) continue;
      if (!count[k]) continue;
      kind[k] = cold[k] && count[k]! >= crowd ? PEAK : STONE;
    }
  }
  const land = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && kind[j * cols + i]! >= GRASS;
  const sea = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && (kind[j * cols + i] === SEA || kind[j * cols + i] === SHALLOW);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const c = kind[k]!;
      if (c === SEA) {
        // Shallows: water blocks touching land, paler, as if the sand showed through.
        if (land(i + 1, j) || land(i - 1, j) || land(i, j + 1) || land(i, j - 1)) kind[k] = SHALLOW;
        continue;
      }
      if (c !== GRASS) continue;
      const coast = sea(i + 1, j) || sea(i - 1, j) || sea(i, j + 1) || sea(i, j - 1);
      const ll = proj.invert?.([cx(i), cy(j)]);
      const lat = ll ? Math.abs(ll[1]) : 0;
      // Snow toward the poles; beaches of sand on the warm coasts. Elsewhere a coast keeps its grass, and the dirt under
      // it shows where it stands over the water.
      if (lat >= 62) kind[k] = SNOW;
      else if (coast && lat < 32) kind[k] = SAND;
    }

  // Top faces as SVG path text, one path per kind.
  const tops: string[][] = Array.from({ length: 7 }, () => []);
  for (let k = 0; k < n; k++) {
    const c = kind[k]!;
    if (c < 0) continue;
    const i = k % cols, j = (k / cols) | 0;
    tops[c]!.push(`M${x0 + i * s} ${y0 + j * s}h${s}v${s}h${-s}Z`);
  }
  // Front faces: a block that stands higher than the one in front of it shows its side over that block, half a block
  // deep for one step and a whole block for more, with a little shadow beneath.
  const sides: string[][] = Array.from({ length: 7 }, () => []);
  const shadow: string[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols; i++) {
      const c = kind[j * cols + i]!;
      if (c < GRASS) continue;
      const below = kind[(j + 1) * cols + i]!;
      if (below < 0) continue;
      const step = HEIGHT[c]! - HEIGHT[below]!;
      if (step <= 0) continue;
      const fh = step === 1 ? s / 2 : s;
      const x = x0 + i * s, y = y0 + (j + 1) * s;
      sides[c]!.push(`M${x} ${y}h${s}v${fh}h${-s}Z`);
      if (fh < s) shadow.push(`M${x} ${y + fh}h${s}v${Math.min(4, s - fh)}h${-s}Z`);
    }

  const tex = patterns(f, cache, s);
  const anchor = new DOMMatrix().translate(x0, y0);
  ctx.save();
  tops.forEach((list, c) => {
    if (!list.length) return;
    const p = tex.tops.get(c)!;
    p.setTransform(anchor);
    ctx.fillStyle = p;
    ctx.fill(new Path2D(list.join("")));
  });
  if (shadow.length) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fill(new Path2D(shadow.join("")));
  }
  sides.forEach((list, c) => {
    if (!list.length) return;
    const p = tex.sides.get(c)!;
    p.setTransform(anchor);
    ctx.fillStyle = p;
    ctx.fill(new Path2D(list.join("")));
  });

  if (globe) {
    // The globe's roundness in whole blocks: rings of blocks darken toward the rim, lit from the upper left.
    const shade: string[][] = [[], [], [], []];
    for (let k = 0; k < n; k++) {
      if (kind[k]! < 0) continue;
      const i = k % cols, j = (k / cols) | 0;
      const d = Math.hypot(cx(i) - (gx - R * 0.3), cy(j) - (gy - R * 0.32)) / (R * 1.3);
      const level = Math.min(3, Math.floor((d - 0.5) / 0.14));
      if (level >= 0) shade[level]!.push(`M${x0 + i * s} ${y0 + j * s}h${s}v${s}h${-s}Z`);
    }
    shade.forEach((list, l) => {
      if (!list.length) return;
      ctx.fillStyle = `rgba(10,20,50,${(0.1 + l * 0.08).toFixed(2)})`;
      ctx.fill(new Path2D(list.join("")));
    });
  }
  ctx.restore();
}

/** Whether a point is on the globe's near side. */
function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}
