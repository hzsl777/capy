// Arcade Cabinet (decision 75): the map on a curved picture tube set in a cabinet's black bezel. In Map view the
// picture bulges with a real barrel curve (the "barrel" warp), so coasts, the grid and places all bend together and
// tapping reads the curved screen. Coasts are glowing vector lines over dark land, the sea is ruled with a faint
// vector grid, mountains are small vector peaks, and scanlines, a glass sheen and a slow rolling band lie over the
// whole tube. The band is dim and takes six seconds to pass, so nothing flashes. No text, no borders.

import { geoGraticule, geoPath } from "d3-geo";
import { cachedPicture, offscreen, pathContext, Picture, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([10, 10])();
const SPHERE = { type: "Sphere" } as const;
/** One pass of the rolling band down the tube, in milliseconds. */
const ROLL_MS = 6500;
/** The picture tube's margin inside the bezel, in pixels. */
const INSET = 16;

/** What the tube keeps between frames: the bezel, the glass laid over it, and the picture as last drawn. */
export class ArcadeCache {
  bezel?: { key: string; canvas: HTMLCanvasElement; screen: Path2D };
  glass?: { key: string; canvas: HTMLCanvasElement };
  picture = new Picture();
}

/** The tube's outline: the frame, inset, as the lens curves it in Map view, or a rounded screen in Globe view. */
function screenPath(f: SurfaceFrame): Path2D {
  const { w, h, warp } = f;
  const p = new Path2D();
  if (!warp) {
    const r = Math.min(w, h) * 0.06;
    p.roundRect(INSET, INSET, w - INSET * 2, h - INSET * 2, r);
    return p;
  }
  const pts: [number, number][] = [];
  const n = 48;
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  // The source rectangle is a little larger than the frame, so the curved screen fills it at the middle of each side.
  const m = -Math.min(w, h) * 0.03;
  edge(m, m, w - m, m);
  edge(w - m, m, w - m, h - m);
  edge(w - m, h - m, m, h - m);
  edge(m, h - m, m, m);
  pts.forEach(([x, y], i) => {
    const [sx, sy] = warp.fwd(x, y);
    // Pulled toward the frame's inside by the inset, so the bezel shows all round.
    const cx = w / 2, cy = h / 2;
    const k = 1 - INSET / Math.max(Math.hypot(sx - cx, sy - cy), 1);
    const px = cx + (sx - cx) * k, py = cy + (sy - cy) * k;
    if (i) p.lineTo(px, py);
    else p.moveTo(px, py);
  });
  p.closePath();
  return p;
}

/** The black cabinet bezel round the tube, with a lip of light along its inner edge. */
function bezel(w: number, h: number, dpr: number, screen: Path2D): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, "#1b1726");
  body.addColorStop(0.5, "#0c0a12");
  body.addColorStop(1, "#16121f");
  g.fillStyle = body;
  g.fillRect(0, 0, w, h);
  // A gloss across the bezel's upper left.
  const gloss = g.createLinearGradient(0, 0, w * 0.5, h * 0.5);
  gloss.addColorStop(0, "rgba(255,255,255,0.08)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gloss;
  g.fillRect(0, 0, w, h);
  g.save();
  g.shadowColor = "rgba(120,110,255,0.35)";
  g.shadowBlur = 14;
  g.strokeStyle = "#2a2440";
  g.lineWidth = 4;
  g.stroke(screen);
  g.restore();
  g.fillStyle = "#020104";
  g.fill(screen);
  return c;
}

/**
 * Laid over the whole tube, markers included: scanlines, the glass's sheen, and the tube's corners falling into
 * shadow. Drawn once per size.
 */
function glass(w: number, h: number, dpr: number, screen: Path2D): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  g.save();
  g.clip(screen);
  g.fillStyle = "rgba(0,0,0,0.26)";
  for (let y = 0; y < h; y += 3) g.fillRect(0, y + 2, w, 1);
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.6)");
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  const sheen = g.createLinearGradient(w * 0.1, 0, w * 0.45, h * 0.6);
  sheen.addColorStop(0, "rgba(255,255,255,0.08)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.03)");
  sheen.addColorStop(0.51, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.stroke(screen);
  return c;
}

export function drawArcade(f: SurfaceFrame, cache: ArcadeCache): SurfaceResult {
  const { ctx, w, h, dpr, proj, mode, theme: t } = f;
  const globe = mode === "3d";
  const key = `${w}:${h}:${dpr}:${mode}`;
  if (cache.bezel?.key !== key) {
    const screen = screenPath(f);
    cache.bezel = { key, canvas: bezel(w, h, dpr, screen), screen };
    cache.glass = { key, canvas: glass(w, h, dpr, screen) };
  }
  const screen = cache.bezel.screen;
  ctx.drawImage(cache.bezel.canvas, 0, 0, w, h);

  // The picture changes only when the view moves; the rolling band passes over the same picture.
  const pk = `${key}:${f.lon.toFixed(5)}:${f.lat.toFixed(5)}:${f.zoom.toFixed(5)}:${f.map === f.low ? "l" : "h"}`;
  cachedPicture(cache.picture, f, pk, (g) => {
    g.clip(screen);
    const path = (o: object) => {
      const p = new Path2D();
      geoPath(f.view as never, pathContext(p))(o as never);
      return p;
    };
    // A faint glow in the middle of the tube, where its phosphor is brightest.
    const glow = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.5);
    glow.addColorStop(0, "rgba(40,50,120,0.35)");
    glow.addColorStop(1, "rgba(40,50,120,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    const sphere = path(SPHERE);
    if (globe) {
      // Behind the globe, a well of vector octagons running out to the tube's edge, joined at their corners.
      const R = proj.scale();
      const ring: string[] = [];
      const radii = [1.12, 1.3, 1.55, 1.9, 2.4, 3.1];
      const corner = (k: number, r: number) => {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        return `${(w / 2 + Math.cos(a) * r * R).toFixed(1)} ${(h / 2 + Math.sin(a) * r * R).toFixed(1)}`;
      };
      for (const r of radii) ring.push(`M${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => corner(k, r)).join("L")}Z`);
      for (let k = 0; k < 8; k++) ring.push(`M${corner(k, radii[0]!)}L${corner(k, radii[radii.length - 1]!)}`);
      const well = new Path2D(ring.join(""));
      g.strokeStyle = "rgba(110,90,255,0.14)";
      g.lineWidth = 4;
      g.stroke(well);
      g.strokeStyle = "rgba(170,150,255,0.4)";
      g.lineWidth = 1;
      g.stroke(well);
      g.fillStyle = "rgba(10,12,40,0.95)";
      g.fill(sphere);
    }
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = t.graticule;
    g.lineWidth = 1;
    g.stroke(path(GRID));
    const land = path(f.map.land);
    const coast = path(f.map.coast);
    g.fillStyle = t.land;
    g.fill(land);
    // Vector lines: a soft coloured glow and a thin white-hot core.
    const vector = (p: Path2D, rgb: string, width: number) => {
      g.strokeStyle = `rgba(${rgb},0.3)`;
      g.lineWidth = width * 3.6;
      g.stroke(p);
      g.strokeStyle = "rgba(235,248,255,0.95)";
      g.lineWidth = width;
      g.stroke(p);
    };
    vector(coast, "90,170,255", t.coastWidth);
    if (globe) vector(sphere, "150,110,255", 1.4);
    // Mountains as small vector peaks, their size fixed on screen.
    if (f.relief) {
      const s = Math.min(6, 2.5 + f.zoom * 0.45);
      const out: string[] = [];
      // Every third peak zoomed out, more as the map comes closer, so ranges read as lines of peaks, not a patch.
      const every = f.zoom < 2.5 ? 3 : f.zoom < 5 ? 2 : 1;
      for (let i = 0; i < f.relief.peaks.length; i += every) {
        const [lon, lat] = f.relief.peaks[i]!;
        const p = proj([lon, lat]);
        if (!p) continue;
        if (globe) {
          const dl = ((((lon - f.lon) % 360) + 540) % 360) - 180;
          if (Math.cos(lat / 57.3) * Math.cos(dl / 57.3) * Math.cos(f.lat / 57.3) + Math.sin(lat / 57.3) * Math.sin(f.lat / 57.3) < 0.05) continue;
        }
        const [x, y] = f.warp ? f.warp.fwd(p[0], p[1]) : p;
        if (x < 0 || y < 0 || x > w || y > h) continue;
        out.push(`M${(x - s).toFixed(1)} ${(y + s * 0.6).toFixed(1)}L${x.toFixed(1)} ${(y - s * 0.7).toFixed(1)}L${(x + s).toFixed(1)} ${(y + s * 0.6).toFixed(1)}`);
      }
      const peaks = new Path2D(out.join(""));
      g.strokeStyle = "rgba(150,120,255,0.18)";
      g.lineWidth = 3;
      g.stroke(peaks);
      g.strokeStyle = "rgba(205,190,255,0.6)";
      g.lineWidth = 1;
      g.stroke(peaks);
    }
  });

  const inside = f.warp
    ? (x: number, y: number) => {
        const [sx, sy] = f.warp!.inv(x, y);
        return sx > INSET && sy > INSET && sx < w - INSET && sy < h - INSET;
      }
    : (x: number, y: number) => x > INSET + 4 && y > INSET + 4 && x < w - INSET - 4 && y < h - INSET - 4;
  const over = () => {
    ctx.drawImage(cache.glass!.canvas, 0, 0, w, h);
    if (f.still) return;
    // A dim band of brighter phosphor rolling slowly down the tube.
    const y = ((f.now ?? 0) % ROLL_MS) / ROLL_MS * (h + 160) - 80;
    ctx.save();
    ctx.clip(screen);
    const band = ctx.createLinearGradient(0, y - 60, 0, y + 60);
    band.addColorStop(0, "rgba(160,190,255,0)");
    band.addColorStop(0.5, "rgba(160,190,255,0.05)");
    band.addColorStop(1, "rgba(160,190,255,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, y - 60, w, 120);
    ctx.restore();
  };
  return { inside, clip: screen, over };
}
