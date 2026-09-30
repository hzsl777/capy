// Rose Window (decision 70): the world as stained glass. Land and sea are cut into pieces (the Voronoi cells of a
// jittered grid of longitude and latitude, from a fixed seed, so every load cuts the same pieces), and the coastline
// is one more lead line, so a piece that crosses the coast becomes a land piece and a sea piece. Sea pieces are
// blues; land pieces are greens, golds and amethyst by climate and relief, pale opal on ice. Lead lines are dark and
// thick, and the glass darkens toward them, as if lit from behind. In Globe view the globe is the centre of a round
// window in stone tracery: plain geometry, no figures or symbols.

import { geoPath } from "d3-geo";
import { hash2, offscreen, pathContext, r1, seeded, type SurfaceFrame } from "./surface.ts";

const DEG = 180 / Math.PI;
/** Grid spacing in degrees, finest last; a frame uses the finest whose pieces are still this many pixels across. */
const STEPS = [8, 6, 4, 3, 2, 1.5];
const MIN_PIECE_PX = 30;

const SEA = ["#173a8a", "#1d4696", "#15347c", "#224c9e", "#1a4190", "#20449a"];
const SHALLOW = ["#2f7fc0", "#2a74b8", "#3a8cc8", "#3080bc"];
const TROPIC = ["#14935c", "#1a9e66", "#10864f"];
const TEMPERATE = ["#3f9a34", "#4aa43a", "#35902e", "#58a83c"];
const COLD = ["#2f7a5a", "#3a8460", "#2a6e52"];
const SAND = ["#e0a820", "#e8b83a", "#d49a18"];
// Mountains in amethyst, never red, so no patch of land reads as a warning.
const PEAK = ["#7a4a9a", "#6a3f8a", "#84559f"];
const ICE = ["#e4ecf5", "#d4e0ee", "#eef3f9"];

/** Pieces for one grid spacing: polygons in longitude and latitude, with their colours. */
export interface Pieces {
  step: number;
  /** Each piece's vertices, as a start index into `lon`/`lat`, and its vertex count. */
  start: Uint32Array;
  count: Uint8Array;
  lon: Float32Array;
  lat: Float32Array;
  clon: Float32Array;
  clat: Float32Array;
  /** Centre as a unit vector, for culling on the globe. */
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
  sea: string[];
  /** A land colour for pieces that touch land, or "" for open sea. */
  land: string[];
}

export class GlassCache {
  pieces = new Map<number, Pieces>();
  for?: unknown;
  texture?: { key: string; pattern: CanvasPattern };
  tracery?: { key: string; canvas: HTMLCanvasElement };
}

type Poly = [number, number][];

/** Keep the part of a convex polygon on the side of the line through `m` nearer to `a` than to `b`. */
function clipHalf(poly: Poly, ax: number, ay: number, bx: number, by: number): Poly {
  const nx = bx - ax, ny = by - ay;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const side = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/**
 * Cut the world into pieces: one seed per grid cell, jittered by a fixed hash, and each piece the part of the plane
 * nearer its seed than any other. Pure apart from the land tests passed in, so it can be tested.
 */
export function buildPieces(
  step: number,
  isLand: (lon: number, lat: number) => boolean,
  isIce: (lon: number, lat: number) => boolean,
  peaks: readonly [number, number][],
  dunes: readonly [number, number][],
): Pieces {
  const cols = Math.round(360 / step), rows = Math.round(180 / step);
  const sx = new Float64Array(cols * rows), sy = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      sx[j * cols + i] = -180 + (i + 0.15 + 0.7 * hash2(i, j)) * step;
      sy[j * cols + i] = -90 + (j + 0.15 + 0.7 * hash2(j + 911, i + 37)) * step;
    }
  // The piece a point falls in is its nearest seed's, found among the seeds of the grid cells around it.
  const nearest = (lon: number, lat: number) => {
    const ci = Math.floor((lon + 180) / step), cj = Math.floor((lat + 90) / step);
    let best = -1, bd = Infinity;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const j = cj + dj;
        if (j < 0 || j >= rows) continue;
        const ii = (((ci + di) % cols) + cols) % cols;
        const shift = ci + di < 0 ? -360 : ci + di >= cols ? 360 : 0;
        const k = j * cols + ii;
        const d = (sx[k]! + shift - lon) ** 2 + (sy[k]! - lat) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    return best;
  };
  const peakN = new Uint16Array(cols * rows), duneN = new Uint16Array(cols * rows);
  for (const [lon, lat] of peaks) {
    const k = nearest(lon, lat);
    if (k >= 0) peakN[k]!++;
  }
  for (const [lon, lat] of dunes) {
    const k = nearest(lon, lat);
    if (k >= 0) duneN[k]!++;
  }
  // Every piece with any land in it, read from the land test every half degree, so small islands are not missed.
  const hasLand = new Uint8Array(cols * rows);
  for (let lat = -89.75; lat < 90; lat += 0.5)
    for (let lon = -179.75; lon < 180; lon += 0.5) {
      if (!isLand(lon, lat)) continue;
      const k = nearest(lon, lat);
      if (k >= 0) hasLand[k] = 1;
    }
  const lons: number[] = [], lats: number[] = [];
  const n = cols * rows;
  const start = new Uint32Array(n), count = new Uint8Array(n);
  const clon = new Float32Array(n), clat = new Float32Array(n);
  const ux = new Float32Array(n), uy = new Float32Array(n), uz = new Float32Array(n);
  const sea: string[] = new Array(n), land: string[] = new Array(n);
  const pick = (list: string[], k: number) => list[Math.floor(hash2(k * 3 + 1, k * 7 + 5) * list.length)]!;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = sx[k]!, y = sy[k]!;
      let poly: Poly = [
        [x - 2.2 * step, Math.max(-90, y - 2.2 * step)],
        [x + 2.2 * step, Math.max(-90, y - 2.2 * step)],
        [x + 2.2 * step, Math.min(90, y + 2.2 * step)],
        [x - 2.2 * step, Math.min(90, y + 2.2 * step)],
      ];
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          if (!di && !dj) continue;
          const jj = j + dj;
          if (jj < 0 || jj >= rows) continue;
          const ii = (((i + di) % cols) + cols) % cols;
          const shift = i + di < 0 ? -360 : i + di >= cols ? 360 : 0;
          const o = jj * cols + ii;
          poly = clipHalf(poly, x, y, sx[o]! + shift, sy[o]!);
        }
      start[k] = lons.length;
      count[k] = Math.min(255, poly.length);
      let cxs = 0, cys = 0;
      for (const [px, py] of poly.slice(0, 255)) {
        lons.push(px);
        lats.push(py);
        cxs += px;
        cys += py;
      }
      const cx = cxs / poly.length, cy = cys / poly.length;
      clon[k] = cx;
      clat[k] = cy;
      const l = cx / DEG, p = cy / DEG;
      ux[k] = Math.cos(p) * Math.cos(l);
      uy[k] = Math.cos(p) * Math.sin(l);
      uz[k] = Math.sin(p);
      // Land if the centre or any corner or edge midpoint is land, so no coast is missed.
      let touches = hasLand[k] === 1 || isLand(cx, cy);
      for (let v = 0; v < poly.length && !touches; v++) {
        const a = poly[v]!, b = poly[(v + 1) % poly.length]!;
        touches = isLand(a[0], a[1]) || isLand((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      sea[k] = touches ? pick(SHALLOW, k) : pick(SEA, k);
      const alat = Math.abs(cy);
      land[k] = !touches
        ? ""
        : isIce(cx, cy) || alat > 70
          ? pick(ICE, k)
          : peakN[k]! >= Math.max(3, step * 1.2)
            ? pick(PEAK, k)
            : duneN[k]! >= 2
              ? pick(SAND, k)
              : alat < 18
                ? pick(TROPIC, k)
                : alat > 52
                  ? pick(COLD, k)
                  : pick(TEMPERATE, k);
    }
  return { step, start, count, lon: Float32Array.from(lons), lat: Float32Array.from(lats), clon, clat, ux, uy, uz, sea, land };
}

/** Streaks and seeds in the glass, drawn once and laid over it in soft light. */
function texture(f: SurfaceFrame, cache: GlassCache): CanvasPattern {
  const key = `${f.dpr}`;
  if (cache.texture?.key === key) return cache.texture.pattern;
  const size = 160;
  const [tile, g] = offscreen(size, size, f.dpr);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, size, size);
  const rnd = seeded(41);
  g.lineCap = "round";
  for (let i = 0; i < 60; i++) {
    const x = rnd() * size, y = rnd() * size, len = 6 + rnd() * 26, a = -0.6 + rnd() * 0.5;
    g.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
    g.lineWidth = 0.6 + rnd() * 2.2;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + len * Math.cos(a), y + oy + len * Math.sin(a));
        g.stroke();
      }
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * size, y = rnd() * size;
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath();
    g.arc(x, y, 0.5 + rnd() * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  const pattern = f.ctx.createPattern(tile, "repeat")!;
  pattern.setTransform(new DOMMatrix().scale(1 / f.dpr));
  cache.texture = { key, pattern };
  return pattern;
}

export function drawGlass(f: SurfaceFrame, cache: GlassCache) {
  const { ctx, w, h, proj, mode } = f;
  const globe = mode === "3d";
  const R = proj.scale();
  const [gx, gy] = proj.translate();
  const pxDeg = R / DEG;
  const step = [...STEPS].reverse().find((s) => s * pxDeg >= MIN_PIECE_PX) ?? STEPS[0]!;
  if (cache.for !== f.isLand) {
    cache.pieces.clear();
    cache.for = f.isLand;
  }
  let pc = cache.pieces.get(step);
  if (!pc) {
    pc = buildPieces(step, f.isLand, f.isIce, f.relief?.peaks ?? [], f.relief?.dunes ?? []);
    // Relief arrives after the first frames; pieces cut before it are cut again once it is here.
    if (f.relief) cache.pieces.set(step, pc);
  }

  // Which pieces can be on screen, and each vertex on screen. On the globe a vertex past the rim is pushed out to
  // the rim, and the sphere clips the piece.
  const n = pc.start.length;
  const seaText = new Map<string, string[]>();
  const landText = new Map<string, string[]>();
  const lead: string[] = [];
  const add = (map: Map<string, string[]>, col: string, text: string) => {
    const l = map.get(col);
    if (l) l.push(text);
    else map.set(col, [text]);
  };
  const l0 = f.lon / DEG, p0 = f.lat / DEG;
  const cx0 = Math.cos(p0) * Math.cos(l0), cy0 = Math.cos(p0) * Math.sin(l0), cz0 = Math.sin(p0);
  const halfLon = (w / 2) / pxDeg + step * 2.5;
  const halfLat = (h / 2) / pxDeg + step * 2.5;
  const margin = step * pxDeg * 2.5;
  for (let k = 0; k < n; k++) {
    let text = "";
    const s = pc.start[k]!, c = pc.count[k]!;
    if (c < 3) continue;
    if (globe) {
      if (pc.ux[k]! * cx0 + pc.uy[k]! * cy0 + pc.uz[k]! * cz0 < -0.08) continue;
      // Zoomed in, most of the near side is off screen.
      const cp = proj([pc.clon[k]!, pc.clat[k]!])!;
      if (cp[0] < -margin || cp[1] < -margin || cp[0] > w + margin || cp[1] > h + margin) continue;
      for (let v = 0; v < c; v++) {
        const lon = pc.lon[s + v]!, lat = pc.lat[s + v]!;
        let q = proj([lon, lat])!;
        const a = lat / DEG, b = lon / DEG;
        const dot = Math.cos(a) * Math.cos(b) * cx0 + Math.cos(a) * Math.sin(b) * cy0 + Math.sin(a) * cz0;
        if (dot < 0) {
          const dx = q[0] - gx, dy = q[1] - gy, d = Math.hypot(dx, dy) || 1;
          q = [gx + (dx / d) * R * 1.05, gy + (dy / d) * R * 1.05];
        }
        text += `${v ? "L" : "M"}${r1(q[0])} ${r1(q[1])}`;
      }
    } else {
      const dl = ((((pc.clon[k]! - f.lon) % 360) + 540) % 360) - 180;
      if (Math.abs(dl) > halfLon || Math.abs(pc.clat[k]! - f.lat) > halfLat) continue;
      for (let v = 0; v < c; v++) {
        const x = gx + (dl + pc.lon[s + v]! - pc.clon[k]!) * pxDeg;
        const y = gy - (pc.lat[s + v]! - f.lat) * pxDeg;
        text += `${v ? "L" : "M"}${r1(x)} ${r1(y)}`;
      }
    }
    text += "Z";
    add(seaText, pc.sea[k]!, text);
    if (pc.land[k]) add(landText, pc.land[k]!, text);
    lead.push(text);
  }

  const sphere = new Path2D();
  if (globe) sphere.arc(gx, gy, R, 0, Math.PI * 2);
  else sphere.rect(0, 0, w, h);
  const landPath = new Path2D();
  geoPath(proj, pathContext(landPath))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  const leadPath = new Path2D(lead.join(""));

  ctx.save();
  ctx.clip(sphere);
  for (const [col, list] of seaText) {
    ctx.fillStyle = col;
    ctx.fill(new Path2D(list.join("")));
  }
  ctx.save();
  ctx.clip(landPath);
  // Land too small for the land test still gets land glass, not sea.
  ctx.fillStyle = TEMPERATE[0]!;
  ctx.fillRect(0, 0, w, h);
  for (const [col, list] of landText) {
    ctx.fillStyle = col;
    ctx.fill(new Path2D(list.join("")));
  }
  ctx.restore();
  // Streaks and seeds in the glass.
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = texture(f, cache);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // Lit from behind: the glass darkens toward its lead, and the whole window toward its edge.
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(12,8,24,0.2)";
  ctx.lineWidth = 11;
  ctx.stroke(leadPath);
  ctx.stroke(coast);
  ctx.strokeStyle = "rgba(12,8,24,0.24)";
  ctx.lineWidth = 6;
  ctx.stroke(leadPath);
  ctx.stroke(coast);
  const vignette = globe
    ? ctx.createRadialGradient(gx - R * 0.15, gy - R * 0.2, R * 0.2, gx, gy, R)
    : ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vignette.addColorStop(0, "rgba(255,244,210,0.12)");
  vignette.addColorStop(0.6, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(8,4,16,0.4)");
  ctx.fillStyle = vignette;
  ctx.fill(sphere);
  // The lead itself: dark came with a faint highlight along its ridge.
  ctx.strokeStyle = "#16121c";
  ctx.lineWidth = 2;
  ctx.stroke(leadPath);
  ctx.lineWidth = f.theme.coastWidth;
  ctx.stroke(coast);
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 0.7;
  ctx.stroke(leadPath);
  ctx.restore();

  if (globe) drawTracery(f, cache, gx, gy, R);
}

const PETALS = 24;
const PETAL_GLASS = ["#b0283f", "#1f4fa8", "#d9a21a", "#1a9a66"];

/** The stone around the globe: a ring of pointed lights between radial mullions, roundels between their tips. */
function drawTracery(f: SurfaceFrame, cache: GlassCache, cx: number, cy: number, R: number) {
  const { ctx, w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}:${Math.round(cx)}:${Math.round(cy)}:${Math.round(R)}`;
  if (cache.tracery?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    const r0 = R * 1.05, r1_ = R * 1.2, r2 = R * 1.32, rOut = R * 1.38;
    // The stone ring.
    const ring = new Path2D();
    ring.arc(cx, cy, rOut, 0, Math.PI * 2);
    ring.arc(cx, cy, R, 0, Math.PI * 2, true);
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 18;
    const stone = g.createRadialGradient(cx - R * 0.4, cy - R * 0.5, R * 0.2, cx, cy, rOut);
    stone.addColorStop(0, "#b3aa9a");
    stone.addColorStop(0.7, "#8c8374");
    stone.addColorStop(1, "#5e574c");
    g.fillStyle = stone;
    g.fill(ring);
    g.restore();
    // Each light: straight sides along the radius, a pointed arch at the outer end.
    const lights = new Path2D();
    const roundels = new Path2D();
    const a = (Math.PI / PETALS) * 0.48;
    const petal = (th: number) => {
      const p = new Path2D();
      const at = (r: number, off: number): [number, number] => [cx + r * Math.cos(th + off), cy + r * Math.sin(th + off)];
      const hw0 = a * 0.95;
      const [bx0, by0] = at(r0, -hw0), [bx1, by1] = at(r0, hw0);
      const [sx0, sy0] = at(r1_, -a), [sx1, sy1] = at(r1_, a);
      const [tx, ty] = at(r2, 0);
      const [kx0, ky0] = at(r1_ + (r2 - r1_) * 0.62, -a * 1.02), [kx1, ky1] = at(r1_ + (r2 - r1_) * 0.62, a * 1.02);
      p.moveTo(bx0, by0);
      p.lineTo(sx0, sy0);
      p.quadraticCurveTo(kx0, ky0, tx, ty);
      p.quadraticCurveTo(kx1, ky1, sx1, sy1);
      p.lineTo(bx1, by1);
      p.closePath();
      return p;
    };
    for (let i = 0; i < PETALS; i++) {
      const th = (i / PETALS) * Math.PI * 2 - Math.PI / 2;
      const p = petal(th);
      lights.addPath(p);
      const [mx, my] = [cx + (r0 + r1_) / 2 * Math.cos(th), cy + (r0 + r1_) / 2 * Math.sin(th)];
      const glow = g.createRadialGradient(mx, my, 0, mx, my, (r2 - r0) * 0.7);
      const col = PETAL_GLASS[i % PETAL_GLASS.length]!;
      glow.addColorStop(0, "#fff3cf");
      glow.addColorStop(0.25, col);
      glow.addColorStop(1, shade(col, 0.45));
      g.fillStyle = glow;
      g.fill(p);
      // A roundel between two lights, near the rim.
      const tr = th + Math.PI / PETALS;
      const rr = R * 0.03;
      const [qx, qy] = [cx + (rOut - rr * 1.6) * Math.cos(tr), cy + (rOut - rr * 1.6) * Math.sin(tr)];
      const disc = new Path2D();
      disc.arc(qx, qy, rr, 0, Math.PI * 2);
      roundels.addPath(disc);
      const rg = g.createRadialGradient(qx, qy, 0, qx, qy, rr);
      rg.addColorStop(0, "#fff3cf");
      rg.addColorStop(0.35, PETAL_GLASS[(i + 2) % PETAL_GLASS.length]!);
      rg.addColorStop(1, shade(PETAL_GLASS[(i + 2) % PETAL_GLASS.length]!, 0.45));
      g.fillStyle = rg;
      g.fill(disc);
    }
    // Joints in the stone between the lights.
    g.beginPath();
    for (let i = 0; i < PETALS; i++) {
      const tr = ((i + 0.5) / PETALS) * Math.PI * 2 - Math.PI / 2;
      g.moveTo(cx + R * 1.012 * Math.cos(tr), cy + R * 1.012 * Math.sin(tr));
      g.lineTo(cx + (rOut - R * 0.1) * Math.cos(tr), cy + (rOut - R * 0.1) * Math.sin(tr));
    }
    g.strokeStyle = "rgba(40,32,26,0.45)";
    g.lineWidth = 1;
    g.stroke();
    // Lead around every light, then the stone's carved edges.
    g.lineJoin = "round";
    g.strokeStyle = "#16121c";
    g.lineWidth = 2.4;
    g.stroke(lights);
    g.stroke(roundels);
    g.strokeStyle = "rgba(255,248,230,0.35)";
    g.lineWidth = 1;
    for (const r of [R + 1.5, rOut - 3]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = "rgba(30,24,20,0.7)";
    g.lineWidth = 1.4;
    for (const r of [R * 1.012, rOut]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    // The globe's own lead ring.
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.strokeStyle = "#16121c";
    g.lineWidth = 4;
    g.stroke();
    cache.tracery = { key, canvas };
  }
  ctx.drawImage(cache.tracery.canvas, 0, 0, w, h);
}

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((v >> 16) & 255) * k)},${Math.round(((v >> 8) & 255) * k)},${Math.round((v & 255) * k)})`;
}
