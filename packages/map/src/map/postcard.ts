// Postcards (id postcard): after the feel of travel postcards on a spinning wire rack in a corner shop,
// and the folded paper travel maps sold beside them. Nothing is copied from any postal service, airline, map maker or
// company: no names, logos, stamps, marks or art. Everything here is our own drawing.
//
// Map view: a folded paper travel map. Cream land with a hand-tinted edge, pale blue sea with soft blue water bands
// along the coasts, a faint printed grid, small brown hill marks, and the sheet's own paper: a soft grain and the
// creases where it was folded, light on one side of each fold and shade on the other. The creases are part of the
// paper, so they stay put on the screen while the map moves under them, and they are drawn under the markers, so they
// never cover a place. The folds are laid so the reticle always sits in the middle of a panel, never on a crease.
//
// Globe view: a paper globe, printed in gores like the ones glued round a ball: the same cream land and pale sea, the
// gores' seams every thirty degrees, a soft light from the upper left, and the ball's shadow on the shop's counter.
//
// Nothing on the canvas moves on its own. The postcard panel's slide and turn (src/ui/postcard.ts) have their timing
// here, so the test can check them against the no-flash limit.

import { geoGraticule, geoPath } from "d3-geo";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The map's paper and inks. Keep in step with the postcard tokens in src/designs/postcard.css. */
export const PAPER = {
  sea: "#c6dfe6",
  seaDeep: "#b4d3dd",
  land: "#f2e6c8",
  landEdge: "rgba(176,140,86,0.32)",
  margin: "#efe5cd",
  coast: "#6d8796",
  ink: "#5a4a36",
  grid: "rgba(77,118,140,0.22)",
  hill: "rgba(122,92,58,0.42)",
  river: "#86b4c7",
  ice: "#fbf8ef",
  seam: "rgba(90,74,54,0.26)",
};

// ---- the postcard's timing (src/ui/postcard.ts, src/designs/postcard.css) -------------------------------------------------------

/** The card's slide out of the rack when the tuned place changes, and its turn from picture to stories, in ms. */
export const SLIDE_MS = 280;
export const FLIP_MS = 460;
/**
 * How long a new card shows its picture before it turns over to its stories on its own. Long enough that a reader
 * dragging the map past places sees pictures, never a card turning back and forth, and short enough that the stories
 * are there in a moment. A tap on the picture or the Turn button turns it at once.
 */
export const HOLD_MS = 1100;

/**
 * The card's faces as the eye takes them in, for the no-flash check: each face's main colours and the share of the
 * face each covers. The turn swaps one for the other over a large area, so the two must be close in brightness.
 * Keep in step with the front's band (src/ui/postcard.ts) and the card tokens in src/designs/postcard.css.
 */
export const FACES = {
  front: [
    { colour: "#f7f0de", share: 0.16 }, // the white border
    { colour: "#cfe5ea", share: 0.3 }, // the sky
    { colour: "#f6e3a6", share: 0.08 }, // the glow round the sun
    { colour: "#9fcbd6", share: 0.18 }, // the sea
    { colour: "#e9d7a9", share: 0.08 }, // the sand
    { colour: "#b8cf94", share: 0.14 }, // the hills
    { colour: "#f2b54a", share: 0.06 }, // the lettering's fill
  ],
  back: [
    { colour: "#f8f1df", share: 0.84 }, // the card
    { colour: "#2b2118", share: 0.06 }, // the typed lines
    { colour: "#dcc7a5", share: 0.05 }, // the ruling and the divider
    { colour: "#2457a8", share: 0.05 }, // the stamp and the postmark
  ],
  /** What shows behind the card while it is edge on, half way through the turn: the panel's paper. */
  behind: [{ colour: "#ece2c9", share: 1 }],
} as const;

/** The relative luminance (WCAG) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** A face's average luminance, weighted by how much of it each colour covers. */
export function faceLuminance(parts: readonly { colour: string; share: number }[]): number {
  const total = parts.reduce((s, p) => s + p.share, 0);
  return parts.reduce((s, p) => s + luminance(p.colour) * p.share, 0) / total;
}

// ---- the sheet's folds -------------------------------------------------------------------------------------------

/** One fold across the sheet: where it runs (x for an upright fold, y for an across one) and which side is lit. */
export interface Fold {
  at: number;
  upright: boolean;
  /** +1 when the light falls on the side after the fold (right or below), -1 before it. */
  lit: 1 | -1;
}

/**
 * The folds of a sheet `w` by `h`: an odd number of tall panels across and an odd number of rows down, so the
 * frame's middle, where the reticle sits, is always the middle of a panel. Panels are about 230 pixels wide and 280
 * tall, as a pocket map folds; a short frame has one row and no fold across. Accordion folds alternate, so the light
 * falls on alternate sides.
 */
export function sheetFolds(w: number, h: number): Fold[] {
  const odd = (n: number) => (n % 2 ? n : n + 1);
  const cols = odd(clamp(Math.round(w / 230), 1, 9));
  const rows = h < 420 ? 1 : odd(clamp(Math.round(h / 280), 1, 5));
  const out: Fold[] = [];
  for (let i = 1; i < cols; i++) out.push({ at: (w * i) / cols, upright: true, lit: i % 2 ? 1 : -1 });
  for (let j = 1; j < rows; j++) out.push({ at: (h * j) / rows, upright: false, lit: j % 2 ? -1 : 1 });
  return out;
}

/** The paper's grain: a small tile of faint fibres and flecks, the same on every load. */
function grainTile(dpr: number): HTMLCanvasElement {
  const size = 160;
  const [c, g] = offscreen(size, size, dpr);
  const rnd = seeded(4471);
  g.lineCap = "round";
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size, y = rnd() * size;
    const a = rnd() * TAU, l = 3 + rnd() * 9;
    g.strokeStyle = rnd() < 0.5 ? "rgba(120,96,60,0.07)" : "rgba(255,255,255,0.22)";
    g.lineWidth = 0.6 + rnd() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Flecks too faint and too small to read as a mark: one pixel, a few per cent darker than the paper.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(110,86,52,${0.03 + rnd() * 0.04})`;
    g.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
  return c;
}

export class PostcardCache {
  /** The sheet's paper over the map: its grain and its folds, one per frame size. */
  sheet?: { key: string; canvas: HTMLCanvasElement };
  /** The paper globe's grain, light and shade, and its shadow on the counter, one per globe size and place. */
  ball?: { key: string; under: HTMLCanvasElement; over: HTMLCanvasElement };
  grain?: { dpr: number; tile: HTMLCanvasElement };
}

function grainOf(cache: PostcardCache, dpr: number) {
  if (cache.grain?.dpr !== dpr) cache.grain = { dpr, tile: grainTile(dpr) };
  return cache.grain.tile;
}

/** The paper laid over the flat map: grain everywhere, then each fold's light and shade. */
function sheetLayer(f: SurfaceFrame, cache: PostcardCache): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const [c, g] = offscreen(w, h, dpr);
  const pat = g.createPattern(grainOf(cache, dpr), "repeat");
  if (pat) {
    pat.setTransform(new DOMMatrix().scale(1 / dpr));
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
  }
  // Each panel bows a little between its folds: a soft sheen across it, brighter toward its lit fold.
  for (const k of sheetFolds(w, h)) {
    const span = k.upright ? w : h;
    // A fold is a broad soft band, never a crisp line, so it never reads as a line drawn on the map.
    const band = clamp(span * 0.018, 7, 16);
    const at = k.at;
    const lin = (a: number, b: number) => (k.upright ? g.createLinearGradient(a, 0, b, 0) : g.createLinearGradient(0, a, 0, b));
    const rect = (a: number, b: number) => (k.upright ? g.fillRect(a, 0, b - a, h) : g.fillRect(0, a, w, b - a));
    // The shaded side: dark at the fold, fading over the band.
    const s0 = at - k.lit * band * 2.2;
    const shade = lin(at, s0);
    shade.addColorStop(0, "rgba(96,74,40,0.16)");
    shade.addColorStop(0.35, "rgba(96,74,40,0.06)");
    shade.addColorStop(1, "rgba(96,74,40,0)");
    g.fillStyle = shade;
    rect(Math.min(at, s0), Math.max(at, s0));
    // The lit side: a soft highlight just past the fold.
    const l1 = at + k.lit * band * 1.6;
    const light = lin(at, l1);
    light.addColorStop(0, "rgba(255,253,244,0.5)");
    light.addColorStop(1, "rgba(255,253,244,0)");
    g.fillStyle = light;
    rect(Math.min(at, l1), Math.max(at, l1));
  }
  // The sheet's edge darkens a little, as paper handled at its edges does.
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  edge.addColorStop(0, "rgba(120,92,50,0)");
  edge.addColorStop(1, "rgba(120,92,50,0.12)");
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  return c;
}

const GRID = geoGraticule().step([15, 15])();
const SEAMS = geoGraticule().step([30, 180]).extent([[-180, -80], [180, 80.001]])();

function facing([lon0, lat0]: [number, number], lon: number, lat: number): boolean {
  const d = Math.PI / 180;
  return Math.sin(lat * d) * Math.sin(lat0 * d) + Math.cos(lat * d) * Math.cos(lat0 * d) * Math.cos((lon - lon0) * d) > 0.05;
}

/** Land, sea and their inks, as printed: shared by the sheet and the globe. */
function paintWorld(f: SurfaceFrame, globe: boolean) {
  const { ctx, w, h, proj } = f;
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  const land = path(f.map.land);
  const coast = path(f.map.coast);
  const lakes = path(f.map.lakes);
  const grid = path(globe ? SEAMS : GRID);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // The printed grid, faint and under everything else.
  ctx.strokeStyle = globe ? PAPER.seam : PAPER.grid;
  ctx.lineWidth = globe ? 0.9 : 0.6;
  if (!globe) ctx.setLineDash([3, 3]);
  ctx.stroke(grid);
  ctx.setLineDash([]);
  // Water bands along the coasts, the way a printed map shades its shallows: wide and faint, then narrower.
  const scale = clamp(Math.sqrt(f.zoom), 1, 2.4);
  ctx.strokeStyle = "rgba(86,140,164,0.13)";
  ctx.lineWidth = 12 * scale;
  ctx.stroke(coast);
  ctx.strokeStyle = "rgba(86,140,164,0.14)";
  ctx.lineWidth = 5 * scale;
  ctx.stroke(coast);
  // The land, then its hand-tinted edge: a warmer band just inside the coast.
  ctx.fillStyle = PAPER.land;
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  ctx.strokeStyle = PAPER.landEdge;
  ctx.lineWidth = 7 * scale;
  ctx.stroke(coast);
  ctx.restore();
  if (f.map.ice) {
    ctx.fillStyle = PAPER.ice;
    ctx.fill(path(f.map.ice));
  }
  // Hills as small open humps in brown ink, the way a pictorial map marks high ground: never a dot.
  if (f.relief) {
    const s = clamp(2.2 * Math.sqrt(f.zoom), 2.2, 5);
    const c: [number, number] = [f.lon, f.lat];
    const hills = new Path2D();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && !facing(c, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      hills.moveTo(p[0] - s, p[1] + s * 0.4);
      hills.quadraticCurveTo(p[0], p[1] - s * 0.9, p[0] + s, p[1] + s * 0.4);
    }
    ctx.save();
    ctx.clip(land);
    ctx.strokeStyle = PAPER.hill;
    ctx.lineWidth = 0.9;
    ctx.stroke(hills);
    ctx.restore();
  }
  ctx.fillStyle = PAPER.sea;
  ctx.fill(lakes);
  if (f.zoom >= 2) {
    ctx.strokeStyle = PAPER.river;
    ctx.lineWidth = 0.8;
    ctx.stroke(path(f.map.rivers));
  }
  ctx.strokeStyle = PAPER.coast;
  ctx.lineWidth = f.theme.coastWidth;
  ctx.stroke(coast);
  ctx.lineWidth = f.theme.coastWidth * 0.7;
  ctx.stroke(lakes);
}

function drawSheet(f: SurfaceFrame, cache: PostcardCache) {
  const { ctx, w, h } = f;
  ctx.fillStyle = PAPER.margin;
  ctx.fillRect(0, 0, w, h);
  const sphere = new Path2D();
  geoPath(f.view as never, pathContext(sphere))({ type: "Sphere" } as never);
  ctx.fillStyle = PAPER.sea;
  ctx.fill(sphere);
  ctx.save();
  ctx.clip(sphere);
  paintWorld(f, false);
  ctx.restore();
  // The map's printed edge: a thin rule in the brown ink, and a finer one outside it.
  ctx.strokeStyle = PAPER.ink;
  ctx.lineWidth = 1.2;
  ctx.stroke(sphere);
  const key = `${w}|${h}|${f.dpr}`;
  if (cache.sheet?.key !== key) cache.sheet = { key, canvas: sheetLayer(f, cache) };
  ctx.drawImage(cache.sheet.canvas, 0, 0, w, h);
}

/** The paper ball's shadow on the counter, and its light and shade over the printed world. */
function ballLayers(f: SurfaceFrame, cache: PostcardCache, cx: number, cy: number, R: number) {
  const { w, h, dpr } = f;
  const [under, u] = offscreen(w, h, dpr);
  // The shadow: a soft ellipse on the counter below and a little right of the ball, away from the light.
  u.save();
  u.translate(cx + R * 0.12, cy + R * 1.04);
  u.scale(1, 0.14);
  const sh = u.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
  sh.addColorStop(0, "rgba(70,52,28,0.3)");
  sh.addColorStop(1, "rgba(70,52,28,0)");
  u.fillStyle = sh;
  u.fillRect(-R, -R, R * 2, R * 2);
  u.restore();
  const [over, o] = offscreen(w, h, dpr);
  o.save();
  o.beginPath();
  o.arc(cx, cy, R, 0, TAU);
  o.clip();
  const pat = o.createPattern(grainOf(cache, dpr), "repeat");
  if (pat) {
    pat.setTransform(new DOMMatrix().scale(1 / dpr));
    o.fillStyle = pat;
    o.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  // Light from the upper left, shade toward the far limb: soft, as on matt paper.
  const lit = o.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.05, cx - R * 0.1, cy - R * 0.1, R * 1.25);
  lit.addColorStop(0, "rgba(255,252,240,0.38)");
  lit.addColorStop(0.45, "rgba(255,252,240,0.04)");
  lit.addColorStop(0.75, "rgba(80,60,30,0.07)");
  lit.addColorStop(1, "rgba(80,60,30,0.3)");
  o.fillStyle = lit;
  o.fillRect(cx - R, cy - R, R * 2, R * 2);
  o.restore();
  o.strokeStyle = PAPER.ink;
  o.lineWidth = 1.2;
  o.beginPath();
  o.arc(cx, cy, R, 0, TAU);
  o.stroke();
  return { under, over };
}

function drawGlobe(f: SurfaceFrame, cache: PostcardCache) {
  const { ctx, w, h, proj } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  const key = `${w}|${h}|${f.dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  if (cache.ball?.key !== key) cache.ball = { key, ...ballLayers(f, cache, cx, cy, R) };
  ctx.drawImage(cache.ball.under, 0, 0, w, h);
  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = PAPER.sea;
  ctx.fill(sphere);
  ctx.save();
  ctx.clip(sphere);
  paintWorld(f, true);
  ctx.restore();
  ctx.drawImage(cache.ball.over, 0, 0, w, h);
}

export function drawPostcard(f: SurfaceFrame, cache: PostcardCache) {
  if (f.mode === "3d") drawGlobe(f, cache);
  else drawSheet(f, cache);
}
