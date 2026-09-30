// Stadium Jumbotron (decision 75): the map on a giant screen seen from the stands. The screen hangs a little to one
// side and above, so the "stadium" warp turns it in perspective; land, sea and places all go through it, and tapping
// reads it back. The picture is made of LED pixels. Floodlight towers stand at the top corners of a night sky, and
// the crowd sits in silhouette along the bottom, a wave passing slowly along it (still for reduced motion). No team,
// league or sponsor names or colours, no flags, no scores, and no text on the canvas.

import { geoGraticule, geoPath } from "d3-geo";
import { cachedPicture, hash2, offscreen, pathContext, Picture, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([15, 15])();
const SPHERE = { type: "Sphere" } as const;
/** One pass of the crowd's wave along the stands, in milliseconds. */
const WAVE_MS = 11000;
/** LED pitch on the screen, in the flat picture's pixels. */
const LED = 4;

/** What the stadium keeps between frames: the night, the lights, the screen's frame, its LED mesh, the picture. */
export class StadiumCache {
  back?: { key: string; canvas: HTMLCanvasElement; quad: Path2D; crowdTop: number };
  leds?: { key: string; canvas: HTMLCanvasElement };
  picture = new Picture();
  people?: { key: string; list: Person[] };
}

interface Person {
  x: number;
  y: number;
  /** Head radius. */
  r: number;
  row: number;
}

/** The screen's outline: the flat picture's frame, grown by `grow` pixels, through the warp. */
function quadOf(f: SurfaceFrame, grow: number): Path2D {
  const { w, h, warp } = f;
  const p = new Path2D();
  const pts: [number, number][] = [
    [-grow, -grow],
    [w + grow, -grow],
    [w + grow, h + grow],
    [-grow, h + grow],
  ];
  pts.forEach(([x, y], i) => {
    const [sx, sy] = warp ? warp.fwd(x, y) : [x, y];
    if (i) p.lineTo(sx, sy);
    else p.moveTo(sx, sy);
  });
  p.closePath();
  return p;
}

/** A floodlight tower: a lattice mast and a bank of lamps, blooming into the haze. */
function tower(g: CanvasRenderingContext2D, x: number, y: number, s: number, lean: number, h: number) {
  g.save();
  g.strokeStyle = "#0a0e18";
  g.lineWidth = Math.max(2, s * 0.12);
  g.beginPath();
  g.moveTo(x - s * 0.5, y + s * 0.6);
  g.lineTo(x - s * 0.15 + lean, h);
  g.moveTo(x + s * 0.5, y + s * 0.6);
  g.lineTo(x + s * 0.15 + lean, h);
  g.stroke();
  g.lineWidth = Math.max(1, s * 0.04);
  g.beginPath();
  for (let k = 0; k < 14; k++) {
    const t0 = k / 14, t1 = (k + 1) / 14;
    const ya = y + s * 0.6 + (h - y - s * 0.6) * t0, yb = y + s * 0.6 + (h - y - s * 0.6) * t1;
    const xa0 = x - s * 0.5 + (s * 0.35 + lean) * t0, xa1 = x + s * 0.5 + (-s * 0.35 + lean) * t0;
    const xb0 = x - s * 0.5 + (s * 0.35 + lean) * t1, xb1 = x + s * 0.5 + (-s * 0.35 + lean) * t1;
    g.moveTo(xa0, ya);
    g.lineTo(xb1, yb);
    g.moveTo(xa1, ya);
    g.lineTo(xb0, yb);
  }
  g.stroke();
  // The haze the lamps light up.
  const haze = g.createRadialGradient(x, y, 0, x, y, s * 7);
  haze.addColorStop(0, "rgba(220,235,255,0.45)");
  haze.addColorStop(0.3, "rgba(170,195,255,0.14)");
  haze.addColorStop(1, "rgba(170,195,255,0)");
  g.fillStyle = haze;
  g.fillRect(x - s * 7, y - s * 7, s * 14, s * 14);
  // The lamp bank: a frame holding four by three square lamps.
  g.fillStyle = "#121726";
  g.fillRect(x - s * 0.62, y - s * 0.5, s * 1.24, s * 1.05);
  const lw = s * 0.22;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const lx = x - s * 0.52 + i * s * 0.28, ly = y - s * 0.4 + j * s * 0.3;
      g.fillStyle = "#fbfdff";
      g.fillRect(lx, ly, lw, lw);
      g.fillStyle = "rgba(210,225,255,0.5)";
      g.fillRect(lx - 1, ly - 1, lw + 2, lw + 2);
    }
  g.restore();
}

/** The night, the floodlights, the screen's frame and its supports. Drawn once per size. */
function back(f: SurfaceFrame): { canvas: HTMLCanvasElement; quad: Path2D; crowdTop: number } {
  const { w, h, dpr } = f;
  const [c, g] = offscreen(w, h, dpr);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#02040c");
  sky.addColorStop(0.55, "#0c1733");
  sky.addColorStop(0.85, "#16244a");
  sky.addColorStop(1, "#0a1024");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // The far stand's rim, a dark curve behind the screen, with rows of seats as faint lines.
  g.fillStyle = "#070b17";
  g.beginPath();
  g.moveTo(0, h * 0.42);
  g.quadraticCurveTo(w / 2, h * 0.3, w, h * 0.42);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(120,150,210,0.08)";
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k < 14; k++) {
    const y = h * 0.42 + k * h * 0.035;
    g.moveTo(0, y);
    g.quadraticCurveTo(w / 2, y - h * 0.12 * (1 - k / 16), w, y);
  }
  g.stroke();
  const s = Math.max(16, Math.min(w, h) * 0.07);
  // Beams from each bank down across the field, then the towers themselves, below the Key button's corner.
  const ty = Math.max(s * 0.9, 58);
  for (const [x, dir] of [
    [s * 1.3, 1],
    [w - s * 1.3, -1],
  ] as const) {
    const beam = g.createLinearGradient(x, ty, x + dir * w * 0.4, h);
    beam.addColorStop(0, "rgba(200,220,255,0.16)");
    beam.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(x, ty);
    g.lineTo(x + dir * w * 0.18, h);
    g.lineTo(x + dir * w * 0.62, h);
    g.closePath();
    g.fill();
  }
  tower(g, s * 1.3, ty, s, -s * 0.2, h * 0.8);
  tower(g, w - s * 1.3, ty, s, s * 0.2, h * 0.8);
  // Two steel legs hold the screen up from behind the crowd.
  const quad = quadOf(f, 0);
  const warp = f.warp;
  if (warp) {
    g.fillStyle = "#0a0f1c";
    for (const fx of [0.22, 0.78]) {
      const [x0, y0] = warp.fwd(w * fx, h);
      g.fillRect(x0 - s * 0.18, y0, s * 0.36, h - y0);
    }
  }
  // The housing: a dark steel frame round the screen, lit a little along its top edge.
  g.save();
  g.shadowColor = "rgba(90,140,255,0.35)";
  g.shadowBlur = 30;
  g.fillStyle = "#151a26";
  g.fill(quadOf(f, Math.min(w, h) * 0.035));
  g.restore();
  g.strokeStyle = "#39445c";
  g.lineWidth = 2;
  g.stroke(quadOf(f, Math.min(w, h) * 0.035));
  g.fillStyle = "#010205";
  g.fill(quad);
  return { canvas: c, quad, crowdTop: h - Math.max(34, h * 0.1) };
}

/**
 * The LED mesh: dark lines between the rows and columns of LEDs, straight through the warp since it keeps lines
 * straight, and a faint glare across the screen's upper part. Drawn once per size, laid over the picture.
 */
function leds(f: SurfaceFrame, quad: Path2D): HTMLCanvasElement {
  const { w, h, dpr, warp } = f;
  const [c, g] = offscreen(w, h, dpr);
  const fw = (x: number, y: number) => (warp ? warp.fwd(x, y) : [x, y]);
  const out: string[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const a = fw(x0, y0), b = fw(x1, y1);
    out.push(`M${a[0]!.toFixed(1)} ${a[1]!.toFixed(1)}L${b[0]!.toFixed(1)} ${b[1]!.toFixed(1)}`);
  };
  for (let x = 0; x <= w; x += LED) line(x, 0, x, h);
  for (let y = 0; y <= h; y += LED) line(0, y, w, y);
  g.save();
  g.clip(quad);
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = 1.2;
  g.stroke(new Path2D(out.join("")));
  const [x0, y0] = fw(0, 0);
  const [x1, y1] = fw(w, h * 0.6);
  const glare = g.createLinearGradient(x0!, y0!, x1!, y1!);
  glare.addColorStop(0, "rgba(255,255,255,0.1)");
  glare.addColorStop(0.45, "rgba(255,255,255,0.02)");
  glare.addColorStop(0.46, "rgba(255,255,255,0)");
  g.fillStyle = glare;
  g.fillRect(0, 0, w, h);
  g.restore();
  return c;
}

/** Seats in rows along the bottom: a back row, smaller, and a front row, each person placed with a little jitter. */
function crowd(w: number, h: number): Person[] {
  const list: Person[] = [];
  const base = Math.max(6.5, Math.min(w, h) * 0.021);
  const rows = [
    { y: h - base * 3.6, r: base * 0.8, gap: base * 2.3 },
    { y: h - base * 1.2, r: base, gap: base * 2.8 },
  ];
  rows.forEach((row, k) => {
    for (let x = -row.gap * (k ? 0 : 0.5), i = 0; x < w + row.gap; x += row.gap, i++) {
      list.push({ x: x + (hash2(i, k + 3) - 0.5) * row.gap * 0.3, y: row.y + (hash2(i, k + 7) - 0.5) * base * 0.5, r: row.r * (0.9 + hash2(i, k + 11) * 0.2), row: k });
    }
  });
  return list;
}

export function drawStadium(f: SurfaceFrame, cache: StadiumCache): SurfaceResult {
  const { ctx, w, h, dpr, mode, theme: t } = f;
  const globe = mode === "3d";
  const key = `${w}:${h}:${dpr}:${mode}`;
  if (cache.back?.key !== key) {
    const b = back(f);
    cache.back = { key, ...b };
    cache.leds = { key, canvas: leds(f, b.quad) };
    cache.people = { key, list: crowd(w, h) };
  }
  const { quad, crowdTop } = cache.back;
  ctx.drawImage(cache.back.canvas, 0, 0, w, h);

  const pk = `${key}:${f.lon.toFixed(5)}:${f.lat.toFixed(5)}:${f.zoom.toFixed(5)}:${f.map === f.low ? "l" : "h"}`;
  cachedPicture(cache.picture, f, pk, (g) => {
    g.clip(quad);
    const path = (o: object) => {
      const p = new Path2D();
      geoPath(f.view as never, pathContext(p))(o as never);
      return p;
    };
    const sphere = path(SPHERE);
    if (globe) {
      // A broadcast backdrop behind the globe: a dark screen with soft rays from the middle.
      const [cx, cy] = f.warp ? f.warp.fwd(w / 2, h / 2) : [w / 2, h / 2];
      const bgd = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.5);
      bgd.addColorStop(0, "#123a7a");
      bgd.addColorStop(1, "#040a1c");
      g.fillStyle = bgd;
      g.fillRect(0, 0, w, h);
      const rays = g.createConicGradient(0, cx, cy);
      for (let i = 0; i <= 24; i++) rays.addColorStop(i / 24, i % 2 ? "rgba(120,170,255,0.07)" : "rgba(120,170,255,0)");
      g.fillStyle = rays;
      g.fillRect(0, 0, w, h);
    }
    g.fillStyle = t.ocean;
    g.fill(sphere);
    g.strokeStyle = t.graticule;
    g.lineWidth = 1;
    g.stroke(path(GRID));
    const land = path(f.map.land);
    g.fillStyle = t.land;
    g.fill(land);
    // Lighter toward the top, as broadcast graphics are lit.
    const lit = g.createLinearGradient(0, 0, 0, h);
    lit.addColorStop(0, "rgba(255,255,255,0.14)");
    lit.addColorStop(1, "rgba(0,0,0,0.12)");
    g.fillStyle = lit;
    g.fill(land);
    if (f.map.ice) {
      g.fillStyle = t.ice;
      g.fill(path(f.map.ice));
    }
    g.strokeStyle = t.coast;
    g.lineWidth = t.coastWidth;
    g.stroke(path(f.map.coast));
    if (globe) {
      const [cx, cy] = f.warp ? f.warp.fwd(w / 2, h / 2) : [w / 2, h / 2];
      const R = f.proj.scale();
      const shade = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
      shade.addColorStop(0, "rgba(255,255,255,0.1)");
      shade.addColorStop(0.6, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,20,0.45)");
      g.fillStyle = shade;
      g.fill(sphere);
      g.strokeStyle = "rgba(170,210,255,0.7)";
      g.lineWidth = 1.5;
      g.stroke(sphere);
    }
  });

  const warp = f.warp;
  const inside = (x: number, y: number) => {
    if (y > crowdTop - 6) return false;
    const [sx, sy] = warp ? warp.inv(x, y) : [x, y];
    return sx > 2 && sy > 2 && sx < w - 2 && sy < h - 2;
  };
  const over = () => {
    ctx.drawImage(cache.leds!.canvas, 0, 0, w, h);
    // The crowd, in silhouette against the glow of the field, the wave lifting people and their arms as it passes.
    const people = cache.people!.list;
    const glow = ctx.createLinearGradient(0, crowdTop - 30, 0, h);
    glow.addColorStop(0, "rgba(60,90,160,0)");
    glow.addColorStop(0.4, "rgba(60,90,160,0.3)");
    glow.addColorStop(1, "rgba(20,30,60,0.2)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, crowdTop - 30, w, h - crowdTop + 30);
    const span = w * 0.16;
    const at = f.still ? -1e9 : (((f.now ?? 0) % WAVE_MS) / WAVE_MS) * (w + span * 4) - span * 2;
    for (const row of [0, 1]) {
      const bodies: string[] = [];
      const arms: string[] = [];
      for (const p of people) {
        if (p.row !== row) continue;
        const up = Math.exp(-(((p.x - at) / span) ** 2));
        const lift = up * p.r * 2.2;
        const hx = p.x, hy = p.y - lift;
        const sw = p.r * 1.75;
        // Head and shoulders, down to the bottom of the frame.
        bodies.push(`M${(hx - p.r).toFixed(1)} ${hy.toFixed(1)}a${p.r.toFixed(1)} ${p.r.toFixed(1)} 0 1 1 ${(p.r * 2).toFixed(1)} 0a${p.r.toFixed(1)} ${p.r.toFixed(1)} 0 1 1 ${(-p.r * 2).toFixed(1)} 0Z`);
        const sy = hy + p.r * 0.8;
        bodies.push(`M${(hx - sw).toFixed(1)} ${(h + 2).toFixed(1)}L${(hx - sw).toFixed(1)} ${(sy + p.r * 0.7).toFixed(1)}Q${(hx - sw).toFixed(1)} ${sy.toFixed(1)} ${(hx - sw * 0.4).toFixed(1)} ${sy.toFixed(1)}L${(hx + sw * 0.4).toFixed(1)} ${sy.toFixed(1)}Q${(hx + sw).toFixed(1)} ${sy.toFixed(1)} ${(hx + sw).toFixed(1)} ${(sy + p.r * 0.7).toFixed(1)}L${(hx + sw).toFixed(1)} ${(h + 2).toFixed(1)}Z`);
        if (up > 0.35) {
          const reach = p.r * 2.6 * up;
          arms.push(`M${(hx - sw * 0.8).toFixed(1)} ${(sy + 2).toFixed(1)}L${(hx - sw * 1.1).toFixed(1)} ${(sy - reach).toFixed(1)}M${(hx + sw * 0.8).toFixed(1)} ${(sy + 2).toFixed(1)}L${(hx + sw * 1.1).toFixed(1)} ${(sy - reach).toFixed(1)}`);
        }
      }
      ctx.fillStyle = row ? "#010208" : "#070c1c";
      ctx.fill(new Path2D(bodies.join("")));
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(2, (people.find((p) => p.row === row)?.r ?? 6) * 0.55);
      ctx.lineCap = "round";
      ctx.stroke(new Path2D(arms.join("")));
    }
  };
  return { inside, clip: quad, over };
}
