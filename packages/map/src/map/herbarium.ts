// Herbarium (id herbarium, experimental): after the feel of a botanist's herbarium, pressed plants mounted on heavy
// cream sheets under thin strips of linen tape, and nothing else from one: no institution's name, collection marks,
// stamps or real specimen labels, and nothing claims a scientific name for anything.
//
// The sea is the sheet itself: cream mounting paper with faint fibres and a few soft patches of foxing, and faint
// pencil water lines round every coast. The land is pressed foliage: small flat leaves in faded greens, olives,
// ochres and dried browns, each at a fixed point of a jittered grid of longitude and latitude, so the texture is tied
// to the world and moves with it, cut by the coastline. A leaf's colour comes from its latitude band (blended over
// about ten degrees), the relief layer's mountains and the ice, and a fixed hash; never from any political unit. The
// coast is a fine ink line.
//
// At a few tested open-sea spots (`SPECIMENS`, test/herbarium.test.ts) lie small pressed specimens of our own drawing,
// a fern frond, a leaf, a small flower and a grass, each held by little strips of linen tape and drawn no wider than
// the open water round it. In Globe view the world is a pressed-paper ball on a round card mount taped to the sheet,
// with a few pressed specimens laid round it on the sheet, never over the ball, the Key or the zoom buttons
// (`placeAround`, tested). Markers are specimen pins: the view draws them as usual and this file only adds each
// one's short shadow under it. Nothing here moves, and there is no text on the canvas.

import { geoPath } from "d3-geo";
import { StillLayer } from "./ambient.ts";
import { clamp, fromCentre, landPaths, pxPerDeg, RAD, type SeaSpot, speckle, streaks, wideCoast } from "./handmade.ts";
import { hash2, offscreen, pathContext, seeded, type SurfaceFrame, type SurfaceResult, type SurfaceSpot } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;

export type RGB = [number, number, number];

/** The mounting paper, and the ink and pencil drawn on it. */
export const PAPER = "#f3ecdc";
const MOUNT = "#f8f3e6";
const INK = "#2f2a24";
const PENCIL = "rgba(84,84,90,0.3)";

/** The pressed foliage's faded colours. */
export const TONES = {
  moss: [110, 123, 84],
  olive: [142, 138, 90],
  sage: [160, 167, 130],
  straw: [200, 188, 142],
  ochre: [190, 156, 96],
  brown: [146, 116, 86],
  bleached: [228, 220, 199],
} satisfies Record<string, RGB>;
export type Tone = keyof typeof TONES;
/** The order leaves are filled in, one batch per tone. */
const TONE_ORDER: readonly Tone[] = ["straw", "ochre", "sage", "olive", "brown", "moss", "bleached"];

/**
 * Latitude bands by their upper edge in degrees from the Equator, each a mix of tones: deep moss and olive near the
 * Equator, ochre and straw in the dry belts, sage and olive in the middle latitudes, dried browns further out, pale
 * straw toward the poles. Only latitude; nothing here knows of any country.
 */
export const BANDS: readonly { to: number; mix: readonly [Tone, number][] }[] = [
  { to: 14, mix: [["moss", 0.55], ["olive", 0.3], ["sage", 0.15]] },
  { to: 33, mix: [["ochre", 0.4], ["olive", 0.35], ["straw", 0.25]] },
  { to: 52, mix: [["sage", 0.45], ["olive", 0.3], ["moss", 0.25]] },
  { to: 66, mix: [["sage", 0.35], ["brown", 0.35], ["moss", 0.3]] },
  { to: 91, mix: [["straw", 0.55], ["brown", 0.2], ["bleached", 0.25]] },
];
const MOUNTAIN: readonly [Tone, number][] = [["brown", 0.55], ["ochre", 0.25], ["straw", 0.2]];
/** How far the bands blend into each other, in degrees of latitude. */
export const BLEND = 10;

function pick(mix: readonly [Tone, number][], h: number): Tone {
  let acc = 0;
  for (const [tone, share] of mix) {
    acc += share;
    if (h < acc) return tone;
  }
  return mix[mix.length - 1]![0];
}

/**
 * A leaf's tone from its latitude, whether it lies on a mountain or on ice, and two fixed hashes in [0, 1). The first
 * hash moves the band's edge by up to half of `BLEND` either way, so neighbouring bands mix over about ten degrees
 * instead of meeting at a line.
 */
export function leafTone(lat: number, h1: number, h2: number, mountain: boolean, ice: boolean): Tone {
  if (ice) return "bleached";
  if (mountain) return pick(MOUNTAIN, h2);
  const a = Math.abs(lat) + (h1 - 0.5) * BLEND;
  const band = BANDS.find((b) => a < b.to) ?? BANDS[BANDS.length - 1]!;
  return pick(band.mix, h2);
}

const rgba = (c: RGB, a: number, k = 1) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;

// ---- The leaf grid -----------------------------------------------------------------------------------------------

/** Grid steps in degrees, each dividing 180, so a leaf stays at the same place on the world at a given step. */
const STEPS = [0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6] as const;

/** The grid step that makes a leaf about `px` pixels long on screen at `pxPerDeg` pixels per degree. */
export function leafStep(pxDeg: number, px = 20): number {
  const want = px / Math.max(1e-6, pxDeg);
  for (const s of STEPS) if (s >= want) return s;
  return STEPS[STEPS.length - 1]!;
}

/** One leaf on the grid: where it lies (lon, lat), its turn, its size as a share of the step, and its two hashes. */
export interface Leaf {
  lon: number;
  lat: number;
  turn: number;
  size: number;
  kind: number;
  h1: number;
  h2: number;
}

/** The leaf of grid cell (i, j) at a step: always the same for the same cell, so the foliage is tied to the world. */
export function leafAt(step: number, i: number, j: number): Leaf {
  const a = hash2(i * 7 + 3, j * 13 + 1);
  const b = hash2(i * 11 + 5, j * 3 + 7);
  const c = hash2(i * 5 + 9, j * 17 + 2);
  const d = hash2(i * 19 + 1, j * 7 + 11);
  return {
    lon: (i + 0.5 + (a - 0.5) * 0.8) * step - 180,
    lat: (j + 0.5 + (b - 0.5) * 0.8) * step - 90,
    turn: c * Math.PI * 2,
    size: 0.7 + d * 0.45,
    kind: Math.floor(hash2(i + 101, j + 37) * 3),
    h1: hash2(i * 3 + 17, j * 5 + 29),
    h2: hash2(i * 23 + 41, j * 29 + 3),
  };
}

/** How wide each of the three leaf shapes is for its length: ovate, lanceolate, willow. */
const LEAF_WIDTH = [0.5, 0.34, 0.22];

/** A leaf's outline into `p`: base at -s, tip at +s along the turn, `wd` its width for its length. */
function leafOutline(p: Path2D, x: number, y: number, turn: number, s: number, wd: number) {
  const c = Math.cos(turn), sn = Math.sin(turn);
  const at = (u: number, v: number): [number, number] => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
  const [bx, by] = at(-1, 0);
  const [tx, ty] = at(1, 0);
  const [a1x, a1y] = at(-0.7, -wd * 1.45);
  const [a2x, a2y] = at(0.45, -wd * 1.25);
  const [b1x, b1y] = at(0.45, wd * 1.25);
  const [b2x, b2y] = at(-0.7, wd * 1.45);
  p.moveTo(bx, by);
  p.bezierCurveTo(a1x, a1y, a2x, a2y, tx, ty);
  p.bezierCurveTo(b1x, b1y, b2x, b2y, bx, by);
  p.closePath();
}

/** A leaf's midrib, stalk and side veins into `p`. */
function leafVeins(p: Path2D, x: number, y: number, turn: number, s: number, wd: number) {
  const c = Math.cos(turn), sn = Math.sin(turn);
  const at = (u: number, v: number): [number, number] => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
  const m0 = at(-1.22, 0), m1 = at(0.85, 0);
  p.moveTo(m0[0], m0[1]);
  p.lineTo(m1[0], m1[1]);
  if (s < 5) return;
  for (const u of [-0.5, -0.05, 0.38]) {
    const o = at(u, 0);
    for (const side of [-1, 1]) {
      const e = at(u + 0.32, side * wd * 0.8);
      p.moveTo(o[0], o[1]);
      p.lineTo(e[0], e[1]);
    }
  }
}

/** The span of longitude (from the view's centre) and latitude the frame can show, a step wider all round. */
function visibleBox(f: SurfaceFrame, step: number): { lat0: number; lat1: number; dl: number } {
  const R = f.proj.scale();
  if (f.mode === "3d") {
    const reach = Math.hypot(f.w, f.h) / 2;
    const a = reach >= R ? 90 : Math.asin(reach / R) / RAD;
    const lat0 = Math.max(-90, f.lat - a - step), lat1 = Math.min(90, f.lat + a + step);
    const edge = Math.max(Math.abs(lat0), Math.abs(lat1));
    const dl = edge >= 89 || a >= 89 ? 180 : Math.min(180, a / Math.cos(edge * RAD) + step * 2);
    return { lat0, lat1, dl };
  }
  let lat0 = 90, lat1 = -90, dl = 0;
  const inv = f.proj.invert!;
  for (let k = 0; k <= 12; k++) {
    for (const [x, y] of [
      [(f.w * k) / 12, 0],
      [(f.w * k) / 12, f.h],
      [0, (f.h * k) / 12],
      [f.w, (f.h * k) / 12],
    ] as const) {
      const q = inv([x, y]);
      if (!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      lat0 = Math.min(lat0, q[1]);
      lat1 = Math.max(lat1, q[1]);
      dl = Math.max(dl, Math.abs(((q[0] - f.lon + 540) % 360) - 180));
    }
  }
  if (lat1 < lat0) return { lat0: -90, lat1: 90, dl: 180 };
  return { lat0: Math.max(-90, lat0 - step), lat1: Math.min(90, lat1 + step), dl: f.zoom < 1.8 ? 180 : Math.min(180, dl + step * 2) };
}

/** The grid cells (at `step`) that hold one of the relief layer's mountains. */
function mountainCells(f: SurfaceFrame, cache: HerbariumCache, step: number): Set<number> {
  const key = `${step}`;
  if (cache.peaks && cache.peaks.key === key && cache.peaks.of === f.relief) return cache.peaks.cells;
  const cells = new Set<number>();
  for (const [lon, lat] of f.relief?.peaks ?? []) {
    const i = Math.floor((lon + 180) / step), j = Math.floor((lat + 90) / step);
    // A mountain browns its own cell and the one on either side, so a range reads as a band rather than single leaves.
    for (let a = -1; a <= 1; a++) cells.add((i + a) * 4096 + j);
  }
  cache.peaks = { key, of: f.relief, cells };
  return cells;
}

/** The pressed foliage: every grid leaf in view that lies on or beside land, batched by tone. */
function drawFoliage(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D, land: Path2D) {
  const pxDeg = pxPerDeg(f.proj);
  const screenK = clamp(Math.min(f.w, f.h) / 720, 0.7, 1);
  const step = leafStep(pxDeg, 14 * screenK);
  const box = visibleBox(f, step);
  const peaks = mountainCells(f, cache, step);
  const fills = new Map<Tone, Path2D>();
  const veins = new Path2D();
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const j0 = Math.floor((box.lat0 + 90) / step), j1 = Math.ceil((box.lat1 + 90) / step);
  const cols = Math.round(360 / step);
  const iMid = Math.floor((f.lon + 180) / step);
  const half = Math.ceil(box.dl / step) + 1;
  const span = Math.min(cols, half * 2 + 1);
  const near = step * 0.45;
  for (let j = j0; j <= j1; j++) {
    for (let k = 0; k < span; k++) {
      const i = (((iMid - Math.floor(span / 2) + k) % cols) + cols) % cols;
      const leaf = leafAt(step, i, j);
      if (leaf.lat < -90 || leaf.lat > 90) continue;
      // On land, or close enough to its edge that the coast cuts it.
      if (!f.isLand(leaf.lon, leaf.lat) && !f.isLand(leaf.lon + near, leaf.lat) && !f.isLand(leaf.lon - near, leaf.lat) && !f.isLand(leaf.lon, leaf.lat + near) && !f.isLand(leaf.lon, leaf.lat - near)) continue;
      let fore = 1;
      if (globe) {
        const a = leaf.lat * RAD, b = f.lat * RAD;
        const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((leaf.lon - f.lon) * RAD);
        if (cosc < 0.02) continue;
        // Toward the rim the ball's surface turns away, so its leaves draw smaller.
        fore = Math.max(0.35, Math.sqrt(cosc));
      }
      const q = f.proj([leaf.lon, leaf.lat]);
      if (!q) continue;
      const s = step * pxDeg * leaf.size * 0.74 * fore;
      if (q[0] < -s * 1.4 || q[1] < -s * 1.4 || q[0] > f.w + s * 1.4 || q[1] > f.h + s * 1.4) continue;
      if (globe && Math.hypot(q[0] - cx, q[1] - cy) > R + s) continue;
      const tone = leafTone(leaf.lat, leaf.h1, leaf.h2, peaks.has(i * 4096 + j), f.isIce(leaf.lon, leaf.lat));
      let p = fills.get(tone);
      if (!p) fills.set(tone, (p = new Path2D()));
      const wd = LEAF_WIDTH[leaf.kind]!;
      leafOutline(p, q[0], q[1], leaf.turn, s, wd);
      if (s >= 3) leafVeins(veins, q[0], q[1], leaf.turn, s, wd);
    }
  }
  g.save();
  g.clip(land);
  for (const tone of TONE_ORDER) {
    const p = fills.get(tone);
    if (!p) continue;
    const c = TONES[tone];
    g.fillStyle = rgba(c, 0.8);
    g.fill(p);
    // A pressed leaf's edge dries a little darker.
    g.lineWidth = 0.6;
    g.strokeStyle = rgba(c, 0.55, 0.72);
    g.stroke(p);
  }
  g.lineWidth = 0.5;
  g.lineCap = "round";
  g.strokeStyle = "rgba(72,58,38,0.32)";
  g.stroke(veins);
  g.restore();
}

// ---- The sheet ----------------------------------------------------------------------------------------------------

/** Heavy cream mounting paper: fibres, a fine speckle and a few large soft patches of foxing, fixed to the screen. */
function paper(g: CanvasRenderingContext2D, f: SurfaceFrame, base: string, x = 0, y = 0, w = f.w, h = f.h) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = streaks(g, f.dpr, "rgba(140,118,84,0.22)", 90, [6, 18], [0.4, 0.8], 71, 180, 0.6);
  g.fillRect(x, y, w, h);
  g.fillStyle = streaks(g, f.dpr, "rgba(255,255,255,0.5)", 50, [5, 14], [0.5, 1], 73, 150, 0.7);
  g.fillRect(x, y, w, h);
  g.fillStyle = speckle(g, f.dpr, "rgba(120,98,66,0.22)", 180, [0.4, 0.9], 79, 120);
  g.fillRect(x, y, w, h);
}

/** Foxing: a few big, very faint rust-brown patches, far larger than any marker, so none reads as a place. */
function foxing(g: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = seeded(97);
  for (let i = 0; i < 6; i++) {
    const x = rnd() * w, y = rnd() * h, r = 50 + rnd() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(176,128,72,0.07)");
    gr.addColorStop(0.6, "rgba(176,128,72,0.035)");
    gr.addColorStop(1, "rgba(176,128,72,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/**
 * Faint pencil water lines round every coast, three of them, the outer one broken: each ring is a wide stroke with a
 * slightly narrower one rubbed out of it on a layer of its own, so only the ring's two edges' outer line is left, and
 * the land laid over it hides the half on land.
 */
function waterLines(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D, coast: Path2D) {
  const { w, h, dpr } = f;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (!cache.rings || cache.rings.canvas.width !== W || cache.rings.canvas.height !== H) {
    const [canvas, rg] = offscreen(w, h, dpr);
    cache.rings = { canvas, g: rg };
  }
  const { canvas, g: rg } = cache.rings;
  rg.setTransform(1, 0, 0, 1, 0, 0);
  rg.clearRect(0, 0, W, H);
  rg.setTransform(dpr, 0, 0, dpr, 0, 0);
  rg.lineJoin = "round";
  rg.lineCap = "round";
  const soft = wideCoast(f, coast);
  const k = clamp(0.85 + f.zoom * 0.15, 1, 1.8) * clamp(Math.min(w, h) / 720, 0.7, 1);
  for (const [d, dash] of [
    [16, true],
    [10, false],
    [5, false],
  ] as const) {
    const at = d * k;
    rg.globalCompositeOperation = "source-over";
    rg.setLineDash(dash ? [6, 6] : []);
    rg.strokeStyle = PENCIL;
    rg.lineWidth = at * 2 + 0.7;
    rg.stroke(soft);
    rg.setLineDash([]);
    rg.globalCompositeOperation = "destination-out";
    rg.strokeStyle = "#000";
    rg.lineWidth = at * 2 - 0.7;
    rg.stroke(soft);
  }
  rg.globalCompositeOperation = "source-over";
  g.drawImage(canvas, 0, 0, w, h);
}

// ---- Pressed specimens of our own drawing ------------------------------------------------------------------------

/**
 * The pressed specimens at sea: open-sea spots with the radius, in degrees, of open water round each (tested like the
 * handmade designs' doodles: the whole circle off land in both basemaps and 3 degrees clear of every place). Each is
 * drawn inside a circle a little smaller than its open water, so it never reaches land at any zoom.
 */
export const SPECIMENS: readonly SeaSpot[] = [
  { kind: "fern", lon: -42, lat: 24, r: 11 },
  { kind: "flower", lon: -152, lat: 40, r: 11 },
  { kind: "leaf", lon: -24, lat: -34, r: 11 },
  { kind: "grass", lon: 86, lat: -42, r: 11 },
  { kind: "fern", lon: -138, lat: -38, r: 11 },
  { kind: "leaf", lon: 82, lat: -16, r: 11, flip: true },
  { kind: "flower", lon: -2, lat: -56, r: 11 },
  { kind: "grass", lon: -120, lat: -14, r: 11, flip: true },
];
/** How much of a spot's open water a specimen spans, from its centre: the drawing stays inside this circle. */
export const SPECIMEN_FILL = 0.8;

export type SpecimenKind = "fern" | "leaf" | "flower" | "grass";

/** A strip of linen tape at (x, y) in local units, turned by `turn`, with frayed ends and a faint weave. */
function tape(g: CanvasRenderingContext2D, x: number, y: number, turn: number, len: number, wid: number, px: number) {
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  const p = new Path2D();
  const n = 4;
  p.moveTo(-len / 2, -wid / 2);
  p.lineTo(len / 2, -wid / 2);
  for (let i = 1; i <= n; i++) p.lineTo(len / 2 + (i % 2 ? -1 : 0) * wid * 0.12, -wid / 2 + (wid * i) / n);
  p.lineTo(-len / 2, wid / 2);
  for (let i = 1; i <= n; i++) p.lineTo(-len / 2 + (i % 2 ? 1 : 0) * wid * 0.12, wid / 2 - (wid * i) / n);
  p.closePath();
  g.fillStyle = "rgba(231,220,194,0.86)";
  g.fill(p);
  g.save();
  g.clip(p);
  const gap = Math.max(0.018, px * 2.2);
  const weave = new Path2D();
  for (let u = -len / 2; u < len / 2; u += gap) {
    weave.moveTo(u, -wid / 2);
    weave.lineTo(u, wid / 2);
  }
  for (let v = -wid / 2; v < wid / 2; v += gap) {
    weave.moveTo(-len / 2, v);
    weave.lineTo(len / 2, v);
  }
  g.lineWidth = px * 0.5;
  g.strokeStyle = "rgba(150,128,92,0.22)";
  g.stroke(weave);
  g.restore();
  g.lineWidth = px * 0.7;
  g.strokeStyle = "rgba(140,118,84,0.45)";
  g.stroke(p);
  g.restore();
}

/** A point along a quadratic curve and its direction. */
function quad(p0: [number, number], c: [number, number], p1: [number, number], t: number): { x: number; y: number; a: number } {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0];
  const y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1];
  const dx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]);
  const dy = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
  return { x, y, a: Math.atan2(dy, dx) };
}

/** A fern frond: a curved stalk with paired leaflets that shorten toward the tip, taped across the stalk twice. */
function fern(g: CanvasRenderingContext2D, px: number) {
  const p0: [number, number] = [0.06, 0.94], c: [number, number] = [0.42, 0.02], p1: [number, number] = [-0.12, -0.9];
  const leaflets = new Path2D(), veins = new Path2D();
  const N = 15;
  for (let i = 0; i < N; i++) {
    const t = 0.1 + (i / N) * 0.86;
    const q = quad(p0, c, p1, t);
    const len = 0.44 * (1 - t * 0.78);
    for (const side of [-1, 1]) {
      // Leaflets sweep up toward the tip, alternating a little so the pairs aren't mirror images.
      const a = q.a + side * (1.05 + (i % 2) * 0.08);
      const s = len / 2;
      const x = q.x + Math.cos(a) * s, y = q.y + Math.sin(a) * s;
      leafOutline(leaflets, x, y, a, s, 0.3);
      veins.moveTo(q.x, q.y);
      veins.lineTo(q.x + Math.cos(a) * len * 0.9, q.y + Math.sin(a) * len * 0.9);
    }
  }
  g.fillStyle = "rgba(122,132,86,0.92)";
  g.fill(leaflets);
  g.lineWidth = px * 0.7;
  g.strokeStyle = "rgba(76,84,52,0.6)";
  g.stroke(leaflets);
  g.lineWidth = px * 0.5;
  g.strokeStyle = "rgba(76,84,52,0.45)";
  g.stroke(veins);
  const stalk = new Path2D();
  stalk.moveTo(p0[0], p0[1] + 0.04);
  stalk.quadraticCurveTo(c[0], c[1], p1[0], p1[1]);
  g.lineWidth = Math.max(px * 1.4, 0.022);
  g.strokeStyle = "rgba(112,90,60,0.9)";
  g.stroke(stalk);
  for (const t of [0.14, 0.6]) {
    const q = quad(p0, c, p1, t);
    tape(g, q.x, q.y, q.a + Math.PI / 2 + 0.18, 0.46, 0.12, px);
  }
}

/** A broad leaf with a toothed edge, its veins and stalk, taped across the stalk and near the tip. */
function broadLeaf(g: CanvasRenderingContext2D, px: number) {
  const turn = -Math.PI / 4 - 0.12;
  const c = Math.cos(turn), sn = Math.sin(turn);
  const at = (u: number, v: number): [number, number] => [u * c - v * sn, u * sn + v * c];
  const L = 0.78, W = 0.42;
  const edge = new Path2D();
  const pts: [number, number][] = [];
  const n = 26;
  // Up one side and down the other, with small teeth: the half-width follows an egg shape, widest below the middle.
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= n; i++) {
      const t = side < 0 ? i / n : 1 - i / n;
      const u = -L + t * 2 * L;
      const shape = Math.sin(Math.PI * Math.pow(t, 0.8));
      const tooth = i % 2 ? 0.035 : 0;
      pts.push(at(u, side * (W * shape + (shape > 0.1 ? tooth : 0))));
    }
  }
  pts.forEach(([x, y], i) => (i ? edge.lineTo(x, y) : edge.moveTo(x, y)));
  edge.closePath();
  g.fillStyle = "rgba(176,146,88,0.94)";
  g.fill(edge);
  // Drier toward the edge, as a pressed leaf goes.
  g.save();
  g.clip(edge);
  g.lineWidth = 0.09;
  g.strokeStyle = "rgba(140,104,66,0.35)";
  g.stroke(edge);
  g.restore();
  g.lineWidth = px * 0.8;
  g.strokeStyle = "rgba(112,82,50,0.7)";
  g.stroke(edge);
  const veins = new Path2D();
  const [s0x, s0y] = at(-L - 0.2, 0);
  const [s1x, s1y] = at(L * 0.92, 0);
  veins.moveTo(s0x, s0y);
  veins.lineTo(s1x, s1y);
  for (let i = 0; i < 6; i++) {
    const u = -L * 0.75 + i * 0.25;
    const shape = Math.sin(Math.PI * Math.pow((u + L) / (2 * L), 0.8));
    for (const side of [-1, 1]) {
      const [ax, ay] = at(u, 0);
      const [bx, by] = at(u + 0.22, side * W * shape * 0.82);
      veins.moveTo(ax, ay);
      veins.quadraticCurveTo(...at(u + 0.08, side * W * shape * 0.5), bx, by);
    }
  }
  g.lineWidth = px * 0.8;
  g.strokeStyle = "rgba(108,80,50,0.6)";
  g.stroke(veins);
  const stalk = at(-L - 0.12, 0);
  tape(g, stalk[0], stalk[1], turn + Math.PI / 2 - 0.15, 0.4, 0.12, px);
  const tip = at(L * 0.55, 0);
  tape(g, tip[0], tip[1], turn + Math.PI / 2 + 0.2, 0.36, 0.11, px);
}

/** A small flower on a slender stalk with two leaves: five faded violet petals round a few short strokes. */
function flower(g: CanvasRenderingContext2D, px: number) {
  const p0: [number, number] = [0.12, 0.95], c: [number, number] = [0.2, 0.25], p1: [number, number] = [-0.08, -0.3];
  const stalk = new Path2D();
  stalk.moveTo(...p0);
  stalk.quadraticCurveTo(...c, ...p1);
  g.lineWidth = Math.max(px * 1.3, 0.02);
  g.strokeStyle = "rgba(108,112,70,0.9)";
  g.stroke(stalk);
  const leaves = new Path2D(), lv = new Path2D();
  for (const [t, side] of [
    [0.38, -1],
    [0.62, 1],
  ] as const) {
    const q = quad(p0, c, p1, t);
    const a = q.a + side * 0.9;
    const s = 0.2;
    leafOutline(leaves, q.x + Math.cos(a) * s, q.y + Math.sin(a) * s, a, s, 0.32);
    leafVeins(lv, q.x + Math.cos(a) * s, q.y + Math.sin(a) * s, a, s, 0.32);
  }
  g.fillStyle = "rgba(128,138,90,0.92)";
  g.fill(leaves);
  g.lineWidth = px * 0.6;
  g.strokeStyle = "rgba(80,88,56,0.6)";
  g.stroke(leaves);
  g.stroke(lv);
  // The head: petals as broad teardrops round the stalk's end, each with a darker line down its middle.
  const hx = p1[0], hy = p1[1] - 0.16;
  const petals = new Path2D(), lines = new Path2D();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5 + 0.2;
    const s = 0.2;
    leafOutline(petals, hx + Math.cos(a) * (s + 0.03), hy + Math.sin(a) * (s + 0.03), a, s, 0.62);
    lines.moveTo(hx + Math.cos(a) * 0.08, hy + Math.sin(a) * 0.08);
    lines.lineTo(hx + Math.cos(a) * 0.34, hy + Math.sin(a) * 0.34);
  }
  g.fillStyle = "rgba(140,112,160,0.86)";
  g.fill(petals);
  g.lineWidth = px * 0.7;
  g.strokeStyle = "rgba(94,70,112,0.6)";
  g.stroke(petals);
  g.lineWidth = px * 0.5;
  g.stroke(lines);
  // The centre as a few short ochre strokes, never a filled dot.
  const eye = new Path2D();
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7;
    eye.moveTo(hx + Math.cos(a) * 0.02, hy + Math.sin(a) * 0.02);
    eye.lineTo(hx + Math.cos(a) * 0.075, hy + Math.sin(a) * 0.075);
  }
  g.lineWidth = Math.max(px * 1.1, 0.018);
  g.lineCap = "round";
  g.strokeStyle = "rgba(176,134,60,0.95)";
  g.stroke(eye);
  const q = quad(p0, c, p1, 0.18);
  tape(g, q.x, q.y, q.a + Math.PI / 2 - 0.1, 0.42, 0.12, px);
}

/** A grass: three long blades and a stalk with a head of small spikelets, in straw and dried green. */
function grass(g: CanvasRenderingContext2D, px: number) {
  const blades = new Path2D();
  for (const [x1, y1, cx, cy] of [
    [-0.55, -0.35, -0.3, 0.1],
    [0.5, -0.1, 0.3, 0.3],
    [-0.2, -0.62, -0.05, 0.0],
  ] as const) {
    blades.moveTo(-0.02, 0.92);
    blades.quadraticCurveTo(cx, cy, x1, y1);
    blades.quadraticCurveTo(cx + 0.07, cy + 0.02, 0.05, 0.92);
    blades.closePath();
  }
  g.fillStyle = "rgba(150,150,96,0.88)";
  g.fill(blades);
  g.lineWidth = px * 0.6;
  g.strokeStyle = "rgba(96,96,60,0.55)";
  g.stroke(blades);
  const p0: [number, number] = [0.02, 0.94], c: [number, number] = [0.18, 0.1], p1: [number, number] = [0.06, -0.95];
  const stalk = new Path2D();
  stalk.moveTo(...p0);
  stalk.quadraticCurveTo(...c, ...p1);
  g.lineWidth = Math.max(px * 1.1, 0.016);
  g.strokeStyle = "rgba(150,124,78,0.92)";
  g.stroke(stalk);
  const spikes = new Path2D();
  for (let i = 0; i < 11; i++) {
    const t = 0.55 + i * 0.042;
    const q = quad(p0, c, p1, t);
    const side = i % 2 ? 1 : -1;
    const a = q.a + side * 0.45;
    const s = 0.085 * (1 - (t - 0.55) * 0.9);
    leafOutline(spikes, q.x + Math.cos(a) * s, q.y + Math.sin(a) * s, a, s, 0.42);
  }
  g.fillStyle = "rgba(196,168,104,0.95)";
  g.fill(spikes);
  g.lineWidth = px * 0.6;
  g.strokeStyle = "rgba(136,108,62,0.65)";
  g.stroke(spikes);
  tape(g, 0.02, 0.72, 0.12, 0.5, 0.12, px);
}

const DRAW: Record<SpecimenKind, (g: CanvasRenderingContext2D, px: number) => void> = { fern, leaf: broadLeaf, flower, grass };

/** One specimen centred at (x, y), spanning a circle of radius `u` pixels, optionally mirrored and turned. */
export function drawSpecimen(g: CanvasRenderingContext2D, kind: SpecimenKind, x: number, y: number, u: number, flip = false, turn = 0, alpha = 1) {
  if (u < 8) return;
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(turn);
  g.scale(flip ? -u : u, u);
  g.lineJoin = "round";
  g.lineCap = "round";
  DRAW[kind](g, 1 / u);
  g.restore();
}

/** The specimens at sea in view, drawn as wide as `SPECIMEN_FILL` of their open water. On the globe they fade at the rim. */
function seaSpecimens(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const pxDeg = pxPerDeg(f.proj);
  for (const s of SPECIMENS) {
    let alpha = 1;
    if (f.mode === "3d") {
      const deg = fromCentre(f, s.lon, s.lat);
      if (deg > 75) continue;
      if (deg > 55) alpha = (75 - deg) / 20;
    }
    const p = f.proj([s.lon, s.lat]);
    if (!p) continue;
    const u = Math.min(150, SPECIMEN_FILL * s.r * pxDeg);
    if (p[0] < -u || p[0] > f.w + u || p[1] < -u || p[1] > f.h + u) continue;
    drawSpecimen(g, s.kind as SpecimenKind, p[0], p[1], u, s.flip, 0, alpha);
  }
}

// ---- The globe on its round mount --------------------------------------------------------------------------------

/** The round card mount's radius for a ball of radius R. */
export const mountRadius = (R: number) => R * 1.09;

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 116, h: 64 };
export const ZOOM_BOX = { w: 76, h: 112 };

/** Something laid on the sheet round the globe: a specimen in a circle of radius s, or a strip of tape. */
export interface Placed {
  kind: SpecimenKind;
  x: number;
  y: number;
  s: number;
  turn: number;
  flip: boolean;
}

/** Whether the square round a circle overlaps a box: stricter than the circle, so a corner never comes close. */
function hitsBox(x: number, y: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;
}

/** Where specimens may lie round the globe, by direction from its centre (screen degrees, y down), in turn of choice. */
const AROUND: readonly [number, SpecimenKind, number, boolean][] = [
  [160, "fern", -0.5, false],
  [-22, "flower", 0.35, false],
  [128, "leaf", 0.2, false],
  [-58, "grass", 0.5, true],
  [22, "leaf", -0.4, true],
  [205, "grass", -0.3, false],
];

/** The gap between the mount and anything laid beside it, and the frame's margin, in pixels. */
const GAP = 10;
const MARGIN = 8;

/**
 * The specimens laid on the sheet round a globe of radius R at (cx, cy) in a frame w by h, sized from the ball at its
 * widest zoom (`baseR`). Each sits in the room left between the mount and the frame's edge, shrinks to fit it and is
 * left out when there is too little, so none ever comes near the ball, the Key, the zoom buttons or another specimen.
 * The same frame and ball always get the same specimens.
 */
export function placeAround(w: number, h: number, cx: number, cy: number, R: number, baseR: number): Placed[] {
  const out: Placed[] = [];
  const M = mountRadius(R);
  const cap = clamp(baseR * 0.3, 20, 96);
  for (const [deg, kind, turn, flip] of AROUND) {
    if (out.length >= 4) break;
    const a = deg * RAD;
    const dx = Math.cos(a), dy = Math.sin(a);
    const x0 = cx + dx * (M + GAP), y0 = cy + dy * (M + GAP);
    if (x0 < MARGIN || y0 < MARGIN || x0 > w - MARGIN || y0 > h - MARGIN) continue;
    // The largest circle along this direction, touching the mount's gap, that stays inside the frame's margin.
    const fit = (room: number, d: number) => (room - MARGIN) / (1 + Math.abs(d));
    let s = Math.min(cap, fit(dx < 0 ? x0 : w - x0, dx), fit(dy < 0 ? y0 : h - y0, dy));
    if (s < 20) continue;
    const x = cx + dx * (M + GAP + s), y = cy + dy * (M + GAP + s);
    if (hitsBox(x, y, s + 4, 0, 0, KEY_BOX.w, KEY_BOX.h)) continue;
    if (hitsBox(x, y, s + 4, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + s + GAP)) continue;
    out.push({ kind, x, y, s, turn, flip });
  }
  return out;
}

/** The strips of tape holding the mount to the sheet: each across the mount's rim, outside the ball. */
export function mountTapes(w: number, h: number, cx: number, cy: number, R: number, around: readonly Placed[]): { x: number; y: number; a: number; len: number; wid: number }[] {
  if (R < 80) return [];
  const M = mountRadius(R);
  const len = clamp(R * 0.17, 16, 46), wid = len * 0.32;
  const out: { x: number; y: number; a: number; len: number; wid: number }[] = [];
  for (const deg of [-112, 68, 12, 192]) {
    const a = deg * RAD;
    // Centred a little outside the rim, so the inner end stays off the ball.
    const r = M + len * 0.15;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const reach = Math.hypot(len, wid) / 2;
    if (x - reach < 0 || y - reach < 0 || x + reach > w || y + reach > h) continue;
    if (hitsBox(x, y, reach, 0, 0, KEY_BOX.w, KEY_BOX.h) || hitsBox(x, y, reach, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) continue;
    if (around.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + reach)) continue;
    out.push({ x, y, a, len, wid });
  }
  return out;
}

/** The round card mount under the ball, its shadow on the sheet and a fine double ink rule at its edge. */
function mount(g: CanvasRenderingContext2D, f: SurfaceFrame, cx: number, cy: number, R: number) {
  const M = mountRadius(R);
  g.save();
  g.shadowColor = "rgba(70,52,30,0.28)";
  g.shadowBlur = 14;
  g.shadowOffsetX = 2;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.arc(cx, cy, M, 0, Math.PI * 2);
  g.fillStyle = MOUNT;
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.arc(cx, cy, M, 0, Math.PI * 2);
  g.clip();
  paper(g, f, MOUNT, cx - M, cy - M, M * 2, M * 2);
  g.restore();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(47,42,36,0.55)";
  g.beginPath();
  g.arc(cx, cy, M - 0.5, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 0.6;
  g.strokeStyle = "rgba(47,42,36,0.35)";
  g.beginPath();
  g.arc(cx, cy, M - Math.max(4, (M - R) * 0.45), 0, Math.PI * 2);
  g.stroke();
}

// ---- The frame ---------------------------------------------------------------------------------------------------

export class HerbariumCache {
  world = new StillLayer();
  rings?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D };
  peaks?: { key: string; of: unknown; cells: Set<number> };
  around?: { key: string; specimens: Placed[]; tapes: ReturnType<typeof mountTapes> };
}

function paint(f: SurfaceFrame, cache: HerbariumCache, g: CanvasRenderingContext2D) {
  const { w, h, mode } = f;
  const globe = mode === "3d";
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  paper(g, f, PAPER);
  foxing(g, w, h);
  const sphere = new Path2D();
  geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  if (globe) {
    const key = `${w}|${h}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
    if (cache.around?.key !== key) {
      const specimens = placeAround(w, h, cx, cy, R, R / Math.max(1, f.zoom));
      cache.around = { key, specimens, tapes: mountTapes(w, h, cx, cy, R, specimens) };
    }
    if (mountRadius(R) < Math.hypot(w, h)) mount(g, f, cx, cy, R);
    for (const s of cache.around.specimens) drawSpecimen(g, s.kind, s.x, s.y, s.s, s.flip, s.turn);
    for (const t of cache.around.tapes) {
      g.save();
      g.translate(t.x, t.y);
      g.scale(t.len, t.len);
      tape(g, 0, 0, t.a, 1, t.wid / t.len, 1 / t.len);
      g.restore();
    }
    // The ball: the same paper, a shade lighter, pressed into a sphere.
    g.save();
    g.clip(sphere);
    paper(g, f, "#f6f0e2", cx - R, cy - R, R * 2, R * 2);
    g.restore();
  }
  const { land, coast, ice } = landPaths(f, f.map);
  g.save();
  if (globe) g.clip(sphere);
  waterLines(f, cache, g, coast);
  seaSpecimens(f, g);
  g.fillStyle = f.theme.land;
  g.fill(land);
  drawFoliage(f, cache, g, land);
  if (ice) {
    g.fillStyle = "rgba(232,225,206,0.55)";
    g.fill(ice);
  }
  const path = geoPath(f.proj, g);
  if (f.zoom >= 2) {
    g.beginPath();
    path(f.map.rivers);
    g.lineWidth = 0.6;
    g.strokeStyle = f.theme.river;
    g.stroke();
  }
  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = PAPER;
  g.fill();
  g.lineWidth = 0.5;
  g.strokeStyle = "rgba(47,42,36,0.6)";
  g.stroke();
  g.lineJoin = "round";
  g.lineWidth = f.theme.coastWidth;
  g.strokeStyle = INK;
  g.stroke(coast);
  if (globe) {
    // Lit from the upper left like a paper ball: a soft light there and a warm shade toward the rim.
    const sh = g.createRadialGradient(cx - R * 0.36, cy - R * 0.4, R * 0.08, cx, cy, R * 1.02);
    sh.addColorStop(0, "rgba(255,252,242,0.22)");
    sh.addColorStop(0.5, "rgba(255,252,242,0)");
    sh.addColorStop(0.82, "rgba(110,84,50,0.08)");
    sh.addColorStop(1, "rgba(110,84,50,0.26)");
    g.fillStyle = sh;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  g.restore();
  if (globe) {
    g.lineWidth = 1;
    g.strokeStyle = "rgba(47,42,36,0.75)";
    g.stroke(sphere);
  }
}

/**
 * Each marker's short shadow on the sheet, down and to the right of its head as if the pin stood a little off the
 * paper. Drawn under the markers in one fill, so the markers themselves are untouched.
 */
export function pinShadows(g: CanvasRenderingContext2D, spots: readonly SurfaceSpot[]) {
  if (!spots.length) return;
  const p = new Path2D();
  for (const s of spots) {
    const x = s.x + s.r * 0.42, y = s.y + s.r * 0.55;
    p.moveTo(x + s.r * 1.02, y);
    p.ellipse(x, y, s.r * 1.02, s.r * 0.78, 0.5, 0, Math.PI * 2);
  }
  g.save();
  g.fillStyle = "rgba(70,52,30,0.2)";
  g.fill(p);
  g.restore();
}

export function drawHerbarium(f: SurfaceFrame, cache: HerbariumCache): SurfaceResult {
  cache.world.draw(f, (g) => paint(f, cache, g));
  return { under: (spots) => pinShadows(f.ctx, spots) };
}
