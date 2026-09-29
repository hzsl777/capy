import { geoDistance, type GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";

/**
 * Decorations some designs draw on the canvas, under the dots: sea creatures on the Pirate chart, and on Space a
 * thin atmosphere rim around the globe or faint stars on the flat star chart. They are open strokes only, with no
 * text and no filled shapes, so they never read as a pin, a label or a place (neutrality rules 1 and 2).
 */

export type CreatureKind = "whale" | "serpent" | "kraken";

export interface Creature {
  kind: CreatureKind;
  lon: number;
  lat: number;
  /** Face the other way, so two of a kind don't look stamped. */
  flip?: boolean;
}

/**
 * Fixed spots in open ocean, far from every coast and every outlet's city. test/decor.test.ts checks both against
 * the basemap and config/sources.yaml, so a new outlet on a remote island fails the test instead of sitting under
 * a sea serpent.
 */
export const CREATURES: readonly Creature[] = [
  { kind: "serpent", lon: -145, lat: 30 }, // North Pacific
  { kind: "kraken", lon: -128, lat: -38 }, // South Pacific
  { kind: "whale", lon: -22, lat: -30, flip: true }, // South Atlantic
  { kind: "serpent", lon: 82, lat: -28, flip: true }, // Indian Ocean
  { kind: "whale", lon: 25, lat: -57 }, // Southern Ocean
];

/**
 * Stars for the Space design's flat map: [lon, lat, size 0 to 2], each in open ocean at least 3 degrees from land
 * and 9 from any outlet's city (checked by test/decor.test.ts). They are fixed to the map so the sheet reads as a
 * star chart that turns with the world.
 */
export const STARS: readonly (readonly [number, number, number])[] = [
  [-24.9, 52.9, 1], [106.3, -37.9, 1], [93.8, -17.9, 1], [151.1, -61.7, 2],
  [66.9, -18.7, 0], [-37.4, 14.6, 1], [-164.2, -50.3, 1], [7, -60.5, 2], [-92, -13.7, 2], [-115, -38.5, 1],
  [109.4, -55.3, 1], [68.1, -33.9, 1], [-151.8, -58.6, 1], [-156.5, 49.4, 1], [-131.7, -28.1, 1], [-155.3, 3.9, 0],
  [-50.7, 35.2, 1], [2.4, -49.4, 1], [92.6, -55.5, 1], [75.3, -54.6, 0], [-157.5, 42.1, 0],
  [-132.1, -6, 2], [-141.5, 23, 1], [-125.9, -12.9, 0], [-8.1, -30.2, 2], [-157.3, -5.7, 1],
  [158.4, 40.8, 0], [144, 26, 2], [68.3, -4.5, 1], [91.3, -29.4, 0], [-171.3, 25, 0], [153.6, 29, 0], [46, -44.1, 2],
  [122.1, -49.7, 2], [118.7, -42.2, 0], [-168.1, -33.6, 2], [-124.1, 19.4, 1], [-23, -39.7, 2],
  [-134.5, 1.3, 1], [-141.2, -32, 1], [-132.6, 33, 1], [-179.2, -61.4, 2], [136.4, -58.5, 1], [178.9, 17.8, 1],
  [79.1, -13.5, 1], [176.7, 0.3, 1], [83.4, -19.5, 1], [-177.6, 51.7, 1], [-134.1, -46.3, 2], [-105.2, -19.5, 2],
  [-34.6, 24.3, 0], [-15.2, -61.1, 2], [-108.8, -27.3, 1], [163.7, -31.1, 1], [-39.6, -50, 0],
  [5, -20, 1], [-27.5, -46.6, 2], [-169.1, 45.4, 1], [-130.9, -54.5, 1], [-48, -42.3, 1],
  [-119.2, 10.6, 2], [80.3, -26.3, 1], [-110.9, 5.9, 1], [134, 16.9, 0],
];

/** Beyond this angle from the centre of the globe a creature is hidden; it fades out over the last stretch. */
const HIDE = (80 * Math.PI) / 180;
const FADE = (64 * Math.PI) / 180;
const INK_ALPHA = 0.5;

export function drawDecor(ctx: CanvasRenderingContext2D, proj: GeoProjection, t: Theme, mode: ViewMode, center: [number, number]) {
  if (t.decor === "sea") drawCreatures(ctx, proj, t, mode, center);
  else if (t.decor === "space" && mode === "3d") drawRim(ctx, proj);
  else if (t.decor === "space") drawStars(ctx, proj);
}

function drawCreatures(ctx: CanvasRenderingContext2D, proj: GeoProjection, t: Theme, mode: ViewMode, center: [number, number]) {
  const [cx, cy] = proj.translate();
  // Half the width of a creature in pixels: grows with zoom, but stays small next to the land.
  const s = Math.min(28, Math.max(9, proj.scale() * 0.06));
  ctx.save();
  ctx.strokeStyle = t.coast;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  for (const c of CREATURES) {
    let alpha = INK_ALPHA;
    let squash = 1;
    let tilt = 0;
    if (mode === "3d") {
      const d = geoDistance([c.lon, c.lat], center);
      if (d > HIDE) continue;
      if (d > FADE) alpha *= (HIDE - d) / (HIDE - FADE);
      // Foreshortened toward the rim, as if drawn on the sphere.
      squash = Math.cos(d);
    }
    const p = proj([c.lon, c.lat]);
    if (!p) continue;
    const [x, y] = p;
    if (mode === "3d") tilt = Math.atan2(y - cy, x - cx);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (squash < 0.999) {
      ctx.rotate(tilt);
      ctx.scale(squash, 1);
      ctx.rotate(-tilt);
    }
    ctx.scale(c.flip ? -s : s, s);
    ctx.lineWidth = 1.1 / s;
    ctx.beginPath();
    if (c.kind === "whale") whale(ctx);
    else if (c.kind === "serpent") serpent(ctx);
    else kraken(ctx);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** A thin bright limb just outside the globe, like air seen edge-on. */
function drawRim(ctx: CanvasRenderingContext2D, proj: GeoProjection) {
  const [cx, cy] = proj.translate();
  const r = proj.scale();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(150,200,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(120,180,255,0.9)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
}

/** Four-point sparkles in open strokes, so a star never looks like a news dot. */
function drawStars(ctx: CanvasRenderingContext2D, proj: GeoProjection) {
  ctx.save();
  ctx.strokeStyle = "rgba(205,222,255,0.6)";
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [lon, lat, size] of STARS) {
    const p = proj([lon, lat]);
    if (!p) continue;
    const a = 1.6 + size * 0.9;
    ctx.moveTo(p[0] - a, p[1]);
    ctx.lineTo(p[0] + a, p[1]);
    ctx.moveTo(p[0], p[1] - a);
    ctx.lineTo(p[0], p[1] + a);
  }
  ctx.stroke();
  ctx.restore();
}

// The shapes below are drawn in a box about two units wide, centred on the creature's spot, as open strokes.

function waves(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) {
  const step = 0.22;
  ctx.moveTo(x0, y);
  for (let x = x0; x < x1 - 0.01; x += step) ctx.quadraticCurveTo(x + step / 2, y - 0.09, x + step, y);
}

function whale(ctx: CanvasRenderingContext2D) {
  // Back, then belly, meeting at the tail stock.
  ctx.moveTo(-0.95, 0.02);
  ctx.bezierCurveTo(-0.92, -0.36, -0.25, -0.44, 0.3, -0.2);
  ctx.bezierCurveTo(0.52, -0.1, 0.66, -0.12, 0.78, -0.2);
  ctx.moveTo(-0.95, 0.02);
  ctx.bezierCurveTo(-0.86, 0.28, -0.15, 0.3, 0.35, 0.06);
  ctx.bezierCurveTo(0.55, -0.04, 0.68, -0.08, 0.78, -0.14);
  // Flukes.
  ctx.moveTo(0.78, -0.2);
  ctx.quadraticCurveTo(0.86, -0.42, 1.0, -0.46);
  ctx.quadraticCurveTo(0.94, -0.28, 0.84, -0.17);
  ctx.quadraticCurveTo(0.98, -0.02, 1.04, 0.08);
  ctx.quadraticCurveTo(0.88, 0.02, 0.78, -0.14);
  // Mouth line, belly grooves, a pectoral fin and an eye drawn as a short arc.
  ctx.moveTo(-0.95, 0.02);
  ctx.quadraticCurveTo(-0.7, 0.06, -0.5, 0.02);
  ctx.moveTo(-0.72, 0.14);
  ctx.quadraticCurveTo(-0.45, 0.2, -0.2, 0.16);
  ctx.moveTo(-0.62, 0.2);
  ctx.quadraticCurveTo(-0.4, 0.25, -0.18, 0.21);
  ctx.moveTo(-0.3, 0.18);
  ctx.quadraticCurveTo(-0.22, 0.38, -0.05, 0.4);
  ctx.moveTo(-0.66, -0.06);
  ctx.arc(-0.69, -0.06, 0.03, 0, Math.PI);
  // Spout.
  ctx.moveTo(-0.58, -0.34);
  ctx.quadraticCurveTo(-0.62, -0.58, -0.76, -0.64);
  ctx.moveTo(-0.58, -0.34);
  ctx.quadraticCurveTo(-0.54, -0.58, -0.4, -0.64);
  ctx.moveTo(-0.58, -0.34);
  ctx.lineTo(-0.58, -0.62);
  waves(ctx, -1.1, 1.1, 0.46);
}

function serpent(ctx: CanvasRenderingContext2D) {
  // Neck and head rising from the water.
  ctx.moveTo(-0.7, 0.22);
  ctx.bezierCurveTo(-0.7, -0.18, -0.8, -0.44, -0.96, -0.5);
  ctx.moveTo(-0.56, 0.22);
  ctx.bezierCurveTo(-0.56, -0.18, -0.68, -0.34, -0.9, -0.36);
  ctx.moveTo(-0.96, -0.5);
  ctx.quadraticCurveTo(-1.12, -0.56, -1.22, -0.44);
  ctx.lineTo(-0.9, -0.36);
  ctx.moveTo(-1.2, -0.42);
  ctx.lineTo(-1.02, -0.42);
  // A crest along the back of the neck.
  ctx.moveTo(-0.72, -0.1);
  ctx.lineTo(-0.82, -0.14);
  ctx.lineTo(-0.76, -0.24);
  ctx.lineTo(-0.87, -0.3);
  ctx.lineTo(-0.84, -0.4);
  // Three coils, each a band above the waterline.
  for (const [x, h] of [
    [-0.18, 0.36],
    [0.24, 0.3],
    [0.6, 0.22],
  ] as const) {
    ctx.moveTo(x - 0.17, 0.22);
    ctx.ellipse(x, 0.22, 0.17, h, 0, Math.PI, Math.PI * 2);
    ctx.moveTo(x + 0.08, 0.22);
    ctx.ellipse(x, 0.22, 0.08, h - 0.12, 0, 0, Math.PI, true);
  }
  // The tail tip, curling.
  ctx.moveTo(0.82, 0.22);
  ctx.quadraticCurveTo(0.88, -0.1, 1.02, -0.08);
  ctx.quadraticCurveTo(1.1, -0.02, 1.02, 0.04);
  waves(ctx, -1.1, 1.1, 0.26);
}

function kraken(ctx: CanvasRenderingContext2D) {
  // The mantle, pointed at the top.
  ctx.moveTo(-0.26, 0.32);
  ctx.bezierCurveTo(-0.34, -0.1, -0.12, -0.66, 0, -0.78);
  ctx.bezierCurveTo(0.12, -0.66, 0.34, -0.1, 0.26, 0.32);
  // Eyes as short lids, not dots.
  ctx.moveTo(-0.16, 0.06);
  ctx.quadraticCurveTo(-0.1, 0.0, -0.04, 0.06);
  ctx.moveTo(0.04, 0.06);
  ctx.quadraticCurveTo(0.1, 0.0, 0.16, 0.06);
  // Tentacles curling up out of the sea on both sides.
  for (const sx of [-1, 1]) {
    ctx.moveTo(sx * 0.36, 0.32);
    ctx.bezierCurveTo(sx * 0.4, 0.0, sx * 0.72, -0.08, sx * 0.7, -0.34);
    ctx.quadraticCurveTo(sx * 0.66, -0.46, sx * 0.58, -0.38);
    ctx.quadraticCurveTo(sx * 0.56, -0.3, sx * 0.62, -0.3);
    ctx.moveTo(sx * 0.46, 0.32);
    ctx.bezierCurveTo(sx * 0.5, 0.08, sx * 0.74, 0.02, sx * 0.8, -0.2);
    ctx.moveTo(sx * 0.78, 0.32);
    ctx.bezierCurveTo(sx * 0.86, 0.1, sx * 1.02, 0.06, sx * 1.04, -0.12);
    ctx.quadraticCurveTo(sx * 1.04, -0.22, sx * 0.96, -0.18);
    ctx.moveTo(sx * 0.88, 0.32);
    ctx.bezierCurveTo(sx * 0.94, 0.18, sx * 1.06, 0.14, sx * 1.12, 0.02);
  }
  waves(ctx, -1.2, 1.2, 0.36);
}
