// Aquarium (decision 77). In Map view the map is the back wall of a tank: aqua water lit from above, sandy land with
// moss, faint moving caustic light, fish swimming only inside fixed circles of open ocean (FISH, tested), and
// gravel and plants in a strip along the bottom edge, below the map. In Globe view the world floats in a round
// fishbowl on a table: glass with highlights and a lip, a waterline that tilts when the globe is turned and
// settles, bubbles rising round the globe, and fish swimming round it in the water, never over it. The fish are
// our own simple drawings. Everything that moves holds still for readers who ask for reduced motion, and nothing
// here draws over a marker: the view draws markers after this.

import { geoPath, type GeoPermissibleObjects } from "d3-geo";
import { drawPart, motionTime, stillMotion, StillLayer } from "./ambient.ts";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

export type FishKind = "goldfish" | "angel" | "tetra" | "guppy";

export interface FishSpot {
  kind: FishKind;
  lon: number;
  lat: number;
  /** Degrees of open water around the spot. A fish swims inside this circle and is sized to it. */
  r: number;
}

/** Where fish swim over the map: open ocean far from land and every place (test/aquarium.test.ts). */
export const FISH: readonly FishSpot[] = [
  { kind: "goldfish", lon: -142, lat: 10, r: 14 },
  { kind: "angel", lon: -22, lat: -30, r: 14 },
  { kind: "guppy", lon: -38, lat: 26, r: 11 },
  { kind: "tetra", lon: 90, lat: -10, r: 9 },
  { kind: "goldfish", lon: -126, lat: -26, r: 14 },
  { kind: "angel", lon: 154, lat: 30, r: 9 },
  { kind: "tetra", lon: -166, lat: -34, r: 9 },
  { kind: "guppy", lon: 46, lat: -34, r: 7 },
  { kind: "tetra", lon: -94, lat: -6, r: 9 },
  { kind: "goldfish", lon: 6, lat: -58, r: 9 },
  { kind: "guppy", lon: 130, lat: -42, r: 7 },
];

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class AquariumCache {
  world = new StillLayer();
  /** The sand's pattern for each canvas it is drawn on: the frame, or the still layer. */
  sand = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
  caustic?: { ctx: CanvasRenderingContext2D; dpr: number; patterns: [CanvasPattern, CanvasPattern] };
  floor?: { key: string; back: HTMLCanvasElement; front: HTMLCanvasElement };
  bowl?: { key: string; back: HTMLCanvasElement; gravel: HTMLCanvasElement; front: HTMLCanvasElement };
  /** The waterline's tilt (radians) and how fast it is turning, and the last position seen, for the slosh. */
  slosh = { theta: 0, omega: 0, lon: NaN, at: 0 };
}

export function drawAquarium(f: SurfaceFrame, cache: AquariumCache) {
  const theta = slosh(f, cache);
  if (f.mode === "3d") drawBowl(f, cache, theta);
  else drawTank(f, cache, theta);
}

// ---- the slosh ------------------------------------------------------------------------------------------------

/**
 * Turning the world pushes the water: each frame's movement in pixels kicks the waterline, and a damped spring
 * brings it back level within a couple of seconds.
 */
function slosh(f: SurfaceFrame, cache: AquariumCache): number {
  const s = cache.slosh;
  if (stillMotion()) return 0;
  const now = performance.now();
  if (!Number.isFinite(s.lon)) {
    s.lon = f.lon;
    s.at = now;
    return s.theta;
  }
  const dt = Math.min(0.1, (now - s.at) / 1000);
  s.at = now;
  const dLon = ((((f.lon - s.lon + 540) % 360) + 360) % 360) - 180;
  s.lon = f.lon;
  const px = dLon * DEG * f.proj.scale();
  s.omega += clamp(px, -60, 60) * 0.014;
  if (dt > 0) {
    s.omega += (-30 * s.theta - 3 * s.omega) * dt;
    s.theta += s.omega * dt;
  }
  s.theta = clamp(s.theta, -0.2, 0.2);
  if (Math.abs(s.theta) < 1e-4 && Math.abs(s.omega) < 1e-3) s.theta = s.omega = 0;
  return s.theta;
}

// ---- the world: water, sand and moss --------------------------------------------------------------------------

/** Sand with moss: grains and green patches in a tile, laid over the land and moving with it. */
function sand(g: CanvasRenderingContext2D, cache: AquariumCache, ink: string, ink2: string): CanvasPattern {
  const had = cache.sand.get(g);
  if (had) return had;
  const [tile, tg] = offscreen(96, 96, 1);
  const rnd = seeded(41);
  for (let i = 0; i < 22; i++) {
    const x = rnd() * 96, y = rnd() * 96, r = 2 + rnd() * 5;
    tg.fillStyle = ink2;
    for (const ox of [-96, 0, 96])
      for (const oy of [-96, 0, 96]) {
        tg.beginPath();
        tg.ellipse(x + ox, y + oy, r, r * 0.7, rnd() * 3, 0, Math.PI * 2);
        tg.fill();
      }
  }
  tg.fillStyle = ink;
  for (let i = 0; i < 260; i++) tg.fillRect(rnd() * 96, rnd() * 96, 1 + rnd() * 1.5, 1 + rnd());
  tg.fillStyle = "rgba(255,250,230,0.5)";
  for (let i = 0; i < 90; i++) tg.fillRect(rnd() * 96, rnd() * 96, 1, 1);
  const pattern = g.createPattern(tile, "repeat")!;
  cache.sand.set(g, pattern);
  return pattern;
}

/** The land, sea and coasts; a still layer, so the fish swim over it without drawing it again. */
function paintWorld(f: SurfaceFrame, cache: AquariumCache, g: CanvasRenderingContext2D) {
  const { w, h, proj, theme: t, mode } = f;
  const path = geoPath(proj, g);
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const globe = mode === "3d";

  g.save();
  if (globe) {
    g.beginPath();
    path(SPHERE);
    g.clip();
  }
  // Water lit from above: brighter near the surface, deeper blue-green below. On the globe, lit from the upper left.
  let sea: CanvasGradient;
  if (globe) {
    sea = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sea.addColorStop(0, "#56c6cf");
    sea.addColorStop(0.55, t.ocean);
    sea.addColorStop(1, "#0f5063");
  } else {
    sea = g.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, "#4ab8c4");
    sea.addColorStop(0.45, t.ocean);
    sea.addColorStop(1, "#11566a");
  }
  g.fillStyle = sea;
  g.fillRect(0, 0, w, h);

  const map = f.map;
  // The coast and the land are projected once and reused for every stroke and fill.
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(map.coast);
  const land = new Path2D();
  geoPath(proj, pathContext(land))(map.land);
  // Pale shallows along every coast, then the land.
  g.lineJoin = "round";
  g.strokeStyle = t.waterline;
  g.lineWidth = 9;
  g.stroke(coast);
  g.lineWidth = 4;
  g.stroke(coast);
  g.fillStyle = t.land;
  g.fill(land);
  const tex = sand(g, cache, t.textureInk, t.textureInk2 ?? t.textureInk);
  // Tied to the world's position, so the sand moves with the land instead of sliding under it.
  const anchor = proj([0, 0]) ?? [0, 0];
  tex.setTransform(new DOMMatrix().translate(anchor[0] % 96, anchor[1] % 96));
  g.fillStyle = tex;
  g.fill(land);
  // Mossy rock where the relief layer has mountains: soft darker patches, never an outline.
  if (f.relief) {
    g.fillStyle = "rgba(92,110,70,0.22)";
    const s = clamp(R / 90, 1.6, 7);
    g.beginPath();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && !facing(f, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      g.moveTo(p[0] + s, p[1]);
      g.ellipse(p[0], p[1], s, s * 0.7, 0, 0, Math.PI * 2);
    }
    g.fill();
  }
  if (map.ice) {
    g.beginPath();
    path(map.ice);
    g.fillStyle = t.ice;
    g.fill();
  }
  g.beginPath();
  path(map.lakes);
  g.fillStyle = "#2a93a6";
  g.fill();
  g.strokeStyle = t.coast;
  g.lineWidth = t.coastWidth;
  g.stroke(coast);

  if (globe) {
    // A solid sphere under water: darker toward the rim, a soft sheen at the upper left.
    const shade = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R * 1.02);
    shade.addColorStop(0, "rgba(255,255,255,0.12)");
    shade.addColorStop(0.5, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(4,40,52,0.5)");
    g.fillStyle = shade;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  g.restore();
  if (globe) {
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.strokeStyle = "rgba(225,255,250,0.55)";
    g.lineWidth = 1.2;
    g.stroke();
  } else beams(g, w, h - floorHeight(h));
}

/** Soft light falling from the surface in a few wide beams, fixed to the tank. */
function beams(g: CanvasRenderingContext2D, w: number, floorY: number) {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const [x0, spread] of [
    [0.18, 0.12],
    [0.47, 0.08],
    [0.74, 0.14],
  ] as const) {
    const light = g.createLinearGradient(0, 0, 0, floorY);
    light.addColorStop(0, "rgba(200,255,250,0.10)");
    light.addColorStop(1, "rgba(200,255,250,0)");
    g.fillStyle = light;
    g.beginPath();
    g.moveTo(w * x0, 0);
    g.lineTo(w * (x0 + spread), 0);
    g.lineTo(w * (x0 + spread * 2.2 + 0.08), floorY);
    g.lineTo(w * (x0 + 0.08), floorY);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Whether a point is on the globe's near side. */
function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const a = lat * DEG, b = f.lat * DEG;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * DEG) > 0.05;
}

/**
 * Caustics: the bright net that light through a rippling surface throws on the bottom, as a tile that repeats
 * seamlessly. Two copies drift slowly across each other, faintly, so no area changes brightness sharply.
 */
/** Tile sizes of the two caustic layers, in CSS pixels. */
const CAUSTIC_TILES = [256, 336] as const;

function caustic(ctx: CanvasRenderingContext2D, cache: AquariumCache, dpr: number): [CanvasPattern, CanvasPattern] {
  if (cache.caustic?.ctx === ctx && cache.caustic.dpr === dpr) return cache.caustic.patterns;
  // Made at the screen's resolution and moved by whole device pixels, so drawing them is a plain copy.
  const make = (size: number, a: number, b: number): CanvasPattern => {
    const n = Math.round(size * dpr);
    const [tile, tg] = offscreen(n, n, 1);
    const img = tg.createImageData(n, n);
    const k = (2 * Math.PI) / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = Math.cos(k * (2 * x + y) + a * Math.cos(k * (x - 2 * y))) + Math.cos(k * (-x + 3 * y) + b * Math.cos(k * (3 * x + y)));
        const c = Math.pow(Math.max(0, 1 - Math.abs(v) * 1.6), 3);
        const o = (y * n + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(c * 255);
      }
    tg.putImageData(img, 0, 0);
    return ctx.createPattern(tile, "repeat")!;
  };
  const patterns: [CanvasPattern, CanvasPattern] = [make(CAUSTIC_TILES[0], 1.4, 1.2), make(CAUSTIC_TILES[1], 1.1, 1.5)];
  cache.caustic = { ctx, dpr, patterns };
  return patterns;
}

function drawCaustics(ctx: CanvasRenderingContext2D, cache: AquariumCache, x: number, y: number, w: number, h: number, t: number, alpha: number) {
  const dpr = ctx.getTransform().a;
  const [a, b] = caustic(ctx, cache, dpr);
  const snap = (v: number, size: number) => (Math.round(v * dpr) / dpr) % size;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  a.setTransform(new DOMMatrix().translate(snap(t * 7, CAUSTIC_TILES[0]), snap(t * 3.5, CAUSTIC_TILES[0])).scale(1 / dpr));
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = alpha * 0.8;
  b.setTransform(new DOMMatrix().translate(snap(-t * 5, CAUSTIC_TILES[1]), snap(t * 6, CAUSTIC_TILES[1])).scale(1 / dpr));
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ---- fish -----------------------------------------------------------------------------------------------------

interface FishArt {
  /** Where the tail joins the body; the tail swings about it. */
  root: number;
  tail: Path2D;
  tailFill: string;
  tailBand?: Path2D;
  tailBandFill?: string;
  body: Path2D;
  bodyFill: string;
  /** Drawn inside the body: a belly, stripes or a neon line, with their colours. */
  marks: [Path2D, string][];
  fins: Path2D;
  finFill: string;
  lines?: Path2D;
  lineInk?: string;
  ink: string;
  eye: [number, number, number];
}

let ART: Record<FishKind, FishArt> | null = null;

/** Our own fish, drawn facing right in a 100-unit length, built once. */
function fishArt(): Record<FishKind, FishArt> {
  if (ART) return ART;
  const P = (d: string) => new Path2D(d);
  ART = {
    goldfish: {
      root: -26,
      tail: P("M-26 0C-40 -22 -58 -36 -61 -16C-62 -8 -53 -2 -51 0C-53 2 -62 8 -61 16C-58 36 -40 22 -26 0Z"),
      tailFill: "rgba(255,150,60,0.92)",
      tailBand: P("M-30 0L-57 -15M-30 0L-57 15M-30 0L-55 -4M-30 0L-55 4"),
      tailBandFill: "rgba(214,90,20,0.8)",
      body: P("M46 2C44 -14 26 -24 4 -22C-14 -20 -26 -10 -30 0C-26 10 -14 20 4 22C26 24 44 16 46 2Z"),
      bodyFill: "#ff8a24",
      marks: [[P("M40 9C30 18 10 20 -6 16C-16 13 -24 6 -26 2C-14 8 10 12 40 9Z"), "#ffd08a"]],
      fins: P("M-6 -20C0 -36 14 -36 21 -21ZM14 8C10 19 2 23 -3 21C2 16 6 12 14 8Z"),
      finFill: "#ffb060",
      lines: P("M26 -11C21 -4 21 6 26 13M10 -9A6 6 0 0 1 10 3M0 -13A6 6 0 0 1 0 -1M0 1A6 6 0 0 1 0 13M-10 -7A6 6 0 0 1 -10 5"),
      lineInk: "rgba(190,70,15,0.55)",
      ink: "#b8480f",
      eye: [34, -4, 4.8],
    },
    angel: {
      root: -28,
      tail: P("M-28 0L-50 -17C-45 -6 -45 6 -50 17Z"),
      tailFill: "rgba(236,232,220,0.9)",
      body: P("M46 0C38 -10 24 -16 8 -18L-8 -56C-5 -36 -15 -22 -27 -8L-30 0L-27 8C-15 22 -5 36 -8 56L8 18C24 16 38 10 46 0Z"),
      bodyFill: "#eef0ea",
      marks: [
        [P("M17 -30H23V30H17ZM-4 -60H3V60H-4ZM-21 -40H-16V40H-21Z"), "rgba(40,44,56,0.85)"],
        [P("M46 0C40 -8 31 -12 25 -12C27 -4 27 4 25 12C31 12 40 8 46 0Z"), "rgba(243,210,122,0.8)"],
      ],
      fins: P("M10 16C8 30 4 44 0 52C8 40 14 28 16 16Z"),
      finFill: "rgba(236,232,220,0.85)",
      ink: "#50525c",
      eye: [36, -3, 4.2],
    },
    tetra: {
      root: -30,
      tail: P("M-30 0L-49 -13L-43 0L-49 13Z"),
      tailFill: "rgba(214,232,242,0.85)",
      body: P("M46 0C40 -10 20 -14 0 -13C-16 -12 -26 -6 -32 0C-26 6 -16 12 0 13C20 14 40 10 46 0Z"),
      bodyFill: "#cbd8e0",
      marks: [
        [P("M8 1C-6 1 -20 1 -31 1C-24 7 -14 11 0 12C8 12 12 8 8 1Z"), "#ff3b4f"],
        [P("M40 -4C20 -7 0 -6 -29 -2C0 -1 20 -1 40 -1Z"), "#22e0ff"],
      ],
      fins: P("M0 -12L-9 -21L-13 -11ZM6 11L0 19L-4 12Z"),
      finFill: "rgba(214,232,242,0.85)",
      ink: "#56697a",
      eye: [34, -2, 4.4],
    },
    guppy: {
      root: -18,
      tail: P("M-18 0C-28 -24 -50 -32 -56 -8C-57 0 -57 0 -56 8C-50 32 -28 24 -18 0Z"),
      tailFill: "#4f7dff",
      tailBand: P("M-22 0C-30 -14 -42 -19 -46 -5C-47 0 -47 0 -46 5C-42 19 -30 14 -22 0Z"),
      tailBandFill: "rgba(255,95,162,0.85)",
      body: P("M46 0C40 -14 18 -16 0 -13C-10 -11 -17 -6 -22 0C-17 6 -10 11 0 13C18 16 40 14 46 0Z"),
      bodyFill: "#b4c4ae",
      marks: [[P("M34 5C20 11 4 12 -14 6C0 7 18 6 34 5Z"), "rgba(255,245,220,0.85)"]],
      fins: P("M6 -12C2 -26 -12 -28 -17 -22C-12 -16 -4 -12 6 -12Z"),
      finFill: "#4f7dff",
      ink: "#475a4c",
      eye: [32, -2, 4.2],
    },
  };
  return ART;
}

/**
 * One fish of length `len` pixels at x, y. `face` is its facing, -1 to 1: it narrows through 0 as it turns round.
 * `tilt` turns it up or down, `wag` swings the tail.
 */
function drawFish(g: CanvasRenderingContext2D, kind: FishKind, x: number, y: number, len: number, face: number, tilt: number, wag: number) {
  const a = fishArt()[kind];
  const k = len / 100;
  const sx = Math.sign(face || 1) * Math.max(0.15, Math.abs(face));
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(sx * k, k);
  g.lineJoin = "round";
  g.lineCap = "round";
  const lw = Math.max(1.6, 1.1 / k);
  g.save();
  g.translate(a.root, 0);
  g.rotate(wag);
  g.translate(-a.root, 0);
  g.fillStyle = a.tailFill;
  g.fill(a.tail);
  if (a.tailBand) {
    if (kind === "goldfish") {
      g.strokeStyle = a.tailBandFill!;
      g.lineWidth = lw * 0.7;
      g.stroke(a.tailBand);
    } else {
      g.fillStyle = a.tailBandFill!;
      g.fill(a.tailBand);
    }
  }
  g.strokeStyle = a.ink;
  g.lineWidth = lw;
  g.stroke(a.tail);
  g.restore();
  g.fillStyle = a.finFill;
  g.fill(a.fins);
  g.strokeStyle = a.ink;
  g.lineWidth = lw * 0.8;
  g.stroke(a.fins);
  g.fillStyle = a.bodyFill;
  g.fill(a.body);
  g.save();
  g.clip(a.body);
  for (const [p, c] of a.marks) {
    g.fillStyle = c;
    g.fill(p);
  }
  g.restore();
  if (a.lines && len > 22) {
    g.strokeStyle = a.lineInk!;
    g.lineWidth = lw * 0.6;
    g.stroke(a.lines);
  }
  g.strokeStyle = a.ink;
  g.lineWidth = lw;
  g.stroke(a.body);
  const [ex, ey, er] = a.eye;
  g.beginPath();
  g.arc(ex, ey, er, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.fill();
  g.lineWidth = lw * 0.5;
  g.stroke();
  g.beginPath();
  g.arc(ex + er * 0.2, ey, er * 0.58, 0, Math.PI * 2);
  g.fillStyle = "#0f1c24";
  g.fill();
  g.restore();
}

// ---- Map view: the tank ---------------------------------------------------------------------------------------

/** The strip along the bottom for the gravel and plants, below the map. */
const floorHeight = (h: number) => Math.round(clamp(h * 0.1, 34, 86));

const PEBBLES = ["#c9b48a", "#a88f64", "#e8dcc0", "#6b5a45", "#8aa0a8", "#d98f6a", "#5e7f9a", "#f1e6cf", "#9c7b5a"];

/** Gravel for a strip w by hh: `back` a darker bed of small stones, `front` a row of larger ones. */
function gravel(g: CanvasRenderingContext2D, x0: number, w: number, top: number, hh: number, seed: number, front: boolean) {
  const rnd = seeded(seed);
  const n = Math.ceil((w / 7) * (front ? 0.9 : 2.2));
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w;
    const depth = front ? 0.45 + rnd() * 0.55 : rnd();
    const y = top + depth * hh;
    const r = front ? 3 + rnd() * 4.5 : 2 + rnd() * 3 + depth * 1.5;
    const col = PEBBLES[Math.floor(rnd() * PEBBLES.length)]!;
    g.beginPath();
    g.ellipse(x, y, r * 1.25, r * 0.85, (rnd() - 0.5) * 0.8, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = "rgba(30,24,16,0.35)";
    g.lineWidth = 0.8;
    g.stroke();
    // A glint on the upper left of the bigger stones.
    if (r > 3) {
      g.beginPath();
      g.ellipse(x - r * 0.4, y - r * 0.3, r * 0.35, r * 0.2, -0.5, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fill();
    }
  }
}

function floorLayers(f: SurfaceFrame, cache: AquariumCache, band: number) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}`;
  if (cache.floor?.key === key) return cache.floor;
  const [back, bg] = offscreen(w, band, dpr);
  // Water in front of the map's lower edge, a shadow where the back wall meets the floor, and the gravel bed.
  const water = bg.createLinearGradient(0, 0, 0, band);
  water.addColorStop(0, "#155e70");
  water.addColorStop(1, "#0b3c49");
  bg.fillStyle = water;
  bg.fillRect(0, 0, w, band);
  const edge = bg.createLinearGradient(0, 0, 0, 10);
  edge.addColorStop(0, "rgba(2,20,26,0.55)");
  edge.addColorStop(1, "rgba(2,20,26,0)");
  bg.fillStyle = edge;
  bg.fillRect(0, 0, w, 10);
  const bedTop = band * 0.5;
  bg.beginPath();
  bg.moveTo(0, band);
  for (let x = 0; x <= w + 20; x += 20) bg.lineTo(x, bedTop + Math.sin(x / 57) * band * 0.06 + Math.sin(x / 23) * band * 0.03);
  bg.lineTo(w, band);
  bg.closePath();
  bg.fillStyle = "#8a7656";
  bg.fill();
  bg.save();
  bg.clip();
  gravel(bg, 0, w, bedTop - 4, band - bedTop + 4, 5, false);
  bg.restore();
  const [front, fg] = offscreen(w, band, dpr);
  gravel(fg, 0, w, band * 0.72, band * 0.3, 9, true);
  cache.floor = { key, back, front };
  return cache.floor;
}

/** A clump of ribbon plants: blades from the gravel, each swaying a little on its own. */
function plants(g: CanvasRenderingContext2D, x: number, base: number, height: number, blades: number, seed: number, t: number, cols: string[]) {
  const rnd = seeded(seed);
  for (let i = 0; i < blades; i++) {
    const bx = x + (rnd() - 0.5) * height * 0.5;
    const hh = height * (0.55 + rnd() * 0.45);
    const lean = (rnd() - 0.5) * hh * 0.5;
    const sway = Math.sin(t * (0.6 + rnd() * 0.4) + i * 1.7) * hh * 0.08;
    const wBase = Math.max(2, hh * 0.07);
    const tipX = bx + lean + sway;
    const tipY = base - hh;
    g.beginPath();
    g.moveTo(bx - wBase, base);
    g.quadraticCurveTo(bx - wBase + lean * 0.3 - sway * 0.2, base - hh * 0.55, tipX, tipY);
    g.quadraticCurveTo(bx + wBase + lean * 0.3 - sway * 0.2, base - hh * 0.5, bx + wBase, base);
    g.closePath();
    g.fillStyle = cols[i % cols.length]!;
    g.fill();
    g.strokeStyle = "rgba(20,60,30,0.5)";
    g.lineWidth = 0.8;
    g.stroke();
  }
}

/** A round-leaf plant: leaves on short stalks from one stem. */
function leafPlant(g: CanvasRenderingContext2D, x: number, base: number, height: number, t: number) {
  const sway = Math.sin(t * 0.7) * height * 0.04;
  g.strokeStyle = "#3f7a3a";
  g.lineWidth = Math.max(1.2, height * 0.035);
  g.beginPath();
  g.moveTo(x, base);
  g.quadraticCurveTo(x + sway, base - height * 0.5, x + sway * 1.5, base - height * 0.9);
  g.stroke();
  for (let i = 0; i < 5; i++) {
    const k = 0.25 + i * 0.15;
    const px = x + sway * k * 1.5, py = base - height * k;
    const side = i % 2 ? 1 : -1;
    const lr = height * (0.16 - i * 0.015);
    g.beginPath();
    g.ellipse(px + side * lr * 0.9, py - lr * 0.2, lr, lr * 0.5, side * -0.5, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? "#5fae4a" : "#4d9a3f";
    g.fill();
    g.strokeStyle = "#2f6a2c";
    g.lineWidth = 0.8;
    g.stroke();
  }
}

function drawTank(f: SurfaceFrame, cache: AquariumCache, theta: number) {
  const { ctx, w, h, proj } = f;
  const t = motionTime();
  const band = floorHeight(h);
  const floorY = h - band;
  cache.world.draw(f, (g) => paintWorld(f, cache, g));

  // Caustics over the back wall (the beams of light are part of the still layer).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, floorY);
  ctx.clip();
  drawCaustics(ctx, cache, 0, 0, w, floorY, t, 0.1);

  // Fish over the open ocean, each inside its tested circle of open water.
  const perDegree = proj.scale() * DEG;
  FISH.forEach((s, i) => {
    const p = proj([s.lon, s.lat]);
    if (!p) return;
    const rp = s.r * perDegree;
    const len = Math.min(rp * 0.95, 72);
    if (len < 12) return;
    if (p[0] < -rp || p[0] > w + rp || p[1] < -rp || p[1] > floorY + rp) return;
    const reach = Math.max(0, rp * 0.82 - len * 0.55);
    const speed = (18 + (i % 4) * 5) / Math.max(20, reach);
    const phase = t * speed + i * 1.9;
    const x = p[0] + reach * Math.sin(phase);
    const y = p[1] + rp * 0.14 * Math.sin(t * 0.5 + i);
    const face = clamp(Math.cos(phase) * 3, -1, 1);
    drawFish(ctx, s.kind, x, y, len, face, Math.sin(t * 0.5 + i) * 0.08, Math.sin(t * 7 + i) * 0.2);
  });

  // The water's surface along the top, seen from below, tilting with the slosh.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, 5 + Math.sin(x / 38 + t * 1.3) * 1.4 + (x - w / 2) * Math.tan(theta) * 0.05);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fillStyle = "rgba(210,252,255,0.45)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // The floor strip: water in front of the map's lower edge, gravel, plants and two small fish.
  const floor = floorLayers(f, cache, band);
  ctx.drawImage(floor.back, 0, floorY, w, band);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, floorY, w, band);
  ctx.clip();
  const baseY = floorY + band * 0.82;
  const greens = ["#3f8f3a", "#5aae48", "#2f7a3a", "#6cbf52"];
  const step = Math.max(150, w / 7);
  for (let x = step * 0.3, i = 0; x < w; x += step, i++) {
    if (i % 3 === 1) leafPlant(ctx, x, baseY, band * 0.7, t + i);
    else plants(ctx, x, baseY, band * 0.78, 6, 13 + i, t, greens);
  }
  for (let i = 0; i < 2; i++) {
    const len = Math.min(band * 0.42, 34);
    const span = w + len * 4;
    const dir = i ? -1 : 1;
    const x = ((((t * (26 + i * 9) + i * span * 0.45) % span) + span) % span) - len * 2;
    const y = floorY + band * (0.28 + i * 0.16) + Math.sin(t * 0.9 + i) * band * 0.05;
    drawFish(ctx, i ? "guppy" : "tetra", dir > 0 ? x : w - x, y, len, dir, 0, Math.sin(t * 8 + i) * 0.2);
  }
  ctx.drawImage(floor.front, 0, floorY, w, band);
  ctx.restore();

  // The tank's trim: dark edges with a line of light where the glass meets them.
  ctx.save();
  ctx.fillStyle = "#16232a";
  ctx.fillRect(0, 0, w, 4);
  ctx.fillRect(0, 0, 4, h);
  ctx.fillRect(w - 4, 0, 4, h);
  ctx.fillStyle = "rgba(220,250,255,0.5)";
  ctx.fillRect(4, 4, 1.5, h - 4);
  ctx.fillRect(w - 5.5, 4, 1.5, h - 4);
  ctx.restore();
}

// ---- Globe view: the fishbowl ---------------------------------------------------------------------------------

interface Bowl {
  cx: number;
  cy: number;
  R: number;
  /** The bowl's centre and radius. */
  bx: number;
  by: number;
  B: number;
  /** Heights of the opening, the still waterline and the gravel's top. */
  yOpen: number;
  yWater: number;
  yGravel: number;
}

function bowlOf(cx: number, cy: number, R: number): Bowl {
  return { cx, cy, R, bx: cx, by: cy + R * 0.12, B: R * 1.5, yOpen: cy - R * 1.24, yWater: cy - R * 1.1, yGravel: cy + R * 1.36 };
}

const halfChord = (b: Bowl, y: number) => Math.sqrt(Math.max(0, b.B * b.B - (y - b.by) * (y - b.by)));

/** The bowl's glass below the opening, as the current path. */
function bowlPath(g: CanvasRenderingContext2D, b: Bowl) {
  const a = Math.asin((b.yOpen - b.by) / b.B);
  g.beginPath();
  g.arc(b.bx, b.by, b.B, a, Math.PI - a, false);
  g.closePath();
}

function bowlLayers(f: SurfaceFrame, cache: AquariumCache, b: Bowl) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}|${Math.round(b.cx)}|${Math.round(b.cy)}|${Math.round(b.R * 4)}`;
  if (cache.bowl?.key === key) return cache.bowl;
  const { bx, by, B, R } = b;

  // Behind: the table, the bowl's shadow, the glass's far side and the back of its lip.
  const [back, g] = offscreen(w, h, dpr);
  const tableY = by + B * 0.96;
  if (tableY < h) {
    const wood = g.createLinearGradient(0, tableY, 0, h);
    wood.addColorStop(0, "#c89a64");
    wood.addColorStop(0.08, "#a8763e");
    wood.addColorStop(1, "#6e4622");
    g.fillStyle = wood;
    g.fillRect(0, tableY, w, h - tableY);
    g.strokeStyle = "rgba(60,34,12,0.25)";
    g.lineWidth = 1;
    const rnd = seeded(17);
    for (let i = 0; i < 18; i++) {
      const y = tableY + 6 + rnd() * (h - tableY);
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 8, w * 0.6, y + (rnd() - 0.5) * 8, w, y + (rnd() - 0.5) * 6);
      g.stroke();
    }
    g.fillStyle = "rgba(255,230,190,0.5)";
    g.fillRect(0, tableY, w, 1.5);
  }
  const shadow = g.createRadialGradient(bx, tableY, 0, bx, tableY, B * 1.1);
  shadow.addColorStop(0, "rgba(20,40,40,0.35)");
  shadow.addColorStop(1, "rgba(20,40,40,0)");
  g.save();
  g.translate(bx, tableY);
  g.scale(1, 0.18);
  g.translate(-bx, -tableY);
  g.fillStyle = shadow;
  g.beginPath();
  g.arc(bx, tableY, B * 1.1, 0, Math.PI * 2);
  g.fill();
  g.restore();
  bowlPath(g, b);
  g.fillStyle = "rgba(215,245,255,0.14)";
  g.fill();
  const lipR = halfChord(b, b.yOpen);
  g.beginPath();
  g.ellipse(bx, b.yOpen, lipR, R * 0.1, 0, Math.PI, Math.PI * 2);
  g.strokeStyle = "rgba(200,240,250,0.5)";
  g.lineWidth = Math.max(2, R * 0.035);
  g.stroke();

  // The gravel in the bottom of the bowl, with a small treasure chest.
  const [grav, gg] = offscreen(w, h, dpr);
  gg.save();
  bowlPath(gg, b);
  gg.clip();
  gg.beginPath();
  gg.moveTo(bx - B, by + B);
  for (let x = bx - B; x <= bx + B; x += R * 0.08) gg.lineTo(x, b.yGravel + Math.sin((x - bx) / (R * 0.19)) * R * 0.025);
  gg.lineTo(bx + B, by + B);
  gg.closePath();
  gg.fillStyle = "#8a7656";
  gg.fill();
  gg.clip();
  gravel(gg, bx - B, 2 * B, b.yGravel - R * 0.03, by + B - b.yGravel, 23, false);
  gg.restore();
  chest(gg, bx + R * 0.5, b.yGravel + R * 0.04, R * 0.2);

  // In front: the glass's edge, its highlights and the front of the lip.
  const [front, fg] = offscreen(w, h, dpr);
  fg.save();
  bowlPath(fg, b);
  fg.clip();
  const edge = fg.createRadialGradient(bx, by, B * 0.86, bx, by, B);
  edge.addColorStop(0, "rgba(190,240,255,0)");
  edge.addColorStop(1, "rgba(190,240,255,0.32)");
  fg.fillStyle = edge;
  fg.fillRect(bx - B, by - B, B * 2, B * 2);
  fg.restore();
  const a = Math.asin((b.yOpen - by) / B);
  fg.beginPath();
  fg.arc(bx, by, B, a, Math.PI - a, false);
  fg.strokeStyle = "rgba(225,250,255,0.75)";
  fg.lineWidth = Math.max(1.5, R * 0.018);
  fg.stroke();
  fg.beginPath();
  fg.arc(bx, by, B - Math.max(2, R * 0.025), a, Math.PI - a, false);
  fg.strokeStyle = "rgba(20,90,110,0.3)";
  fg.lineWidth = 1;
  fg.stroke();
  fg.lineCap = "round";
  for (const [r, a0, a1, width, alpha] of [
    [0.93, 196, 236, 0.05, 0.5],
    [0.93, 241, 246, 0.05, 0.4],
    [0.9, 22, 52, 0.022, 0.3],
    [0.92, 315, 330, 0.02, 0.35],
  ] as const) {
    fg.beginPath();
    fg.arc(bx, by, B * r, a0 * DEG, a1 * DEG);
    fg.strokeStyle = `rgba(255,255,255,${alpha})`;
    fg.lineWidth = B * width;
    fg.stroke();
  }
  fg.beginPath();
  fg.ellipse(bx, b.yOpen, lipR, R * 0.1, 0, 0, Math.PI);
  fg.strokeStyle = "rgba(225,250,255,0.85)";
  fg.lineWidth = Math.max(2, R * 0.035);
  fg.stroke();
  fg.beginPath();
  fg.ellipse(bx, b.yOpen - R * 0.01, lipR * 0.9, R * 0.08, 0, 0.3, Math.PI * 0.55);
  fg.strokeStyle = "rgba(255,255,255,0.9)";
  fg.lineWidth = Math.max(1, R * 0.012);
  fg.stroke();

  cache.bowl = { key, back, gravel: grav, front };
  return cache.bowl;
}

/** A small wooden treasure chest half sunk in the gravel, the classic bowl ornament. It carries no symbol. */
function chest(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  g.lineJoin = "round";
  g.lineWidth = Math.max(1, s * 0.05);
  g.strokeStyle = "#3a2410";
  g.fillStyle = "#8a5a2c";
  g.beginPath();
  g.rect(-s * 0.6, -s * 0.5, s * 1.2, s * 0.6);
  g.fill();
  g.stroke();
  g.fillStyle = "#a8703a";
  g.beginPath();
  g.moveTo(-s * 0.6, -s * 0.5);
  g.bezierCurveTo(-s * 0.6, -s * 0.95, s * 0.6, -s * 0.95, s * 0.6, -s * 0.5);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#d9b24a";
  for (const bx of [-0.42, 0.38]) g.fillRect(bx * s, -s * 0.86, s * 0.1, s * 0.96);
  g.strokeRect(-0.42 * s, -s * 0.86, s * 0.1, s * 0.96);
  g.strokeRect(0.38 * s, -s * 0.86, s * 0.1, s * 0.96);
  g.fillRect(-s * 0.08, -s * 0.56, s * 0.16, s * 0.16);
  g.strokeRect(-s * 0.08, -s * 0.56, s * 0.16, s * 0.16);
  g.restore();
}

/** Fish round the globe: each swims back and forth along an arc of radius rho (in globe radii) about the globe. */
const BOWL_FISH: { kind: FishKind; rho: number; at: number; swing: number; speed: number; len: number }[] = [
  { kind: "goldfish", rho: 1.27, at: 90, swing: 48, speed: 0.22, len: 0.27 },
  { kind: "angel", rho: 1.3, at: 176, swing: 20, speed: 0.19, len: 0.22 },
  { kind: "tetra", rho: 1.19, at: 8, swing: 28, speed: 0.33, len: 0.14 },
  { kind: "guppy", rho: 1.33, at: 52, swing: 18, speed: 0.28, len: 0.17 },
  { kind: "tetra", rho: 1.17, at: 132, swing: 22, speed: 0.31, len: 0.13 },
];

function drawBowl(f: SurfaceFrame, cache: AquariumCache, theta: number) {
  const { ctx, proj } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const b = bowlOf(cx, cy, R);
  const t = motionTime();
  const layers = bowlLayers(f, cache, b);
  const { w, h } = f;
  // The static layers are copied only where they have something: round the bowl, and the table below it.
  const x0 = b.bx - b.B * 1.12, x1 = b.bx + b.B * 1.12, top = b.yOpen - R * 0.15, foot = b.by + b.B * 1.25;
  const table = b.by + b.B * 0.96 - 2;
  drawPart(f, layers.back, x0, top, x1, table);
  drawPart(f, layers.back, 0, table, w, h);

  // The water, level under a tilted line through the still waterline.
  const tan = Math.tan(theta);
  const surf = (x: number) => b.yWater + (x - cx) * tan;
  ctx.save();
  bowlPath(ctx, b);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - b.B * 1.2, surf(cx - b.B * 1.2));
  ctx.lineTo(cx + b.B * 1.2, surf(cx + b.B * 1.2));
  ctx.lineTo(cx + b.B * 1.2, b.by + b.B);
  ctx.lineTo(cx - b.B * 1.2, b.by + b.B);
  ctx.closePath();
  const water = ctx.createLinearGradient(0, b.yWater, 0, b.by + b.B);
  water.addColorStop(0, "rgba(96,204,218,0.55)");
  water.addColorStop(1, "rgba(18,104,122,0.7)");
  ctx.fillStyle = water;
  ctx.fill();
  ctx.clip();
  drawCaustics(ctx, cache, cx - b.B, b.yWater, b.B * 2, b.B * 2.2, t, 0.08);

  // Plants on the left, behind the gravel's front, then the gravel and the chest.
  plants(ctx, cx - R * 0.58, b.yGravel + R * 0.06, R * 0.34, 5, 31, t, ["#3f8f3a", "#5aae48", "#2f7a3a"]);
  leafPlant(ctx, cx + R * 0.7, b.yGravel + R * 0.04, R * 0.3, t);
  drawPart(f, layers.gravel, b.bx - b.B, b.yGravel - R * 0.3, b.bx + b.B, b.by + b.B);

  // Bubbles from the chest and from a stone on the left, rising round the globe to the surface.
  const rho = R * 1.2;
  ctx.lineWidth = Math.max(0.8, R * 0.006);
  for (const [side, seed] of [
    [1, 0],
    [-1, 0.37],
  ] as const) {
    const y0 = b.yGravel - R * 0.08;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = (t * 0.05 + seed + i / n) % 1;
      const y = y0 + (b.yWater - y0) * p;
      const dy = y - cy;
      const along = Math.sqrt(Math.max(0, rho * rho - dy * dy));
      const x = cx + side * Math.max(R * 0.55, along) + Math.sin(p * 14 + i) * R * 0.02;
      if (y < surf(x) + R * 0.02) continue;
      const rb = R * (0.014 + 0.014 * p) * (0.8 + (i % 3) * 0.2);
      const fade = Math.min(1, p * 8, (1 - p) * 10);
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(x, y, rb, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(235,255,255,0.85)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - rb * 0.3, y - rb * 0.3, rb * 0.35, Math.PI, Math.PI * 1.5);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Fish swimming round the globe, never over it.
  for (const [i, fish] of BOWL_FISH.entries()) {
    const ph = t * fish.speed * 2 + i * 2.1;
    const phi = (fish.at + fish.swing * Math.sin(ph)) * DEG;
    const dphi = Math.cos(ph);
    const r = R * fish.rho;
    const x = cx + r * Math.cos(phi);
    const y = cy + r * Math.sin(phi);
    const vx = -Math.sin(phi) * dphi;
    const vy = Math.cos(phi) * dphi;
    // It faces the way it swims across the screen, and turns round at each end of its swim.
    const across = Math.sin(fish.at * DEG) > 0 ? -1 : 1;
    const face = clamp(dphi * across * 3, -1, 1);
    const tilt = clamp(Math.sign(face) * Math.atan2(vy, Math.abs(vx) + 1e-6), -0.55, 0.55);
    drawFish(ctx, fish.kind, x, y, Math.min(R * fish.len, 90), face, tilt, Math.sin(t * 7 + i) * 0.22);
  }
  ctx.restore();

  // The world itself, floating in the middle of the bowl.
  cache.world.draw(f, (g) => paintWorld(f, cache, g));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  drawCaustics(ctx, cache, cx - R, cy - R, R * 2, R * 2, t, 0.07);
  ctx.restore();

  // The surface, seen a little from above: a bright ellipse tilting with the slosh.
  const rx = halfChord(b, b.yWater);
  const ry = R * 0.085 * (1 + 0.06 * Math.sin(t * 1.4));
  ctx.save();
  bowlPath(ctx, b);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx, b.yWater, rx, ry, theta, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(205,250,255,0.3)";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, b.yWater, rx, ry, theta, 0, Math.PI);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(1.2, R * 0.01);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, b.yWater, rx, ry, theta, Math.PI, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.stroke();
  ctx.restore();

  drawPart(f, layers.front, x0, top, x1, foot);
}
