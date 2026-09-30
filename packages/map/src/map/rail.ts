// Sleeper Car (decision 74, retooled): the world on a modern long-distance train's on-board route display. A deep
// navy screen with a fine grid of longitude and latitude; land as flat slate plates with a lit inner edge and a thin
// silver coast; mountains as small chevrons. The Equator, the tropics and the polar circles run across the sea as a
// route map's lines, red, blue and silver, with stop ticks every ten degrees; they pass under the land, so no line
// ever crosses a coast or runs over a country. In Globe view the same display shows the globe inside a fine dial of
// ticks. Nothing moves on its own. No text, and no line links one place to another.

import { geoDistance, geoGraticule, geoPath } from "d3-geo";
import { offscreen, pathContext, r1, type SurfaceFrame } from "./surface.ts";

const RED = "#e0313f";
const BLUE = "#3f82f0";
const SILVER = "#b9c6d6";
/** The route lines: fixed parallels of the globe, never anything drawn from a place or a region. */
export const ROUTE_LINES: readonly { lat: number; color: string }[] = [
  { lat: 66.56, color: SILVER },
  { lat: 23.44, color: BLUE },
  { lat: 0, color: RED },
  { lat: -23.44, color: BLUE },
  { lat: -66.56, color: SILVER },
];
const GRID = geoGraticule().step([10, 10])();
/** Each route line as a dense line string, so the globe draws it along its parallel rather than a great circle. */
const LINES = ROUTE_LINES.map((l) => ({
  ...l,
  geo: { type: "LineString", coordinates: Array.from({ length: 181 }, (_, i) => [-180 + i * 2, l.lat]) },
}));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class RailCache {
  dial?: { key: string; canvas: HTMLCanvasElement };
}

export function drawRail(f: SurfaceFrame, cache: RailCache) {
  const { ctx, w, h, proj, theme: t, mode } = f;
  const globe = mode === "3d";
  const [cx, cy] = proj.translate();
  const R = proj.scale();

  // The screen: navy, a little lighter at the top, like a lit display.
  const screen = ctx.createLinearGradient(0, 0, 0, h);
  screen.addColorStop(0, globe ? "#0c1a31" : "#0d1e39");
  screen.addColorStop(1, globe ? "#060e1c" : "#091629");
  ctx.fillStyle = screen;
  ctx.fillRect(0, 0, w, h);

  const sphere = new Path2D();
  if (globe) {
    const key = `${w}:${h}:${f.dpr}:${Math.round(R)}:${Math.round(cx)}:${Math.round(cy)}`;
    if (cache.dial?.key !== key) cache.dial = { key, canvas: dial(f, cx, cy, R) };
    ctx.drawImage(cache.dial.canvas, 0, 0, w, h);
    sphere.arc(cx, cy, R, 0, Math.PI * 2);
    const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    sea.addColorStop(0, "#17305a");
    sea.addColorStop(1, t.ocean);
    ctx.fillStyle = sea;
    ctx.fill(sphere);
    ctx.save();
    ctx.clip(sphere);
  } else {
    ctx.save();
  }

  const path = geoPath(proj, ctx);
  // The grid, under everything.
  ctx.beginPath();
  path(GRID);
  ctx.strokeStyle = t.graticule;
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // The route lines and their stop ticks, over the sea only: the land is laid on top of them.
  const k = clamp(Math.sqrt(f.zoom), 1, 2.4);
  const lw = 2.6 * k;
  const centre: [number, number] = [-proj.rotate()[0], -proj.rotate()[1]];
  ctx.lineCap = "round";
  for (const l of LINES) {
    ctx.beginPath();
    path(l.geo as never);
    ctx.strokeStyle = "rgba(4,10,22,0.8)";
    ctx.lineWidth = lw + 3;
    ctx.stroke();
    ctx.strokeStyle = l.color;
    ctx.lineWidth = lw;
    ctx.stroke();
    const ticks = new Path2D();
    for (let lon = -175; lon < 180; lon += 10) {
      if (globe && geoDistance([lon, l.lat], centre) > Math.PI / 2 - 0.08) continue;
      if (f.isLand(lon, l.lat)) continue;
      const p = proj([lon, l.lat]);
      const q = proj([lon, l.lat + 1]);
      if (!p || !q || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const n = Math.hypot(dx, dy) || 1;
      dx = (dx / n) * (lw + 2.6);
      dy = (dy / n) * (lw + 2.6);
      ticks.moveTo(r1(p[0]), r1(p[1]));
      ticks.lineTo(r1(p[0] + dx), r1(p[1] + dy));
    }
    ctx.lineWidth = lw * 0.8;
    ctx.stroke(ticks);
  }

  // Land: flat slate plates, a lit band just inside the coast, ice a paler slate, and a thin silver coast.
  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.fillStyle = t.land;
  ctx.fill(land);
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = t.ice;
    ctx.fill(ice);
  }
  ctx.save();
  ctx.clip(land);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(150,185,230,0.13)";
  ctx.lineWidth = 6;
  ctx.stroke(coast);
  ctx.restore();
  peaks(f, globe, centre);
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);

  if (globe) {
    // A soft shade toward the limb, so the globe reads as a sphere on the flat screen.
    const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
    shade.addColorStop(0, "rgba(255,255,255,0.04)");
    shade.addColorStop(0.7, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(2,6,16,0.45)");
    ctx.fillStyle = shade;
    ctx.fill(sphere);
  }
  ctx.restore();
  if (globe) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(185,198,214,0.7)";
    ctx.stroke(sphere);
  }
}

/** Mountains from the relief layer as small open chevrons, the way a route map marks a pass. */
function peaks(f: SurfaceFrame, globe: boolean, centre: [number, number]) {
  const list = f.relief?.peaks;
  if (!list) return;
  const { ctx, w, h, proj } = f;
  const s = clamp(1.6 * Math.sqrt(f.zoom), 1.6, 3.4);
  const out: string[] = [];
  for (const [lon, lat] of list) {
    if (globe && geoDistance([lon, lat], centre) > Math.PI / 2 - 0.05) continue;
    const p = proj([lon, lat]);
    if (!p || p[0] < -6 || p[1] < -6 || p[0] > w + 6 || p[1] > h + 6) continue;
    out.push(`M${r1(p[0] - s)} ${r1(p[1] + s * 0.6)}L${r1(p[0])} ${r1(p[1] - s * 0.6)}L${r1(p[0] + s)} ${r1(p[1] + s * 0.6)}`);
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = f.theme.relief;
  ctx.stroke(new Path2D(out.join("")));
  ctx.restore();
}

/** The dial round the globe: a thin ring of ticks, longer every thirty degrees, and a faint glow. Kept offscreen. */
function dial(f: SurfaceFrame, cx: number, cy: number, R: number): HTMLCanvasElement {
  const [c, g] = offscreen(f.w, f.h, f.dpr);
  const glow = g.createRadialGradient(cx, cy, R, cx, cy, R * 1.25);
  glow.addColorStop(0, "rgba(63,130,240,0.16)");
  glow.addColorStop(1, "rgba(63,130,240,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, f.w, f.h);
  const r0 = R * 1.08;
  g.beginPath();
  g.arc(cx, cy, r0, 0, Math.PI * 2);
  g.strokeStyle = "rgba(185,198,214,0.35)";
  g.lineWidth = 1;
  g.stroke();
  const minor = new Path2D(), major = new Path2D();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const big = i % 6 === 0;
    const p = big ? major : minor;
    const r1_ = r0 + (big ? 9 : 4);
    p.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    p.lineTo(cx + Math.cos(a) * r1_, cy + Math.sin(a) * r1_);
  }
  g.lineWidth = 1;
  g.strokeStyle = "rgba(185,198,214,0.35)";
  g.stroke(minor);
  g.lineWidth = 1.6;
  g.strokeStyle = "rgba(185,198,214,0.6)";
  g.stroke(major);
  // The line colours at the dial's quarters: red at the top and bottom, blue at the sides, like a line's mark.
  g.lineWidth = 3;
  g.lineCap = "round";
  for (const [a, col] of [
    [-Math.PI / 2, RED],
    [Math.PI / 2, RED],
    [0, BLUE],
    [Math.PI, BLUE],
  ] as const) {
    g.beginPath();
    g.arc(cx, cy, r0, a - 0.09, a + 0.09);
    g.strokeStyle = col;
    g.stroke();
  }
  return c;
}
