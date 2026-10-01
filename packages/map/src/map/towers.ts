// Crystal Towers (id towers, experimental): after the feel of an early-2000s black console's system menu, and nothing
// else from it: no maker's or console's name, logo, button shapes, sounds, characters, menu text or art. A dark
// blue-black void with soft haze; small clear cubes drifting slowly through it; towers of clear cubes standing on a
// dark reflective floor, each rising very slowly a cube at a time while its top cube fades. In Globe view the world
// floats among the towers as a dark glassy sphere with pale blue land and a soft glow; in Map view it is a glowing
// glass plate with the towers standing at its sides.
//
// The towers and cubes are decoration only. Where they stand and how tall they are is fixed by the list below and the
// frame's size, never by data, so no tower stands for a place, a count or a story. They keep clear of the globe and the
// plate, and the drifting cubes pass behind the world, so nothing is ever drawn over a place; the view draws markers
// last, and nothing here moves them. Once per page load the towers rise out of the floor, in under two seconds, skipped
// by any touch, key or wheel, and not at all for readers who ask for reduced motion, for whom everything holds still.
// Light changes slowly over small areas, so nothing flashes.

import { geoGraticule, geoPath } from "d3-geo";
import { drawPart, motionTime, StillLayer } from "./ambient.ts";
import { offscreen, pathContext, seeded, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([20, 20])();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

/** The cube's depth as drawn (its top and side), as a share of its side. */
const DEPTH = 0.32;
/** A cube's height plus the small gap above it, in sides, so the cubes in a tower read apart. */
const STEP = 1.06;

/** Milliseconds between frames while the towers rise, then for the slow drift (about 30 and 10 a second). */
export const OPEN_FRAME_MS = 33;
export const DRIFT_FRAME_MS = 100;
/** Seconds each tower takes to rise out of the floor, and the latest any tower starts. The opening ends by OPEN_S. */
export const RISE_S = 1.3;
export const RISE_DELAY_MAX = 0.4;
export const OPEN_S = 1.8;

/**
 * Where the towers stand, a fixed list: the side of the world (left or right), how far out from the globe's edge or
 * the plate's side in cube widths, how deep on the floor (0 by the horizon, 1 at the front) and how many cubes high.
 * Pure decoration; a tower too close to the world is cut shorter or left out (`placeTowers`).
 */
export const TOWERS: readonly { side: -1 | 1; off: number; z: number; n: number }[] = [
  { side: -1, off: 1.3, z: 0.04, n: 7 },
  { side: -1, off: 2.5, z: 0.0, n: 9 },
  { side: -1, off: 3.8, z: 0.22, n: 5 },
  { side: -1, off: 5.6, z: 0.08, n: 10 },
  { side: -1, off: 2.0, z: 0.56, n: 4 },
  { side: -1, off: 7.2, z: 0.4, n: 7 },
  { side: -1, off: 4.6, z: 0.82, n: 3 },
  { side: -1, off: 9.4, z: 0.66, n: 6 },
  { side: 1, off: 1.5, z: 0.1, n: 8 },
  { side: 1, off: 2.9, z: 0.0, n: 10 },
  { side: 1, off: 4.3, z: 0.3, n: 6 },
  { side: 1, off: 2.3, z: 0.62, n: 4 },
  { side: 1, off: 6.1, z: 0.16, n: 9 },
  { side: 1, off: 7.9, z: 0.5, n: 6 },
  { side: 1, off: 5.2, z: 0.86, n: 3 },
  { side: 1, off: 9.8, z: 0.3, n: 5 },
];

/** Map view's towers: a few each side of the plate, in its margins, where there's room on a wide screen. */
export const PLATE_TOWERS: readonly { side: -1 | 1; off: number; z: number; n: number }[] = [
  { side: -1, off: 1.3, z: 0.08, n: 10 },
  { side: -1, off: 2.7, z: 0.36, n: 6 },
  { side: -1, off: 1.6, z: 0.78, n: 4 },
  // The right side keeps to the back, clear of the zoom buttons in the frame's lower right.
  { side: 1, off: 1.4, z: 0.04, n: 11 },
  { side: 1, off: 2.8, z: 0.3, n: 7 },
];

/** The corner the zoom buttons take, with their margin, which towers keep out of. */
export const ZOOM_W = 60;
export const ZOOM_H = 100;

/** What the towers keep clear of: the globe's disc, or the map's plate. */
export type Hole = { kind: "disc"; cx: number; cy: number; r: number } | { kind: "rect"; x0: number; y0: number; x1: number; y1: number };

/** A tower as placed in a frame: its front's centre and base on screen, its cube size, height and timing. */
export interface Tower {
  x: number;
  base: number;
  c: number;
  n: number;
  /** Fainter toward the horizon, as if in haze. */
  alpha: number;
  /** Seconds to rise by one cube, and where in that rise it starts. */
  period: number;
  phase: number;
  /** Seconds after the opening starts that it begins to rise out of the floor. */
  delay: number;
}

/** Map view's plate: the world as a glass plate inset in the frame, with room at the sides for towers on wide screens. */
export function plateOf(w: number, h: number): { x0: number; y0: number; x1: number; y1: number; r: number } {
  const wide = w >= 700;
  const mx = wide ? Math.round(clamp(w * 0.1, 64, 150)) : 10;
  const my = wide ? 16 : 10;
  const mb = wide ? Math.round(clamp(h * 0.1, 36, 84)) : 10;
  return { x0: mx, y0: my, x1: w - mx, y1: h - mb, r: wide ? 14 : 10 };
}

/** The floor's horizon: a little below the globe's centre, or a third of the way up the plate. */
export function horizonOf(h: number, hole: Hole): number {
  return hole.kind === "disc" ? Math.min(h * 0.94, hole.cy + hole.r * 0.15) : hole.y1 - (hole.y1 - hole.y0) * 0.3;
}

/**
 * Everything a tower of n cubes ever draws: its cubes with their tops and sides, the top cube as it rises a step and
 * fades, and the reflection below the floor.
 */
export function towerBox(t: Pick<Tower, "x" | "base" | "c">, n: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: t.x - t.c / 2 - 2, y0: t.base - (n + 1) * t.c * STEP - t.c * DEPTH - 2, x1: t.x + t.c / 2 + t.c * DEPTH + 2, y1: t.base + REFLECT * t.c * STEP };
}

/** How many cubes deep the reflection reaches below the floor. */
const REFLECT = 3;

/** Whether a box comes within `gap` pixels of the hole. */
export function nearHole(b: { x0: number; y0: number; x1: number; y1: number }, hole: Hole, gap: number): boolean {
  if (hole.kind === "rect") return b.x1 > hole.x0 - gap && b.x0 < hole.x1 + gap && b.y1 > hole.y0 - gap && b.y0 < hole.y1 + gap;
  const nx = clamp(hole.cx, b.x0, b.x1), ny = clamp(hole.cy, b.y0, b.y1);
  return Math.hypot(nx - hole.cx, ny - hole.cy) < hole.r + gap;
}

/**
 * The towers for a frame. Each stands on the floor beside the world, sized by its depth; one that would come near the
 * globe or the plate is cut shorter, and left out below two cubes, as is one that would leave the frame. The same
 * frame always gets the same towers.
 */
export function placeTowers(w: number, h: number, hole: Hole): Tower[] {
  const yh = horizonOf(h, hole);
  let c0: number;
  if (hole.kind === "disc") c0 = clamp(Math.min(w, h) * 0.042, 9, 30);
  else {
    if (hole.x0 < 40) return [];
    c0 = clamp(hole.x0 * 0.26, 8, 30);
  }
  const rnd = seeded(41);
  const out: Tower[] = [];
  for (const s of hole.kind === "disc" ? TOWERS : PLATE_TOWERS) {
    const period = 6 + rnd() * 4, phase = rnd(), delay = rnd() * RISE_DELAY_MAX;
    const k = 0.5 + 0.6 * s.z;
    const c = c0 * k;
    const base = yh + (h - 6 - yh) * (0.06 + 0.9 * s.z);
    const edge = hole.kind === "disc" ? hole.cx + s.side * hole.r : s.side < 0 ? hole.x0 : hole.x1;
    // Nearer towers spread a little wider, as the floor does in perspective.
    const x = edge + s.side * c0 * s.off * (hole.kind === "disc" ? 0.75 + 0.5 * s.z : 1);
    const t = { x, base, c };
    const gap = hole.kind === "disc" ? Math.max(6, hole.r * 0.05) : 8;
    let n = s.n;
    while (n >= 2 && (nearHole(towerBox(t, n), hole, gap) || towerBox(t, n).y0 < 4)) n--;
    const box = towerBox(t, n);
    if (n < 2 || box.x0 < 0 || box.x1 > w || base > h) continue;
    // The zoom buttons sit in the frame's lower right; a tower behind them would only clutter them.
    if (box.x1 > w - ZOOM_W && box.y1 > h - ZOOM_H) continue;
    out.push({ x, base, c, n, alpha: 0.55 + 0.45 * s.z, period, phase, delay });
  }
  // Far towers first, so nearer ones stand in front of them.
  return out.sort((a, b) => a.base - b.base);
}

/** How far a tower has risen through its current cube, 0 to 1: one cube every `period` seconds. */
export function risePhase(t: Pick<Tower, "period" | "phase">, time: number): number {
  const p = time / t.period + t.phase;
  return p - Math.floor(p);
}

/** How much of a tower has come up out of the floor during the opening, 0 to 1. */
export function riseOf(t: Pick<Tower, "delay">, since: number): number {
  return easeOut((since - t.delay) / RISE_S);
}

/** Small cubes drifting through the void: fixed starting points, slow drifts and turns. */
const MOTES = (() => {
  const rnd = seeded(23);
  return Array.from({ length: 22 }, () => ({
    u: rnd(),
    v: rnd(),
    vx: (rnd() - 0.5) * 0.016,
    vy: -0.003 - rnd() * 0.006,
    size: 8 + rnd() * 10,
    // Each sways a little about a slight lean and never turns far, so it reads as a cube seen in depth, never as a
    // diamond like the markers.
    turn: (rnd() - 0.5) * 0.5,
    sway: 0.1 + rnd() * 0.15,
    rate: 0.15 + rnd() * 0.2,
    ph: rnd() * Math.PI * 2,
    alpha: 0.5 + rnd() * 0.4,
  }));
})();

export class TowersCache {
  world = new StillLayer();
  /** The floor, its haze and the light under the world, and in Map view the plate's glow and rim: one per frame size. */
  floor?: { key: string; canvas: HTMLCanvasElement; top: number };
  towers?: { key: string; list: Tower[] };
  sprite?: HTMLCanvasElement;
  mote?: HTMLCanvasElement;
  /** When the opening began (performance.now), once per page load, and whether the reader cut it short. */
  openedAt = -1;
  skipped = false;
  private stop?: () => void;

  /** Seconds since the opening began, or Infinity once it is over, skipped or not shown (reduced motion). */
  opening(still: boolean): number {
    if (still || this.skipped) return Infinity;
    if (this.openedAt < 0) {
      this.openedAt = performance.now();
      const skip = () => {
        this.skipped = true;
        this.stop?.();
      };
      const opts = { passive: true, capture: true } as const;
      addEventListener("pointerdown", skip, opts);
      addEventListener("keydown", skip, opts);
      addEventListener("wheel", skip, opts);
      this.stop = () => {
        removeEventListener("pointerdown", skip, opts);
        removeEventListener("keydown", skip, opts);
        removeEventListener("wheel", skip, opts);
        this.stop = undefined;
      };
    }
    const s = (performance.now() - this.openedAt) / 1000;
    if (s < OPEN_S) return s;
    this.stop?.();
    return Infinity;
  }
}

/** One clear cube seen a little from above and to the right, drawn once and stamped everywhere. */
const SPRITE_S = 96;
const SPRITE_PAD = 4;
function cubeSprite(): HTMLCanvasElement {
  const S = SPRITE_S, d = S * DEPTH, p = SPRITE_PAD;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(S + d + p * 2);
  const g = c.getContext("2d")!;
  g.translate(p, p);
  const poly = (pts: number[][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!)));
    g.closePath();
  };
  // The side, the top, then the front: clear glass lit from inside, the front catching the most light.
  poly([[S, d], [S + d, 0], [S + d, S], [S, S + d]]);
  g.fillStyle = "rgba(80,130,225,0.3)";
  g.fill();
  poly([[0, d], [d, 0], [S + d, 0], [S, d]]);
  g.fillStyle = "rgba(190,220,255,0.3)";
  g.fill();
  const front = g.createLinearGradient(0, d, S * 0.7, S + d);
  front.addColorStop(0, "rgba(185,218,255,0.5)");
  front.addColorStop(0.5, "rgba(120,170,245,0.3)");
  front.addColorStop(1, "rgba(90,140,235,0.4)");
  g.fillStyle = front;
  g.fillRect(0, d, S, S);
  // Edges: bright down the front's sides, softer across the top and behind, so a stack reads as cubes, not slats.
  g.lineJoin = "round";
  g.lineWidth = 2;
  g.strokeStyle = "rgba(190,220,255,0.35)";
  poly([[0, d], [d, 0], [S + d, 0], [S + d, S], [S, S + d]]);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(225,240,255,0.8)";
  g.strokeRect(1.5, d + 1.5, S - 3, S - 3);
  // A glint on the front's upper left.
  const glint = g.createRadialGradient(S * 0.25, d + S * 0.22, 0, S * 0.25, d + S * 0.22, S * 0.45);
  glint.addColorStop(0, "rgba(255,255,255,0.4)");
  glint.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glint;
  g.fillRect(0, d, S, S);
  return c;
}

/** A drifting cube: the same cube in a soft glow of its own, so it reads as light in the dark, not a stone. */
function moteSprite(cubeImg: HTMLCanvasElement): HTMLCanvasElement {
  const n = cubeImg.width * 2;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const glow = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  glow.addColorStop(0, "rgba(150,200,255,0.55)");
  glow.addColorStop(0.35, "rgba(120,175,255,0.18)");
  glow.addColorStop(1, "rgba(110,165,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, n, n);
  g.drawImage(cubeImg, n / 4, n / 4);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.6;
  g.drawImage(cubeImg, n / 4, n / 4);
  return c;
}

/** Stamps a cube of side c with its front's lower left corner at (x, y). */
function cube(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, c: number) {
  const k = c / SPRITE_S;
  ctx.drawImage(sprite, x - SPRITE_PAD * k, y - c - (SPRITE_S * DEPTH + SPRITE_PAD) * k, sprite.width * k, sprite.height * k);
}

/**
 * A tower and its reflection in the floor. It rises one cube every `period` seconds: a new cube comes up out of the
 * floor as the top one fades, so its height holds. During the opening the whole tower comes up out of the floor.
 */
function drawTower(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, t: Tower, time: number, rise: number) {
  if (rise <= 0) return;
  const step = t.c * STEP;
  const p = risePhase(t, time);
  const sink = (1 - rise) * (t.n + 1) * step;
  const x = t.x - t.c / 2;
  // Clipped to the box placeTowers kept clear of the world, so nothing drawn here can reach it.
  const box = towerBox(t, t.n);
  const at = (k: number) => t.base - (k + p) * step + sink;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x0, box.y0, box.x1 - box.x0, t.base - box.y0);
  ctx.clip();
  // Brightest at the floor, fading a little toward the top as if into the haze.
  for (let k = -1; k < t.n; k++) {
    const up = clamp((k + p) / t.n, 0, 1);
    ctx.globalAlpha = t.alpha * (1 - 0.45 * up) * (k === t.n - 1 ? 1 - p : 1);
    cube(ctx, sprite, x, at(k), t.c);
  }
  ctx.restore();

  // The reflection: the lowest cubes mirrored in the floor, fading with depth.
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x0, t.base, box.x1 - box.x0, box.y1 - t.base);
  ctx.clip();
  ctx.translate(0, 2 * t.base);
  ctx.scale(1, -1);
  for (let k = -1; k < Math.min(REFLECT, t.n); k++) {
    ctx.globalAlpha = t.alpha * 0.2 * (1 - (k + 1) / (REFLECT + 1));
    cube(ctx, sprite, x, at(k), t.c);
  }
  ctx.restore();
}

/** The small cubes drifting through the void, behind the world. They fade in and settle during the opening. */
function drawMotes(f: SurfaceFrame, sprite: HTMLCanvasElement, time: number, since: number) {
  const { ctx, w, h } = f;
  const m = 30;
  const scale = clamp(Math.min(w, h) / 700, 0.6, 1.2);
  const k = since === Infinity ? 1 : easeOut(since / OPEN_S);
  for (const c of MOTES) {
    const u = c.u + c.vx * time, v = c.v + c.vy * time;
    const x = (u - Math.floor(u)) * (w + m * 2) - m;
    const y = (v - Math.floor(v)) * (h + m * 2) - m + (1 - k) * 36;
    const s = c.size * scale * 2.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(c.turn + c.sway * Math.sin(time * c.rate + c.ph));
    ctx.globalAlpha = c.alpha * k;
    ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

/** The floor: haze along the horizon, dark glass below it, faint lines toward the far light, and the world's glow. */
function floorLayer(f: SurfaceFrame, cache: TowersCache, hole: Hole): { canvas: HTMLCanvasElement; top: number } {
  const { w, h, dpr } = f;
  const key =
    hole.kind === "disc"
      ? `d|${w}|${h}|${dpr}|${Math.round(hole.cx)}|${Math.round(hole.cy)}|${Math.round(hole.r)}`
      : `r|${w}|${h}|${dpr}|${hole.x0}|${hole.y0}|${hole.x1}|${hole.y1}`;
  if (cache.floor?.key === key) return cache.floor;
  const [canvas, g] = offscreen(w, h, dpr);
  const yh = horizonOf(h, hole);
  const top = Math.max(0, yh - 46);
  const haze = g.createLinearGradient(0, top, 0, yh + 46);
  haze.addColorStop(0, "rgba(60,100,180,0)");
  haze.addColorStop(0.5, "rgba(80,125,210,0.2)");
  haze.addColorStop(1, "rgba(60,100,180,0)");
  g.fillStyle = haze;
  g.fillRect(0, top, w, yh + 46 - top);
  const floor = g.createLinearGradient(0, yh, 0, h);
  floor.addColorStop(0, "rgba(14,26,56,0.5)");
  floor.addColorStop(1, "rgba(2,4,12,0.88)");
  g.fillStyle = floor;
  g.fillRect(0, yh, w, h - yh);
  g.strokeStyle = "rgba(150,190,255,0.22)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, yh + 0.5);
  g.lineTo(w, yh + 0.5);
  g.stroke();
  // Faint seams in the floor running back toward the horizon's middle.
  g.strokeStyle = "rgba(130,175,255,0.06)";
  g.beginPath();
  for (let i = -12; i <= 12; i++) {
    g.moveTo(w / 2 + i * w * 0.02, yh);
    g.lineTo(w / 2 + i * w * 0.16, h);
  }
  g.stroke();
  // The world's light on the floor below it.
  const [px, py, rx] = hole.kind === "disc" ? [hole.cx, Math.min(h - 8, hole.cy + hole.r * 1.12), hole.r * 0.95] : [(hole.x0 + hole.x1) / 2, hole.y1 + (h - hole.y1) * 0.55, (hole.x1 - hole.x0) * 0.55];
  if (py > yh) {
    g.save();
    g.translate(px, py);
    g.scale(1, 0.14);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    pool.addColorStop(0, "rgba(120,175,255,0.34)");
    pool.addColorStop(1, "rgba(120,175,255,0)");
    g.fillStyle = pool;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  }
  if (hole.kind === "rect") {
    // The plate's glow into the void and its pale glass rim, under the map itself.
    const plate = new Path2D();
    plate.roundRect(hole.x0, hole.y0, hole.x1 - hole.x0, hole.y1 - hole.y0, plateOf(w, h).r);
    g.save();
    g.shadowColor = "rgba(90,150,255,0.55)";
    g.shadowBlur = 30;
    g.fillStyle = "#081430";
    g.fill(plate);
    g.restore();
  }
  cache.floor = { key, canvas, top: hole.kind === "rect" ? 0 : top };
  return cache.floor;
}

/** The world's land, ice, lakes and coasts as paths for this frame. */
function worldPaths(f: SurfaceFrame) {
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  return { path, land: path(f.map.land), coast: path(f.map.coast), lakes: path(f.map.lakes) };
}

/** Pale blue land with a soft glow round its coasts, on dark glass. Shared by the globe and the plate. */
function paintLand(f: SurfaceFrame, g: CanvasRenderingContext2D, y0: number, y1: number) {
  const { theme: t } = f;
  const { path, land, coast, lakes } = worldPaths(f);
  g.strokeStyle = t.graticule;
  g.lineWidth = 0.7;
  g.stroke(path(GRID));
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = "rgba(110,170,255,0.1)";
  g.lineWidth = 12;
  g.stroke(coast);
  g.strokeStyle = t.waterline;
  g.lineWidth = 5;
  g.stroke(coast);
  const lit = g.createLinearGradient(0, y0, 0, y1);
  lit.addColorStop(0, "#80a8e0");
  lit.addColorStop(1, t.land);
  g.fillStyle = lit;
  g.fill(land);
  if (f.map.ice) {
    g.fillStyle = t.ice;
    g.fill(path(f.map.ice));
  }
  g.fillStyle = t.lake;
  g.fill(lakes);
  if (f.zoom >= 2) {
    g.strokeStyle = t.river;
    g.lineWidth = 0.8;
    g.stroke(path(f.map.rivers));
  }
  g.strokeStyle = t.coast;
  g.lineWidth = t.coastWidth;
  g.stroke(coast);
  g.lineWidth = t.coastWidth * 0.7;
  g.stroke(lakes);
}

/** The globe: a soft glow round it, dark glass with light from the upper left, the land, a highlight and a rim. */
function paintGlobe(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const { proj, theme: t } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const halo = g.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.28);
  halo.addColorStop(0, "rgba(110,165,255,0.34)");
  halo.addColorStop(1, "rgba(110,165,255,0)");
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, R * 1.28, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  const sea = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
  sea.addColorStop(0, "#1b3a6e");
  sea.addColorStop(0.6, t.ocean);
  sea.addColorStop(1, "#050b1c");
  g.fillStyle = sea;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  paintLand(f, g, cy - R, cy + R);
  // Glass: the rim catches light, and a soft highlight sits on the upper left.
  const rim = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
  rim.addColorStop(0, "rgba(120,175,255,0)");
  rim.addColorStop(1, "rgba(120,175,255,0.3)");
  g.fillStyle = rim;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.translate(cx - R * 0.36, cy - R * 0.48);
  g.rotate(-0.5);
  g.scale(1, 0.5);
  const spec = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
  spec.addColorStop(0, "rgba(255,255,255,0.2)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = spec;
  g.fillRect(-R * 0.5, -R * 0.5, R, R);
  g.restore();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.strokeStyle = "rgba(180,215,255,0.55)";
  g.lineWidth = 1;
  g.stroke();
}

/** The plate: dark glass holding the map, a sheen across its top and a thin pale rim. */
function paintPlate(f: SurfaceFrame, g: CanvasRenderingContext2D, plate: Path2D, b: ReturnType<typeof plateOf>) {
  const { theme: t } = f;
  g.save();
  g.clip(plate);
  const sea = g.createLinearGradient(0, b.y0, 0, b.y1);
  sea.addColorStop(0, "#132b58");
  sea.addColorStop(1, t.ocean);
  g.fillStyle = sea;
  g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  paintLand(f, g, b.y0, b.y1);
  const sheen = g.createLinearGradient(b.x0, b.y0, b.x0 + (b.x1 - b.x0) * 0.35, b.y0 + (b.y1 - b.y0) * 0.6);
  sheen.addColorStop(0, "rgba(200,225,255,0.12)");
  sheen.addColorStop(1, "rgba(200,225,255,0)");
  g.fillStyle = sheen;
  g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  g.restore();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(185,218,255,0.7)";
  g.stroke(plate);
}

export function drawTowers(f: SurfaceFrame, cache: TowersCache): SurfaceResult {
  const { ctx, w, h, proj, mode } = f;
  const still = !!f.still;
  const since = cache.opening(still);
  const time = motionTime();
  cache.sprite ??= cubeSprite();
  cache.mote ??= moteSprite(cache.sprite);
  const sprite = cache.sprite;

  const globe = mode === "3d";
  const b = plateOf(w, h);
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const hole: Hole = globe ? { kind: "disc", cx, cy, r: R } : { kind: "rect", x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };

  const floor = floorLayer(f, cache, hole);
  drawPart(f, floor.canvas, 0, floor.top, w, h);

  const tk = `${mode}|${w}|${h}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  if (cache.towers?.key !== tk) cache.towers = { key: tk, list: placeTowers(w, h, hole) };
  for (const t of cache.towers.list) drawTower(ctx, sprite, t, time, since === Infinity ? 1 : riseOf(t, since));
  ctx.globalAlpha = 1;
  drawMotes(f, cache.mote, time, since);
  ctx.globalAlpha = 1;

  const next = still ? 0 : since === Infinity ? DRIFT_FRAME_MS : OPEN_FRAME_MS;
  if (globe) {
    const k = R * 1.3;
    cache.world.draw(f, (g) => paintGlobe(f, g), [cx - k, cy - k, cx + k, cy + k]);
    return { next };
  }
  const plate = new Path2D();
  plate.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, b.r);
  cache.world.draw(f, (g) => paintPlate(f, g, plate, b), [b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1]);
  const m = 4;
  return { inside: (x, y) => x > b.x0 + m && y > b.y0 + m && x < b.x1 - m && y < b.y1 - m, clip: plate, next };
}
