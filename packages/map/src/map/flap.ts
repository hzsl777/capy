// Departures (id flap, experimental): after the feel of a split-flap departures board in a big station hall, and
// nothing else from one: no operator's, airline's, railway's or maker's name, logo, colours, lettering or sounds.
// The map is the hall's wall map: a charcoal sheet on a darker wall, land as a field of warm off-white dots fixed to
// the screen like the lamps of a big board, a little brighter on mountains, and thin yellow coasts. The globe sits in
// a round hall clock's ring: a dark band of sixty ticks, longer and heavier at the hours, with no numbers and no
// hands, so nothing ever crosses the world. Nothing here moves on its own; the board's flaps are chrome (src/ui/flap.ts).
// No text on the canvas, and nothing is cut from any political unit.

import { geoGraticule, geoPath } from "d3-geo";
import { offscreen, pathContext, type SurfaceFrame } from "./surface.ts";

const GRID = geoGraticule().step([15, 15])();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The wall behind the sheet, the sheet itself, and the clock's band and rim. */
export const WALL = "#131415";
export const BAND = "#0c0c0d";
export const RIM = "#3b3c3f";
/** The ticks' warm off-white, the same as the land's lamps. */
export const TICK = "#efe6cf";

export class FlapCache {
  dots = new Map<string, CanvasPattern>();
  ring?: { key: string; canvas: HTMLCanvasElement };
}

/**
 * The clock's ring round a globe of radius R: a small gap, then a band of ticks with a metal rim at its outer edge.
 * Its width follows the globe's size, so the whole ring fits the frame at the widest zoom (`globeScale` 0.4).
 */
export function clockRing(R: number): { inner: number; outer: number; rim: number } {
  const inner = R + Math.max(3, R * 0.02);
  const band = clamp(R * 0.11, 9, 30);
  return { inner, outer: inner + band, rim: Math.max(2, band * 0.16) };
}

/** The sixty ticks of the ring: angle (radians), inner and outer radius, and width. Every fifth is an hour bar. */
export function clockTicks(R: number): { a: number; r0: number; r1: number; w: number; hour: boolean }[] {
  const { inner, outer, rim } = clockRing(R);
  const band = outer - rim - inner;
  const out: { a: number; r0: number; r1: number; w: number; hour: boolean }[] = [];
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    const len = band * (hour ? 0.62 : 0.26);
    const r1 = outer - rim - band * 0.14;
    out.push({ a: (i / 60) * Math.PI * 2 - Math.PI / 2, r0: r1 - len, r1, w: hour ? clamp(R * 0.014, 2, 5) : clamp(R * 0.004, 0.8, 1.5), hour });
  }
  return out;
}

/** A field of square lamps one `pitch` apart, in canvas pixels so it stays crisp, fixed to the screen. */
function lamps(f: SurfaceFrame, cache: FlapCache, pitch: number, size: number, ink: string): CanvasPattern {
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

export function drawFlap(f: SurfaceFrame, cache: FlapCache) {
  const { ctx, w, h, proj, theme: t, mode } = f;
  const globe = mode === "3d";
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, w, h);

  const path = geoPath(proj, ctx);
  const sheet = new Path2D();
  geoPath(proj, pathContext(sheet))({ type: "Sphere" });

  if (globe) drawRing(f, cache, cx, cy, R);
  // The sheet: charcoal, a shade lighter toward the middle as if lit from the hall's roof.
  const fill = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R * (globe ? 1 : 1.6));
  fill.addColorStop(0, "#222325");
  fill.addColorStop(1, t.ocean);
  ctx.fillStyle = fill;
  ctx.fill(sheet);

  ctx.save();
  ctx.clip(sheet);
  ctx.beginPath();
  path(GRID);
  ctx.strokeStyle = t.graticule;
  ctx.lineWidth = 1;
  ctx.stroke();

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  ctx.fillStyle = t.land;
  ctx.fill(land);
  // Smaller lamps when the whole world shows, so the continents keep their shape; bigger ones close in.
  const pitch = R < 160 ? 3 : R < 260 ? 3.5 : 4.5;
  ctx.fillStyle = lamps(f, cache, pitch, pitch * 0.42, t.textureInk);
  ctx.fill(land);

  // Mountains: the lamps brighter and closer together round each peak, kept to land.
  const peaks = f.relief?.peaks;
  if (peaks) {
    const rr = Math.min(10, Math.max(3, R * 0.01));
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
      ctx.fillStyle = lamps(f, cache, pitch, pitch * 0.5, t.relief);
      ctx.fill(new Path2D(hot.join("")));
      ctx.restore();
    }
  }
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = "#1f1f21";
    ctx.fill(ice);
    ctx.fillStyle = lamps(f, cache, pitch, pitch * 0.42, t.ice);
    ctx.fill(ice);
  }
  if (f.map.lakes) {
    ctx.beginPath();
    path(f.map.lakes);
    ctx.fillStyle = t.lake;
    ctx.fill();
  }

  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  ctx.restore();

  // The sheet's edge: a thin dim line, like the frame of a printed wall map.
  ctx.strokeStyle = globe ? "rgba(239,230,207,0.35)" : "rgba(233,191,46,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke(sheet);
}

/** The hall clock's ring round the globe, drawn once per size into an offscreen layer. */
function drawRing(f: SurfaceFrame, cache: FlapCache, cx: number, cy: number, R: number) {
  const { ctx, w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}:${Math.round(cx)}:${Math.round(cy)}:${Math.round(R)}`;
  if (cache.ring?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    const { outer, rim } = clockRing(R);
    // A soft shadow on the wall, then the dark band and its metal rim.
    const shadow = g.createRadialGradient(cx, cy + outer * 0.04, outer * 0.96, cx, cy + outer * 0.04, outer * 1.12);
    shadow.addColorStop(0, "rgba(0,0,0,0.5)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = shadow;
    g.fillRect(0, 0, w, h);
    g.beginPath();
    g.arc(cx, cy, outer, 0, Math.PI * 2);
    g.fillStyle = BAND;
    g.fill();
    const metal = g.createLinearGradient(cx - outer, cy - outer, cx + outer, cy + outer);
    metal.addColorStop(0, "#5a5b5f");
    metal.addColorStop(0.5, RIM);
    metal.addColorStop(1, "#232426");
    g.beginPath();
    g.arc(cx, cy, outer - rim / 2, 0, Math.PI * 2);
    g.lineWidth = rim;
    g.strokeStyle = metal;
    g.stroke();
    g.lineCap = "butt";
    g.strokeStyle = TICK;
    for (const k of clockTicks(R)) {
      const c = Math.cos(k.a), s = Math.sin(k.a);
      g.beginPath();
      g.moveTo(cx + c * k.r0, cy + s * k.r0);
      g.lineTo(cx + c * k.r1, cy + s * k.r1);
      g.lineWidth = k.w;
      g.stroke();
    }
    cache.ring = { key, canvas };
  }
  ctx.drawImage(cache.ring.canvas, 0, 0, w, h);
}

function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}
