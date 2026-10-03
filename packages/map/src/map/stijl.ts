// Primary (id stijl): after the feel of the De Stijl movement of the 1910s and 20s, a public art
// movement, and no copy of any one painting. The land is a composition of flat rectangles cut from a grid fixed to
// longitude and latitude, divided by thick black lines; the sea is plain and has no lines at all.
//
// The grid: candidate lines every `ROOT / 2^level` degrees of longitude and latitude, the level chosen from the zoom so
// a unit stays about the same size on screen. Parallels run the whole way across; every fourth candidate is always
// one and the rest are kept or left out by a fixed hash of where they are. Between two parallels the meridians come
// in short pieces, some left out by the same kind of hash, so the rectangles come in uneven widths and heights and
// lines end at others the way such a composition's do. Every eighth candidate meridian is never left out, so a
// rectangle is at most eight units wide and is the same rectangle wherever the view starts.
//
// Most cells are white or light grey; a fixed few are yellow or blue, picked by a hash of the cell's own position and
// level and nothing else (`cellFill`). Never by any data and never by any political unit; the colours mean nothing.
// No land is ever red (the neutrality rule every design keeps, so no patch reads as a claim or a warning); the red of
// the palette is in the page around the map, and on the map it is only the fresh reports' colour. A coloured cell is also painted only where it is wholly land with no lake, with room to spare
// (`solidLand`), and big enough on screen (`colourFits`), so colour is only ever a broad whole rectangle bounded by
// black lines, longer than the largest marker, never a small piece cut off by the coast or squeezed at the globe's
// limb that might read as one. Markers are round discs with a white edge, so none reads as a cell either.
//
// Globe view is the same cells on a ball under a thick black outline. Nothing moves.

import { geoDistance, geoEquirectangular, geoPath, type GeoProjection } from "d3-geo";
import type { Basemap } from "./basemap.ts";
import { pathContext, type SurfaceFrame } from "./surface.ts";

/** The palette: white, the three primaries, light grey and the black of the lines. Red is the page's, never land's. */
export const STIJL = {
  page: "#f7f5ef",
  land: "#fdfcf8",
  sea: "#e7e5dd",
  grey: "#d9d9d4",
  red: "#d62a1e",
  yellow: "#f4c400",
  blue: "#1d4fa0",
  black: "#111111",
} as const;

export type Fill = "white" | "grey" | "yellow" | "blue";
/** The colours a cell may take besides white and grey: never red. */
export const PRIMARIES: readonly Fill[] = ["yellow", "blue"];

/** The coarsest grid step in degrees; each level halves it, so 360 and 180 always divide evenly. */
export const ROOT = 45;
export const MAX_LEVEL = 16;
/** A coloured rectangle is painted only when it is at least this many pixels each way on screen... */
export const MIN_COLOUR_PX = 20;
/**
 * ...and this many along its longer side: more than the largest marker with its ring, which the view draws at most
 * 13 pixels in radius times 1.45 at the closest zoom, plus a 2.6-pixel gap and the ring's line, about 46 across.
 */
export const LONG_COLOUR_PX = 48;

/** Whether a coloured rectangle this big on screen may be painted. */
export const colourFits = (w: number, h: number) => Math.min(w, h) >= MIN_COLOUR_PX && Math.max(w, h) >= LONG_COLOUR_PX;

export const stepOf = (level: number) => ROOT / 2 ** level;

/** Candidate lines of longitude at a level (they wrap round, a multiple of 8), and of latitude from pole to pole. */
export const lonCount = (level: number) => Math.round(360 / stepOf(level));
export const latCount = (level: number) => Math.round(180 / stepOf(level));

/** A fixed hash of three integers to [0, 1): the same cell always gets the same number, on every load. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x61c88647) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Whether candidate line `i` on an axis (0 longitude, 1 latitude) is a line at a level. Every fourth always is, so the
 * composition has a frame to hang on; so are the poles.
 */
export function keepLine(axis: 0 | 1, level: number, i: number): boolean {
  const n = axis === 0 ? lonCount(level) : latCount(level);
  const k = axis === 0 ? wrap(i, n) : i;
  if (k % 4 === 0 || (axis === 1 && (k <= 0 || k >= n))) return true;
  return hash3(level * 2 + axis, k, 7) < 0.34;
}

/**
 * Whether the piece of meridian `i` between parallel `j` and the next is drawn. Every eighth meridian always is; of the
 * rest about two in five are left out, joining the two rectangles beside it into one.
 */
export function segmentDrawn(level: number, i: number, j: number): boolean {
  const k = wrap(i, lonCount(level));
  if (k % 8 === 0) return true;
  return hash3(level + 57, k, j) >= 0.4;
}

/**
 * The lines covering candidate indices `lo` to `hi` on an axis, widened out to whole eighths so every rectangle in
 * view is whole and starts where it always starts. Longitude indices run past the wrap (they are wrapped only to look
 * up a hash); latitude stays between the poles.
 */
export function linesIn(axis: 0 | 1, level: number, lo: number, hi: number): number[] {
  let a = Math.floor(Math.floor(lo) / 8) * 8;
  let b = Math.ceil(Math.ceil(hi) / 8) * 8;
  if (axis === 1) {
    a = Math.max(0, a);
    b = Math.min(latCount(level), b);
  }
  const out: number[] = [];
  for (let i = a; i <= b; i++) if (keepLine(axis, level, i)) out.push(i);
  return out;
}

/**
 * A cell's fill from its position alone: its level, the candidate indices of its west and south lines, and how many
 * units wide and tall it is. Only cells of two units or more can take yellow or blue, so colour always comes as a broad
 * block, and the bigger the cell the likelier (from about one in three to three in five), as such a composition sets its
 * colour in its larger fields. Some more are light grey. Nothing else goes in.
 */
export function cellFill(level: number, i: number, j: number, wide: number, tall: number): Fill {
  const n = lonCount(level);
  const h = hash3(level + 101, wrap(i, n), j);
  if (wide * tall >= 2 && h < Math.min(0.45, 0.1 * wide * tall)) return PRIMARIES[Math.floor(hash3(level + 211, wrap(i, n), j) * PRIMARIES.length)]!;
  if (h > 0.86) return "grey";
  return "white";
}

/** The level whose unit is nearest `target` pixels, at `ppd` pixels per degree. */
export function levelFor(ppd: number, target: number): number {
  const l = Math.round(Math.log2((ROOT * ppd) / target));
  return Math.max(0, Math.min(MAX_LEVEL, l));
}

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Whether a cell, grown by a margin, is land at every sample (as `land` says) and lake at no more than a few: a
 * coloured cell is then a whole rectangle on land, its outline never cut by the coast into a shape of its own. A lake
 * only makes a hole inside it, with the rectangle's black edges still round it, so up to `LAKE_ALLOWED` of the samples
 * may be lake; without that, the broad fields at the whole world's zoom, which nearly all hold some lake, stay white.
 * The margin is half the land raster's own cell, so a sample sits in every raster cell the rectangle touches.
 */
export const LAKE_ALLOWED = 0.15;
export function solidLand(
  land: (lon: number, lat: number) => boolean,
  lake: (lon: number, lat: number) => boolean,
  lon0: number,
  lon1: number,
  lat0: number,
  lat1: number,
): boolean {
  const m = 0.25;
  const a0 = lon0 - m, a1 = lon1 + m;
  const b0 = Math.max(-90, lat0 - m), b1 = Math.min(90, lat1 + m);
  const nx = Math.min(32, Math.max(4, Math.ceil((a1 - a0) / 0.5)));
  const ny = Math.min(32, Math.max(4, Math.ceil((b1 - b0) / 0.5)));
  const allowed = Math.floor((nx + 1) * (ny + 1) * LAKE_ALLOWED);
  let wet = 0;
  for (let y = 0; y <= ny; y++) {
    const lat = b0 + ((b1 - b0) * y) / ny;
    for (let x = 0; x <= nx; x++) {
      const lon = wrapLon(a0 + ((a1 - a0) * x) / nx);
      if (!land(lon, lat)) return false;
      if (lake(lon, lat) && ++wet > allowed) return false;
    }
  }
  return true;
}

/** A box of longitude and latitude as a ring d3 reads as the small area inside it, its edges laid along the parallels. */
export function cellRing(lon0: number, lon1: number, lat0: number, lat1: number): [number, number][] {
  const n = Math.max(1, Math.ceil((lon1 - lon0) / 2));
  const m = Math.max(1, Math.ceil((lat1 - lat0) / 2));
  const ring: [number, number][] = [];
  for (let k = 0; k <= m; k++) ring.push([lon0, lat0 + ((lat1 - lat0) * k) / m]);
  for (let k = 1; k <= n; k++) ring.push([lon0 + ((lon1 - lon0) * k) / n, lat1]);
  for (let k = m - 1; k >= 0; k--) ring.push([lon1, lat0 + ((lat1 - lat0) * k) / m]);
  for (let k = n - 1; k >= 0; k--) ring.push([lon0 + ((lon1 - lon0) * k) / n, lat0]);
  return ring;
}

/** The part of the world in view, in degrees round the centre: half-widths in longitude and latitude. */
export function viewSpan(w: number, h: number, mode: "2d" | "3d", scale: number, lat: number): { lon: number; lat: number } {
  const ppd = (scale * Math.PI) / 180;
  if (mode === "2d") return { lon: Math.min(180, w / 2 / ppd + 1), lat: h / 2 / ppd + 1 };
  // The globe: the cap round the centre that reaches the frame's furthest corner, or the whole near side.
  const d = Math.hypot(w / 2, h / 2);
  const a = d >= scale ? 90 : (Math.asin(d / scale) * 180) / Math.PI;
  const cap = Math.min(90, a + 2);
  if (Math.abs(lat) + cap >= 89) return { lon: 180, lat: cap };
  const s = Math.sin((cap * Math.PI) / 180) / Math.cos((lat * Math.PI) / 180);
  return { lon: s >= 1 ? 180 : (Math.asin(s) * 180) / Math.PI + 2, lat: cap };
}

export interface StijlCell {
  /** The candidate indices of its west line and south line, and its size in units. */
  i: number;
  j: number;
  wide: number;
  tall: number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  fill: Fill;
}

export interface StijlGrid {
  level: number;
  step: number;
  /** The parallels, as candidate indices. */
  ys: number[];
  /** Every rectangle in view, white ones included, row by row. */
  cells: StijlCell[];
  /** The drawn pieces of meridian: longitude, and the latitudes it runs between. */
  segments: [number, number, number][];
  lonRange: [number, number];
}

/**
 * Every rectangle in view at a level round a centre, with the fill its position gives it. Nothing here knows about
 * the news: the same level and position always give the same rectangles and fills.
 */
export function gridInView(level: number, lon: number, lat: number, span: { lon: number; lat: number }): StijlGrid {
  const step = stepOf(level);
  const lonLo = (lon - span.lon + 180) / step;
  const lonHi = Math.min(lonLo + lonCount(level), (lon + span.lon + 180) / step);
  const latLo = (Math.max(-90, lat - span.lat) + 90) / step;
  const latHi = (Math.min(90, lat + span.lat) + 90) / step;
  const xs = linesIn(0, level, lonLo, lonHi);
  const ys = linesIn(1, level, latLo, latHi);
  const cells: StijlCell[] = [];
  const segments: [number, number, number][] = [];
  for (let b = 0; b + 1 < ys.length; b++) {
    const j = ys[b]!, j1 = ys[b + 1]!;
    const lat0 = -90 + j * step, lat1 = -90 + j1 * step;
    let start = xs[0]!;
    for (let a = 1; a < xs.length; a++) {
      const i = xs[a]!;
      if (a < xs.length - 1 && !segmentDrawn(level, i, j)) continue;
      segments.push([-180 + i * step, lat0, lat1]);
      const fill = cellFill(level, start, j, i - start, j1 - j);
      cells.push({ i: start, j, wide: i - start, tall: j1 - j, lon0: -180 + start * step, lon1: -180 + i * step, lat0, lat1, fill });
      start = i;
    }
    segments.push([-180 + xs[0]! * step, lat0, lat1]);
  }
  return { level, step, ys, cells, segments, lonRange: [-180 + xs[0]! * step, -180 + xs[xs.length - 1]! * step] };
}

/** The black lines' width on screen: thick, and a little thinner on a phone. */
export const lineWidth = (w: number, h: number) => Math.max(2.2, Math.min(3.6, Math.min(w, h) / 230));

/** Whether each half-degree cell holds a lake, read back from a small drawing of the lakes, kept per basemap. */
const LAKES = new WeakMap<object, (lon: number, lat: number) => boolean>();
function lakeRaster(map: Basemap): (lon: number, lat: number) => boolean {
  let r = LAKES.get(map);
  if (r) return r;
  const W = 720, H = 360;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.beginPath();
  geoPath(geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2), g)(map.lakes);
  // Drawn a little thick, so a lake's shore counts as lake too.
  g.lineWidth = 1.5;
  g.fillStyle = g.strokeStyle = "#fff";
  g.fill();
  g.stroke();
  const px = g.getImageData(0, 0, W, H).data;
  r = (lon, lat) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    return px[(y * W + x) * 4 + 3]! > 0;
  };
  LAKES.set(map, r);
  return r;
}

/** How wide and tall a cell is on screen, through its edges' midpoints; zero where any of them faces away. */
function screenSize(proj: GeoProjection, c: StijlCell, centre: [number, number] | null): [number, number] {
  const mx = (c.lon0 + c.lon1) / 2, my = (c.lat0 + c.lat1) / 2;
  const pts: [number, number][] = [[c.lon0, my], [c.lon1, my], [mx, c.lat0], [mx, c.lat1]];
  if (centre && pts.some((p) => geoDistance(p, centre) > (80 * Math.PI) / 180)) return [0, 0];
  const [w0, e0, s0, n0] = pts.map((p) => proj(p));
  if (!w0 || !e0 || !s0 || !n0) return [0, 0];
  return [Math.hypot(e0[0] - w0[0], e0[1] - w0[1]), Math.hypot(n0[0] - s0[0], n0[1] - s0[1])];
}

export function drawStijl(f: SurfaceFrame) {
  const { ctx, w, h, proj, mode } = f;
  const globe = mode === "3d";
  ctx.fillStyle = STIJL.page;
  ctx.fillRect(0, 0, w, h);

  const p = (o: object) => {
    const out = new Path2D();
    geoPath(proj, pathContext(out))(o as never);
    return out;
  };
  const sphere = p({ type: "Sphere" });
  const land = p(f.map.land);
  const lakes = p(f.map.lakes);
  const coast = p(f.map.coast);

  // The sea: plain, with no lines.
  ctx.fillStyle = STIJL.sea;
  ctx.fill(sphere);
  ctx.fillStyle = STIJL.land;
  ctx.fill(land);

  const lw = lineWidth(w, h);
  const ppd = (proj.scale() * Math.PI) / 180;
  // A unit of the grid stays about 26 to 40 pixels on screen whatever the zoom. Zoomed out to the whole map, the
  // coarsest grids' rectangles almost all reach the coast, so none could take colour: there the grid goes one level
  // finer while its unit stays at least 15 pixels.
  let level = levelFor(ppd, Math.max(26, Math.min(40, Math.min(w, h) / 18)));
  if (level < 3 && stepOf(level + 1) * ppd >= 15) level++;
  const grid = gridInView(level, f.lon, f.lat, viewSpan(w, h, mode, proj.scale(), f.lat));
  // Lakes from both basemaps: the detailed one, drawn once zoomed in, has small lakes the light one lacks.
  const wet = [lakeRaster(f.low), lakeRaster(f.map)];
  const lake = (lon: number, lat: number) => wet.some((l) => l(lon, lat));
  const centre: [number, number] | null = globe ? [f.lon, f.lat] : null;

  ctx.save();
  ctx.clip(land);
  for (const fill of ["grey", "yellow", "blue"] as const) {
    const rings: [number, number][][][] = [];
    for (const c of grid.cells) {
      if (c.fill !== fill) continue;
      if (fill !== "grey") {
        const [sw, sh] = screenSize(proj, c, centre);
        if (!colourFits(sw, sh) || !solidLand(f.isLand, lake, c.lon0, c.lon1, c.lat0, c.lat1)) continue;
      }
      rings.push([cellRing(c.lon0, c.lon1, c.lat0, c.lat1)]);
    }
    if (!rings.length) continue;
    ctx.fillStyle = STIJL[fill];
    ctx.fill(p({ type: "MultiPolygon", coordinates: rings }));
  }
  // The black lines, over the land only: whole parallels, and the meridians in their pieces between them, each laid
  // in short steps so the parallels curve on the globe.
  const lines: [number, number][][] = [];
  const [lonA, lonB] = grid.lonRange;
  const seg = Math.min(2, grid.step);
  for (const j of grid.ys) {
    const lat = -90 + j * grid.step;
    if (Math.abs(lat) >= 90) continue;
    const n = Math.max(1, Math.ceil((lonB - lonA) / seg));
    const line: [number, number][] = [];
    for (let k = 0; k <= n; k++) line.push([lonA + ((lonB - lonA) * k) / n, lat]);
    lines.push(line);
  }
  for (const [lon, lat0, lat1] of grid.segments) {
    const n = Math.max(1, Math.ceil((lat1 - lat0) / 10));
    const line: [number, number][] = [];
    for (let k = 0; k <= n; k++) line.push([lon, lat0 + ((lat1 - lat0) * k) / n]);
    lines.push(line);
  }
  ctx.strokeStyle = STIJL.black;
  ctx.lineWidth = lw;
  ctx.lineCap = "square";
  ctx.stroke(p({ type: "MultiLineString", coordinates: lines }));
  ctx.restore();

  // Lakes are sea, and the coast a firm black line as heavy as the grid.
  ctx.fillStyle = STIJL.sea;
  ctx.fill(lakes);
  ctx.strokeStyle = STIJL.black;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lw;
  ctx.stroke(coast);
  ctx.lineWidth = lw * 0.7;
  ctx.stroke(lakes);

  // The world's edge: a thick black outline round the ball, a frame round the flat sheet.
  ctx.lineWidth = globe ? lw * 1.6 : lw;
  ctx.stroke(sphere);
}
