// Tiramisu (id tiramisu): the world as a tiramisu, our own drawing of the dessert and nothing from any
// shop, brand or product.
//
// The land is the mascarpone cream: soft ivory with spoon-swirled ridges, each swirl at a fixed point of a jittered
// grid of longitude and latitude, so the texture is tied to the world and cut by the coast, and dusted with cocoa
// toward the coast and over the relief layer's mountains. Nothing here knows of any country: only the land, the ice
// and the relief layer set what is drawn. The sea is the coffee-soaked sponge under the cream, deep espresso with the
// soft pores of a soaked ladyfinger, a little lighter along every coast where the cream meets it. A faint cocoa dust
// lies over everything, anchored to the world in Map view.
//
// Map view is the top of the tiramisu in a rectangular glass dish seen from above, on a pale marble table; along the
// foot of the dish, below the map, the glass side shows the layers in cross-section (cocoa, cream, sponge, cream,
// sponge, the sponge as cut ladyfingers). Places outside the dish's top are neither drawn nor tuned. Globe view puts
// the world in a round glass bowl on a dessert plate, the layers showing round its rim, with a spoon and a cocoa
// sieve laid on the table beside the plate where there is room, never near the ball, the Key or the zoom buttons
// (`placeTools`, test/tiramisu.test.ts). Markers are coffee beans (marks.ts); this file adds only each bean's soft
// shadow under it. Nothing moves, and there is no text on the canvas.

import { geoPath } from "d3-geo";
import { StillLayer } from "./ambient.ts";
import { clamp, landPaths, once, pxPerDeg, RAD, speckle, wideCoast } from "./handmade.ts";
import { hash2, pathContext, seeded, type SurfaceFrame, type SurfaceResult, type SurfaceSpot } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;

/** The coffee-soaked sponge, the mascarpone and the cocoa. */
export const ESPRESSO = "#3a2416";
export const CREAM = "#f4e9d0";
const cocoa = (a: number) => `rgba(92,56,34,${a})`;

// ---- The spoon swirls in the cream ------------------------------------------------------------------------------

/** Grid steps in degrees, each dividing 180, so a swirl stays at the same place on the world at a given step. */
const STEPS = [0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6] as const;

/** The grid step that makes a swirl about `px` pixels across on screen at `pxDeg` pixels per degree. */
export function swirlStep(pxDeg: number, px = 26): number {
  const want = px / Math.max(1e-6, pxDeg);
  for (const s of STEPS) if (s >= want) return s;
  return STEPS[STEPS.length - 1]!;
}

/** One swirl: where it lies (lon, lat), where its arc starts and how far it sweeps (radians), and its size. */
export interface Swirl {
  lon: number;
  lat: number;
  turn: number;
  sweep: number;
  size: number;
}

/** The swirl of grid cell (i, j) at a step: always the same for the same cell, so the cream is tied to the world. */
export function swirlAt(step: number, i: number, j: number): Swirl {
  const a = hash2(i * 7 + 3, j * 13 + 1);
  const b = hash2(i * 11 + 5, j * 3 + 7);
  const c = hash2(i * 5 + 9, j * 17 + 2);
  const d = hash2(i * 19 + 1, j * 7 + 11);
  const e = hash2(i * 23 + 41, j * 29 + 3);
  return {
    lon: (i + 0.5 + (a - 0.5) * 0.7) * step - 180,
    lat: (j + 0.5 + (b - 0.5) * 0.7) * step - 90,
    turn: c * Math.PI * 2,
    // A long, gentle curve, never near a whole turn, so no swirl closes into a ring that could read as a hollow mark.
    sweep: 0.9 + e * 1.1,
    size: 0.75 + d * 0.5,
  };
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
  const inv = f.proj.invert!;
  const k = R * RAD;
  const half = f.w / 2 / k, up = f.h / 2 / k;
  const mid = inv([f.w / 2, f.h / 2]);
  const lat = mid ? mid[1] : f.lat;
  return { lat0: Math.max(-90, lat - up - step), lat1: Math.min(90, lat + up + step), dl: Math.min(180, half + step * 2) };
}

/**
 * The spoon swirls: every grid swirl in view that lies on or beside land, as ridges of cream lit from the upper left,
 * a pale crest with a soft shade just below it. Clipped to the land by the caller, so the coast cuts them.
 */
function swirls(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const pxDeg = pxPerDeg(f.proj);
  const screenK = clamp(Math.min(f.w, f.h) / 720, 0.75, 1);
  const step = swirlStep(pxDeg, 26 * screenK);
  const box = visibleBox(f, step);
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const lit = new Path2D(), shade = new Path2D(), body = new Path2D();
  const j0 = Math.floor((box.lat0 + 90) / step), j1 = Math.ceil((box.lat1 + 90) / step);
  const cols = Math.round(360 / step);
  const iMid = Math.floor((f.lon + 180) / step);
  const span = Math.min(cols, (Math.ceil(box.dl / step) + 1) * 2 + 1);
  const near = step * 0.5;
  for (let j = j0; j <= j1; j++) {
    for (let k = 0; k < span; k++) {
      const i = (((iMid - Math.floor(span / 2) + k) % cols) + cols) % cols;
      const s = swirlAt(step, i, j);
      if (s.lat < -90 || s.lat > 90) continue;
      if (!f.isLand(s.lon, s.lat) && !f.isLand(s.lon + near, s.lat) && !f.isLand(s.lon - near, s.lat) && !f.isLand(s.lon, s.lat + near) && !f.isLand(s.lon, s.lat - near)) continue;
      let fore = 1;
      if (globe) {
        const a = s.lat * RAD, b = f.lat * RAD;
        const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((s.lon - f.lon) * RAD);
        if (cosc < 0.02) continue;
        // Toward the rim the dome turns away, so its swirls draw smaller.
        fore = Math.max(0.35, Math.sqrt(cosc));
      }
      const q = f.proj([s.lon, s.lat]);
      if (!q) continue;
      const r = step * pxDeg * 0.8 * s.size * fore;
      if (q[0] < -r * 2 || q[1] < -r * 2 || q[0] > f.w + r * 2 || q[1] > f.h + r * 2) continue;
      if (globe && Math.hypot(q[0] - cx, q[1] - cy) > R + r) continue;
      // The crest, its shade a little below and right of it, and a broad soft body for the ridge's volume.
      const ox = Math.max(0.6, r * 0.05), oy = Math.max(0.9, r * 0.07);
      const from = s.turn, to = s.turn + s.sweep;
      lit.moveTo(q[0] + Math.cos(from) * r, q[1] + Math.sin(from) * r);
      lit.arc(q[0], q[1], r, from, to);
      shade.moveTo(q[0] + ox + Math.cos(from) * r, q[1] + oy + Math.sin(from) * r);
      shade.arc(q[0] + ox, q[1] + oy, r, from, to);
      body.moveTo(q[0] + ox * 2.5 + Math.cos(from) * r, q[1] + oy * 2.5 + Math.sin(from) * r);
      body.arc(q[0] + ox * 2.5, q[1] + oy * 2.5, r, from, to);
    }
  }
  const w = clamp(pxDeg * step * 0.05, 1, 2.4);
  g.lineCap = "round";
  g.lineWidth = w * 5;
  g.strokeStyle = "rgba(196,160,112,0.08)";
  g.stroke(body);
  g.lineWidth = w * 1.6;
  g.strokeStyle = "rgba(176,138,92,0.24)";
  g.stroke(shade);
  g.lineWidth = w * 1.3;
  g.strokeStyle = "rgba(255,252,244,0.72)";
  g.stroke(lit);
}

// ---- Textures: the soaked sponge and the cocoa -------------------------------------------------------------------

const SPONGE_TILE = 128;
const sponges = new WeakMap<CanvasRenderingContext2D, { dpr: number; p: CanvasPattern }>();

/**
 * The soaked sponge's crumb as a tile repeated without a seam: soft lighter patches where the crumb holds less
 * coffee and small dark pores with a faint lit lip, all far smaller and fainter than any marker.
 */
function sponge(g: CanvasRenderingContext2D, dpr: number): CanvasPattern {
  const hit = sponges.get(g);
  if (hit && hit.dpr === dpr) return hit.p;
  const T = SPONGE_TILE;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(T * dpr);
  const t = c.getContext("2d")!;
  t.scale(dpr, dpr);
  const rnd = seeded(41);
  const wrap = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) if (x + ox > -r && x + ox < T + r && y + oy > -r && y + oy < T + r) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * T, y = rnd() * T, r = 3 + rnd() * 9;
    const a = 0.08 + rnd() * 0.12;
    wrap(x, y, r, (px, py) => {
      const gr = t.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, `rgba(138,92,56,${a})`);
      gr.addColorStop(1, "rgba(138,92,56,0)");
      t.fillStyle = gr;
      t.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 150; i++) {
    const x = rnd() * T, y = rnd() * T, rx = 0.5 + rnd() * 1.6, ry = rx * (0.55 + rnd() * 0.4), turn = rnd() * Math.PI;
    wrap(x, y, 4, (px, py) => {
      t.beginPath();
      t.ellipse(px + 0.4, py + 0.6, rx, ry, turn, 0, Math.PI * 2);
      t.fillStyle = "rgba(160,112,72,0.2)";
      t.fill();
      t.beginPath();
      t.ellipse(px, py, rx, ry, turn, 0, Math.PI * 2);
      t.fillStyle = "rgba(14,7,3,0.5)";
      t.fill();
    });
  }
  const p = g.createPattern(c, "repeat")!;
  sponges.set(g, { dpr, p });
  return p;
}

/**
 * Pins a pattern to a point of the world: in Map view the projected 0 degrees, 0 degrees, so the texture travels
 * with the land and sea as they are dragged; on the globe its centre. `k` is the pattern's own scale (1 / dpr).
 */
function anchor(p: CanvasPattern, f: SurfaceFrame, k: number): CanvasPattern {
  const o = f.mode === "2d" ? (f.proj([0, 0]) ?? [0, 0]) : f.proj.translate();
  p.setTransform(new DOMMatrix().translate(o[0], o[1]).scale(k));
  return p;
}

/** Sifted cocoa: fine specks, dense where it settles at the cream's edge and on high relief, sparse elsewhere. */
const dense = (g: CanvasRenderingContext2D, f: SurfaceFrame) => anchor(speckle(g, f.dpr, "rgb(96,58,34)", 520, [0.5, 1.4], 61, 96), f, 1 / f.dpr);
const sparse = (g: CanvasRenderingContext2D, f: SurfaceFrame) => anchor(speckle(g, f.dpr, "rgb(96,58,34)", 40, [0.4, 1], 67, 128), f, 1 / f.dpr);

// ---- The world: sponge, cream and cocoa --------------------------------------------------------------------------

/** How much smaller the soft layers are drawn than the frame. */
const LOW = 4;

/**
 * A soft layer: what `draw` strokes, drawn on a canvas a quarter the frame's size, so laid back over the frame it comes
 * out blurred. Wide soft glows cost a sixteenth as much this way as stroked at full size.
 */
function low(slot: { canvas?: HTMLCanvasElement; g?: CanvasRenderingContext2D }, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const W = Math.max(1, Math.ceil(w / LOW)), H = Math.max(1, Math.ceil(h / LOW));
  if (!slot.canvas || !slot.g || slot.canvas.width !== W || slot.canvas.height !== H) {
    slot.canvas = document.createElement("canvas");
    slot.canvas.width = W;
    slot.canvas.height = H;
    slot.g = slot.canvas.getContext("2d")!;
  }
  const g = slot.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(1 / LOW, 0, 0, 1 / LOW, 0, 0);
  g.lineJoin = "round";
  g.lineCap = "round";
  draw(g);
  return slot.canvas;
}

/** The sea, the land and the dusting, inside `clip` (the dish's top or the ball). */
function paintWorld(f: SurfaceFrame, cache: TiramisuCache, g: CanvasRenderingContext2D, clip: Path2D) {
  const { w, h, dpr } = f;
  const k = clamp(0.85 + f.zoom * 0.15, 1, 1.8) * clamp(Math.min(w, h) / 720, 0.7, 1);
  g.save();
  g.clip(clip);
  g.fillStyle = ESPRESSO;
  g.fillRect(0, 0, w, h);
  g.fillStyle = anchor(sponge(g, dpr), f, 1 / dpr);
  g.fillRect(0, 0, w, h);
  const { land, coast, ice } = landPaths(f, f.map);
  const soft = wideCoast(f, coast);
  // The relief layer's mountains in view, a disc round each peak, so a range joins into one band.
  const pr = clamp(pxPerDeg(f.proj) * 0.9, 4, 20);
  const peaks = new Path2D();
  for (const [lon, lat] of f.relief?.peaks ?? []) {
    if (f.mode === "3d") {
      const a = lat * RAD, b = f.lat * RAD;
      if (Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * RAD) < 0.05) continue;
    }
    const q = f.proj([lon, lat]);
    if (!q || q[0] < -pr || q[1] < -pr || q[0] > w + pr || q[1] > h + pr) continue;
    peaks.moveTo(q[0] + pr, q[1]);
    peaks.arc(q[0], q[1], pr, 0, Math.PI * 2);
  }
  // Where the cream meets the sponge the coffee is a little milkier, fading out from the shore.
  g.drawImage(
    low(cache.milk, w, h, (s) => {
      s.strokeStyle = "rgba(184,130,82,0.09)";
      for (const d of [56, 40, 26, 14]) {
        s.lineWidth = d * k;
        s.stroke(soft);
      }
    }),
    0,
    0,
    w,
    h,
  );
  g.fillStyle = CREAM;
  g.fill(land);
  g.save();
  g.clip(land);
  swirls(f, g);
  if (ice) {
    g.fillStyle = "rgba(255,252,246,0.5)";
    g.fill(ice);
  }
  // Cocoa toward the edges and on high relief: a soft warm tint, thickest at the shore, and fine specks over it.
  g.drawImage(
    low(cache.cocoa, w, h, (s) => {
      s.strokeStyle = "rgba(196,160,112,0.16)";
      s.lineWidth = 22 * k;
      s.stroke(soft);
      s.strokeStyle = cocoa(0.07);
      for (const d of [44, 30, 18, 8]) {
        s.lineWidth = d * k;
        s.stroke(soft);
      }
      s.fillStyle = cocoa(0.1);
      s.fill(peaks);
    }),
    0,
    0,
    w,
    h,
  );
  // Each stroke's dust is shifted, so the specks of one band don't line up with the next and show its edge.
  const dust = dense(g, f);
  const [ax, ay] = f.mode === "2d" ? (f.proj([0, 0]) ?? [0, 0]) : f.proj.translate();
  g.lineJoin = "round";
  g.strokeStyle = dust;
  for (const [n, d, a] of [
    [0, 30, 0.22],
    [1, 13, 0.35],
  ] as const) {
    dust.setTransform(new DOMMatrix().translate(ax + n * 37, ay + n * 23).scale(1 / f.dpr));
    g.globalAlpha = a;
    g.lineWidth = d * k;
    g.stroke(soft);
  }
  g.globalAlpha = 0.25;
  dust.setTransform(new DOMMatrix().translate(ax + 71, ay + 13).scale(1 / f.dpr));
  g.fillStyle = dust;
  g.fill(peaks);
  g.globalAlpha = 1;
  g.restore();
  // No rivers: a thin line running inland across the cream reads too much like a border.
  const path = geoPath(f.proj, g);
  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = ESPRESSO;
  g.fill();
  g.fillStyle = anchor(sponge(g, dpr), f, 1 / dpr);
  g.fill();
  g.lineWidth = 0.6;
  g.strokeStyle = "rgba(70,42,24,0.6)";
  g.stroke();
  g.lineWidth = f.theme.coastWidth;
  g.strokeStyle = "rgba(70,42,24,0.75)";
  g.stroke(coast);
  // The faint dust over everything.
  g.globalAlpha = 0.5;
  g.fillStyle = sparse(g, f);
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  g.restore();
}

// ---- The table ---------------------------------------------------------------------------------------------------

/** Pale marble: a cool cream ground with a few soft grey veins from a fixed seed, fixed to the screen. */
function marble(g: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, "#efebe4");
  gr.addColorStop(1, "#e4ddd2");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const rnd = seeded(23);
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 0; i < 9; i++) {
    const v = new Path2D();
    let x = rnd() * w, y = rnd() * h;
    let a = rnd() * Math.PI * 2;
    v.moveTo(x, y);
    const n = 6 + Math.floor(rnd() * 6);
    for (let s = 0; s < n; s++) {
      a += (rnd() - 0.5) * 1.1;
      const l = 40 + rnd() * 90;
      const mx = x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 30, my = y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * 30;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      v.quadraticCurveTo(mx, my, x, y);
    }
    g.lineWidth = 5 + rnd() * 6;
    g.strokeStyle = "rgba(150,140,130,0.07)";
    g.stroke(v);
    g.lineWidth = 0.7 + rnd() * 0.6;
    g.strokeStyle = "rgba(130,120,110,0.22)";
    g.stroke(v);
  }
  g.fillStyle = speckle(g, dpr, "rgba(120,112,104,0.25)", 60, [0.5, 1.2], 29, 110);
  g.fillRect(0, 0, w, h);
}

// ---- Map view: the glass dish ------------------------------------------------------------------------------------

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The dish in a frame w by h: its outer glass edge, the top of the tiramisu inside it (the map), and the side under
 * the top where the glass shows the layers. The glass is as thick all round; the side is extra at the foot.
 */
export function dishOf(w: number, h: number): { outer: Box; inner: Box; side: Box; glass: number; round: number } {
  const wide = w >= 520 && h >= 360;
  const m = wide ? 12 : 5;
  const glass = wide ? 11 : 6;
  const band = wide ? 58 : 32;
  const outer = { x0: m, y0: m, x1: w - m, y1: h - m };
  const inner = { x0: m + glass, y0: m + glass, x1: w - m - glass, y1: h - m - glass - band };
  return { outer, inner, side: { x0: inner.x0, y0: inner.y1, x1: inner.x1, y1: inner.y1 + band }, glass, round: wide ? 18 : 11 };
}

function roundRect(p: Path2D, b: Box, r: number) {
  p.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r);
}

/** Where a layer's top edge runs across the cut: a gentle fixed wave, as cream is never spread quite flat. */
function layerEdge(x: number, y: number, amp: number, seed: number): number {
  return y + amp * (Math.sin(x * 0.021 + seed * 1.7) * 0.6 + Math.sin(x * 0.057 + seed * 3.1) * 0.4);
}

/**
 * The layers as the dish's side shows them, from the top down: cocoa, cream, sponge, cream, sponge (`LAYERS`, shares
 * of the side's height). The sponge is ladyfingers cut across, each a soaked oval, golden at its heart.
 */
/** The soaked sponge across a layer, from its top edge to its bottom edge. */
const SOAK: readonly [number, string][] = [
  [0, "#4a2a16"],
  [0.3, "#87583a"],
  [0.55, "#a2734a"],
  [0.8, "#7a4d2f"],
  [1, "#4f2e19"],
];

export const LAYERS: readonly ["cocoa" | "cream" | "sponge", number][] = [
  ["cocoa", 0.09],
  ["cream", 0.25],
  ["sponge", 0.22],
  ["cream", 0.2],
  ["sponge", 0.24],
];

function layersSide(g: CanvasRenderingContext2D, side: Box, dpr: number) {
  const { x0, x1 } = side;
  const H = side.y1 - side.y0;
  g.save();
  const cut = new Path2D();
  cut.rect(x0, side.y0, x1 - x0, H);
  g.clip(cut);
  let y = side.y0;
  LAYERS.forEach(([kind, share], n) => {
    const top = y, bottom = y + share * H;
    y = bottom;
    const amp = n === 0 ? 0.6 : Math.min(2.2, share * H * 0.14);
    const band = new Path2D();
    band.moveTo(x0, layerEdge(x0, top, amp, n));
    for (let x = x0; x <= x1 + 6; x += 6) band.lineTo(x, layerEdge(x, top, amp, n));
    band.lineTo(x1, bottom + 3);
    band.lineTo(x0, bottom + 3);
    band.closePath();
    if (kind === "cocoa") {
      g.fillStyle = "#5c3822";
      g.fill(band);
      g.fillStyle = speckle(g, dpr, "rgb(40,22,12)", 300, [0.5, 1.3], 71, 90);
      g.fill(band);
    } else if (kind === "cream") {
      const gr = g.createLinearGradient(0, top, 0, bottom);
      gr.addColorStop(0, "#f8efdc");
      gr.addColorStop(1, "#ebdcc0");
      g.fillStyle = gr;
      g.fill(band);
    } else {
      // Soaked sponge: darkest where the coffee went in at its top and bottom, golden toward its heart, the ladyfingers
      // laid side by side showing as faint joints.
      const gr = g.createLinearGradient(0, top, 0, bottom);
      for (const [at, c] of SOAK) gr.addColorStop(at, c);
      g.fillStyle = gr;
      g.fill(band);
      const lh = bottom - top;
      const rnd = seeded(97 + n);
      const joints = new Path2D();
      for (let x = x0 + lh * 2.6 * rnd(); x < x1; x += lh * (2.4 + rnd() * 0.6)) {
        const lean = (rnd() - 0.5) * lh * 0.5;
        joints.moveTo(x - lean / 2, top + 1);
        joints.quadraticCurveTo(x + lean, (top + bottom) / 2, x + lean / 2, bottom);
      }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(48,26,12,0.45)";
      g.stroke(joints);
      g.fillStyle = sponge(g, dpr);
      g.fill(band);
    }
    // A soft shade under each layer's edge, where it rests on the one below.
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(60,36,20,0.25)";
    const edge = new Path2D();
    edge.moveTo(x0, layerEdge(x0, top, amp, n));
    for (let x = x0; x <= x1 + 6; x += 6) edge.lineTo(x, layerEdge(x, top, amp, n));
    if (n > 0) g.stroke(edge);
  });
  // The glass over the cut: a sheen from the top, two upright streaks of light, a bright line at its top edge.
  const sh = g.createLinearGradient(0, side.y0, 0, side.y1);
  sh.addColorStop(0, "rgba(255,255,255,0.22)");
  sh.addColorStop(0.5, "rgba(255,255,255,0.06)");
  sh.addColorStop(1, "rgba(255,255,255,0.14)");
  g.fillStyle = sh;
  g.fillRect(x0, side.y0, x1 - x0, H);
  const W = x1 - x0;
  for (const [at, wd, a] of [
    [0.07, 0.025, 0.2],
    [0.11, 0.008, 0.28],
    [0.83, 0.012, 0.16],
  ] as const) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x0 + W * at, side.y0, Math.max(2, W * wd), H);
  }
  g.restore();
}

/** The table, the dish's shadow, its glass walls and the layers in its side: everything but the top. */
function dishLayer(g: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
  const d = dishOf(w, h);
  marble(g, w, h, dpr);
  const outer = new Path2D();
  roundRect(outer, d.outer, d.round);
  g.save();
  g.shadowColor = "rgba(70,48,30,0.3)";
  g.shadowBlur = 16;
  g.shadowOffsetY = 5;
  g.fillStyle = "rgba(226,232,228,0.9)";
  g.fill(outer);
  g.restore();
  layersSide(g, d.side, dpr);
  // The glass: a pale wall round the top and the side, lit along its outer edge and its inner one.
  const wall = new Path2D();
  roundRect(wall, d.outer, d.round);
  const hole = { x0: d.inner.x0, y0: d.inner.y0, x1: d.inner.x1, y1: d.side.y1 };
  roundRect(wall, hole, Math.max(4, d.round - d.glass));
  const gl = g.createLinearGradient(0, 0, w, h);
  gl.addColorStop(0, "rgba(250,253,252,0.75)");
  gl.addColorStop(0.5, "rgba(214,226,222,0.6)");
  gl.addColorStop(1, "rgba(236,244,240,0.7)");
  g.fillStyle = gl;
  g.fill(wall, "evenodd");
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  const rim = new Path2D();
  roundRect(rim, { x0: d.outer.x0 + 0.5, y0: d.outer.y0 + 0.5, x1: d.outer.x1 - 0.5, y1: d.outer.y1 - 0.5 }, d.round);
  g.stroke(rim);
  g.strokeStyle = "rgba(112,128,124,0.45)";
  g.stroke(outer);
  const mid = new Path2D();
  const half = d.glass / 2;
  roundRect(mid, { x0: d.outer.x0 + half, y0: d.outer.y0 + half, x1: d.outer.x1 - half, y1: d.outer.y1 - half }, d.round - half);
  g.lineWidth = 0.8;
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.stroke(mid);
  const lip = new Path2D();
  roundRect(lip, hole, Math.max(4, d.round - d.glass));
  g.lineWidth = 1;
  g.strokeStyle = "rgba(90,104,100,0.5)";
  g.stroke(lip);
}

// ---- Globe view: the bowl on its plate ---------------------------------------------------------------------------

/** The rings round a ball of radius R: the layers' outer edge, the bowl's glass, and the plate's edge and well. */
export function bowlOf(R: number): { layers: number; glass: number; well: number; plate: number } {
  return { layers: R * 1.2, glass: R * 1.25, well: R * 1.33, plate: R * 1.5 };
}

/** The layers round the ball, from the ball outward: the top's cocoa first and the bottom's sponge last. */
const RINGS: readonly ["cocoa" | "cream" | "sponge", number][] = [
  ["cocoa", 0.08],
  ["cream", 0.24],
  ["sponge", 0.22],
  ["cream", 0.21],
  ["sponge", 0.25],
];

function ring(r0: number, r1: number, cx: number, cy: number): Path2D {
  const p = new Path2D();
  p.arc(cx, cy, r1, 0, Math.PI * 2);
  p.moveTo(cx + r0, cy);
  p.arc(cx, cy, r0, 0, Math.PI * 2, true);
  return p;
}

function bowl(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, dpr: number) {
  const b = bowlOf(R);
  // The plate: a shadow on the marble, cream china, a sunken well and a fine cocoa line round the rim.
  g.save();
  g.shadowColor = "rgba(70,48,30,0.3)";
  g.shadowBlur = Math.min(24, R * 0.1);
  g.shadowOffsetY = Math.min(8, R * 0.03);
  g.beginPath();
  g.arc(cx, cy, b.plate, 0, Math.PI * 2);
  g.fillStyle = "#fbf8f1";
  g.fill();
  g.restore();
  const well = g.createRadialGradient(cx, cy, b.glass, cx, cy, b.well);
  well.addColorStop(0, "rgba(206,192,170,0.4)");
  well.addColorStop(1, "rgba(206,192,170,0)");
  g.fillStyle = well;
  g.fill(ring(b.glass, b.well, cx, cy));
  g.lineWidth = Math.max(1, R * 0.006);
  g.strokeStyle = "rgba(120,80,48,0.45)";
  g.beginPath();
  g.arc(cx, cy, b.plate - Math.max(4, R * 0.035), 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(150,132,110,0.45)";
  g.beginPath();
  g.arc(cx, cy, b.plate - 0.5, 0, Math.PI * 2);
  g.stroke();
  // The layers, ring by ring.
  const T = b.layers - R;
  let r = R;
  RINGS.forEach(([kind, share], n) => {
    const r0 = r, r1 = r + share * T;
    r = r1;
    const band = ring(r0 - 0.5, r1 + 0.5, cx, cy);
    if (kind === "cocoa") {
      g.fillStyle = "#5c3822";
      g.fill(band);
      g.fillStyle = speckle(g, dpr, "rgb(40,22,12)", 300, [0.5, 1.3], 71, 90);
      g.fill(band);
    } else if (kind === "cream") {
      const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      gr.addColorStop(0, "#ebdcc0");
      gr.addColorStop(1, "#f8efdc");
      g.fillStyle = gr;
      g.fill(band);
    } else {
      // The sponge's soak runs across the ring as it runs down the dish's side, and the ladyfingers' joints point out.
      const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      for (const [at, c] of SOAK) gr.addColorStop(at, c);
      g.fillStyle = gr;
      g.fill(band);
      const lh = r1 - r0;
      const count = Math.max(8, Math.round((Math.PI * 2 * (r0 + r1)) / 2 / (lh * 2.7)));
      const rnd = seeded(97 + n);
      const joints = new Path2D();
      for (let i = 0; i < count; i++) {
        const a = ((i + rnd() * 0.3) / count) * Math.PI * 2, b = a + (rnd() - 0.5) * 0.04;
        joints.moveTo(cx + Math.cos(a) * (r0 + 1), cy + Math.sin(a) * (r0 + 1));
        joints.lineTo(cx + Math.cos(b) * r1, cy + Math.sin(b) * r1);
      }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(48,26,12,0.45)";
      g.stroke(joints);
      g.fillStyle = sponge(g, dpr);
      g.fill(band);
    }
    if (n > 0) {
      g.lineWidth = 1;
      g.strokeStyle = "rgba(60,36,20,0.22)";
      g.beginPath();
      g.arc(cx, cy, r0, 0, Math.PI * 2);
      g.stroke();
    }
  });
  // The bowl's glass wall, and its light: bright toward the upper left, a soft shade toward the lower right.
  g.fillStyle = "rgba(232,240,238,0.72)";
  g.fill(ring(b.layers, b.glass, cx, cy));
  const sheen = g.createLinearGradient(cx - b.glass, cy - b.glass, cx + b.glass, cy + b.glass);
  sheen.addColorStop(0, "rgba(255,255,255,0.3)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.04)");
  sheen.addColorStop(1, "rgba(60,70,70,0.12)");
  g.fillStyle = sheen;
  g.fill(ring(R, b.glass, cx, cy));
  g.lineCap = "round";
  g.lineWidth = Math.max(1.5, R * 0.012);
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.beginPath();
  g.arc(cx, cy, (b.layers + b.glass) / 2, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.arc(cx, cy, b.glass - 0.5, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(100,116,112,0.45)";
  g.beginPath();
  g.arc(cx, cy, b.layers, 0, Math.PI * 2);
  g.stroke();
}

// ---- The spoon and the sieve beside the plate --------------------------------------------------------------------

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 116, h: 64 };
export const ZOOM_BOX = { w: 76, h: 112 };

/** A tool laid on the table: its centre, the radius of the circle it stays inside, and its turn. */
export interface Tool {
  kind: "spoon" | "sieve";
  x: number;
  y: number;
  s: number;
  turn: number;
}

/** Where each tool may lie, by direction from the ball's centre (screen degrees, y down), in turn of choice. */
const SPOTS: readonly [Tool["kind"], number][] = [
  ["spoon", 14],
  ["sieve", 196],
  ["spoon", 166],
  ["sieve", -24],
  ["spoon", -14],
  ["sieve", 156],
];

const GAP = 10;
const MARGIN = 8;

function hitsBox(x: number, y: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;
}

/**
 * The spoon and the sieve on the table beside a ball of radius R at (cx, cy) in a frame w by h, sized from the ball
 * at its widest zoom (`baseR`). Each sits in the room between the plate and the frame's edge, shrinks to fit it and
 * is left out when there is too little, so neither ever comes near the plate, the Key, the zoom buttons or the other.
 */
export function placeTools(w: number, h: number, cx: number, cy: number, R: number, baseR: number): Tool[] {
  const out: Tool[] = [];
  const P = bowlOf(R).plate;
  for (const [kind, deg] of SPOTS) {
    if (out.some((o) => o.kind === kind)) continue;
    const cap = clamp(baseR * (kind === "spoon" ? 0.5 : 0.36), 22, kind === "spoon" ? 130 : 90);
    const a = deg * RAD;
    const dx = Math.cos(a), dy = Math.sin(a);
    const x0 = cx + dx * (P + GAP), y0 = cy + dy * (P + GAP);
    if (x0 < MARGIN || y0 < MARGIN || x0 > w - MARGIN || y0 > h - MARGIN) continue;
    // The largest circle along this direction, touching the plate's gap, that stays inside the frame's margin.
    const fit = (room: number, d: number) => (room - MARGIN) / (1 + Math.abs(d));
    const s = Math.min(cap, fit(dx < 0 ? x0 : w - x0, dx), fit(dy < 0 ? y0 : h - y0, dy));
    if (s < 22) continue;
    const x = cx + dx * (P + GAP + s), y = cy + dy * (P + GAP + s);
    if (hitsBox(x, y, s + 4, 0, 0, KEY_BOX.w, KEY_BOX.h)) continue;
    if (hitsBox(x, y, s + 4, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + s + GAP)) continue;
    // Laid along the plate's edge, as a spoon is set beside a plate, with a slight slant.
    out.push({ kind, x, y, s, turn: a + Math.PI / 2 + (kind === "spoon" ? 0.12 : -0.5) });
  }
  return out;
}

/** A dessert spoon along its length in local units: the bowl at +x, the handle toward -x, within a unit circle. */
function spoon(g: CanvasRenderingContext2D, px: number) {
  const handle = new Path2D();
  handle.moveTo(-0.93, -0.035);
  handle.quadraticCurveTo(-0.96, 0, -0.93, 0.035);
  handle.bezierCurveTo(-0.6, 0.06, -0.2, 0.02, 0.28, 0.03);
  handle.lineTo(0.28, -0.03);
  handle.bezierCurveTo(-0.2, -0.02, -0.6, -0.06, -0.93, -0.035);
  handle.closePath();
  const metal = g.createLinearGradient(0, -0.08, 0, 0.08);
  metal.addColorStop(0, "#f2f3f2");
  metal.addColorStop(0.5, "#b9bebe");
  metal.addColorStop(1, "#8e9494");
  g.fillStyle = metal;
  g.fill(handle);
  const bowlP = new Path2D();
  bowlP.ellipse(0.58, 0, 0.34, 0.2, 0, 0, Math.PI * 2);
  const bm = g.createRadialGradient(0.5, -0.07, 0.02, 0.58, 0, 0.36);
  bm.addColorStop(0, "#fbfbfa");
  bm.addColorStop(0.6, "#c4c9c8");
  bm.addColorStop(1, "#8a9090");
  g.fillStyle = bm;
  g.fill(bowlP);
  g.lineWidth = px;
  g.strokeStyle = "rgba(80,88,88,0.7)";
  g.stroke(handle);
  g.stroke(bowlP);
  // A smear of cream and a little cocoa left in the spoon's bowl.
  const smear = new Path2D();
  smear.ellipse(0.62, 0.03, 0.17, 0.08, -0.15, 0, Math.PI * 2);
  g.fillStyle = "rgba(246,236,214,0.95)";
  g.fill(smear);
  g.fillStyle = "rgba(96,58,34,0.55)";
  g.beginPath();
  g.ellipse(0.66, 0.02, 0.08, 0.035, -0.15, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = px * 1.4;
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.moveTo(-0.85, -0.012);
  g.lineTo(0.2, -0.008);
  g.stroke();
}

/** A round cocoa sieve in local units: a wire mesh in a rim with cocoa in it, and its handle toward -x. */
function sieve(g: CanvasRenderingContext2D, px: number) {
  const cx = 0.3, R = 0.62;
  const handle = new Path2D();
  handle.moveTo(cx - R + 0.02, -0.04);
  handle.lineTo(-0.94, -0.03);
  handle.quadraticCurveTo(-0.99, 0, -0.94, 0.03);
  handle.lineTo(cx - R + 0.02, 0.04);
  handle.closePath();
  g.fillStyle = "#a9afaf";
  g.fill(handle);
  g.lineWidth = px;
  g.strokeStyle = "rgba(80,88,88,0.7)";
  g.stroke(handle);
  const mesh = new Path2D();
  mesh.arc(cx, 0, R * 0.9, 0, Math.PI * 2);
  g.fillStyle = "rgba(205,200,190,0.55)";
  g.fill(mesh);
  // The cocoa in it, heaped toward the middle, then the wire mesh over it.
  const heap = g.createRadialGradient(cx - 0.05, 0.03, 0, cx, 0, R * 0.78);
  heap.addColorStop(0, "rgba(104,62,36,0.95)");
  heap.addColorStop(0.7, "rgba(112,70,42,0.7)");
  heap.addColorStop(1, "rgba(112,70,42,0)");
  g.fillStyle = heap;
  g.fill(mesh);
  g.save();
  g.clip(mesh);
  const wires = new Path2D();
  const step = Math.max(0.045, px * 5);
  for (let u = -R; u <= R; u += step) {
    wires.moveTo(cx + u, -R);
    wires.lineTo(cx + u, R);
    wires.moveTo(cx - R, u);
    wires.lineTo(cx + R, u);
  }
  g.lineWidth = px * 0.6;
  g.strokeStyle = "rgba(70,74,74,0.35)";
  g.stroke(wires);
  g.restore();
  const rim = new Path2D();
  rim.arc(cx, 0, R, 0, Math.PI * 2);
  rim.moveTo(cx + R * 0.9, 0);
  rim.arc(cx, 0, R * 0.9, 0, Math.PI * 2, true);
  const metal = g.createLinearGradient(cx - R, -R, cx + R, R);
  metal.addColorStop(0, "#f4f5f4");
  metal.addColorStop(0.5, "#b4baba");
  metal.addColorStop(1, "#8a9090");
  g.fillStyle = metal;
  g.fill(rim);
  g.lineWidth = px;
  g.strokeStyle = "rgba(80,88,88,0.7)";
  g.beginPath();
  g.arc(cx, 0, R, 0, Math.PI * 2);
  g.stroke();
}

function drawTool(g: CanvasRenderingContext2D, t: Tool, dpr: number) {
  g.save();
  g.translate(t.x, t.y);
  g.rotate(t.turn);
  g.shadowColor = "rgba(70,48,30,0.28)";
  g.shadowBlur = 6;
  g.shadowOffsetX = 2;
  g.shadowOffsetY = 3;
  g.scale(t.s, t.s);
  g.lineJoin = "round";
  g.lineCap = "round";
  if (t.kind === "spoon") spoon(g, 1 / t.s);
  else sieve(g, 1 / t.s);
  g.restore();
  if (t.kind === "sieve") {
    // A little cocoa sifted onto the table beside it, inside the tool's own circle.
    g.save();
    const p = new Path2D();
    p.arc(t.x, t.y, t.s * 0.95, 0, Math.PI * 2);
    g.clip(p);
    g.globalAlpha = 0.45;
    g.fillStyle = speckle(g, dpr, "rgb(96,58,34)", 160, [0.5, 1.2], 83, 80);
    g.beginPath();
    g.ellipse(t.x + Math.cos(t.turn) * t.s * 0.3, t.y + Math.sin(t.turn) * t.s * 0.3, t.s * 0.55, t.s * 0.4, t.turn, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// ---- The frame ---------------------------------------------------------------------------------------------------

export class TiramisuCache {
  world = new StillLayer();
  dish: { key?: string; canvas?: HTMLCanvasElement } = {};
  table: { key?: string; canvas?: HTMLCanvasElement } = {};
  /** The soft layers: the milkier coffee along the shore, and the cocoa at the cream's edge and on high relief. */
  milk: { canvas?: HTMLCanvasElement; g?: CanvasRenderingContext2D } = {};
  cocoa: { canvas?: HTMLCanvasElement; g?: CanvasRenderingContext2D } = {};
}

function paintGlobe(f: SurfaceFrame, cache: TiramisuCache, g: CanvasRenderingContext2D) {
  const { w, h, dpr } = f;
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const key = `${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  const table = once(cache.table, key, w, h, dpr, (t) => {
    marble(t, w, h, dpr);
    for (const tool of placeTools(w, h, cx, cy, R, R / Math.max(1, f.zoom))) drawTool(t, tool, dpr);
    if (bowlOf(R).plate < Math.hypot(w, h)) bowl(t, cx, cy, R, dpr);
  });
  g.drawImage(table, 0, 0, w, h);
  const sphere = new Path2D();
  geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  paintWorld(f, cache, g, sphere);
  g.save();
  g.clip(sphere);
  // The dome lit from the upper left, and cocoa thicker toward its edge, where the sieve's dust settles deepest.
  const lightG = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R);
  lightG.addColorStop(0, "rgba(255,250,236,0.2)");
  lightG.addColorStop(0.55, "rgba(255,250,236,0)");
  lightG.addColorStop(0.8, "rgba(92,56,34,0.04)");
  lightG.addColorStop(1, "rgba(80,46,26,0.3)");
  g.fillStyle = lightG;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.globalAlpha = 0.5;
  g.lineWidth = Math.min(60, R * 0.16);
  g.strokeStyle = dense(g, f);
  g.stroke(sphere);
  g.restore();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(70,42,24,0.6)";
  g.stroke(sphere);
}

/**
 * Each bean's soft shadow on the cream, down and to the right as if it sat on the surface, in one fill under the
 * markers, so the markers themselves are untouched.
 */
export function beanShadows(g: CanvasRenderingContext2D, spots: readonly SurfaceSpot[]) {
  if (!spots.length) return;
  const p = new Path2D();
  for (const s of spots) {
    const x = s.x + s.r * 0.3, y = s.y + s.r * 0.5;
    p.moveTo(x + s.r * 1.2, y);
    p.ellipse(x, y, s.r * 1.2, s.r * 0.85, -0.45, 0, Math.PI * 2);
  }
  g.save();
  g.fillStyle = "rgba(50,28,14,0.22)";
  g.fill(p);
  g.restore();
}

export function drawTiramisu(f: SurfaceFrame, cache: TiramisuCache): SurfaceResult {
  const { w, h, dpr } = f;
  const under = (spots: SurfaceSpot[]) => beanShadows(f.ctx, spots);
  if (f.mode === "3d") {
    cache.world.draw(f, (g) => paintGlobe(f, cache, g));
    return { under };
  }
  const d = dishOf(w, h);
  const top = new Path2D();
  roundRect(top, d.inner, Math.max(4, d.round - d.glass));
  cache.world.draw(f, (g) => {
    g.drawImage(once(cache.dish, `${w}|${h}|${dpr}`, w, h, dpr, (t) => dishLayer(t, w, h, dpr)), 0, 0, w, h);
    paintWorld(f, cache, g, top);
    // Where the cream meets the glass it sits a touch in shadow.
    g.save();
    g.clip(top);
    g.lineWidth = 6;
    g.strokeStyle = "rgba(90,64,40,0.12)";
    g.stroke(top);
    g.restore();
  });
  const m = 4;
  const i = d.inner;
  return { inside: (x, y) => x > i.x0 + m && y > i.y0 + m && x < i.x1 - m && y < i.y1 - m, clip: top, under };
}
