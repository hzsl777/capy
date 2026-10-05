// Burger Joint (id burger, experimental): the world as the top of a burger of our own, on a diner tray. Nothing here
// is any restaurant's, chain's or maker's: no name, mark, lettering, packaging or colour set.
//
// The sea is the toasted bun, brown gold with a glaze; the land is lettuce, a bright leaf with pale lobes along every
// coast and veins in the leaf, each vein at a fixed point of a jittered grid of longitude and latitude (so the texture
// is tied to the world and cut only by the coast), darker over the relief layer's mountains. Ice is a smear of pale
// sauce. Nothing here knows of any country: only the land, the ice and the relief layer set what is drawn.
//
// What lies round the world is the rest of the stack, outward from the bun as the burger goes down: a frill of lettuce
// with round lobes, overlapping tomato slices, melted cheese with its corners and a few drips, the patty and the
// bottom bun's rim (`REACH`). Globe view is the burger from above, the globe being the bun's top and the layers
// showing round it; Map view is the same stack cut square, its layers showing round the map, on a steel tray lined
// with checked paper, with a squeeze bottle of each sauce lying on the liner where there is room. Everything outside
// the map is a decoration at a fixed place that carries no data, laid out clear of the globe, the map, the Key, the
// zoom buttons and the frame's edge (`placeBottles`, `mapBottles`, test/burger.test.ts). Places outside the map's
// window are neither drawn nor tuned. Markers are sesame seeds (marks.ts); this file adds each seed's soft shadow
// under it. Nothing moves, and there is no text on the canvas.

import { geoPath } from "d3-geo";
import { StillLayer } from "./ambient.ts";
import { clamp, landPaths, once, pxPerDeg, RAD, speckle, wideCoast } from "./handmade.ts";
import { hash2, pathContext, seeded, type SurfaceFrame, type SurfaceResult, type SurfaceSpot } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;
const TAU = Math.PI * 2;

/** The toasted bun (the sea), the lettuce (the land) and the sauce on the ice. */
export const CRUST = "#c27e2c";
export const LETTUCE = "#88cb48";
export const SAUCE = "#f7f1dc";

// ---- The veins in the lettuce -------------------------------------------------------------------------------------

/** Grid steps in degrees, each dividing 180, so a vein stays at the same place on the world at a given step. */
const STEPS = [0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 9, 10, 12, 15, 18] as const;

/** The grid step that makes a leaf about `px` pixels across on screen at `pxDeg` pixels per degree. */
export function veinStep(pxDeg: number, px = 46): number {
  const want = px / Math.max(1e-6, pxDeg);
  for (const s of STEPS) if (s >= want) return s;
  return STEPS[STEPS.length - 1]!;
}

/** One leaf's vein: where its stem starts (lon, lat), which way it runs (radians), how much it bends, and its size. */
export interface Vein {
  lon: number;
  lat: number;
  turn: number;
  bend: number;
  size: number;
}

/** The vein of grid cell (i, j) at a step: always the same for the same cell, so the leaf is tied to the world. */
export function veinAt(step: number, i: number, j: number): Vein {
  const a = hash2(i * 7 + 3, j * 13 + 1);
  const b = hash2(i * 11 + 5, j * 3 + 7);
  const c = hash2(i * 5 + 9, j * 17 + 2);
  const d = hash2(i * 19 + 1, j * 7 + 11);
  const e = hash2(i * 23 + 41, j * 29 + 3);
  return {
    lon: (i + 0.5 + (a - 0.5) * 0.7) * step - 180,
    lat: (j + 0.5 + (b - 0.5) * 0.7) * step - 90,
    turn: c * TAU,
    bend: (e - 0.5) * 1.2,
    size: 0.75 + d * 0.5,
  };
}

/** The span of latitude and longitude (from the view's centre) the frame can show, a step wider all round. */
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
 * The leaf veins: a stem with side veins, one for every grid cell in view that lies on or beside land, pale on top
 * and a shade darker just below. Clipped to the land by the caller, so the coast cuts them.
 */
function veins(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const pxDeg = pxPerDeg(f.proj);
  const screenK = clamp(Math.min(f.w, f.h) / 720, 0.75, 1);
  const step = veinStep(pxDeg, 46 * screenK);
  const box = visibleBox(f, step);
  const globe = f.mode === "3d";
  const [cx, cy] = f.proj.translate();
  const R = f.proj.scale();
  const lit = new Path2D(), shade = new Path2D();
  const j0 = Math.floor((box.lat0 + 90) / step), j1 = Math.ceil((box.lat1 + 90) / step);
  const cols = Math.round(360 / step);
  const iMid = Math.floor((f.lon + 180) / step);
  const span = Math.min(cols, (Math.ceil(box.dl / step) + 1) * 2 + 1);
  const near = step * 0.5;
  for (let j = j0; j <= j1; j++) {
    for (let k = 0; k < span; k++) {
      const i = (((iMid - Math.floor(span / 2) + k) % cols) + cols) % cols;
      const v = veinAt(step, i, j);
      if (v.lat < -90 || v.lat > 90) continue;
      // About a third of the cells draw none, so the leaves never crowd into a mat.
      if (hash2(i * 3 + 1, j * 5 + 2) < 0.35) continue;
      if (!f.isLand(v.lon, v.lat) && !f.isLand(v.lon + near, v.lat) && !f.isLand(v.lon - near, v.lat) && !f.isLand(v.lon, v.lat + near) && !f.isLand(v.lon, v.lat - near)) continue;
      let fore = 1;
      if (globe) {
        const a = v.lat * RAD, b = f.lat * RAD;
        const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((v.lon - f.lon) * RAD);
        if (cosc < 0.02) continue;
        // Toward the rim the dome turns away, so its leaves draw smaller.
        fore = Math.max(0.35, Math.sqrt(cosc));
      }
      const q = f.proj([v.lon, v.lat]);
      if (!q) continue;
      const len = step * pxDeg * 1.05 * v.size * fore;
      if (q[0] < -len * 2 || q[1] < -len * 2 || q[0] > f.w + len * 2 || q[1] > f.h + len * 2) continue;
      if (globe && Math.hypot(q[0] - cx, q[1] - cy) > R + len) continue;
      const dx = Math.cos(v.turn), dy = Math.sin(v.turn);
      const px = -dy, py = dx;
      const ox = Math.max(0.6, len * 0.03), oy = Math.max(0.8, len * 0.04);
      for (const [path, sx, sy] of [[shade, ox, oy], [lit, 0, 0]] as const) {
        const x0 = q[0] + sx, y0 = q[1] + sy;
        const ex = x0 + dx * len, ey = y0 + dy * len;
        path.moveTo(x0, y0);
        path.quadraticCurveTo(x0 + dx * len * 0.5 + px * v.bend * len * 0.3, y0 + dy * len * 0.5 + py * v.bend * len * 0.3, ex, ey);
        // Two pairs of side veins, leaning forward off the stem and shorter toward its tip.
        for (const [at, share] of [[0.34, 0.42], [0.66, 0.32]] as const) {
          const bx = x0 + dx * len * at + px * v.bend * len * 0.3 * 4 * at * (1 - at), by = y0 + dy * len * at + py * v.bend * len * 0.3 * 4 * at * (1 - at);
          for (const side of [-1, 1]) {
            const a = v.turn + side * 0.78;
            path.moveTo(bx, by);
            path.lineTo(bx + Math.cos(a) * len * share, by + Math.sin(a) * len * share);
          }
        }
      }
    }
  }
  const w = clamp(pxDeg * step * 0.05, 0.9, 2.2);
  g.lineCap = "round";
  g.lineWidth = w * 1.5;
  g.strokeStyle = "rgba(40,96,22,0.24)";
  g.stroke(shade);
  g.lineWidth = w;
  g.strokeStyle = "rgba(230,250,170,0.46)";
  g.stroke(lit);
}

// ---- Textures: the toasted crust ----------------------------------------------------------------------------------

const CRUST_TILE = 160;
const crusts = new WeakMap<CanvasRenderingContext2D, { dpr: number; p: CanvasPattern }>();

/**
 * The bun's crust as a tile repeated without a seam: soft patches where it toasted darker or stayed golden and small
 * pale and dark crumbs, all far smaller and fainter than any marker.
 */
function crust(g: CanvasRenderingContext2D, dpr: number): CanvasPattern {
  const hit = crusts.get(g);
  if (hit && hit.dpr === dpr) return hit.p;
  const T = CRUST_TILE;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(T * dpr);
  const t = c.getContext("2d")!;
  t.scale(dpr, dpr);
  const rnd = seeded(53);
  const wrap = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) if (x + ox > -r && x + ox < T + r && y + oy > -r && y + oy < T + r) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * T, y = rnd() * T, r = 8 + rnd() * 22;
    const dark = rnd() < 0.55;
    const a = 0.07 + rnd() * 0.1;
    wrap(x, y, r, (px, py) => {
      const gr = t.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, dark ? `rgba(110,52,12,${a * 0.8})` : `rgba(255,208,120,${a * 1.2})`);
      gr.addColorStop(1, dark ? "rgba(86,40,10,0)" : "rgba(246,196,108,0)");
      t.fillStyle = gr;
      t.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 190; i++) {
    const x = rnd() * T, y = rnd() * T, rx = 0.5 + rnd() * 1.5, ry = rx * (0.5 + rnd() * 0.4), turn = rnd() * Math.PI;
    const pale = rnd() < 0.5;
    wrap(x, y, 4, (px, py) => {
      t.beginPath();
      t.ellipse(px, py, rx, ry, turn, 0, TAU);
      t.fillStyle = pale ? "rgba(255,218,150,0.3)" : "rgba(70,32,8,0.3)";
      t.fill();
    });
  }
  const p = g.createPattern(c, "repeat")!;
  crusts.set(g, { dpr, p });
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

// ---- The world: crust, lettuce and sauce --------------------------------------------------------------------------

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

/** The sea, the land and the glaze, inside `clip` (the map's window or the globe). */
function paintWorld(f: SurfaceFrame, cache: BurgerCache, g: CanvasRenderingContext2D, clip: Path2D) {
  const { w, h, dpr } = f;
  const k = clamp(0.85 + f.zoom * 0.15, 1, 1.8) * clamp(Math.min(w, h) / 720, 0.7, 1);
  g.save();
  g.clip(clip);
  g.fillStyle = CRUST;
  g.fillRect(0, 0, w, h);
  g.fillStyle = anchor(crust(g, dpr), f, 1 / dpr);
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
    peaks.arc(q[0], q[1], pr, 0, TAU);
  }
  // The leaf's shadow on the bun: the coast again, a little down and to the right, soft and cheap.
  g.save();
  g.translate(1.6, 2.6);
  g.lineJoin = "round";
  g.lineWidth = 3.4;
  g.strokeStyle = "rgba(60,26,6,0.4)";
  g.stroke(coast);
  g.restore();
  g.fillStyle = LETTUCE;
  g.fill(land);
  g.save();
  g.clip(land);
  // Pale along every coast, where a lettuce leaf's lobes are thin, and darker over the mountains, where its rib is thick.
  g.drawImage(
    low(cache.edge, w, h, (s) => {
      s.strokeStyle = "rgba(226,248,160,0.2)";
      for (const d of [46, 32, 20, 10]) {
        s.lineWidth = d * k;
        s.stroke(soft);
      }
      s.fillStyle = "rgba(34,92,24,0.22)";
      s.fill(peaks);
    }),
    0,
    0,
    w,
    h,
  );
  veins(f, g);
  if (ice) {
    g.fillStyle = "rgba(247,241,220,0.88)";
    g.fill(ice);
  }
  g.restore();
  // No rivers: a thin line running inland across the leaf reads too much like a border.
  const path = geoPath(f.proj, g);
  g.beginPath();
  path(f.map.lakes);
  g.fillStyle = CRUST;
  g.fill();
  g.fillStyle = anchor(crust(g, dpr), f, 1 / dpr);
  g.fill();
  g.lineWidth = 0.7;
  g.strokeStyle = "rgba(40,86,20,0.75)";
  g.stroke();
  g.lineWidth = f.theme.coastWidth;
  g.strokeStyle = "rgba(38,84,18,0.9)";
  g.stroke(coast);
  g.restore();
}

// ---- Rings round the world: the stack's layers --------------------------------------------------------------------

/** The layers from the world outward: the bun's top is the world itself, then each layer below it. */
export const LAYERS = ["lettuce", "tomato", "cheese", "patty", "bun"] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * How far each layer reaches beyond the world's edge, least and greatest, as shares of the unit (the globe's radius,
 * or in Map view 128 pixels at full size). A layer's least reach is a little past the one inside it's greatest, so
 * every layer shows all the way round.
 */
export const REACH: readonly (readonly [Layer, number, number])[] = [
  ["lettuce", 0.04, 0.12],
  ["tomato", 0.14, 0.2],
  ["cheese", 0.21, 0.29],
  ["patty", 0.265, 0.31],
  ["bun", 0.325, 0.35],
];
/** The whole stack's reach beyond the world's edge, as a share of the unit. */
export const STACK_REACH = REACH[REACH.length - 1]![2];

export interface RingPt {
  x: number;
  y: number;
  /** The outward unit normal. */
  nx: number;
  ny: number;
  /** How far round the ring this point lies, from 0 to under 1. */
  u: number;
}

export interface Ring {
  pts: RingPt[];
  /** The ring's length in pixels. */
  length: number;
  /** Where the ring's four corners lie, as `u`: the cheese slice's corners point there. */
  corners: number[];
  kind: "circle" | "box";
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A circle of radius R as a ring, starting at the top and running clockwise; its corners turn by `turn` radians. */
export function circleRing(cx: number, cy: number, R: number, turn = 0): Ring {
  const n = clamp(Math.ceil((TAU * R) / 4), 96, 1200);
  const pts: RingPt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, nx: Math.cos(a), ny: Math.sin(a), u: i / n });
  }
  const corners = [0, 1, 2, 3].map((k) => (((Math.PI / 4 + (k * Math.PI) / 2 + turn) / TAU) % 1 + 1) % 1);
  return { pts, length: TAU * R, corners, kind: "circle" };
}

/** A rounded rectangle as a ring, starting where its top edge meets the top left corner's curve and running clockwise. */
export function boxRing(b: Box, radius: number): Ring {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const r = Math.max(0.5, Math.min(radius, w / 2, h / 2));
  const step = 4;
  const raw: { x: number; y: number; nx: number; ny: number }[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i < n; i++) raw.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, nx, ny });
  };
  const arcMid: number[] = [];
  const arc = (cx: number, cy: number, a0: number) => {
    const n = Math.max(3, Math.ceil((Math.PI * r) / 2 / step));
    arcMid.push(raw.length + Math.floor(n / 2));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      raw.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
    }
  };
  line(b.x0 + r, b.y0, b.x1 - r, b.y0, 0, -1);
  arc(b.x1 - r, b.y0 + r, -Math.PI / 2);
  line(b.x1, b.y0 + r, b.x1, b.y1 - r, 1, 0);
  arc(b.x1 - r, b.y1 - r, 0);
  line(b.x1 - r, b.y1, b.x0 + r, b.y1, 0, 1);
  arc(b.x0 + r, b.y1 - r, Math.PI / 2);
  line(b.x0, b.y1 - r, b.x0, b.y0 + r, -1, 0);
  arc(b.x0 + r, b.y0 + r, Math.PI);
  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
  const last = raw[raw.length - 1]!, first = raw[0]!;
  const length = cum[cum.length - 1]! + Math.hypot(first.x - last.x, first.y - last.y);
  return { pts: raw.map((p, i) => ({ ...p, u: cum[i]! / length })), length, corners: arcMid.map((i) => cum[i]! / length), kind: "box" };
}

/** The point of a ring at `u` (wrapping), interpolated between its samples. */
export function ringAt(ring: Ring, u: number): RingPt {
  const pts = ring.pts;
  const v = ((u % 1) + 1) % 1;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid]!.u <= v) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo]!, b = pts[(lo + 1) % pts.length]!;
  const ub = lo + 1 < pts.length ? b.u : 1;
  const t = ub > a.u ? (v - a.u) / (ub - a.u) : 0;
  const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
  const m = Math.hypot(nx, ny) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / m, ny: ny / m, u: v };
}

/** A closed outline `edge(p)` pixels outside a ring at every point of it. */
function blob(ring: Ring, edge: (p: RingPt) => number): Path2D {
  const path = new Path2D();
  ring.pts.forEach((p, i) => {
    const d = edge(p);
    const x = p.x + p.nx * d, y = p.y + p.ny * d;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

/** How many lobes the lettuce and how many slices of tomato run round a ring: fixed on a circle, by length on a box. */
export function lobesOf(ring: Ring, unit: number): { lettuce: number; tomato: number } {
  if (ring.kind === "circle") return { lettuce: 15, tomato: 20 };
  return { lettuce: Math.max(8, Math.round(ring.length / (0.26 * unit))), tomato: Math.max(8, Math.round(ring.length / (0.24 * unit))) };
}

/** The lettuce's edge at `u`, from 0 (a valley) to 1 (the top of a lobe): round lobes with sharp valleys between. */
export function lettuceWave(u: number, n: number): number {
  const lobe = Math.pow(Math.abs(Math.sin(Math.PI * n * u + 0.7)), 0.75);
  const swell = 0.5 + 0.5 * Math.sin(TAU * Math.max(2, Math.round(n / 4)) * u + 1.3);
  return clamp(0.72 * lobe + 0.28 * swell, 0, 1);
}

/** How near `u` is to the nearest of the ring's corners, from 1 on one to 0 well away from all of them. */
export function cornerness(ring: Ring, u: number): number {
  const sigma = ring.kind === "circle" ? 0.035 : 0.025;
  let best = 0;
  for (const c of ring.corners) {
    const d = Math.min(Math.abs(u - c), 1 - Math.abs(u - c));
    best = Math.max(best, Math.exp(-((d / sigma) ** 2)));
  }
  return best;
}

const mix = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;

/** Where the cheese's drips hang: three points near the bottom of a ring, always the same. */
export function dripsOf(ring: Ring): number[] {
  const low = ring.pts.filter((p) => p.ny > 0.82);
  if (low.length < 12) return [];
  const out: number[] = [];
  for (const [at, jig] of [[0.2, 0.05], [0.52, 0.04], [0.82, 0.05]] as const) {
    const i = clamp(Math.round(low.length * (at + (hash2(at * 31, 7) - 0.5) * jig)), 0, low.length - 1);
    out.push(low[i]!.u);
  }
  return out;
}

/** A soft shadow under a layer, so each lies on the one below it. */
function lift(g: CanvasRenderingContext2D, path: Path2D, fill: string | CanvasGradient, k: number, strength = 0.42) {
  g.save();
  g.shadowColor = `rgba(34,16,4,${strength})`;
  g.shadowBlur = 7 * k;
  g.shadowOffsetX = 0.6 * k;
  g.shadowOffsetY = 2.4 * k;
  g.fillStyle = fill;
  g.fill(path);
  g.restore();
}

/** Strokes `path` inside itself in a series of widths and colours, so the colour grades inward from the edge. */
function grade(g: CanvasRenderingContext2D, path: Path2D, bands: readonly (readonly [number, string])[]) {
  g.save();
  g.clip(path);
  g.lineJoin = "round";
  for (const [wd, c] of bands) {
    g.lineWidth = wd * 2;
    g.strokeStyle = c;
    g.stroke(path);
  }
  g.restore();
}

function paintBun(g: CanvasRenderingContext2D, ring: Ring, unit: number, k: number) {
  const reach = (t: number) => unit * mix(REACH[4]![1], REACH[4]![2], t);
  const path = blob(ring, (p) => reach(0.5 + 0.5 * Math.sin(TAU * 3 * p.u + 0.4)));
  lift(g, path, "#cf9440", k, 0.5);
  grade(g, path, [
    [14 * k, "#d99d46"],
    [7 * k, "#e8b765"],
    [2.6 * k, "#f6d495"],
  ]);
  g.lineWidth = Math.max(1, 1.3 * k);
  g.strokeStyle = "rgba(112,58,14,0.75)";
  g.stroke(path);
}

function paintPatty(g: CanvasRenderingContext2D, ring: Ring, unit: number, k: number, dpr: number) {
  const reach = (t: number) => unit * mix(REACH[3]![1], REACH[3]![2], t);
  const path = blob(ring, (p) => reach(0.5 + 0.5 * (0.6 * Math.sin(TAU * 5 * p.u + 1.1) + 0.4 * Math.sin(TAU * 13 * p.u + 2.3))));
  lift(g, path, "#4a2a1a", k, 0.5);
  g.save();
  g.clip(path);
  for (const [ink, count, size, seed] of [
    ["rgb(18,7,3)", 300, [0.7, 2.1], 133],
    ["rgb(158,104,68)", 150, [0.6, 1.6], 137],
    ["rgb(96,56,36)", 220, [0.8, 2.4], 139],
  ] as const) {
    g.fillStyle = speckle(g, dpr, ink, count, [size[0], size[1]], seed, 96);
    g.fill(path);
  }
  g.restore();
  grade(g, path, [
    [9 * k, "rgba(255,196,150,0.12)"],
    [3 * k, "rgba(255,206,160,0.22)"],
  ]);
  g.lineWidth = Math.max(1, 1.2 * k);
  g.strokeStyle = "rgba(24,10,4,0.8)";
  g.stroke(path);
}

function paintCheese(g: CanvasRenderingContext2D, ring: Ring, unit: number, k: number) {
  const [, lo, hi] = REACH[2]!;
  const reach = (p: RingPt) => unit * mix(lo, hi, 0.22 + 0.78 * cornerness(ring, p.u) + 0.06 * Math.sin(TAU * 7 * p.u));
  const slice = blob(ring, (p) => Math.min(unit * hi, reach(p)));
  // The drips first, so the slice's edge overlaps their tops: a thick rounded tongue running down off the edge.
  const drips = new Path2D();
  const dripPts = dripsOf(ring);
  dripPts.forEach((u, i) => {
    const p = ringAt(ring, u);
    const from = unit * lo * 0.9;
    const len = unit * (0.075 + 0.03 * hash2(i * 11 + 3, 5));
    drips.moveTo(p.x + p.nx * from, p.y + p.ny * from);
    drips.lineTo(p.x + p.nx * (from + len), p.y + p.ny * (from + len));
  });
  g.save();
  g.lineCap = "round";
  g.lineWidth = unit * 0.05 + 2 * k;
  g.strokeStyle = "rgba(150,92,10,0.85)";
  g.stroke(drips);
  g.lineWidth = unit * 0.05;
  g.strokeStyle = "#f3b73c";
  g.stroke(drips);
  g.restore();
  lift(g, slice, "#f1b23a", k, 0.4);
  grade(g, slice, [
    [10 * k, "#f3b83f"],
    [5 * k, "#f8c95c"],
    [2 * k, "#fde39a"],
  ]);
  g.lineWidth = Math.max(0.9, 1.1 * k);
  g.strokeStyle = "rgba(160,98,8,0.7)";
  g.stroke(slice);
}

function paintTomato(g: CanvasRenderingContext2D, ring: Ring, unit: number, k: number, n: number) {
  const [, lo, hi] = REACH[1]!;
  const rs = unit * 0.125;
  const rnd = seeded(71);
  const slices: { x: number; y: number; r: number; turn: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = ringAt(ring, (i + 0.5 * rnd()) / n);
    const out = unit * mix(lo, hi, 0.55 + 0.45 * rnd());
    const r = rs * (0.92 + 0.2 * rnd());
    slices.push({ x: p.x + p.nx * (out - r), y: p.y + p.ny * (out - r), r, turn: rnd() * TAU });
  }
  for (const s of slices) {
    const disc = new Path2D();
    disc.arc(s.x, s.y, s.r, 0, TAU);
    lift(g, disc, "#a5301d", k, 0.4);
    g.save();
    g.clip(disc);
    const flesh = g.createRadialGradient(s.x - s.r * 0.25, s.y - s.r * 0.3, s.r * 0.1, s.x, s.y, s.r);
    flesh.addColorStop(0, "#ee6a48");
    flesh.addColorStop(0.7, "#df4c30");
    flesh.addColorStop(1, "#b83a22");
    g.fillStyle = flesh;
    g.beginPath();
    g.arc(s.x, s.y, s.r * 0.88, 0, TAU);
    g.fill();
    // Pale seed gel in the slice's chambers, three small ovals round its middle.
    g.fillStyle = "rgba(255,214,128,0.62)";
    for (let c = 0; c < 3; c++) {
      const a = s.turn + (c * TAU) / 3;
      g.beginPath();
      g.ellipse(s.x + Math.cos(a) * s.r * 0.45, s.y + Math.sin(a) * s.r * 0.45, s.r * 0.17, s.r * 0.1, a, 0, TAU);
      g.fill();
    }
    g.restore();
    g.lineWidth = Math.max(0.9, 1.1 * k);
    g.strokeStyle = "rgba(96,22,10,0.75)";
    g.stroke(disc);
  }
}

function paintLettuce(g: CanvasRenderingContext2D, ring: Ring, unit: number, k: number, n: number) {
  const reach = (t: number) => unit * mix(REACH[0]![1], REACH[0]![2], t);
  const path = blob(ring, (p) => reach(lettuceWave(p.u, n)));
  lift(g, path, "#4a8a28", k, 0.5);
  grade(g, path, [
    [34 * k, "#5da232"],
    [22 * k, "#6fb53b"],
    [12 * k, "#86cc4a"],
    [5 * k, "#b3e47a"],
  ]);
  // Each valley between two lobes runs in as a dark crease, each crest a pale one.
  const creases = new Path2D(), crests = new Path2D();
  for (let j = 0; j <= n; j++) {
    const uv = (j * Math.PI - 0.7) / (Math.PI * n);
    const uc = uv + 0.5 / n;
    for (const [u, path2] of [[uv, creases], [uc, crests]] as const) {
      if (u < 0 || u >= 1) continue;
      const p = ringAt(ring, u);
      const edge = reach(lettuceWave(u, n));
      const len = (path2 === creases ? 0.62 : 0.42) * (edge - unit * REACH[0]![1] * 0.6);
      path2.moveTo(p.x + p.nx * edge, p.y + p.ny * edge);
      path2.lineTo(p.x + p.nx * (edge - len), p.y + p.ny * (edge - len));
    }
  }
  g.save();
  g.clip(path);
  g.lineCap = "round";
  g.lineWidth = Math.max(1, 1.5 * k);
  g.strokeStyle = "rgba(40,90,20,0.55)";
  g.stroke(creases);
  g.lineWidth = Math.max(0.8, 1.1 * k);
  g.strokeStyle = "rgba(232,252,176,0.55)";
  g.stroke(crests);
  g.restore();
  g.lineWidth = Math.max(0.9, 1.1 * k);
  g.strokeStyle = "rgba(38,86,20,0.7)";
  g.stroke(path);
}

/** The whole stack round a ring, from the bottom bun up to the lettuce; the world is drawn over it afterwards. */
function paintStack(g: CanvasRenderingContext2D, ring: Ring, unit: number, dpr: number) {
  const k = unit / 128;
  const n = lobesOf(ring, unit);
  paintBun(g, ring, unit, k);
  paintPatty(g, ring, unit, k, dpr);
  paintCheese(g, ring, unit, k);
  paintTomato(g, ring, unit, k, n.tomato);
  paintLettuce(g, ring, unit, k, n.lettuce);
}

// ---- The tray ---------------------------------------------------------------------------------------------------

/** The Key button's corner at the frame's upper left and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 116, h: 64 };
export const ZOOM_BOX = { w: 76, h: 112 };

const GINGHAM = 16;
const ginghams = new WeakMap<CanvasRenderingContext2D, { dpr: number; p: CanvasPattern }>();

/** Checked liner paper: cream, with a band of teal each way, so the crossings come out darker. */
function gingham(g: CanvasRenderingContext2D, dpr: number): CanvasPattern {
  const hit = ginghams.get(g);
  if (hit && hit.dpr === dpr) return hit.p;
  const T = GINGHAM * 2;
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(T * dpr);
  const t = c.getContext("2d")!;
  t.scale(dpr, dpr);
  t.fillStyle = "#f7eed6";
  t.fillRect(0, 0, T, T);
  t.fillStyle = "rgba(31,138,138,0.2)";
  t.fillRect(0, 0, GINGHAM, T);
  t.fillRect(0, 0, T, GINGHAM);
  const p = g.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  ginghams.set(g, { dpr, p });
  return p;
}

function roundRect(p: Path2D, b: Box, r: number) {
  p.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r);
}

/** The steel tray and its checked liner, filling the frame: a lip all round, the liner sunk a little inside it. */
function tray(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, lip: number) {
  const outer = new Path2D();
  outer.rect(0, 0, w, h);
  const steel = g.createLinearGradient(0, 0, w, h);
  steel.addColorStop(0, "#e3e9ea");
  steel.addColorStop(0.5, "#b9c4c6");
  steel.addColorStop(1, "#d3dbdc");
  g.fillStyle = steel;
  g.fill(outer);
  const liner: Box = { x0: lip, y0: lip, x1: w - lip, y1: h - lip };
  const floor = new Path2D();
  roundRect(floor, liner, lip + 3);
  g.save();
  g.clip(floor);
  g.fillStyle = gingham(g, dpr);
  g.fillRect(0, 0, w, h);
  // Waxed paper over the checks: a pale sheen from the upper left, a few creases and the odd grease spot.
  const sheen = g.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, "rgba(255,255,255,0.3)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.04)");
  sheen.addColorStop(1, "rgba(255,255,255,0.16)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  const rnd = seeded(29);
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(214,160,70,0.14)");
    gr.addColorStop(1, "rgba(214,160,70,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const v = new Path2D();
    let x = rnd() * w, y = rnd() * h;
    let a = rnd() * TAU;
    v.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      a += (rnd() - 0.5) * 0.8;
      const l = 30 + rnd() * 80;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      v.lineTo(x, y);
    }
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,0.1)";
    g.stroke(v);
    g.lineWidth = 0.8;
    g.strokeStyle = "rgba(120,100,70,0.14)";
    g.stroke(v);
  }
  // The tray's wall throws a soft shade on the liner along its edge.
  g.lineWidth = lip * 1.6;
  g.strokeStyle = "rgba(20,40,40,0.2)";
  g.stroke(floor);
  g.restore();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
  g.strokeStyle = "rgba(80,96,98,0.7)";
  g.stroke(floor);
}

// ---- The squeeze bottles ------------------------------------------------------------------------------------------

export type BottleKind = "ketchup" | "mustard";

/** A bottle lying on the liner: its centre, the radius of the circle it stays inside, and its turn. */
export interface Bottle {
  kind: BottleKind;
  x: number;
  y: number;
  s: number;
  turn: number;
}

const SAUCES: Record<BottleKind, { light: string; body: string; dark: string; cap: string }> = {
  ketchup: { light: "#bd4632", body: "#932a1d", dark: "#5f160d", cap: "#f1e9d6" },
  mustard: { light: "#d8b14c", body: "#b9902a", dark: "#7e5c10", cap: "#f1e9d6" },
};

/** A squeeze bottle along its length in local units: its nozzle at +x, its base at -x, within a unit circle. */
function bottle(g: CanvasRenderingContext2D, kind: BottleKind, px: number) {
  const c = SAUCES[kind];
  const body = new Path2D();
  body.moveTo(-0.93, -0.18);
  body.quadraticCurveTo(-0.97, -0.27, -0.88, -0.27);
  body.lineTo(0.28, -0.27);
  body.bezierCurveTo(0.44, -0.27, 0.5, -0.12, 0.6, -0.1);
  body.lineTo(0.6, 0.1);
  body.bezierCurveTo(0.5, 0.12, 0.44, 0.27, 0.28, 0.27);
  body.lineTo(-0.88, 0.27);
  body.quadraticCurveTo(-0.97, 0.27, -0.93, 0.18);
  body.closePath();
  const gr = g.createLinearGradient(0, -0.27, 0, 0.27);
  gr.addColorStop(0, c.light);
  gr.addColorStop(0.4, c.body);
  gr.addColorStop(1, c.dark);
  g.fillStyle = gr;
  g.fill(body);
  // A plain label band round the middle, no lettering.
  g.save();
  g.clip(body);
  g.fillStyle = "rgba(247,240,222,0.95)";
  g.fillRect(-0.62, -0.3, 0.5, 0.6);
  g.lineWidth = px * 0.8;
  g.strokeStyle = "rgba(60,40,20,0.5)";
  g.strokeRect(-0.58, -0.22, 0.42, 0.44);
  g.restore();
  // The cap's collar and the nozzle's cone, tip rounded.
  const collar = new Path2D();
  collar.roundRect(0.6, -0.12, 0.09, 0.24, 0.02);
  const nozzle = new Path2D();
  nozzle.moveTo(0.69, -0.1);
  nozzle.lineTo(0.94, -0.03);
  nozzle.quadraticCurveTo(0.99, 0, 0.94, 0.03);
  nozzle.lineTo(0.69, 0.1);
  nozzle.closePath();
  g.fillStyle = c.cap;
  g.fill(collar);
  g.fill(nozzle);
  g.lineWidth = px;
  g.strokeStyle = "rgba(50,30,16,0.65)";
  g.stroke(body);
  g.stroke(collar);
  g.stroke(nozzle);
  g.lineWidth = px * 1.6;
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.moveTo(-0.84, -0.16);
  g.lineTo(0.3, -0.16);
  g.stroke();
}

function drawBottle(g: CanvasRenderingContext2D, b: Bottle) {
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.turn);
  g.shadowColor = "rgba(30,24,16,0.32)";
  g.shadowBlur = 6;
  g.shadowOffsetX = 2;
  g.shadowOffsetY = 3;
  g.scale(b.s, b.s);
  g.lineJoin = "round";
  g.lineCap = "round";
  bottle(g, b.kind, 1 / b.s);
  g.restore();
}

const GAP = 10;
const MARGIN = 8;

function hitsBox(x: number, y: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;
}

/** Where each bottle may lie, by direction from the globe's centre (screen degrees, y down), in turn of choice. */
const SPOTS: readonly [BottleKind, number][] = [
  ["ketchup", 20],
  ["mustard", 200],
  ["ketchup", 160],
  ["mustard", -20],
  ["ketchup", -160],
  ["mustard", 150],
];

/**
 * The squeeze bottles on the liner beside a globe of radius R at (cx, cy) in a frame w by h, sized from the globe at
 * its widest zoom (`baseR`). Each sits in the room between the stack's outer edge and the frame's, shrinks to fit it
 * and is left out when there is too little, so neither ever comes near the stack, the Key, the zoom buttons or the other.
 */
export function placeBottles(w: number, h: number, cx: number, cy: number, R: number, baseR: number): Bottle[] {
  const out: Bottle[] = [];
  const P = R * (1 + STACK_REACH);
  for (const [kind, deg] of SPOTS) {
    if (out.some((o) => o.kind === kind)) continue;
    const cap = clamp(baseR * 0.62, 26, 120);
    const a = deg * RAD;
    const dx = Math.cos(a), dy = Math.sin(a);
    const x0 = cx + dx * (P + GAP), y0 = cy + dy * (P + GAP);
    if (x0 < MARGIN || y0 < MARGIN || x0 > w - MARGIN || y0 > h - MARGIN) continue;
    const fit = (room: number, d: number) => (room - MARGIN) / (1 + Math.abs(d));
    const s = Math.min(cap, fit(dx < 0 ? x0 : w - x0, dx), fit(dy < 0 ? y0 : h - y0, dy));
    if (s < 26) continue;
    const x = cx + dx * (P + GAP + s), y = cy + dy * (P + GAP + s);
    if (hitsBox(x, y, s + 4, 0, 0, KEY_BOX.w, KEY_BOX.h)) continue;
    if (hitsBox(x, y, s + 4, w - ZOOM_BOX.w, h - ZOOM_BOX.h, w, h)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.s + s + GAP)) continue;
    // Laid along the stack's edge, with a slight slant.
    out.push({ kind, x, y, s, turn: a + Math.PI / 2 + (kind === "ketchup" ? 0.14 : -0.2) });
  }
  return out;
}

// ---- Map view: the stack cut square on its tray -------------------------------------------------------------------

export interface Slab {
  wide: boolean;
  /** The tray's steel lip. */
  lip: number;
  /** The unit the layers' reaches are shares of, in pixels. */
  unit: number;
  /** The stack's outer edge, the bottom bun's greatest reach. */
  stack: Box;
  /** The map's window: the world seen inside the layers. */
  window: Box;
  round: number;
  /** The liner's strip under the stack, where the bottles lie (wide frames only), or null. */
  strip: Box | null;
}

/** The tray and stack in a frame w by h. */
export function slabOf(w: number, h: number): Slab {
  const wide = w >= 520 && h >= 360;
  const k = clamp(Math.min(w, h) / 620, 0.5, 1);
  const lip = wide ? 9 : 4;
  const gap = wide ? 6 : 3;
  const unit = 128 * k;
  const reach = STACK_REACH * unit;
  const stripH = wide ? 40 : 0;
  const stack: Box = { x0: lip + gap, y0: lip + gap, x1: w - lip - gap, y1: h - lip - gap - stripH };
  const window: Box = { x0: stack.x0 + reach, y0: stack.y0 + reach, x1: stack.x1 - reach, y1: stack.y1 - reach };
  const strip = wide ? { x0: lip, y0: stack.y1, x1: w - lip, y1: h - lip } : null;
  return { wide, lip, unit, stack, window, round: clamp(20 * k, 8, 20), strip };
}

/** The bottles lying in the liner's strip under the stack in Map view: none on a small frame. */
export function mapBottles(w: number, h: number): Bottle[] {
  const s = slabOf(w, h);
  if (!s.strip) return [];
  const room = s.strip.y1 - s.strip.y0;
  const half = clamp((room / 2 - 2) / 0.27, 20, 62);
  const y = (s.strip.y0 + s.strip.y1) / 2;
  const x0 = s.strip.x0 + 22 + half;
  const out: Bottle[] = [{ kind: "ketchup", x: x0, y, s: half, turn: -0.02 }];
  const x1 = x0 + half * 2 + 16;
  if (x1 + half < w - ZOOM_BOX.w - 8) out.push({ kind: "mustard", x: x1, y, s: half, turn: 0.025 });
  return out;
}

// ---- The frame ----------------------------------------------------------------------------------------------------

export class BurgerCache {
  world = new StillLayer();
  table: { key?: string; canvas?: HTMLCanvasElement } = {};
  /** The soft layer: pale along the coast and dark on the mountains. */
  edge: { canvas?: HTMLCanvasElement; g?: CanvasRenderingContext2D } = {};
}

/** The tray, the bottles and the stack round the globe: everything but the globe, kept while the view's size and zoom hold. */
function globeTable(f: SurfaceFrame, cache: BurgerCache): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const key = `${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  return once(cache.table, key, w, h, dpr, (t) => {
    tray(t, w, h, dpr, clamp(Math.min(w, h) / 90, 4, 9));
    for (const b of placeBottles(w, h, cx, cy, R, R / Math.max(1, f.zoom))) drawBottle(t, b);
    if (R < Math.hypot(w, h)) paintStack(t, circleRing(cx, cy, R, 0.35), R, dpr);
    // The bun's top throws a shadow on the lettuce round it. Drawn here, once, since a blurred shadow is dear to redraw.
    t.save();
    t.shadowColor = "rgba(34,16,4,0.5)";
    t.shadowBlur = Math.min(26, R * 0.09);
    t.shadowOffsetY = Math.min(6, R * 0.025);
    t.fillStyle = CRUST;
    t.beginPath();
    t.arc(cx, cy, R, 0, TAU);
    t.fill();
    t.restore();
  });
}

function paintGlobe(f: SurfaceFrame, cache: BurgerCache, g: CanvasRenderingContext2D) {
  const { w, h } = f;
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  g.drawImage(globeTable(f, cache), 0, 0, w, h);
  const sphere = new Path2D();
  geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  paintWorld(f, cache, g, sphere);
  g.save();
  g.clip(sphere);
  // The dome lit from the upper left, darker toward its edge where it turns away, and the glaze's long highlight.
  const lightG = g.createRadialGradient(cx - R * 0.38, cy - R * 0.44, R * 0.05, cx, cy, R);
  lightG.addColorStop(0, "rgba(255,246,214,0.34)");
  lightG.addColorStop(0.5, "rgba(255,246,214,0)");
  lightG.addColorStop(0.82, "rgba(60,26,6,0.1)");
  lightG.addColorStop(1, "rgba(40,16,2,0.34)");
  g.fillStyle = lightG;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.lineCap = "round";
  g.lineWidth = Math.max(2, R * 0.09);
  g.strokeStyle = "rgba(255,248,226,0.1)";
  g.beginPath();
  g.arc(cx, cy, R * 0.74, Math.PI * 1.07, Math.PI * 1.44);
  g.stroke();
  g.lineWidth = Math.max(1.4, R * 0.028);
  g.strokeStyle = "rgba(255,250,232,0.36)";
  g.beginPath();
  g.arc(cx, cy, R * 0.74, Math.PI * 1.12, Math.PI * 1.38);
  g.stroke();
  g.restore();
  g.lineWidth = 1.2;
  g.strokeStyle = "rgba(84,40,8,0.85)";
  g.stroke(sphere);
}

/** The tray, the bottles and the stack round the map's window, kept while the frame's size holds. */
function slabLayer(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, s: Slab) {
  tray(g, w, h, dpr, s.lip);
  for (const b of mapBottles(w, h)) drawBottle(g, b);
  paintStack(g, boxRing(s.window, s.round), s.unit, dpr);
}

/**
 * Each seed's soft shadow on whatever it lies on, down and to the right as if it sat on the surface, in one fill under
 * the markers, so the markers themselves are untouched.
 */
export function seedShadows(g: CanvasRenderingContext2D, spots: readonly SurfaceSpot[]) {
  if (!spots.length) return;
  const p = new Path2D();
  for (const s of spots) {
    const x = s.x + s.r * 0.3, y = s.y + s.r * 0.5;
    p.moveTo(x + s.r * 1.2, y);
    p.ellipse(x, y, s.r * 1.2, s.r * 0.85, -0.75, 0, TAU);
  }
  g.save();
  g.fillStyle = "rgba(40,18,4,0.26)";
  g.fill(p);
  g.restore();
}

export function drawBurger(f: SurfaceFrame, cache: BurgerCache): SurfaceResult {
  const { w, h, dpr } = f;
  const under = (spots: SurfaceSpot[]) => seedShadows(f.ctx, spots);
  if (f.mode === "3d") {
    cache.world.draw(f, (g) => paintGlobe(f, cache, g));
    return { under };
  }
  const s = slabOf(w, h);
  const win = new Path2D();
  roundRect(win, s.window, s.round);
  cache.world.draw(f, (g) => {
    g.drawImage(once(cache.table, `${w}|${h}|${dpr}`, w, h, dpr, (t) => slabLayer(t, w, h, dpr, s)), 0, 0, w, h);
    paintWorld(f, cache, g, win);
    // The glaze over the window: a sheen from the upper left, and the layers' edge shading the world a touch.
    g.save();
    g.clip(win);
    const sheen = g.createLinearGradient(s.window.x0, s.window.y0, s.window.x0 + (s.window.x1 - s.window.x0) * 0.7, s.window.y0 + (s.window.y1 - s.window.y0) * 1.1);
    sheen.addColorStop(0, "rgba(255,246,214,0.2)");
    sheen.addColorStop(0.4, "rgba(255,246,214,0.03)");
    sheen.addColorStop(1, "rgba(255,246,214,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 7;
    g.strokeStyle = "rgba(40,16,2,0.28)";
    g.stroke(win);
    g.restore();
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(84,40,8,0.85)";
    g.stroke(win);
  });
  const m = 4;
  const i = s.window;
  return { inside: (x, y) => x > i.x0 + m && y > i.y0 + m && x < i.x1 - m && y < i.y1 - m, clip: win, under };
}
