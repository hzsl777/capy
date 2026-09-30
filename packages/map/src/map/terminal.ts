// Market Terminal (decision 74): the world as an amber plot on a black screen. A coordinate grid of longitude and
// latitude with tick marks along the frame's edges; land as a dot matrix fixed to the screen, brighter over
// mountains; coasts as a thin vector line. The globe is a vector plot, its far side faint, inside a ring of ticks.
// No text on the canvas, no prices, no arrows, and no red or green that could read as good or bad news.

import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import { offscreen, pathContext, type SurfaceFrame } from "./surface.ts";

const MINOR = geoGraticule().step([10, 10])();
const MAJOR = geoGraticule().step([30, 30])();

export class TerminalCache {
  dots = new Map<string, CanvasPattern>();
  bezel?: { key: string; canvas: HTMLCanvasElement };
}

/** A dot-matrix fill: one square dot per `pitch` pixels, in canvas pixels so it stays crisp. */
function matrix(f: SurfaceFrame, cache: TerminalCache, pitch: number, size: number, ink: string): CanvasPattern {
  const key = `${pitch}:${size}:${ink}:${f.dpr}`;
  let p = cache.dots.get(key);
  if (p) return p;
  const n = Math.max(2, Math.round(pitch * f.dpr));
  const d = Math.max(1, Math.round(size * f.dpr));
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = ink;
  g.fillRect(0, 0, d, d);
  p = f.ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / f.dpr));
  cache.dots.set(key, p);
  return p;
}

export function drawTerminal(f: SurfaceFrame, cache: TerminalCache) {
  const { ctx, w, h, proj, theme: t, mode } = f;
  const globe = mode === "3d";
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  ctx.fillStyle = t.ocean;
  ctx.fillRect(0, 0, w, h);

  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, Math.PI * 2);
  const path = geoPath(proj, ctx);

  ctx.save();
  if (globe) {
    ctx.clip(sphere);
    // The far side, faint, as a vector plot shows through.
    const back = geoOrthographic().rotate(proj.rotate()).scale(R).translate([cx, cy]).clipAngle(179.5).precision(0.8);
    const backPath = geoPath(back, ctx);
    ctx.beginPath();
    backPath(MAJOR);
    ctx.strokeStyle = "rgba(255,176,0,0.07)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    backPath(f.low.coast as never);
    ctx.strokeStyle = "rgba(255,176,0,0.13)";
    ctx.stroke();
  }

  // The coordinate grid: every ten degrees faint, every thirty a little brighter.
  ctx.beginPath();
  path(MINOR);
  ctx.strokeStyle = "rgba(255,176,0,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  path(MAJOR);
  ctx.strokeStyle = t.graticule;
  ctx.stroke();

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.fillStyle = t.land;
  ctx.fill(land);
  ctx.fillStyle = matrix(f, cache, 4, 1.4, t.textureInk);
  ctx.fill(land);

  // Mountains: the matrix brighter and denser around each peak, clipped to land.
  const peaks = f.relief?.peaks;
  if (peaks) {
    const rr = Math.min(12, Math.max(4, R * 0.012));
    const hot: string[] = [];
    for (const [lon, lat] of peaks) {
      if (globe && !facing(f, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -rr || p[1] < -rr || p[0] > w + rr || p[1] > h + rr) continue;
      hot.push(`M${(p[0] + rr).toFixed(1)} ${p[1].toFixed(1)}a${rr} ${rr} 0 1 0 ${-2 * rr} 0a${rr} ${rr} 0 1 0 ${2 * rr} 0Z`);
    }
    if (hot.length) {
      ctx.save();
      ctx.clip(land);
      ctx.fillStyle = matrix(f, cache, 2, 1.2, "rgba(255,211,107,0.55)");
      ctx.fill(new Path2D(hot.join("")));
      ctx.restore();
    }
  }
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = matrix(f, cache, 4, 1.4, "rgba(255,236,200,0.5)");
    ctx.fill(ice);
  }

  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,176,0,0.22)";
  ctx.lineWidth = 3;
  ctx.stroke(coast);
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  ctx.restore();

  if (globe) drawBezel(f, cache, cx, cy, R);
  else drawTicks(f);
}

/** Tick marks along the frame's edges where the grid's lines meet it, like a plot's axes. No numbers. */
function drawTicks(f: SurfaceFrame) {
  const { ctx, w, h, proj } = f;
  const out: string[] = [];
  const top = proj.invert?.([w / 2, 0]);
  const bottom = proj.invert?.([w / 2, h]);
  if (!top || !bottom) return;
  // Longitude runs evenly across the flat map from the centre, unwrapped, so the ticks never jump at 180.
  const k = proj.scale() * (Math.PI / 180);
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  const start = Math.ceil((f.lon - w / 2 / k) / 5) * 5;
  for (let lon = start; w / 2 + (lon - f.lon) * k <= w; lon += 5) {
    const x = Math.round(w / 2 + (lon - f.lon) * k) + 0.5;
    const len = mod(lon, 30) === 0 ? 12 : mod(lon, 10) === 0 ? 8 : 4;
    out.push(`M${x} 0v${len}M${x} ${h}v${-len}`);
  }
  for (let lat = Math.ceil(bottom[1] / 5) * 5; lat <= top[1]; lat += 5) {
    const p = proj([f.lon, lat]);
    if (!p) continue;
    const y = Math.round(p[1]) + 0.5;
    const len = lat % 30 === 0 ? 12 : lat % 10 === 0 ? 8 : 4;
    out.push(`M0 ${y}h${len}M${w} ${y}h${-len}`);
  }
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,176,0,0.7)";
  ctx.stroke(new Path2D(out.join("")));
  ctx.restore();
}

/** A ring of ticks around the globe, every five degrees, longer every thirty, and the rim. Drawn once per size. */
function drawBezel(f: SurfaceFrame, cache: TerminalCache, cx: number, cy: number, R: number) {
  const { ctx, w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}:${Math.round(cx)}:${Math.round(cy)}:${Math.round(R)}`;
  if (cache.bezel?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.lineWidth = 1.4;
    g.strokeStyle = "#ffb000";
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R + 18, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255,176,0,0.45)";
    g.stroke();
    g.beginPath();
    for (let a = 0; a < 360; a += 5) {
      const r0 = R + 18;
      const len = a % 30 === 0 ? 11 : a % 10 === 0 ? 7 : 4;
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      g.moveTo(cx + c * r0, cy + s * r0);
      g.lineTo(cx + c * (r0 - len), cy + s * (r0 - len));
    }
    g.strokeStyle = "rgba(255,176,0,0.8)";
    g.stroke();
    // Corner brackets around the plot, like a framed window on the screen.
    const b = R + 34, l = Math.max(14, R * 0.12);
    g.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      g.moveTo(cx + sx * b, cy + sy * (b - l));
      g.lineTo(cx + sx * b, cy + sy * b);
      g.lineTo(cx + sx * (b - l), cy + sy * b);
    }
    g.lineWidth = 1.4;
    g.strokeStyle = "#ffb000";
    g.stroke();
    cache.bezel = { key, canvas };
  }
  ctx.drawImage(cache.bezel.canvas, 0, 0, w, h);
}

function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}
