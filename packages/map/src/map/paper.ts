// Paper Screen (id paper, experimental): after the feel of an e-ink reading device, and nothing else from any: no
// maker's or product's name, logo, case shape, button symbols or screens. Greys only, at most sixteen of them, on a
// slightly warm paper white, drawn crisp.
//
// The sea is the paper itself with fine grey water lines along every coast; the land is stippled in a mid grey, the
// coasts are black, and the globe is the same sphere, outlined in black with a second fine ring. Like
// an e-ink screen, the picture is drawn plainly while it moves (flat grey land and black coasts, no stipple, water
// lines, rivers or grid) and redrawn in full once it holds still, so a drag stays as quick as in any design and only
// decorative work waits. Nothing here moves on its own, and markers, arcs and tuning are the view's as in every design.

import { geoDistance, geoGraticule, geoPath, type GeoProjection } from "d3-geo";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

type RGB = [number, number, number];

/** The ink and the paper the sixteen greys run between, a little warm, as on an e-ink page. */
const INK_RGB: RGB = [27, 26, 24];
const PAPER_RGB: RGB = [245, 243, 238];

const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * The only colours the design uses, on the canvas and in its chrome (style.css repeats them as --pp-g0 to --pp-g15):
 * sixteen greys evenly spaced from the ink (0) to the paper (15), like the levels of an e-ink screen.
 */
export const GREYS: readonly string[] = Array.from({ length: 16 }, (_, i) => hex(INK_RGB.map((v, k) => v + ((PAPER_RGB[k]! - v) * i) / 15) as RGB));

export const INK = GREYS[0]!;
export const PAPER = GREYS[15]!;

/** How long the picture must hold still before the full drawing replaces the plain one, in milliseconds. */
export const SETTLE_MS = 140;

/**
 * A page turn is an e-ink refresh: the page fades toward a light grey and back in REFRESH_MS, the new page landing at
 * the middle. It never fades all the way: at its lowest the page is REFRESH_LOW paper over the grey, so the light
 * swings by well under a tenth of the screen's brightness and nothing ever flashes (WCAG 2.3.1, test/paper.test.ts).
 * None at all for reduced motion.
 */
export const REFRESH_MS = 150;
export const REFRESH_GREY_LEVEL = 14;
export const REFRESH_LOW = 0.25;

/** The page's opacity over the grey through a refresh, t from 0 to 1: down to REFRESH_LOW at the middle and back. */
export function refreshOpacity(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  // A smooth dip to the middle and back, the same curve the page's animation is given as keyframes.
  const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
  return 1 - (1 - REFRESH_LOW) * k;
}

/** sRGB to relative luminance (WCAG), for the flash checks. */
export function luminance(color: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`not a hex colour: ${color}`);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => lin(parseInt(x, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** What each part of the map is drawn in, by grey level. */
const SEA = PAPER;
const LAND_FLAT = GREYS[11]!;
const LAND_UNDER = GREYS[13]!;
const STIPPLE = GREYS[4]!;
const WATERLINE = GREYS[10]!;
const RIVER = GREYS[8]!;
const ICE = GREYS[14]!;
const GRID = GREYS[12]!;
const PEAK = GREYS[0]!;

const GRATICULE = geoGraticule().step([15, 15])();
const SPHERE = { type: "Sphere" } as const;

/** The stipple tile's side in device pixels, and how many dots it holds: about a sixth of the paper is inked. */
const TILE = 160;
const TILE_DOTS = 4050;

/**
 * A tile of stipple dots from a fixed seed, one device pixel each, so every load draws the same grain and the dots stay
 * crisp at any screen density: land reads as a mid grey made of black dots on paper, as an e-ink page prints a grey.
 */
export function stippleDots(seed = 7, n = TILE_DOTS, side = TILE): [number, number][] {
  const rnd = seeded(seed);
  const out: [number, number][] = [];
  const taken = new Set<number>();
  while (out.length < n) {
    const x = Math.floor(rnd() * side);
    const y = Math.floor(rnd() * side);
    // No two dots in one pixel or touching side by side, so the grain stays even rather than clumping into blots.
    const k = y * side + x;
    if (taken.has(k) || taken.has(y * side + ((x + 1) % side)) || taken.has(y * side + ((x + side - 1) % side))) continue;
    taken.add(k);
    out.push([x, y]);
  }
  return out;
}

export class PaperCache {
  /** The last view drawn, to tell a moving picture from one that holds still. */
  key = "";
  /** The full drawing of the last still view, kept so redraws for markers cost one image. */
  full = "";
  canvas?: HTMLCanvasElement;
  g?: CanvasRenderingContext2D;
  tile?: { dpr: number; canvas: HTMLCanvasElement };
  maps = new WeakMap<object, number>();
  mapId = 0;
}

function mapKey(f: SurfaceFrame, c: PaperCache): number {
  let id = c.maps.get(f.map);
  if (id === undefined) c.maps.set(f.map, (id = ++c.mapId));
  return id;
}

/** The stipple as a pattern drawn at device resolution, so each dot is one crisp screen pixel. */
function stipple(g: CanvasRenderingContext2D, c: PaperCache, dpr: number): CanvasPattern | null {
  if (!c.tile || c.tile.dpr !== dpr) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TILE;
    const t = canvas.getContext("2d")!;
    t.fillStyle = STIPPLE;
    for (const [x, y] of stippleDots()) t.fillRect(x, y, 1, 1);
    c.tile = { dpr, canvas };
  }
  const p = g.createPattern(c.tile.canvas, "repeat");
  p?.setTransform(new DOMMatrix().scale(1 / dpr));
  return p;
}

/** The sea, the land's outline and the frame of the sheet or the sphere: what both drawings share. */
function base(g: CanvasRenderingContext2D, f: SurfaceFrame, full: boolean, c: PaperCache) {
  const path = geoPath(f.view as GeoProjection, g);
  const globe = f.mode === "3d";
  g.beginPath();
  path(SPHERE);
  g.fillStyle = SEA;
  g.fill();

  g.save();
  g.beginPath();
  path(SPHERE);
  g.clip();

  const land = new Path2D();
  geoPath(f.view as GeoProjection, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(f.view as GeoProjection, pathContext(coast))(f.map.coast);

  if (full) {
    // A faint dotted grid of longitude and latitude, like the ruling of a printed map.
    g.beginPath();
    path(GRATICULE);
    g.strokeStyle = GRID;
    g.lineWidth = 0.6;
    g.setLineDash([1, 3]);
    g.stroke();
    g.setLineDash([]);

    // Fine water lines along the coasts: wide grey strokes cut back to paper, the land laid over their inner half.
    g.lineJoin = "round";
    const gap = 3.4;
    for (let i = 4; i >= 1; i--) {
      g.lineWidth = i * gap * 2;
      g.strokeStyle = WATERLINE;
      g.stroke(coast);
      g.lineWidth = i * gap * 2 - 1;
      g.strokeStyle = SEA;
      g.stroke(coast);
    }
    g.fillStyle = LAND_UNDER;
    g.fill(land);
    const dots = stipple(g, c, f.dpr);
    if (dots) {
      g.fillStyle = dots;
      g.fill(land);
    }
  } else {
    // Moving: the same mid grey without its grain, so the full drawing lands on the same tone when the map stops.
    g.fillStyle = LAND_FLAT;
    g.fill(land);
  }

  if (f.map.ice) {
    g.beginPath();
    path(f.map.ice);
    g.fillStyle = ICE;
    g.fill();
  }

  if (full && f.relief) {
    // Mountains as small clusters of darker stipple, the same few dots at every peak.
    const s = Math.min(4, 1.4 + f.zoom * 0.5);
    g.fillStyle = PEAK;
    const visible = (lon: number, lat: number) => !globe || geoDistance([lon, lat], [f.lon, f.lat]) < Math.PI / 2 - 0.02;
    for (const [lon, lat] of f.relief.peaks) {
      if (!visible(lon, lat)) continue;
      const p = f.proj([lon, lat]);
      if (!p) continue;
      const [x, y] = f.tp(p[0], p[1], 0);
      if (x < -8 || y < -8 || x > f.w + 8 || y > f.h + 8) continue;
      const px = Math.round(x * f.dpr) / f.dpr;
      const py = Math.round(y * f.dpr) / f.dpr;
      const d = Math.max(1, Math.round(f.dpr)) / f.dpr;
      g.fillRect(px, py - s, d, d);
      g.fillRect(px - s * 0.8, py + s * 0.4, d, d);
      g.fillRect(px + s * 0.8, py + s * 0.5, d, d);
    }
  }

  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = SEA;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.5;
  g.stroke();

  if (full) {
    const maxRank = f.zoom < 1.8 ? 4 : f.zoom < 3.5 ? 5 : 9;
    g.beginPath();
    for (const r of f.map.rivers.features) if ((r.properties?.r ?? 9) <= maxRank) path(r);
    g.strokeStyle = RIVER;
    g.lineWidth = 0.6;
    g.stroke();
  }

  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.stroke(coast);

  g.restore();

  // The sheet's or the sphere's edge, crisp and black, with a second fine rule just outside it.
  g.beginPath();
  path(SPHERE);
  g.strokeStyle = INK;
  g.lineWidth = globe ? 1.4 : 1.2;
  g.stroke();
  if (globe) {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    g.beginPath();
    g.arc(cx, cy, R + 5, 0, Math.PI * 2);
    g.lineWidth = 0.6;
    g.stroke();
  }
}

/**
 * Draws the map like an e-ink screen: plainly while the view moves, asking for one more frame shortly after, and in
 * full once a frame repeats the last view. For readers who ask for reduced motion every frame is drawn in full, since
 * the view asks for no frames of its own for them.
 */
export function drawPaper(f: SurfaceFrame, c: PaperCache): number | void {
  const key = `${f.mode}|${f.lon}|${f.lat}|${f.zoom}|${f.w}|${f.h}|${f.dpr}|${mapKey(f, c)}`;
  const moving = key !== c.key;
  c.key = key;
  if (moving && !f.still) {
    f.ctx.save();
    base(f.ctx, f, false, c);
    f.ctx.restore();
    return SETTLE_MS;
  }
  if (c.full !== key || !c.canvas || !c.g) {
    if (!c.canvas || c.canvas.width !== Math.round(f.w * f.dpr) || c.canvas.height !== Math.round(f.h * f.dpr)) [c.canvas, c.g] = offscreen(f.w, f.h, f.dpr);
    const g = c.g!;
    g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    g.clearRect(0, 0, f.w, f.h);
    g.save();
    base(g, f, true, c);
    g.restore();
    c.full = key;
  }
  f.ctx.drawImage(c.canvas, 0, 0, f.w, f.h);
}
