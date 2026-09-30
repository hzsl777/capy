// Chalkboard (decision 76): the world drawn in chalk on a classroom board. The board is dark green slate with old
// eraser smears; the land is hatched in pale green chalk inside a white chalk coast, with dashes of blue chalk in
// the water along every shore and little chalk peaks for mountains. Every stroke is dusty, with the grain of the
// board showing through. On the flat map the chalk outlines the world's edge; in Globe view the globe is a chalk
// circle, drawn twice round the way a hand does, hatched on its shadow side. Dragging leaves a faint smudge that
// fades within a second; for readers who ask for reduced motion there is none. No text, no borders.

import { geoGraticule, geoPath } from "d3-geo";
import { clamp, drawDoodles, hatch, landPaths, once, speckle, streaks, wideCoast } from "./handmade.ts";
import { hash2, offscreen, type SurfaceFrame } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;
const GRID = geoGraticule().step([30, 30])();
/** How long a smudge takes to fade, in milliseconds. */
const SMUDGE_MS = 1100;

export class ChalkCache {
  board: { key?: string; canvas?: HTMLCanvasElement } = {};
  layer?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number };
}

/** The slate: dark green, with old eraser smears and chalk dust that never quite came off. */
function board(f: SurfaceFrame, cache: ChalkCache): HTMLCanvasElement {
  const { w, h, dpr, theme: t } = f;
  return once(cache.board, `${w}:${h}:${dpr}`, w, h, dpr, (g) => {
    g.fillStyle = t.ocean;
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.45, h * 0.4, Math.max(w, h) * 0.75);
    glow.addColorStop(0, "rgba(255,255,255,0.05)");
    glow.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    // Wide arcs where an eraser swept across, each a band of faint dust.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const x = rnd() * w, y = rnd() * h, r = 80 + rnd() * Math.max(w, h) * 0.35;
      const a0 = rnd() * Math.PI * 2;
      g.lineWidth = 26 + rnd() * 40;
      g.strokeStyle = `rgba(230,236,226,${(0.025 + rnd() * 0.03).toFixed(3)})`;
      g.beginPath();
      g.arc(x, y, r, a0, a0 + 0.6 + rnd() * 1.2);
      g.stroke();
    }
    g.fillStyle = streaks(g, dpr, "rgba(230,236,226,0.05)", 40, [30, 120], [8, 20], 13, 260, 0.2);
    g.fillRect(0, 0, w, h);
    g.fillStyle = speckle(g, dpr, "rgba(235,240,230,0.25)", 160, [0.4, 1.2], 19, 110);
    g.fillRect(0, 0, w, h);
  });
}

/** A full-frame canvas the chalk is drawn into before the board's grain is knocked out of it. */
function layerFor(f: SurfaceFrame, cache: ChalkCache): CanvasRenderingContext2D {
  const W = Math.round(f.w * f.dpr), H = Math.round(f.h * f.dpr);
  if (!cache.layer || cache.layer.canvas.width !== W || cache.layer.canvas.height !== H) {
    const [canvas, g] = offscreen(f.w, f.h, f.dpr);
    cache.layer = { canvas, g, w: f.w, h: f.h };
  }
  const g = cache.layer.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  return g;
}

/** Chalk peaks where the relief layer has mountains: an upturned V with a stroke of shading on one flank. */
function peaks(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const list = f.relief?.peaks;
  if (!list) return;
  const k = clamp(0.8 + f.zoom * 0.25, 1, 2.6) * clamp(Math.min(f.w, f.h) / 720, 0.7, 1);
  const cell = 22 * k;
  const taken = new Set<number>();
  const p = new Path2D();
  for (const [lon, lat] of list) {
    if (f.mode === "3d") {
      const r = Math.PI / 180;
      const c = Math.sin(lat * r) * Math.sin(f.lat * r) + Math.cos(lat * r) * Math.cos(f.lat * r) * Math.cos((lon - f.lon) * r);
      if (c < 0.1) continue;
    }
    const q = f.proj([lon, lat]);
    if (!q) continue;
    const [x, y] = q;
    if (x < -10 || y < -10 || x > f.w + 10 || y > f.h + 10) continue;
    const key = Math.floor(x / cell) * 4096 + Math.floor(y / cell);
    if (taken.has(key)) continue;
    taken.add(key);
    const s = (4 + hash2(Math.round(lon * 10), Math.round(lat * 10)) * 2.5) * k;
    p.moveTo(x - s, y + s * 0.5);
    p.lineTo(x, y - s * 0.8);
    p.lineTo(x + s, y + s * 0.5);
    p.moveTo(x + s * 0.12, y - s * 0.4);
    p.lineTo(x + s * 0.5, y + s * 0.45);
  }
  g.lineJoin = "round";
  g.lineCap = "round";
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(245,242,232,0.8)";
  g.stroke(p);
}

/** A circle drawn by hand: its radius wanders a little, and it starts and ends a little apart. */
function handCircle(cx: number, cy: number, R: number, seed: number, wobble: number): Path2D {
  const p = new Path2D();
  const n = 90;
  const a0 = seed * 1.7;
  for (let i = 0; i <= n + 3; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const r = R + wobble * (Math.sin(a * 3 + seed) * 0.6 + Math.sin(a * 7 + seed * 3) * 0.4) + (i / n) * wobble * 0.8;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i) p.lineTo(x, y);
    else p.moveTo(x, y);
  }
  return p;
}

export function drawChalk(f: SurfaceFrame, cache: ChalkCache): number | void {
  const { ctx, w, h } = f;
  ctx.drawImage(board(f, cache), 0, 0, w, h);
  const g = layerFor(f, cache);
  const path = geoPath(f.proj, g);
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const globe = f.mode === "3d";
  const { land, coast, ice } = landPaths(f, f.map);

  // Blue chalk ripples in the water along every shore: two dashed lines following the coast out to sea. Each is
  // the edge of a wide dashed stroke with its middle rubbed out; the half over the land is rubbed out last.
  const soft = wideCoast(f, coast);
  g.lineCap = "butt";
  g.lineJoin = "round";
  for (const [wide, dash, ink] of [
    [30, [4, 10], "rgba(160,205,238,0.35)"],
    [16, [6, 7], "rgba(160,205,238,0.6)"],
  ] as const) {
    g.setLineDash(dash as unknown as number[]);
    g.lineWidth = wide;
    g.strokeStyle = ink;
    g.stroke(soft);
    g.setLineDash([]);
    g.globalCompositeOperation = "destination-out";
    g.lineWidth = wide - 2.6;
    g.stroke(soft);
    g.globalCompositeOperation = "source-over";
  }
  g.globalCompositeOperation = "destination-out";
  g.fill(land);
  g.globalCompositeOperation = "source-over";

  // The world's grid in thin chalk, and doodles in the open sea.
  g.lineCap = "round";
  g.beginPath();
  path(GRID);
  g.lineWidth = 1;
  g.strokeStyle = f.theme.graticule;
  g.stroke();
  drawDoodles(f, g, "rgba(246,243,234,0.8)", 1.8);

  // Land: a wash of dust, then hatching in pale green chalk; the ice hatched the other way in pale blue.
  g.fillStyle = "rgba(230,240,220,0.06)";
  g.fill(land);
  g.fillStyle = hatch(g, f.dpr, "rgba(205,235,185,0.62)", 5.5, 1, 1.3, 7);
  g.fill(land);
  if (ice) {
    g.save();
    g.clip(land);
    g.fillStyle = f.theme.ocean;
    g.fill(ice);
    g.fillStyle = hatch(g, f.dpr, "rgba(200,225,245,0.55)", 5, -1, 1.2, 9);
    g.fill(ice);
    g.restore();
  }
  peaks(f, g);

  // The coast, pressed harder: a firm line and a second, lighter pass just beside it.
  g.lineWidth = f.theme.coastWidth + 0.4;
  g.strokeStyle = "rgba(246,243,234,0.95)";
  g.stroke(coast);
  g.save();
  g.translate(0.8, 0.6);
  g.lineWidth = 1;
  g.strokeStyle = "rgba(246,243,234,0.5)";
  g.stroke(coast);
  g.restore();

  if (globe) {
    // The globe's shadow side, hatched: the part of the disc the lit disc up and to the left doesn't cover.
    const disc = new Path2D();
    disc.arc(cx, cy, R, 0, Math.PI * 2);
    g.save();
    g.clip(disc);
    const lit = new Path2D();
    lit.arc(cx - R * 0.2, cy - R * 0.2, R * 1.02, 0, Math.PI * 2);
    lit.rect(cx + R * 2, cy - R * 2, -R * 4, R * 4);
    g.clip(lit, "evenodd");
    g.fillStyle = hatch(g, f.dpr, "rgba(246,243,234,0.5)", 4.5, -1, 1.1, 11);
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();
    // The circle, twice round, and a curved stroke of shine at the upper left.
    g.lineWidth = 2.6;
    g.strokeStyle = "rgba(246,243,234,0.95)";
    g.stroke(handCircle(cx, cy, R, 1, Math.max(1.2, R * 0.006)));
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(246,243,234,0.55)";
    g.stroke(handCircle(cx + 1.5, cy - 1, R + 2.5, 4, Math.max(1.4, R * 0.008)));
    g.lineWidth = 3;
    g.strokeStyle = "rgba(246,243,234,0.45)";
    g.beginPath();
    g.arc(cx, cy, R * 0.86, Math.PI * 1.08, Math.PI * 1.36);
    g.stroke();
  } else {
    g.beginPath();
    path(SPHERE);
    g.lineWidth = 2.2;
    g.strokeStyle = "rgba(246,243,234,0.85)";
    g.stroke();
  }

  // Knock the board's grain out of the chalk, so every stroke is dusty.
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = speckle(g, f.dpr, "rgba(0,0,0,0.9)", 900, [0.5, 1.4], 29, 96);
  g.fillRect(0, 0, w, h);
  g.fillStyle = streaks(g, f.dpr, "rgba(0,0,0,0.35)", 50, [6, 24], [0.6, 1.2], 31, 120, 0.9);
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  ctx.drawImage(cache.layer!.canvas, 0, 0, w, h);

  return smudge(f);
}

/** The faint smudge a drag leaves on the board, fading. Asks for the next frame while any of it shows. */
function smudge(f: SurfaceFrame): number | void {
  const trail = f.trail;
  if (!trail || f.still || !trail.length) return;
  const now = f.time ?? 0;
  const g = f.ctx;
  let live = false;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!, b = trail[i]!;
    const age = now - b.t;
    if (age > SMUDGE_MS || b.t - a.t > 200) continue;
    live = true;
    const k = 1 - age / SMUDGE_MS;
    g.strokeStyle = `rgba(232,238,228,${(0.07 * k).toFixed(3)})`;
    g.lineWidth = 30;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.strokeStyle = `rgba(232,238,228,${(0.05 * k).toFixed(3)})`;
    g.lineWidth = 14;
    g.stroke();
  }
  g.restore();
  return live ? 50 : undefined;
}
