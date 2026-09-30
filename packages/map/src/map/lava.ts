// Lava Lamp (decision 77): a 1970s lava lamp. Blobs of warm wax in orange, magenta and purple rise and sink very
// slowly through the dark liquid of the sea, behind land that glows warm, like the wax lit by the bulb. The wax is
// a low-resolution field of metaballs, worked out a few times a second and enlarged smoothly, so it costs little.
// In Globe view the world is the lamp's glass: a tapered bottle on a metal base with a cap on top, the wax drifting
// round the globe inside it, and the lamp lighting the wall behind. The wax sits under the land and never over a
// marker (the view draws markers last); it changes slowly and never flashes, and holds still for readers who ask
// for reduced motion. The lamp is plain shapes with no symbols or text.

import { geoPath } from "d3-geo";
import { drawPart, motionTime, StillLayer } from "./ambient.ts";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

/** Wax colours: orange, magenta, purple. */
const WAX: [number, number, number][] = [
  [255, 132, 38],
  [236, 52, 140],
  [150, 78, 226],
];

interface Blob {
  /** Resting place across the field, 0 to 1. */
  u: number;
  /** Radius as a share of the field's shorter side. */
  r: number;
  /** Seconds for one rise and fall. */
  period: number;
  phase: number;
  wax: number;
}

/** A fixed set of blobs, so every load shows the same lamp. */
function blobs(n: number, seed: number, size = 1): Blob[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => ({
    u: (i + 0.2 + rnd() * 0.6) / n,
    r: (0.07 + rnd() * 0.08) * size,
    period: 70 + rnd() * 70,
    phase: rnd() * Math.PI * 2,
    wax: i % 3,
  }));
}

const MAP_BLOBS = blobs(11, 5);
const LAMP_BLOBS = blobs(7, 12, 1.45);

export class LavaCache {
  world = new StillLayer();
  field?: { key: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; at: number };
  lamp?: { key: string; back: HTMLCanvasElement; front: HTMLCanvasElement; glass: Path2D };
}

export function drawLava(f: SurfaceFrame, cache: LavaCache) {
  if (f.mode === "3d") drawLamp(f, cache);
  else drawSheet(f, cache);
}

// ---- the wax ----------------------------------------------------------------------------------------------------

/**
 * The wax over a field fw by fh pixels, worked out at one cell per `cell` pixels. Blobs rise and sink slowly and
 * sway a little; where they meet they merge, as wax does. Recomputed at most about five times a second.
 */
function wax(cache: LavaCache, list: Blob[], fw: number, fh: number, cell: number, t: number): HTMLCanvasElement {
  const gw = Math.max(4, Math.ceil(fw / cell));
  const gh = Math.max(4, Math.ceil(fh / cell));
  const key = `${gw}|${gh}|${list.length}`;
  const now = performance.now();
  let fl = cache.field;
  if (fl && fl.key === key && now - fl.at < 180) return fl.canvas;
  if (!fl || fl.key !== key) {
    const canvas = document.createElement("canvas");
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d")!;
    fl = { key, canvas, ctx, img: ctx.createImageData(gw, gh), at: 0 };
    cache.field = fl;
  }
  fl.at = now;
  const S = Math.min(gw, gh);
  const bx: number[] = [], by: number[] = [], br: number[] = [];
  for (const b of list) {
    const v = 0.5 + 0.44 * Math.sin((2 * Math.PI * t) / b.period + b.phase);
    const u = b.u + 0.05 * Math.sin((2 * Math.PI * t) / (b.period * 1.7) + b.phase * 2);
    // A little larger at the bottom, where the wax is warm, and a little smaller as it cools at the top.
    const r = b.r * S * (0.85 + 0.3 * v);
    bx.push(u * gw);
    by.push(v * gh);
    br.push(r * r);
  }
  const d = fl.img.data;
  const n = list.length;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let sum = 0, cr = 0, cg = 0, cb = 0;
      for (let i = 0; i < n; i++) {
        const dx = x + 0.5 - bx[i]!, dy = (y + 0.5 - by[i]!) * 0.85;
        const v = br[i]! / (dx * dx + dy * dy + 0.5);
        sum += v;
        const c = WAX[list[i]!.wax]!;
        cr += c[0] * v;
        cg += c[1] * v;
        cb += c[2] * v;
      }
      const o = (y * gw + x) * 4;
      if (sum < 0.5) {
        d[o + 3] = 0;
        continue;
      }
      // A clear edge with a faint glow round it, darker at the rim and lit toward the middle, like lit wax.
      const inside = smooth(0.93, 1.05, sum);
      const halo = smooth(0.7, 0.93, sum) * 0.1;
      const rim = 0.8 + 0.2 * smooth(1.0, 1.3, sum);
      const core = smooth(1.6, 3.6, sum) * 0.38;
      const r = (cr / sum) * rim, g = (cg / sum) * rim, b = (cb / sum) * rim;
      d[o] = Math.round(r + (255 - r) * core);
      d[o + 1] = Math.round(g + (236 - g) * core);
      d[o + 2] = Math.round(b + (190 - b) * core);
      d[o + 3] = Math.round(255 * Math.max(inside * 0.97, halo));
    }
  fl.ctx.putImageData(fl.img, 0, 0);
  return fl.canvas;
}

// ---- the land ---------------------------------------------------------------------------------------------------

/** The land, glowing warm, over the liquid and the wax; a still layer, so the wax moves without drawing it again. */
function paintLand(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const { w, h, proj, theme: t, mode } = f;
  const path = geoPath(proj, g);
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const globe = mode === "3d";
  const map = f.map;
  g.save();
  if (globe) {
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
  }
  // The coast and the land are projected once and reused for every stroke and fill.
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(map.coast);
  const land = new Path2D();
  geoPath(proj, pathContext(land))(map.land);
  // Lakes are the lamp's liquid too: holes in the land, so the liquid and the wax show through.
  const lakes = new Path2D();
  geoPath(proj, pathContext(lakes))(map.lakes);
  land.addPath(lakes);
  // A warm glow into the liquid all round the coast, then the land lit from the bulb below.
  g.lineJoin = "round";
  g.strokeStyle = "rgba(255,160,70,0.16)";
  g.lineWidth = 14;
  g.stroke(coast);
  g.strokeStyle = t.waterline;
  g.lineWidth = 6;
  g.stroke(coast);
  let lit: CanvasGradient;
  if (globe) {
    lit = g.createRadialGradient(cx, cy + R * 0.7, R * 0.1, cx, cy + R * 0.3, R * 1.5);
    lit.addColorStop(0, "#fff2c4");
    lit.addColorStop(0.5, t.land);
    lit.addColorStop(1, "#f29a48");
  } else {
    lit = g.createLinearGradient(0, 0, 0, h);
    lit.addColorStop(0, "#ffe4a0");
    lit.addColorStop(0.6, t.land);
    lit.addColorStop(1, "#ffb45a");
  }
  g.fillStyle = lit;
  g.fill(land, "evenodd");
  g.clip(land, "evenodd");
  // Warmer patches where the relief layer has mountains: soft dabs, never an outline.
  if (f.relief) {
    const s = clamp(R / 60, 2.5, 10);
    g.fillStyle = "rgba(236,120,40,0.12)";
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
  g.restore();
  g.save();
  if (globe) {
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
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

// ---- Map view ---------------------------------------------------------------------------------------------------

function drawSheet(f: SurfaceFrame, cache: LavaCache) {
  const { ctx, w, h, theme: t } = f;
  const liquid = ctx.createRadialGradient(w / 2, h * 1.1, h * 0.1, w / 2, h * 0.7, Math.max(w, h) * 0.9);
  liquid.addColorStop(0, "#4a1a52");
  liquid.addColorStop(0.5, t.ocean);
  liquid.addColorStop(1, "#110a2a");
  ctx.fillStyle = liquid;
  ctx.fillRect(0, 0, w, h);
  const field = wax(cache, MAP_BLOBS, w, h, 5, motionTime());
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(field, 0, 0, w, h);
  ctx.restore();
  cache.world.draw(f, (g) => paintLand(f, g));
}

// ---- Globe view: the lamp ---------------------------------------------------------------------------------------

interface Lamp {
  cx: number;
  cy: number;
  R: number;
  /** Top and bottom of the glass. */
  top: number;
  bottom: number;
}

const lampOf = (cx: number, cy: number, R: number): Lamp => ({ cx, cy, R, top: cy - R * 1.42, bottom: cy + R * 1.3 });

/** Half the glass's width at height y: a tapered bottle, narrow at the top, with a gentle bulge round the globe. */
function halfWidth(l: Lamp, y: number): number {
  const s = clamp((y - l.top) / (l.bottom - l.top), 0, 1);
  return l.R * (0.5 + 0.4 * s + 0.35 * Math.sin(Math.PI * s));
}

function glassPath(l: Lamp): Path2D {
  const p = new Path2D();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const y = l.top + ((l.bottom - l.top) * i) / n;
    const x = l.cx + halfWidth(l, y);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const y = l.top + ((l.bottom - l.top) * i) / n;
    p.lineTo(l.cx - halfWidth(l, y), y);
  }
  p.closePath();
  return p;
}

/** A brass gradient across a shape from x0 to x1, lit from the left. */
function brass(g: CanvasRenderingContext2D, x0: number, x1: number): CanvasGradient {
  const m = g.createLinearGradient(x0, 0, x1, 0);
  m.addColorStop(0, "#5a3010");
  m.addColorStop(0.18, "#c98a3a");
  m.addColorStop(0.32, "#fff0c2");
  m.addColorStop(0.45, "#e0a850");
  m.addColorStop(0.75, "#8a5220");
  m.addColorStop(1, "#3e1f06");
  return m;
}

function lampLayers(f: SurfaceFrame, cache: LavaCache, l: Lamp) {
  const { w, h, dpr, theme: t } = f;
  const { cx, cy, R, top, bottom } = l;
  const key = `${w}|${h}|${dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R * 4)}`;
  if (cache.lamp?.key === key) return cache.lamp;
  const glass = glassPath(l);

  // Behind: the lamp's light on the wall, its base and cap, and the liquid in the glass.
  const [back, g] = offscreen(w, h, dpr);
  const light = g.createRadialGradient(cx, cy + R * 0.4, R * 0.5, cx, cy + R * 0.4, R * 3.2);
  light.addColorStop(0, "rgba(255,150,70,0.32)");
  light.addColorStop(0.5, "rgba(236,70,120,0.1)");
  light.addColorStop(1, "rgba(236,70,120,0)");
  g.fillStyle = light;
  g.fillRect(0, 0, w, h);

  // The base: a cone widening to the floor, with a glowing collar where the glass sits and slots at its foot.
  const bTop = bottom - R * 0.04, bBot = bottom + R * 0.78;
  const wTop = halfWidth(l, bottom) + R * 0.05, wBot = R * 1.26;
  g.beginPath();
  g.moveTo(cx - wTop, bTop);
  g.quadraticCurveTo(cx - (wTop + wBot) * 0.47, (bTop + bBot) / 2, cx - wBot, bBot);
  g.ellipse(cx, bBot, wBot, R * 0.12, 0, Math.PI, 0, true);
  g.quadraticCurveTo(cx + (wTop + wBot) * 0.47, (bTop + bBot) / 2, cx + wTop, bTop);
  g.closePath();
  g.fillStyle = brass(g, cx - wBot, cx + wBot);
  g.fill();
  g.strokeStyle = "#3a1c06";
  g.lineWidth = 1;
  g.stroke();
  g.save();
  g.clip();
  for (let i = -3; i <= 3; i++) {
    const x = cx + i * wBot * 0.22;
    const y0 = bBot - R * 0.3, y1 = bBot - R * 0.1;
    const sw = R * 0.05;
    const glow = g.createLinearGradient(0, y0, 0, y1);
    glow.addColorStop(0, "#ffd070");
    glow.addColorStop(1, "#ff7a2a");
    g.fillStyle = glow;
    g.beginPath();
    g.roundRect(x - sw / 2, y0, sw, y1 - y0, sw / 2);
    g.fill();
    g.strokeStyle = "rgba(60,24,4,0.8)";
    g.stroke();
  }
  g.restore();
  g.beginPath();
  g.ellipse(cx, bTop + R * 0.02, wTop + R * 0.02, R * 0.06, 0, 0, Math.PI * 2);
  g.fillStyle = brass(g, cx - wTop, cx + wTop);
  g.fill();
  g.stroke();

  // The cap: a small cone on top of the glass, with a rounded crown.
  const cBot = top + R * 0.04, cTop = top - R * 0.46;
  const cwB = halfWidth(l, top) + R * 0.05, cwT = R * 0.26;
  g.beginPath();
  g.moveTo(cx - cwB, cBot);
  g.lineTo(cx - cwT, cTop);
  g.ellipse(cx, cTop, cwT, R * 0.07, 0, Math.PI, 0);
  g.lineTo(cx + cwB, cBot);
  g.ellipse(cx, cBot, cwB, R * 0.06, 0, 0, Math.PI);
  g.closePath();
  g.fillStyle = brass(g, cx - cwB, cx + cwB);
  g.fill();
  g.stroke();

  // The liquid, warmer toward the bulb at the bottom.
  const liquid = g.createLinearGradient(0, top, 0, bottom);
  liquid.addColorStop(0, "#140c30");
  liquid.addColorStop(0.55, t.ocean);
  liquid.addColorStop(1, "#5a1c4e");
  g.fillStyle = liquid;
  g.fill(glass);

  // In front: the glass's edge and its highlights, clear of the globe, and the collars over the glass's ends.
  const [front, fg] = offscreen(w, h, dpr);
  fg.strokeStyle = "rgba(255,220,190,0.55)";
  fg.lineWidth = Math.max(1.2, R * 0.012);
  fg.stroke(glass);
  fg.lineCap = "round";
  for (const [side, s0, s1, k, alpha] of [
    [-1, 0.05, 0.24, 0.72, 0.55],
    [-1, 0.78, 0.96, 0.8, 0.4],
    [1, 0.06, 0.2, 0.8, 0.25],
    [1, 0.82, 0.95, 0.86, 0.22],
  ] as const) {
    fg.beginPath();
    for (let i = 0; i <= 12; i++) {
      const y = top + (bottom - top) * (s0 + ((s1 - s0) * i) / 12);
      const x = cx + side * halfWidth(l, y) * k;
      if (i === 0) fg.moveTo(x, y);
      else fg.lineTo(x, y);
    }
    fg.strokeStyle = `rgba(255,255,255,${alpha})`;
    fg.lineWidth = Math.max(2, R * 0.045);
    fg.stroke();
  }
  fg.beginPath();
  fg.ellipse(cx, bTop + R * 0.02, wTop + R * 0.02, R * 0.06, 0, 0, Math.PI);
  fg.fillStyle = brass(fg, cx - wTop, cx + wTop);
  fg.fill();
  fg.strokeStyle = "#3a1c06";
  fg.lineWidth = 1;
  fg.stroke();
  fg.beginPath();
  fg.ellipse(cx, cBot, cwB, R * 0.06, 0, 0, Math.PI);
  fg.fillStyle = brass(fg, cx - cwB, cx + cwB);
  fg.fill();
  fg.stroke();

  cache.lamp = { key, back, front, glass };
  return cache.lamp;
}

function drawLamp(f: SurfaceFrame, cache: LavaCache) {
  const { ctx, w, h, proj } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const l = lampOf(cx, cy, R);
  const lamp = lampLayers(f, cache, l);
  ctx.drawImage(lamp.back, 0, 0, w, h);

  // The wax, inside the glass only, on screen only.
  const x0 = Math.max(0, cx - R * 1.12), x1 = Math.min(w, cx + R * 1.12);
  const y0 = Math.max(0, l.top), y1 = Math.min(h, l.bottom);
  if (x1 > x0 && y1 > y0) {
    const fx = cx - R * 1.12, fw = R * 2.24, fy = l.top, fh = l.bottom - l.top;
    const field = wax(cache, LAMP_BLOBS, fw, fh, Math.max(2.5, R / 50), motionTime());
    ctx.save();
    ctx.clip(lamp.glass);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(field, fx, fy, fw, fh);
    ctx.restore();
  }

  // The globe inside: a faint shade so it reads as a sphere in the liquid, then the land.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
  shade.addColorStop(0, "rgba(255,220,180,0.1)");
  shade.addColorStop(0.6, "rgba(20,8,40,0.08)");
  shade.addColorStop(1, "rgba(20,8,40,0.45)");
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.restore();
  cache.world.draw(f, (g) => paintLand(f, g));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,200,150,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
  drawPart(f, lamp.front, cx - R * 1.35, l.top - R * 0.15, cx + R * 1.35, l.bottom + R * 0.15);
}
