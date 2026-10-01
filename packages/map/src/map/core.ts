// Green Core (id core): after the feel of an early-2000s black and green console dashboard, and nothing else from
// it: no maker's names, logos, shapes, sounds, menus or art, and no text. A dark green room with thick translucent
// tubes lit from within curving through it, and at its centre a glowing orb with energy swirling slowly inside.
//
// Globe view: the globe is the orb. Its sea is dark green glass with the energy turning in it, its land lit green
// with a soft glow along every coast, a halo round it. The tubes are drawn behind the orb, so they never cross it
// or a place on it. Map view: the world on a dark green glowing panel inside a rounded bezel that is itself a lit
// tube; places outside the bezel are neither drawn nor tuned.
//
// What moves (the energy, light running along the tubes, a slow hum in the halo) asks for eight frames a second
// through ambient.ts, never for reduced motion or in a hidden tab, and the world is kept in a still layer so a frame
// of motion redraws only what moves. Each moving light adds less than a tenth of the brightness scale where it
// passes, so nothing can flash. When the page loads, the picture lights up from dark once, over less than two
// seconds, evenly in brightness (`bootShade`, tested in test/core.test.ts); never for reduced motion. Markers are
// drawn by the view after all of this, so the light never dims, moves or covers one.

import { geoGraticule, geoPath } from "d3-geo";
import { motionTime, stillMotion, StillLayer } from "./ambient.ts";
import { offscreen, pathContext, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

export type RGB = [number, number, number];

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const GRID = geoGraticule().step([15, 15])();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

/**
 * The colours of the large lit areas, kept here so the test can check the opening never brightens any of them
 * faster than the no-flash limit.
 */
export const CORE = {
  /** The sea at the orb's middle, where the energy is brightest, and at its rim. */
  seaCore: [16, 92, 44] as RGB,
  sea: [6, 44, 22] as RGB,
  seaRim: [2, 22, 11] as RGB,
  /** The land's lit top, brightest toward the middle of the orb, and its shade toward the rim. */
  land: [56, 194, 90] as RGB,
  landShade: [26, 112, 54] as RGB,
  /** Polar ice: a pale lit green, still dim enough for the opening to bring it up slowly. */
  ice: [110, 200, 130] as RGB,
  /** The inside of a tube, and its lit middle (the inside with its inner glow added), not counting the thin filament. */
  tube: [26, 96, 48] as RGB,
  tubeLit: [39, 144, 70] as RGB,
  /** The energy and the pulses, added on top ("lighter"). */
  energy: [70, 255, 120] as RGB,
  pulse: [150, 255, 175] as RGB,
};

/**
 * The most the energy adds to a pixel of sea before its fade: one arm turning each way crossing there, each with all
 * its layers (0.16 and 0.08). Arms start a third of the way out, where those turning the same way are too far apart
 * to overlap.
 */
export const ENERGY_ALPHA = 0.24;

/**
 * How strong the energy is from the orb's centre (0) to its rim (1), as gradient stops. It is held back at the bright
 * core and strongest across the middle of the sea, where the glass is dark, so it reads as light moving in the glass
 * while adding the same small step of brightness everywhere.
 */
export const ENERGY_FADE: readonly (readonly [number, number])[] = [
  [0, 0.45],
  [0.4, 0.75],
  [0.62, 1],
  [0.88, 0.8],
  [1, 0],
];

/** The sea's gradient, centre to rim, as stops; `seaAt` reads it for the test. */
export const SEA_STOPS: readonly (readonly [number, RGB])[] = [
  [0, CORE.seaCore],
  [0.55, CORE.sea],
  [1, CORE.seaRim],
];

/** Linear interpolation through gradient stops at `s` (0 to 1). */
export function stopAt<T extends number | RGB>(stops: readonly (readonly [number, T])[], s: number): T {
  for (let i = 1; i < stops.length; i++) {
    const [s1, v1] = stops[i]!;
    const [s0, v0] = stops[i - 1]!;
    if (s <= s1) {
      const u = (s - s0) / (s1 - s0 || 1);
      if (typeof v0 === "number") return (v0 + ((v1 as number) - v0) * u) as T;
      return (v0 as RGB).map((c, k) => c + ((v1 as RGB)[k]! - c) * u) as T;
    }
  }
  return stops[stops.length - 1]![1];
}
/** The most a pulse of light running along a tube adds to it. */
export const PULSE_ALPHA = 0.1;

// ---- the opening -------------------------------------------------------------------------------------------------

/** Seconds the opening takes, from dark to fully lit: under two, once per page load. */
export const BOOT_S = 1.8;
/** How lit the picture is when the opening starts, as a share of its brightness: all but dark. */
const BOOT_FROM = 0.03;

/**
 * How lit the picture is `t` seconds into the opening, as a share of its full brightness (relative luminance),
 * rising evenly so no third of a second brightens it by more than a small step. 1 for reduced motion.
 */
export function bootLight(t: number, still = false): number {
  if (still) return 1;
  const u = clamp(t / BOOT_S, 0, 1);
  return BOOT_FROM + (1 - BOOT_FROM) * u;
}

/**
 * What every sRGB channel is multiplied by to reach `bootLight`: luminance follows the channels to about the power
 * 2.2, so the channels rise by the inverse, and brightness, not paint, rises evenly.
 */
export function bootShade(t: number, still = false): number {
  return Math.pow(bootLight(t, still), 1 / 2.2);
}

/** When the picture was first drawn on this page, so the opening plays once per load and not on every redraw. */
let bootStart: number | null = null;

function bootNow(still: boolean): number {
  if (still) return 1;
  const now = performance.now();
  bootStart ??= now;
  return bootShade((now - bootStart) / 1000);
}

// ---- the slow hum ------------------------------------------------------------------------------------------------

/** The halo's breathing, 0 to 1, once every eight seconds: the dashboard's hum, seen rather than heard. */
export function hum(t: number): number {
  return 0.5 + 0.5 * Math.sin((TAU * t) / 8);
}

// ---- the tubes ---------------------------------------------------------------------------------------------------

/** A tube's centre line as a cubic curve across the frame, with its thickness as a share of the orb's radius. */
interface Tube {
  /** Four points, (x, y) as shares of the frame's width and height, with the orb's centre at (0.5, 0.5). */
  p: [number, number, number, number, number, number, number, number];
  width: number;
  /** Seconds for a pulse of light to run its length, and where along it the pulse starts. */
  period: number;
  phase: number;
}

/**
 * The tubes through the room. Each comes in from an edge and either runs into the middle, behind the orb, or curves
 * round past it; the orb is drawn over them, so they never cross it. Set out in shares of the frame, so they fill a
 * wide window and a phone's tall one alike.
 */
const TUBES: Tube[] = [
  { p: [-0.06, 0.2, 0.22, 0.1, 0.28, 0.62, 0.5, 0.52], width: 0.16, period: 21, phase: 0.1 },
  { p: [0.5, 0.5, 0.72, 0.4, 0.76, 0.92, 1.06, 0.8], width: 0.16, period: 23, phase: 0.55 },
  { p: [0.56, -0.06, 0.58, 0.28, 0.86, 0.12, 1.06, 0.3], width: 0.11, period: 17, phase: 0.3 },
  { p: [-0.06, 0.86, 0.2, 0.66, 0.34, 1.0, 0.42, 1.06], width: 0.11, period: 19, phase: 0.8 },
  { p: [0.14, -0.06, 0.2, 0.3, 0.02, 0.42, -0.06, 0.6], width: 0.07, period: 15, phase: 0.45 },
  { p: [0.78, 1.06, 0.84, 0.64, 0.98, 0.62, 1.06, 0.54], width: 0.07, period: 16, phase: 0.7 },
];

function bez(a: number, b: number, c: number, d: number, s: number): number {
  const m = 1 - s;
  return m * m * m * a + 3 * m * m * s * b + 3 * m * s * s * c + s * s * s * d;
}

/** A tube's curve on screen in a frame w by h about the orb's centre (cx, cy), and its width from the orb's radius. */
function tubeAt(t: Tube, w: number, h: number, cx: number, cy: number, R: number) {
  const q = t.p.map((v, i) => (i % 2 ? cy + (v - 0.5) * h : cx + (v - 0.5) * w));
  return {
    path() {
      const p = new Path2D();
      p.moveTo(q[0]!, q[1]!);
      p.bezierCurveTo(q[2]!, q[3]!, q[4]!, q[5]!, q[6]!, q[7]!);
      return p;
    },
    at(s: number): [number, number] {
      return [bez(q[0]!, q[2]!, q[4]!, q[6]!, s), bez(q[1]!, q[3]!, q[5]!, q[7]!, s)];
    },
    width: Math.max(7, t.width * R),
  };
}

/**
 * One glass tube lit from inside: a wide soft glow round it, a bright wall on each side, the darker translucent
 * inside, a lit filament down its middle and a highlight along its upper edge. Drawn once per size.
 */
function strokeTube(g: CanvasRenderingContext2D, p: Path2D, tw: number) {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalCompositeOperation = "lighter";
  for (const [k, a] of [
    [3.2, 0.035],
    [2.2, 0.05],
    [1.5, 0.07],
  ] as const) {
    g.lineWidth = tw * k;
    g.strokeStyle = rgba(CORE.energy, a);
    g.stroke(p);
  }
  g.globalCompositeOperation = "source-over";
  g.lineWidth = tw;
  g.strokeStyle = "rgba(120,255,150,0.55)";
  g.stroke(p);
  g.lineWidth = tw * 0.8;
  g.strokeStyle = rgba(CORE.tube, 0.9);
  g.stroke(p);
  g.globalCompositeOperation = "lighter";
  g.lineWidth = tw * 0.5;
  g.strokeStyle = "rgba(60,220,100,0.22)";
  g.stroke(p);
  g.lineWidth = Math.max(1.5, tw * 0.16);
  g.strokeStyle = "rgba(170,255,190,0.55)";
  g.stroke(p);
  g.globalCompositeOperation = "source-over";
  g.translate(-tw * 0.18, -tw * 0.2);
  g.lineWidth = Math.max(1, tw * 0.09);
  g.strokeStyle = "rgba(225,255,230,0.35)";
  g.stroke(p);
  g.restore();
}

/** A soft pulse of light at a point on a tube, added to what is there. */
function pulseAt(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const p = g.createRadialGradient(x, y, 0, x, y, r);
  p.addColorStop(0, rgba(CORE.pulse, PULSE_ALPHA));
  p.addColorStop(1, rgba(CORE.pulse, 0));
  g.fillStyle = p;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---- the energy ------------------------------------------------------------------------------------------------

/**
 * Energy turning slowly about (cx, cy) out to radius r: three wide soft arms one way and two fainter ones the other,
 * round the brighter glass at the core. Added to the dark sea with "lighter"; all its layers together add at most
 * `ENERGY_ALPHA` of the energy colour, so where an arm passes, brightness changes by only a small step.
 */
function energy(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, squash = 1) {
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  const fade = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [s, a] of ENERGY_FADE) fade.addColorStop(s, rgba(CORE.energy, a));
  g.strokeStyle = fade;
  const arms = (n: number, spin: number, turn: number, widths: readonly (readonly [number, number])[]) => {
    for (let a = 0; a < n; a++) {
      const rot = spin + (a * TAU) / n;
      const p = new Path2D();
      for (let k = 0; k <= 36; k++) {
        const s = k / 36;
        const ang = rot + s * turn;
        const rad = r * (0.3 + 0.7 * s);
        const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad * squash;
        if (k === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      for (const [k, alpha] of widths) {
        g.lineWidth = r * k;
        g.globalAlpha = alpha;
        g.stroke(p);
      }
    }
  };
  // One turn every 70 seconds one way, every 110 the other: slow enough to read as drifting, not spinning.
  arms(3, (t * TAU) / 70, 2.4, [
    [0.24, 0.035],
    [0.13, 0.05],
    [0.05, 0.075],
  ]);
  arms(2, (-t * TAU) / 110 + 1, -2.0, [
    [0.16, 0.03],
    [0.06, 0.05],
  ]);
  g.globalAlpha = 1;
  g.restore();
}

// ---- the land --------------------------------------------------------------------------------------------------

/** The land, lit green with a glow along every coast, over a transparent sea: a still layer over the moving energy. */
function paintLand(f: SurfaceFrame, g: CanvasRenderingContext2D, area: Path2D, cx: number, cy: number, R: number) {
  const { w, h, proj, theme: t, mode } = f;
  const globe = mode === "3d";
  const map = f.map;
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  g.save();
  g.clip(area);
  g.lineCap = "round";
  g.lineJoin = "round";
  // A faint display grid in the glass.
  g.strokeStyle = t.graticule;
  g.lineWidth = 0.7;
  g.stroke(path(GRID));

  const coast = path(map.coast);
  const lakes = path(map.lakes);
  // Lakes are holes in the land, so the dark glass and its energy show through them.
  const land = path(map.land);
  land.addPath(lakes);
  // The glow the land throws into the sea round it.
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = rgba(CORE.energy, 0.07);
  g.lineWidth = 12;
  g.stroke(coast);
  g.strokeStyle = rgba(CORE.energy, 0.09);
  g.lineWidth = 5;
  g.stroke(coast);
  g.globalCompositeOperation = "source-over";

  // The lit top: brighter toward the middle of the orb or the panel, where the light is.
  const reach = globe ? R : Math.max(w, h) * 0.7;
  const lit = g.createRadialGradient(cx, cy, reach * 0.1, cx, cy, reach * 1.02);
  lit.addColorStop(0, rgba(CORE.land, 1));
  lit.addColorStop(1, rgba(CORE.landShade, 1));
  g.fillStyle = lit;
  g.fill(land, "evenodd");
  if (map.ice) {
    g.fillStyle = rgba(CORE.ice, 1);
    g.fill(path(map.ice));
  }

  // The soft inner glow: light gathered along the coast inside the land, fading inland.
  g.save();
  g.clip(land, "evenodd");
  g.globalCompositeOperation = "lighter";
  for (const [lw, a] of [
    [11, 0.05],
    [6, 0.07],
    [2.5, 0.1],
  ] as const) {
    g.lineWidth = lw;
    g.strokeStyle = `rgba(150,255,175,${a})`;
    g.stroke(coast);
  }
  g.globalCompositeOperation = "source-over";
  // Mountains as soft lighter patches, never an outline.
  if (f.relief) {
    const s = clamp(R / 90, 2, 6);
    g.fillStyle = "rgba(200,255,210,0.07)";
    g.beginPath();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && !facing(f, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      g.moveTo(p[0] + s, p[1]);
      g.ellipse(p[0], p[1], s, s * 0.7, 0, 0, TAU);
    }
    g.fill();
  }
  g.restore();

  if (f.zoom >= 2) {
    g.strokeStyle = t.river;
    g.lineWidth = 0.8;
    g.stroke(path(map.rivers));
  }
  g.strokeStyle = t.coast;
  g.lineWidth = t.coastWidth;
  g.stroke(coast);
  g.lineWidth = t.coastWidth * 0.7;
  g.stroke(lakes);
  g.restore();
}

function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const a = lat * DEG, b = f.lat * DEG;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * DEG) > 0.05;
}

// ---- the cache ---------------------------------------------------------------------------------------------------

export class CoreCache {
  world = new StillLayer();
  /** Globe view: the tubes and the room's light behind the orb, and the glass over it; drawn once per size. */
  orb?: { key: string; back: HTMLCanvasElement; front: HTMLCanvasElement };
  /** Map view: the bezel, a lit tube round the panel, and the sheen on its glass, drawn once per size. */
  panel?: { key: string; frame: HTMLCanvasElement; area: Path2D; inset: number; tube: number };
  /** The dark glass and the energy in it, worked out at a third of the size: it is all soft light. */
  glass?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D };
}

export function drawCore(f: SurfaceFrame, cache: CoreCache): SurfaceResult | void {
  return f.mode === "3d" ? drawOrb(f, cache) : drawPanel(f, cache);
}

/** Lights the picture up from dark while the page opens: everything the surface drew, never the markers after it. */
function boot(f: SurfaceFrame) {
  const k = bootNow(stillMotion());
  if (k >= 0.999) return;
  const { ctx, w, h } = f;
  ctx.save();
  // Darken only what was drawn, so the room behind the canvas (CSS) is left as it is.
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(0,0,0,${1 - k})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * The dark glass with the energy turning in it, for the box (x, y, bw, bh) on screen: drawn at a third of the size
 * into a small canvas and enlarged smoothly, since wide soft strokes at full size would cost most of every frame.
 */
function drawGlass(f: SurfaceFrame, cache: CoreCache, box: [number, number, number, number], cx: number, cy: number, reach: number, squash: number) {
  const [x, y, bw, bh] = box;
  const gw = Math.max(4, Math.ceil(bw / 3)), gh = Math.max(4, Math.ceil(bh / 3));
  if (!cache.glass || cache.glass.canvas.width !== gw || cache.glass.canvas.height !== gh) {
    const canvas = document.createElement("canvas");
    canvas.width = gw;
    canvas.height = gh;
    cache.glass = { canvas, g: canvas.getContext("2d")! };
  }
  const { canvas, g } = cache.glass;
  g.setTransform(gw / bw, 0, 0, gh / bh, (-x * gw) / bw, (-y * gh) / bh);
  const sea = g.createRadialGradient(cx, cy, 0, cx, cy, reach);
  for (const [s, c] of SEA_STOPS) sea.addColorStop(s, rgba(c, 1));
  g.fillStyle = sea;
  g.fillRect(x, y, bw, bh);
  energy(g, cx, cy, reach * 0.98, motionTime(), squash);
  const { ctx } = f;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(canvas, x, y, bw, bh);
  ctx.restore();
}

// ---- Globe view: the orb -----------------------------------------------------------------------------------------

function orbLayers(f: SurfaceFrame, cache: CoreCache, cx: number, cy: number, R: number) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R * 4)}`;
  if (cache.orb?.key === key) return cache.orb;

  const [back, g] = offscreen(w, h, dpr);
  // The orb lights the room round it.
  const room = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 3.2);
  room.addColorStop(0, "rgba(40,190,80,0.2)");
  room.addColorStop(0.4, "rgba(20,120,50,0.08)");
  room.addColorStop(1, "rgba(10,60,25,0)");
  g.fillStyle = room;
  g.fillRect(0, 0, w, h);
  for (const t of TUBES) {
    const tube = tubeAt(t, w, h, cx, cy, R);
    strokeTube(g, tube.path(), tube.width);
  }
  // Where the tubes run behind the orb, they fade into its glow rather than stopping at a hard edge.
  const veil = g.createRadialGradient(cx, cy, R, cx, cy, R * 1.3);
  veil.addColorStop(0, "rgba(3,16,8,0.6)");
  veil.addColorStop(1, "rgba(3,16,8,0)");
  g.fillStyle = veil;
  g.beginPath();
  g.arc(cx, cy, R * 1.3, 0, TAU);
  g.fill();

  // In front: the glass of the orb. Light gathers at its rim, a soft highlight sits upper left, and a bright edge.
  const [front, fg] = offscreen(w, h, dpr);
  fg.save();
  fg.beginPath();
  fg.arc(cx, cy, R, 0, TAU);
  fg.clip();
  const rim = fg.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
  rim.addColorStop(0, "rgba(70,255,120,0)");
  rim.addColorStop(0.85, "rgba(70,255,120,0.1)");
  rim.addColorStop(1, "rgba(120,255,160,0.32)");
  fg.fillStyle = rim;
  fg.fillRect(cx - R, cy - R, R * 2, R * 2);
  fg.translate(cx - R * 0.38, cy - R * 0.52);
  fg.rotate(-0.5);
  fg.scale(1, 0.5);
  const spec = fg.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
  spec.addColorStop(0, "rgba(230,255,235,0.26)");
  spec.addColorStop(1, "rgba(230,255,235,0)");
  fg.fillStyle = spec;
  fg.fillRect(-R * 0.5, -R * 0.5, R, R);
  fg.restore();
  fg.beginPath();
  fg.arc(cx, cy, R, 0, TAU);
  fg.lineWidth = Math.max(1.5, R * 0.008);
  fg.strokeStyle = "rgba(170,255,190,0.85)";
  fg.stroke();

  cache.orb = { key, back, front };
  return cache.orb;
}

function drawOrb(f: SurfaceFrame, cache: CoreCache) {
  const { ctx, w, h, proj } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const t = motionTime();
  const layers = orbLayers(f, cache, cx, cy, R);
  ctx.drawImage(layers.back, 0, 0, w, h);

  // Light running slowly along the tubes, behind the orb (drawn before it, so the orb covers any that pass behind).
  if (!stillMotion()) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const tb of TUBES) {
      const tube = tubeAt(tb, w, h, cx, cy, R);
      const s = (t / tb.period + tb.phase) % 1;
      const [x, y] = tube.at(s);
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
      pulseAt(ctx, x, y, tube.width * 1.6);
    }
    ctx.restore();
  }

  // The halo, breathing with the hum: a ring round the orb only, since the orb covers the rest.
  const glow = 0.3 + 0.06 * hum(t);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.32);
  halo.addColorStop(0, rgba(CORE.energy, glow));
  halo.addColorStop(0.35, rgba(CORE.energy, glow * 0.35));
  halo.addColorStop(1, rgba(CORE.energy, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.32, 0, TAU);
  ctx.arc(cx, cy, R * 0.98, 0, TAU, true);
  ctx.fill();

  // The sea: dark green glass, brighter at the core, with the energy turning in it.
  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, TAU);
  const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
  const x1 = Math.min(w, cx + R), y1 = Math.min(h, cy + R);
  if (x1 > x0 && y1 > y0) {
    ctx.save();
    ctx.clip(sphere);
    drawGlass(f, cache, [x0, y0, x1 - x0, y1 - y0], cx, cy, R, 1);
    ctx.restore();
  }

  // The land and the orb's glass over it change only when the view moves: one still layer, copied for the orb only.
  cache.world.draw(
    f,
    (g) => {
      paintLand(f, g, sphere, cx, cy, R);
      g.drawImage(layers.front, 0, 0, w, h);
    },
    [cx - R - 2, cy - R - 2, cx + R + 2, cy + R + 2],
  );
  boot(f);
}

// ---- Map view: the panel -----------------------------------------------------------------------------------------

function panelFrame(f: SurfaceFrame, cache: CoreCache) {
  const { w, h, dpr } = f;
  const key = `${w}|${h}|${dpr}`;
  if (cache.panel?.key === key) return cache.panel;
  const small = Math.min(w, h) < 420;
  const tube = small ? 8 : 12;
  const inset = (small ? 6 : 12) + tube / 2;
  const radius = clamp(Math.min(w, h) * 0.06, 16, 34);
  const area = new Path2D();
  area.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
  const [frame, g] = offscreen(w, h, dpr);
  // A soft sheen across the top of the glass, then the bezel round it.
  g.save();
  g.clip(area);
  const sheen = g.createLinearGradient(0, inset, 0, h * 0.4);
  sheen.addColorStop(0, "rgba(200,255,215,0.09)");
  sheen.addColorStop(1, "rgba(200,255,215,0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h * 0.4);
  g.restore();
  strokeTube(g, area, tube);
  cache.panel = { key, frame, area, inset, tube };
  return cache.panel;
}

function drawPanel(f: SurfaceFrame, cache: CoreCache): SurfaceResult {
  const { ctx, w, h } = f;
  const t = motionTime();
  const panel = panelFrame(f, cache);
  const cx = w / 2, cy = h / 2;
  const reach = Math.max(w, h) * 0.75;
  ctx.save();
  ctx.clip(panel.area);
  // The energy turns behind the whole panel, flattened to its shape.
  drawGlass(f, cache, [0, 0, w, h], cx, cy, reach, Math.min(1, h / w + 0.2));
  ctx.restore();
  // The land, the sheen and the bezel change only when the view moves, so they are one still layer.
  cache.world.draw(f, (g) => {
    paintLand(f, g, panel.area, cx, cy, reach);
    g.drawImage(panel.frame, 0, 0, w, h);
  });
  // Light running round the bezel, two pulses half the frame apart.
  if (!stillMotion()) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const per = 2 * (w + h - panel.inset * 4);
    for (const off of [0, 0.5]) {
      const [x, y] = alongFrame(((t / 26 + off) % 1) * per, panel.inset, w, h);
      pulseAt(ctx, x, y, panel.tube * 1.8);
    }
    ctx.restore();
  }
  boot(f);
  const m = panel.inset + panel.tube * 0.7;
  return { inside: (x, y) => x > m && y > m && x < w - m && y < h - m, clip: panel.area };
}

/** A point `d` pixels round the bezel clockwise from its top left (corners taken square; the pulse is soft). */
function alongFrame(d: number, inset: number, w: number, h: number): [number, number] {
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const top = x1 - x0, side = y1 - y0;
  if (d < top) return [x0 + d, y0];
  d -= top;
  if (d < side) return [x1, y0 + d];
  d -= side;
  if (d < top) return [x1 - d, y1];
  d -= top;
  return [x0, y1 - Math.min(d, side)];
}
