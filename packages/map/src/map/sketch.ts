// Sketchbook (decision 76): a pencil sketch on paper. The coasts are a wobbly pencil line, drawn twice the way a
// hand goes over a line, and redrawn a little differently a few times a second, like the "line boil" of drawn
// animation; for readers who ask for reduced motion it holds still. The land is cross-hatched in graphite, darker
// just inside the coast; the sea is paper with light graphite strokes and a touch of blue watercolour along the
// shore. Mountains are little pencil peaks. In Globe view the globe is a sketched ball, hatched on its shadow side,
// with its shadow hatched on the paper under it. No text, no borders.

import { geoGraticule, geoPath, type GeoProjection, type GeoStream } from "d3-geo";
import { clamp, drawDoodles, hatch, landPaths, speckle, StillLayer, stillLayer, streaks, wideCoast } from "./handmade.ts";
import { hash2, pathContext, type SurfaceFrame } from "./surface.ts";

const SPHERE = { type: "Sphere" } as const;
const GRID = geoGraticule().step([30, 30])();
/** Milliseconds between redraws of the pencil lines: a little over four a second. */
const BOIL_MS = 230;

export class SketchCache {
  still = new StillLayer();
}

/** A fixed pseudo-random offset in [-0.5, 0.5) for a point and a drawing of the line. */
function jitter(x: number, y: number, k: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/**
 * The projection with every point of a line nudged by up to `px` pixels, the same way for the same drawing `k`,
 * so a line wobbles like a pencil's and each drawing wobbles differently. The nudge is tied to the point on the
 * world, so the line keeps its shape while the map is dragged.
 */
function wobbly(proj: GeoProjection, px: number, k: number): { stream(out: GeoStream): GeoStream } {
  const deg = px / (proj.scale() * (Math.PI / 180));
  return {
    stream(out: GeoStream) {
      const s = proj.stream(out);
      return {
        point: (x: number, y: number) => s.point(x + jitter(x, y, k) * deg, y + jitter(y, x, k + 11) * deg),
        lineStart: () => s.lineStart(),
        lineEnd: () => s.lineEnd(),
        polygonStart: () => s.polygonStart(),
        polygonEnd: () => s.polygonEnd(),
        sphere: () => s.sphere?.(),
      };
    },
  };
}

/** A circle drawn by hand, a little different each drawing `k`. */
function handCircle(cx: number, cy: number, R: number, k: number, wobble: number): Path2D {
  const p = new Path2D();
  const n = 80;
  const a0 = k * 2.3;
  for (let i = 0; i <= n + 2; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const r = R + wobble * (Math.sin(a * 3 + k * 1.9) * 0.5 + Math.sin(a * 8 + k * 4.1) * 0.3 + jitter(i, k, 3) * 0.6);
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i) p.lineTo(x, y);
    else p.moveTo(x, y);
  }
  return p;
}

/** Little pencil peaks where the relief layer has mountains, shaded on one flank with short strokes. */
function peaks(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const list = f.relief?.peaks;
  if (!list) return;
  const k = clamp(0.8 + f.zoom * 0.25, 1, 2.6) * clamp(Math.min(f.w, f.h) / 720, 0.7, 1);
  const cell = 20 * k;
  const taken = new Set<number>();
  const line = new Path2D(), shade = new Path2D();
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
    const s = (3.5 + hash2(Math.round(lon * 10), Math.round(lat * 10)) * 2.5) * k;
    line.moveTo(x - s, y + s * 0.5);
    line.lineTo(x - s * 0.1, y - s * 0.75);
    line.lineTo(x + s, y + s * 0.5);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      shade.moveTo(x - s * 0.1 + s * 1.1 * t * 0.9, y - s * 0.75 + s * 1.25 * t * 0.9);
      shade.lineTo(x - s * 0.1 + s * 0.3 * t, y + s * 0.45);
    }
  }
  g.lineJoin = "round";
  g.lineCap = "round";
  g.lineWidth = 1.1;
  g.strokeStyle = "rgba(47,47,54,0.8)";
  g.stroke(line);
  g.lineWidth = 0.7;
  g.strokeStyle = "rgba(47,47,54,0.5)";
  g.stroke(shade);
}

/** Everything but the pencil lines that boil: paper, watercolour, graphite, hatching, the globe's shading. */
function drawPaper(f: SurfaceFrame, g: CanvasRenderingContext2D, land: Path2D, coast: Path2D) {
  const { w, h, dpr, theme: t } = f;
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const globe = f.mode === "3d";
  const path = geoPath(f.proj, g);
  g.fillStyle = t.ocean;
  g.fillRect(0, 0, w, h);
  g.fillStyle = speckle(g, dpr, "rgba(90,80,60,0.22)", 500, [0.4, 1.1], 37, 110);
  g.fillRect(0, 0, w, h);
  if (globe) {
    // The ball's shadow on the paper, hatched.
    g.save();
    g.beginPath();
    g.ellipse(cx + R * 0.18, cy + R * 1.02, R * 0.85, R * 0.13, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = hatch(g, dpr, "rgba(47,47,54,0.5)", 3.5, 1, 0.8, 41);
    g.fillRect(cx - R, cy + R * 0.8, R * 2.2, R * 0.5);
    g.restore();
  }
  const sphere = new Path2D();
  geoPath(f.proj, pathContext(sphere) as never)(SPHERE);
  g.save();
  g.clip(sphere);
  // Light graphite strokes across the sea.
  g.fillStyle = streaks(g, dpr, "rgba(60,60,72,0.13)", 60, [10, 30], [0.6, 1], 43, 170, 0.04);
  g.fillRect(0, 0, w, h);
  // Blue watercolour along the shore, pooling darker at its outer edge as a wash dries.
  g.lineJoin = "round";
  g.lineCap = "round";
  const soft = wideCoast(f, coast);
  g.lineWidth = 34;
  g.strokeStyle = "rgba(92,150,210,0.14)";
  g.stroke(soft);
  g.lineWidth = 30;
  g.strokeStyle = "rgba(127,176,220,0.16)";
  g.stroke(soft);
  g.lineWidth = 14;
  g.strokeStyle = "rgba(127,176,220,0.2)";
  g.stroke(soft);
  g.beginPath();
  path(GRID);
  g.lineWidth = 0.7;
  g.strokeStyle = t.graticule;
  g.stroke();
  drawDoodles(f, g, "rgba(47,47,54,0.7)", 1.1);
  // Land: paper again, cross-hatched, darker just inside the coast.
  g.fillStyle = t.land;
  g.fill(land);
  g.fillStyle = hatch(g, dpr, "rgba(52,52,60,0.32)", 4.2, 1, 0.75, 47);
  g.fill(land);
  g.fillStyle = hatch(g, dpr, "rgba(52,52,60,0.2)", 5.5, -1, 0.7, 53);
  g.fill(land);
  g.save();
  g.clip(land);
  g.lineWidth = 10;
  g.strokeStyle = hatch(g, dpr, "rgba(52,52,60,0.4)", 2.6, -1, 0.7, 59);
  g.stroke(coast);
  g.restore();
  peaks(f, g);
  if (globe) {
    // The shadow side of the ball, hatched once more.
    const lit = new Path2D();
    lit.arc(cx - R * 0.22, cy - R * 0.22, R * 1.03, 0, Math.PI * 2);
    lit.rect(cx + R * 2, cy - R * 2, -R * 4, R * 4);
    g.clip(lit, "evenodd");
    g.fillStyle = hatch(g, dpr, "rgba(47,47,54,0.42)", 3.2, 1, 0.8, 61);
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  g.restore();
  if (!globe) {
    g.lineWidth = 1;
    g.strokeStyle = "rgba(47,47,54,0.35)";
    g.stroke(sphere);
  }
}

export function drawSketch(f: SurfaceFrame, cache: SketchCache): number | void {
  const g = f.ctx;
  const boil = f.still ? 0 : Math.floor((f.time ?? 0) / BOIL_MS) % 3;
  stillLayer(f, cache.still, "", (gg) => {
    const { land, coast } = landPaths(f, f.map);
    drawPaper(f, gg, land, coast);
  });

  // The pencil lines, drawn for this moment's wobble: a firm line and a lighter second pass.
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const [k, width, ink] of [
    [boil, f.theme.coastWidth, "rgba(47,47,54,0.88)"],
    [boil + 5, 0.7, "rgba(47,47,54,0.45)"],
  ] as const) {
    const line = new Path2D();
    geoPath(wobbly(f.proj, 1.1, k) as GeoProjection, pathContext(line) as never)(f.map.coast);
    g.lineWidth = width;
    g.strokeStyle = ink;
    g.stroke(line);
  }
  if (f.mode === "3d") {
    g.lineWidth = 1.6;
    g.strokeStyle = "rgba(47,47,54,0.85)";
    g.stroke(handCircle(cx, cy, R, boil, Math.max(1, R * 0.005)));
    g.lineWidth = 0.8;
    g.strokeStyle = "rgba(47,47,54,0.45)";
    g.stroke(handCircle(cx + 1, cy - 1, R + 2, boil + 7, Math.max(1.2, R * 0.007)));
  }
  g.restore();
  return f.still ? undefined : BOIL_MS;
}
