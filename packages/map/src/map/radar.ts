// Radar Sweep (decision 75): the map in a round weather-radar scope. Land is a speckle of phosphor returns fixed to
// the world, range rings and bearing ticks are centred on the reticle, and a beam turns once every few seconds.
// Land brightens a little as the beam passes and fades back; places get a soft halo as it passes and never change
// size or symbol. No friend-or-foe symbols, target boxes or tracks: it is a weather scope. With reduced motion there
// is no beam. No text, no borders.

import { geoGraticule, geoPath } from "d3-geo";
import { cachedPicture, hash2, offscreen, pathContext, Picture, type SurfaceFrame, type SurfaceResult, type SurfaceSpot } from "./surface.ts";

const DEG = 180 / Math.PI;
/** One turn of the beam, in milliseconds. */
const TURN_MS = 6000;
/** How far behind the beam the afterglow reaches, in radians. */
const TRAIL = 1.15;
const GRID = geoGraticule().step([30, 30])();

const PHOSPHOR = "120,255,170";

/** What the scope keeps between frames: the housing, the glass, and the map as last drawn. */
export class RadarCache {
  housing?: { key: string; canvas: HTMLCanvasElement };
  glass?: { key: string; canvas: HTMLCanvasElement };
  picture = new Picture();
  land?: { key: string; path: Path2D };
  speckle?: HTMLCanvasElement;
}

/** The scope's centre and radius on screen. */
function scope(w: number, h: number): [number, number, number] {
  return [w / 2, h / 2, Math.min(w, h) * (Math.min(w, h) < 500 ? 0.485 : 0.47)];
}

/**
 * The returns: clumps of phosphor speckle from smooth noise in three octaves, each repeating with the tile so it has
 * no seam, set in two-pixel bins like a scope's range cells. Bright cores in dimmer clumps, all one green.
 */
function speckleTile(): HTMLCanvasElement {
  const N = 128;
  const small = document.createElement("canvas");
  small.width = small.height = N;
  const g = small.getContext("2d")!;
  const img = g.createImageData(N, N);
  const octave = (x: number, y: number, cell: number, seed: number) => {
    const m = N / cell;
    const lat = (i: number, j: number) => hash2((((i % m) + m) % m) + seed * 31, (((j % m) + m) % m) + seed * 17);
    const i = Math.floor(x / cell), j = Math.floor(y / cell);
    const fx = x / cell - i, fy = y / cell - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat(i, j), b = lat(i + 1, j), c = lat(i, j + 1), d = lat(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const n = octave(x, y, 16, 1) * 0.5 + octave(x, y, 8, 2) * 0.3 + octave(x, y, 4, 3) * 0.2;
      const clump = Math.min(1, Math.max(0, (n - 0.42) / 0.3));
      const grain = hash2(x + 0.5, y + 0.25);
      // Sparse everywhere, dense and bright in the clumps, so land reads as returns, not a fill.
      const on = grain < 0.14 + 0.5 * clump;
      const k = (y * N + x) * 4;
      img.data[k] = 120 + Math.round(90 * clump * clump);
      img.data[k + 1] = 255;
      img.data[k + 2] = 170 + Math.round(40 * clump);
      img.data[k + 3] = on ? Math.round(60 + 130 * clump * (0.4 + 0.6 * hash2(y + 0.7, x + 0.1))) : 0;
    }
  g.putImageData(img, 0, 0);
  const c = document.createElement("canvas");
  c.width = c.height = N * 2;
  const cg = c.getContext("2d")!;
  cg.imageSmoothingEnabled = false;
  cg.drawImage(small, 0, 0, N * 2, N * 2);
  return c;
}

/** The console around the scope: enamel, a machined bezel, bearing ticks and two knobs. Drawn once per size. */
function housing(w: number, h: number, dpr: number): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const [cx, cy, S] = scope(w, h);
  const face = g.createLinearGradient(0, 0, 0, h);
  face.addColorStop(0, "#39433c");
  face.addColorStop(1, "#262e29");
  g.fillStyle = face;
  g.fillRect(0, 0, w, h);
  // Hammered enamel: a fine, soft grain.
  for (let i = 0; i < 1800; i++) {
    const x = hash2(i, 3) * w, y = hash2(i, 7) * h, r = 1.5 + hash2(i, 11) * 4;
    g.fillStyle = hash2(i, 13) < 0.5 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.035)";
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Two tuning knobs on the console, where the scope leaves room: large knurled discs, never mistaken for places.
  const kr = Math.min(w, h) * 0.05;
  for (const [x, y] of [
    [kr * 2.2, h - kr * 2.2],
    [w - kr * 2.2, kr * 2.2],
  ] as const) {
    if (Math.hypot(x - cx, y - cy) < S * 1.08 + kr * 1.6 || kr < 18) continue;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.arc(x + 3, y + 4, kr * 1.12, 0, Math.PI * 2);
    g.fill();
    const skirt = g.createLinearGradient(x - kr, y - kr, x + kr, y + kr);
    skirt.addColorStop(0, "#5c6660");
    skirt.addColorStop(1, "#1c221e");
    g.fillStyle = skirt;
    g.beginPath();
    g.arc(x, y, kr * 1.12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      g.moveTo(x + Math.cos(t) * kr * 0.8, y + Math.sin(t) * kr * 0.8);
      g.lineTo(x + Math.cos(t) * kr * 1.08, y + Math.sin(t) * kr * 1.08);
    }
    g.stroke();
    const cap = g.createRadialGradient(x - kr * 0.3, y - kr * 0.35, 0, x, y, kr * 0.8);
    cap.addColorStop(0, "#9aa49d");
    cap.addColorStop(1, "#2e3531");
    g.fillStyle = cap;
    g.beginPath();
    g.arc(x, y, kr * 0.78, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(230,240,232,0.8)";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + kr * 0.5, y - kr * 0.5);
    g.stroke();
  }
  // The bezel: a machined ring, lit from the top left, around a dark recess.
  const B = Math.max(10, S * 0.055);
  const ring = g.createLinearGradient(cx - S, cy - S, cx + S, cy + S);
  ring.addColorStop(0, "#b8c2bb");
  ring.addColorStop(0.45, "#6d776f");
  ring.addColorStop(1, "#2a302c");
  g.beginPath();
  g.arc(cx, cy, S + B, 0, Math.PI * 2);
  g.fillStyle = ring;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, S + B * 0.45, 0, Math.PI * 2);
  g.fillStyle = "#1a201c";
  g.fill();
  // Bearing ticks on the bezel's inner lip: every 5 degrees, longer every 30, a notch at the top.
  g.strokeStyle = "rgba(220,235,225,0.75)";
  g.lineCap = "round";
  for (let a = 0; a < 360; a += 5) {
    const t = (a - 90) / DEG;
    const long = a % 30 === 0;
    const r0 = S + B * 0.08, r1 = S + B * (long ? 0.42 : 0.24);
    g.lineWidth = long ? 1.6 : 0.9;
    g.beginPath();
    g.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
    g.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
    g.stroke();
  }
  g.fillStyle = "rgba(220,235,225,0.85)";
  g.beginPath();
  g.moveTo(cx, cy - S - B * 0.5);
  g.lineTo(cx - B * 0.35, cy - S - B * 0.98);
  g.lineTo(cx + B * 0.35, cy - S - B * 0.98);
  g.closePath();
  g.fill();
  // The dark glass of the tube, a little lighter in the middle.
  const tube = g.createRadialGradient(cx, cy, 0, cx, cy, S);
  tube.addColorStop(0, "#07251a");
  tube.addColorStop(0.8, "#041a11");
  tube.addColorStop(1, "#020c07");
  g.beginPath();
  g.arc(cx, cy, S, 0, Math.PI * 2);
  g.fillStyle = tube;
  g.fill();
  return c;
}

/** Range rings, bearing lines and the glass's shine and edge shadow, over the picture. Drawn once per size. */
function glass(w: number, h: number, dpr: number): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const [cx, cy, S] = scope(w, h);
  g.save();
  g.beginPath();
  g.arc(cx, cy, S, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = `rgba(${PHOSPHOR},0.28)`;
  g.lineWidth = 1;
  for (const k of [0.25, 0.5, 0.75]) {
    g.beginPath();
    g.arc(cx, cy, S * k, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([2, 5]);
  g.strokeStyle = `rgba(${PHOSPHOR},0.16)`;
  for (let a = 0; a < 180; a += 30) {
    const t = a / DEG;
    g.beginPath();
    g.moveTo(cx - Math.cos(t) * S, cy - Math.sin(t) * S);
    g.lineTo(cx + Math.cos(t) * S, cy + Math.sin(t) * S);
    g.stroke();
  }
  g.setLineDash([]);
  // The glass: darker at its edge where the tube curves away, a soft shine at the top left.
  const edge = g.createRadialGradient(cx, cy, S * 0.72, cx, cy, S);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,8,4,0.55)");
  g.fillStyle = edge;
  g.fillRect(cx - S, cy - S, S * 2, S * 2);
  const shine = g.createRadialGradient(cx - S * 0.45, cy - S * 0.55, 0, cx - S * 0.45, cy - S * 0.55, S * 0.75);
  shine.addColorStop(0, "rgba(220,255,235,0.09)");
  shine.addColorStop(1, "rgba(220,255,235,0)");
  g.fillStyle = shine;
  g.fillRect(cx - S, cy - S, S * 2, S * 2);
  g.restore();
  return c;
}

export function drawRadar(f: SurfaceFrame, cache: RadarCache): SurfaceResult {
  const { ctx, w, h, dpr, proj, mode, theme: t } = f;
  const [cx, cy, S] = scope(w, h);
  const globe = mode === "3d";
  const R = proj.scale();

  const hk = `${w}:${h}:${dpr}`;
  if (cache.housing?.key !== hk) cache.housing = { key: hk, canvas: housing(w, h, dpr) };
  if (cache.glass?.key !== hk) cache.glass = { key: hk, canvas: glass(w, h, dpr) };
  const speckle = (cache.speckle ??= speckleTile());
  ctx.drawImage(cache.housing.canvas, 0, 0, w, h);

  // The map inside the scope, drawn again only when the view moves: the beam turns over the same picture.
  const pk = `${hk}:${mode}:${f.lon.toFixed(5)}:${f.lat.toFixed(5)}:${f.zoom.toFixed(5)}:${f.mapId}`;
  cachedPicture(cache.picture, f, pk, (g) => {
    g.beginPath();
    g.arc(cx, cy, S, 0, Math.PI * 2);
    g.clip();
    if (globe) {
      // The globe inside the scope: a slightly lighter disc with a faint grid, so it reads as a sphere.
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fillStyle = "rgba(20,70,45,0.35)";
      g.fill();
      g.strokeStyle = `rgba(${PHOSPHOR},0.3)`;
      g.lineWidth = 1.2;
      g.stroke();
      const grid = new Path2D();
      geoPath(f.view as never, pathContext(grid))(GRID);
      g.strokeStyle = `rgba(${PHOSPHOR},0.07)`;
      g.lineWidth = 0.7;
      g.stroke(grid);
    }
    const land = new Path2D();
    geoPath(f.view as never, pathContext(land))(f.map.land);
    const coast = new Path2D();
    geoPath(f.view as never, pathContext(coast))(f.map.coast);
    g.fillStyle = t.land;
    g.fill(land);
    // The speckle is tied to the world, so it moves with the land: on the globe, with the point under the centre.
    const pat = g.createPattern(speckle, "repeat")!;
    let ax: number, ay: number;
    if (globe) {
      ax = cx - (f.lon / DEG) * R;
      ay = cy + (f.lat / DEG) * R;
    } else {
      const a = proj([0, 0]) ?? [cx, cy];
      [ax, ay] = [a[0], a[1]];
    }
    const size = 256;
    pat.setTransform(new DOMMatrix().translate(((ax % size) + size) % size, ((ay % size) + size) % size));
    g.fillStyle = pat;
    g.globalAlpha = 0.85;
    g.fill(land);
    g.globalAlpha = 1;
    g.strokeStyle = `rgba(${PHOSPHOR},0.45)`;
    g.lineWidth = 0.8;
    g.stroke(coast);
    cache.land = { key: pk, path: land };
  });
  ctx.drawImage(cache.glass.canvas, 0, 0, w, h);

  const clip = new Path2D();
  clip.arc(cx, cy, S, 0, Math.PI * 2);
  const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < S - 2;
  if (f.still) return { inside, clip };

  // The beam, clockwise from the top: a bright leading edge and a trail that fades behind it.
  const beam = ((f.now ?? 0) % TURN_MS) / TURN_MS * Math.PI * 2 - Math.PI / 2;
  const cone = ctx.createConicGradient(beam - TRAIL, cx, cy);
  const tf = TRAIL / (Math.PI * 2);
  cone.addColorStop(0, `rgba(${PHOSPHOR},0)`);
  cone.addColorStop(tf * 0.6, `rgba(${PHOSPHOR},0.04)`);
  cone.addColorStop(tf * 0.97, `rgba(${PHOSPHOR},0.1)`);
  cone.addColorStop(tf, `rgba(${PHOSPHOR},0.15)`);
  cone.addColorStop(Math.min(1, tf + 0.002), `rgba(${PHOSPHOR},0)`);
  cone.addColorStop(1, `rgba(${PHOSPHOR},0)`);
  ctx.save();
  ctx.clip(clip);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = cone;
  ctx.fillRect(cx - S, cy - S, S * 2, S * 2);
  // Land returns glow a little as the beam passes, then fade back.
  const after = ctx.createConicGradient(beam - TRAIL, cx, cy);
  after.addColorStop(0, `rgba(${PHOSPHOR},0)`);
  after.addColorStop(tf, `rgba(${PHOSPHOR},0.12)`);
  after.addColorStop(Math.min(1, tf + 0.002), `rgba(${PHOSPHOR},0)`);
  after.addColorStop(1, `rgba(${PHOSPHOR},0)`);
  ctx.fillStyle = after;
  if (cache.land) ctx.fill(cache.land.path);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(${PHOSPHOR},0.7)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(beam) * S, cy + Math.sin(beam) * S);
  ctx.stroke();
  ctx.restore();

  // Places the beam has just passed get a soft halo that fades as the beam moves on. Their marker is unchanged.
  const under = (spots: SurfaceSpot[]) => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of spots) {
      const a = Math.atan2(s.y - cy, s.x - cx);
      const behind = (((beam - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (behind > TRAIL) continue;
      const k = 1 - behind / TRAIL;
      const rr = s.r * 2.4 + 7;
      const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.6, s.x, s.y, rr);
      const col = s.fresh ? "255,196,77" : PHOSPHOR;
      g.addColorStop(0, `rgba(${col},${(0.5 * k * k).toFixed(3)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2);
    }
    ctx.restore();
  };
  return { inside, clip, under };
}
