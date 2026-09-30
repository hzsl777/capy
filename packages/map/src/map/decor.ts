import { geoDistance, type GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";

/**
 * Decorations some designs draw on the canvas, under the dots: the Pirate chart's engraved sea (monsters, ships,
 * whirlpools and compass roses after Olaus Magnus's Carta Marina of 1539, with short wave marks over the open
 * water), the Candy Shop's sweets, and on Space a thin atmosphere rim around the globe or faint stars on the flat
 * star chart. Nothing here is text, and nothing is a small filled circle, so no decoration reads as a pin, a label
 * or a place (neutrality rules 1 and 2). Every one sits at a fixed spot in open ocean, checked by
 * test/decor.test.ts.
 */

export type SeaKind = "serpent" | "kraken" | "whale" | "hog" | "dragon" | "fish" | "turtle" | "leviathan" | "ship" | "whirlpool" | "rose";

export interface SeaSpot {
  kind: SeaKind;
  lon: number;
  lat: number;
  /**
   * Radius in degrees of the open sea the drawing may fill. It is drawn at this size on screen or smaller, so it
   * never reaches land: the test keeps every coast at least this far away and every outlet's city 7 degrees further.
   */
  r: number;
  /** Face the other way, so two of a kind don't look stamped. */
  flip?: boolean;
}

/** The Pirate chart's sea: creatures, ships, whirlpools and compass roses in every ocean. */
export const CREATURES: readonly SeaSpot[] = [
  { kind: "serpent", lon: -42, lat: 24, r: 11 }, // North Atlantic
  { kind: "whale", lon: -32, lat: 52, r: 6 },
  { kind: "ship", lon: -22, lat: -2, r: 6 },
  { kind: "whale", lon: -24, lat: -34, r: 11, flip: true }, // South Atlantic
  { kind: "hog", lon: -1, lat: -32, r: 8 },
  { kind: "rose", lon: -2, lat: -56, r: 11 },
  { kind: "whale", lon: 46, lat: -56, r: 9 }, // Southern Ocean
  { kind: "ship", lon: 52, lat: -36, r: 8, flip: true }, // Indian Ocean
  { kind: "whirlpool", lon: 62, lat: 10, r: 5.5 },
  { kind: "dragon", lon: 82, lat: -16, r: 11 },
  { kind: "kraken", lon: 86, lat: -42, r: 11 },
  { kind: "fish", lon: 104, lat: -22, r: 7, flip: true },
  { kind: "rose", lon: 122, lat: -54, r: 11 },
  { kind: "turtle", lon: 156, lat: 24, r: 6 }, // North Pacific
  { kind: "ship", lon: 160, lat: 40, r: 7.5 },
  { kind: "leviathan", lon: -180, lat: 26, r: 11 },
  { kind: "whale", lon: -152, lat: 40, r: 11, flip: true },
  { kind: "whirlpool", lon: -168, lat: 6, r: 8 },
  { kind: "serpent", lon: -144, lat: 4, r: 11, flip: true },
  { kind: "turtle", lon: -120, lat: 10, r: 9 },
  { kind: "kraken", lon: -138, lat: -38, r: 11 }, // South Pacific
  { kind: "fish", lon: -120, lat: -14, r: 11 },
  { kind: "dragon", lon: -112, lat: -58, r: 11, flip: true },
  { kind: "rose", lon: -96, lat: -32, r: 11 },
  { kind: "hog", lon: -164, lat: -58, r: 11, flip: true },
];

/**
 * Areas of open sea that get engraved wave marks: [lon, lat, radius in degrees]. The test keeps each at least 1.5
 * degrees from any coast and 3 degrees from every outlet's city. Marks are scattered inside them at fixed spots,
 * and the closer a mark is to an area's edge, the further the map must be zoomed in before it shows.
 */
export const WAVE_FIELDS: readonly (readonly [number, number, number])[] = [
  [84, -22, 16], [-136, 14, 16], [-24, -34, 16], [170, 34, 16], [-150, -48, 16], [-112, -8, 16], [-102, -46, 16],
  [8, -52, 16], [-42, 24, 15], [102, -48, 15], [-148, 38, 15], [-172, 12, 13], [-92, -22, 14], [62, -36, 11],
  [-144, -38, 16], [126, -50, 13], [0, -30, 10], [-24, 0, 9], [-30, 52, 9], [162, 28, 15], [-110, 0, 16],
  [86, -6, 11], [-24, -20, 12], [-168, -32, 9], [56, -56, 8], [-4, -5, 7], [62, 6, 8], [42, -36, 8], [94, -24, 15],
  [-140, 8, 15], [-166, -58, 13], [-170, 36, 14], [-38, 12, 11], [-40, -42, 10], [-106, -54, 16], [-120, -8, 16],
  [-120, -30, 7], [64, -12, 7], [-46, 34, 11], [74, -32, 15], [136, 20, 6], [-128, 16, 14], [-164, -4, 5],
  [156, -48, 5], [4, -12, 6], [-160, -12, 5], [150, -60, 5], [162, -34, 5], [38, -58, 8], [76, -60, 5],
  [178, -28, 5], [64, 14, 6], [68, -2, 5], [-138, 26, 15], [26, -44, 7], [-92, -12, 9], [-20, -46, 11],
  [158, -42, 5], [-28, 26, 7], [144, 4, 4], [-98, 6, 7], [112, -16, 4], [-34, 50, 9], [130, 18, 4], [-20, 46, 5],
  [168, -60, 5], [48, -6, 4], [172, -8, 4], [-154, 10, 6], [156, 16, 6], [-178, 4, 7], [-148, -4, 5], [174, 16, 6],
  [-20, -22, 11], [168, -30, 4], [-80, -60, 5], [-52, -44, 5], [158, 0, 3], [-10, -2, 5], [-54, 26, 8],
  [154, -18, 3], [-18, -64, 5], [-144, 52, 5], [160, -26, 3], [-66, 26, 3], [56, 4, 5], [-88, 4, 3], [166, -6, 3],
  [54, -34, 9], [-72, 30, 3], [-34, -62, 3], [-98, -40, 14], [-148, -34, 13], [-50, -56, 3], [158, 32, 12],
  [154, 2, 3], [140, -54, 9], [-146, -10, 4], [-50, 14, 6], [56, -12, 4],
];

export type SweetKind = "wrapped" | "lollipop" | "swirl";

export interface Sweet {
  kind: SweetKind;
  lon: number;
  lat: number;
  flip?: boolean;
}

/**
 * Sweets for the Candy Shop design, at their own fixed spots in open ocean, far from every outlet's city (checked
 * by test/decor.test.ts). Each is bigger than a dot and made of open strokes with a wrapper, a stick or spokes, so
 * none reads as a hollow story mark.
 */
export const CANDIES: readonly Sweet[] = [
  { kind: "lollipop", lon: -145, lat: 30 },
  { kind: "wrapped", lon: -128, lat: -38 },
  { kind: "swirl", lon: -22, lat: -30 },
  { kind: "wrapped", lon: 82, lat: -28, flip: true },
  { kind: "lollipop", lon: 25, lat: -57, flip: true },
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

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** Beyond this angle from the centre of the globe a drawing is hidden; it fades out over the last stretch. */
const HIDE = (80 * Math.PI) / 180;
const FADE = (64 * Math.PI) / 180;
const INK_ALPHA = 0.5;

export function drawDecor(ctx: CanvasRenderingContext2D, proj: GeoProjection, t: Theme, mode: ViewMode, center: [number, number]) {
  if (t.decor === "sea") drawSea(ctx, proj, t, mode, center);
  else if (t.decor === "candy") drawSweets(ctx, proj, t, mode, center, CANDIES);
  else if (t.decor === "space" && mode === "3d") drawRim(ctx, proj);
  else if (t.decor === "space") drawStars(ctx, proj);
}

// ---- the Pirate sea ---------------------------------------------------------------------------------------------

/** Largest drawing, as a half-width in pixels, and never more than this share of the map's shorter side. */
const SEA_CAP = 170;
const SEA_CAP_SHARE = 0.3;
const SEA_ALPHA = 0.92;

function drawSea(ctx: CanvasRenderingContext2D, proj: GeoProjection, t: Theme, mode: ViewMode, center: [number, number]) {
  const k = proj.scale() * RAD; // pixels per degree at the centre of the map
  const W = ctx.canvas.clientWidth || ctx.canvas.width;
  const H = ctx.canvas.clientHeight || ctx.canvas.height;
  const [cx, cy] = proj.translate();
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.strokeStyle = t.coast;
  if (mode === "3d") {
    // Large drawings near the rim stay on the sphere.
    ctx.beginPath();
    ctx.arc(cx, cy, proj.scale(), 0, TAU);
    ctx.clip();
  }
  drawWaveMarks(ctx, proj, mode, center, k, W, H);

  const cap = Math.min(SEA_CAP, SEA_CAP_SHARE * Math.min(W, H));
  for (const c of CREATURES) {
    let alpha = SEA_ALPHA;
    let squash = 1;
    if (mode === "3d") {
      const d = geoDistance([c.lon, c.lat], center);
      if (d > HIDE) continue;
      if (d > FADE) alpha *= (HIDE - d) / (HIDE - FADE);
      // Foreshortened toward the rim, as if drawn on the sphere.
      squash = Math.cos(d);
    }
    // Sized by the sea it may fill, so it grows as the map zooms in and never reaches the coast.
    const s = Math.min(cap, c.r * k);
    if (s < 7) continue;
    const p = proj([c.lon, c.lat]);
    if (!p) continue;
    const [x, y] = p;
    if (x < -s || y < -s || x > W + s || y > H + s) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (squash < 0.999) {
      const tilt = Math.atan2(y - cy, x - cx);
      ctx.rotate(tilt);
      ctx.scale(squash, 1);
      ctx.rotate(-tilt);
    }
    ctx.scale(c.flip ? -s : s, s);
    drawFigure(ctx, figure(c.kind), s, t);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * One part of a drawing, in local units (the drawing fits a circle of radius 1). Drawn in order: the paper fill that
 * hides the water behind it, engraved texture inside it, solid ink, fine lines, then the outline.
 */
interface Part {
  fill: Path2D | null;
  /** Fill with the sea's colour instead of paper, for water drawn over the wave marks (a whirlpool). */
  sea: boolean;
  clip: Path2D | null;
  tex: Tex | null;
  /** Hand-drawn engraving (ribs, plates, planks), clipped to the fill. */
  etch: Path2D | null;
  solid: Path2D | null;
  fine: Path2D | null;
  ink: Path2D | null;
}

function drawFigure(ctx: CanvasRenderingContext2D, parts: readonly Part[], s: number, t: Theme) {
  // Lines keep about the same weight on screen at every size; small drawings leave out their finest work.
  const w = Math.min(1.7, Math.max(0.85, 0.6 + s / 100));
  const detail = s >= 20;
  const textured = s >= 28;
  for (const p of parts) {
    if (p.fill) {
      ctx.fillStyle = p.sea ? t.ocean : t.land;
      ctx.fill(p.fill);
    }
    if (textured && p.tex && (p.clip || p.fill)) {
      ctx.save();
      ctx.clip((p.clip ?? p.fill)!);
      ctx.lineWidth = (w * 0.5) / s;
      ctx.stroke(texture(p.tex, s));
      ctx.restore();
    }
    if (detail && p.etch) {
      ctx.save();
      if (p.fill) ctx.clip(p.fill);
      ctx.lineWidth = (w * 0.55) / s;
      ctx.stroke(p.etch);
      ctx.restore();
    }
    if (p.solid) {
      ctx.fillStyle = t.coast;
      ctx.fill(p.solid);
    }
    if (detail && p.fine) {
      ctx.lineWidth = (w * 0.62) / s;
      ctx.stroke(p.fine);
    }
    if (p.ink) {
      ctx.lineWidth = w / s;
      ctx.stroke(p.ink);
    }
  }
}

// ---- engraved texture -------------------------------------------------------------------------------------------

type Tex = "hatch" | "cross" | "lines" | "scales";

/** The spacing each texture aims for on screen, in pixels. */
const TEX_PX: Record<Tex, number> = { hatch: 2.8, cross: 3.4, lines: 3, scales: 6 };
const texCache = new Map<string, Path2D>();

/** A texture over the unit square, at the prebuilt spacing nearest to what the drawing's size calls for. */
function texture(kind: Tex, s: number): Path2D {
  const want = TEX_PX[kind] / s;
  const level = Math.max(0, Math.min(8, Math.round(Math.log(want / 0.01) / Math.log(1.5))));
  const key = `${kind}${level}`;
  let p = texCache.get(key);
  if (p) return p;
  const d = 0.01 * 1.5 ** level;
  p = new Path2D();
  const B = 1.05;
  if (kind === "hatch" || kind === "cross") {
    // Lines at 45 degrees, rising to the right; "cross" adds the other diagonal.
    const step = d * Math.SQRT2;
    for (let c = -2 * B; c <= 2 * B; c += step) {
      const x0 = Math.max(-B, c - B);
      const x1 = Math.min(B, c + B);
      p.moveTo(x0, c - x0);
      p.lineTo(x1, c - x1);
      if (kind === "cross") {
        p.moveTo(x0, x0 - c);
        p.lineTo(x1, x1 - c);
      }
    }
  } else if (kind === "lines") {
    for (let y = -B; y <= B; y += d) {
      p.moveTo(-B, y);
      p.lineTo(B, y);
    }
  } else {
    // Overlapping scales: rows of short downward arcs, every other row offset by half.
    let row = 0;
    for (let y = -B; y <= B + d; y += d * 0.9, row++) {
      for (let x = -B + (row % 2) * d; x <= B + d; x += d * 2) {
        p.moveTo(x + d * Math.cos(0.15 * Math.PI), y + d * Math.sin(0.15 * Math.PI));
        p.arc(x, y, d, 0.15 * Math.PI, 0.85 * Math.PI);
      }
    }
  }
  texCache.set(key, p);
  return p;
}

// ---- building drawings --------------------------------------------------------------------------------------------

type Pt = readonly [number, number];

/** Where a drawing's pens put their marks: a uniform scale and an offset, so one shape can be reused smaller. */
interface Place {
  a: number;
  dx: number;
  dy: number;
  /** -1 mirrors left to right. */
  fx: number;
}

/** A Path2D that remembers the points it passes, so the finished drawing can be centred and fitted to radius 1. */
class Pen {
  readonly p = new Path2D();
  used = false;
  constructor(
    private readonly at: Place,
    private readonly seen: number[],
  ) {}
  private x(x: number) {
    return x * this.at.a * this.at.fx + this.at.dx;
  }
  private y(y: number) {
    return y * this.at.a + this.at.dy;
  }
  private see(x: number, y: number) {
    this.used = true;
    this.seen.push(x, y);
  }
  M(x: number, y: number) {
    const X = this.x(x), Y = this.y(y);
    this.p.moveTo(X, Y);
    this.see(X, Y);
    return this;
  }
  L(x: number, y: number) {
    const X = this.x(x), Y = this.y(y);
    this.p.lineTo(X, Y);
    this.see(X, Y);
    return this;
  }
  Q(a: number, b: number, x: number, y: number) {
    const A = this.x(a), B = this.y(b), X = this.x(x), Y = this.y(y);
    this.p.quadraticCurveTo(A, B, X, Y);
    this.see(A, B);
    this.see(X, Y);
    return this;
  }
  C(a: number, b: number, c: number, d: number, x: number, y: number) {
    const A = this.x(a), B = this.y(b), Cx = this.x(c), D = this.y(d), X = this.x(x), Y = this.y(y);
    this.p.bezierCurveTo(A, B, Cx, D, X, Y);
    this.see(A, B);
    this.see(Cx, D);
    this.see(X, Y);
    return this;
  }
  Z() {
    this.p.closePath();
    return this;
  }
  line(pts: readonly Pt[], close = false) {
    pts.forEach(([x, y], i) => (i ? this.L(x, y) : this.M(x, y)));
    if (close) this.Z();
    return this;
  }
  /** An ellipse or part of one, from angle a0 to a1, starting a new subpath. */
  ell(x: number, y: number, rx: number, ry: number, a0 = 0, a1 = TAU) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.2));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      if (i) this.L(x + rx * Math.cos(a), y + ry * Math.sin(a));
      else this.M(x + rx * Math.cos(a), y + ry * Math.sin(a));
    }
    return this;
  }
}

interface Layer {
  fill: Pen;
  clip: Pen;
  etch: Pen;
  solid: Pen;
  fine: Pen;
  ink: Pen;
  tex: Tex | null;
  sea: boolean;
}

class Fig {
  readonly layers: Layer[] = [];
  /** Every point any pen passed, control points included, as x, y pairs. */
  readonly seen: number[] = [];
  at: Place = { a: 1, dx: 0, dy: 0, fx: 1 };
  layer(tex: Tex | null = null, sea = false): Layer {
    const at = this.at;
    const pen = () => new Pen(at, this.seen);
    const l = { fill: pen(), clip: pen(), etch: pen(), solid: pen(), fine: pen(), ink: pen(), tex, sea };
    this.layers.push(l);
    return l;
  }
  /** Draw `build` at a smaller size, moved and optionally mirrored. */
  within(a: number, dx: number, dy: number, fx: number, build: () => void) {
    const prev = this.at;
    this.at = { a: prev.a * a, dx: prev.dx + dx * prev.a * prev.fx, dy: prev.dy + dy * prev.a, fx: prev.fx * fx };
    build();
    this.at = prev;
  }
}

/** Draw the same outline into a layer's fill and its ink. */
function both(l: Layer, draw: (p: Pen) => void) {
  draw(l.fill);
  draw(l.ink);
}

const figures = new Map<SeaKind, Part[]>();

/** Each drawing is built once, as Path2D objects in local units, and drawn every frame with a transform. */
function figure(kind: SeaKind): Part[] {
  let parts = figures.get(kind);
  if (parts) return parts;
  const f = new Fig();
  BUILD[kind](f);
  // Centre the drawing on its bounding box, then shrink it until every point is inside radius 1.
  const pts = f.seen;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let reach = 0;
  for (let i = 0; i < pts.length; i += 2) reach = Math.max(reach, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
  const scale = 1 / reach;
  const m = new DOMMatrix([scale, 0, 0, scale, -cx * scale, -cy * scale]);
  const fit = (pen: Pen) => {
    if (!pen.used) return null;
    const out = new Path2D();
    out.addPath(pen.p, m);
    return out;
  };
  parts = f.layers.map((l) => ({
    fill: fit(l.fill),
    sea: l.sea,
    clip: fit(l.clip),
    tex: l.tex,
    etch: fit(l.etch),
    solid: fit(l.solid),
    fine: fit(l.fine),
    ink: fit(l.ink),
  }));
  figures.set(kind, parts);
  return parts;
}

// ---- geometry helpers ---------------------------------------------------------------------------------------------

function bez(a: Pt, b: Pt, c: Pt, d: Pt, n = 26): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return out;
}

/** Continue a line into a tightening curl, like a tentacle's tip. dir 1 turns clockwise on screen. */
function curl(pts: Pt[], dir: 1 | -1, r0: number, turns = 1.1, n = 30): Pt[] {
  const out = pts.slice();
  let [x, y] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  let h = Math.atan2(y - py, x - px);
  let r = r0;
  const dh = (turns * TAU) / n;
  const decay = Math.pow(0.28, 1 / n);
  for (let i = 0; i < n; i++) {
    h += dir * dh;
    x += Math.cos(h) * r * dh;
    y += Math.sin(h) * r * dh;
    r *= decay;
    out.push([x, y]);
  }
  return out;
}

/** Half an ellipse from (cx - a, y) over the top to (cx + a, y): a coil rising out of the water. */
function arch(cx: number, y: number, a: number, h: number, n = 26): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (Math.PI * i) / n;
    out.push([cx + a * Math.cos(t), y + h * Math.sin(t)]);
  }
  return out;
}

interface TubeOpts {
  /** Close the far end with a rounded cap. */
  cap?: boolean;
  /** Hatch the half on this side (1 is the right-hand side walking along the line). */
  shade?: 1 | -1;
  /** A fine line across the body every this many samples: belly plates, rings. */
  bands?: number;
  /** Suckers along this side. */
  suckers?: 1 | -1;
  /** A spined, webbed fin along this side. */
  crest?: { side: 1 | -1; h: number; every: number };
}

/** A body of changing width along a line: serpents' coils, necks, tentacles, tails. */
function tube(l: Layer, pts: readonly Pt[], w0: number, w1: number, o: TubeOpts = {}) {
  const n = pts.length;
  const A: Pt[] = [];
  const B: Pt[] = [];
  const T: Pt[] = [];
  const Wd: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(n - 1, i + 1)];
    let tx = q[0] - p[0];
    let ty = q[1] - p[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = (w0 + ((w1 - w0) * i) / (n - 1)) / 2;
    T.push([tx, ty]);
    Wd.push(w);
    A.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
    B.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
  }
  const side = (s: 1 | -1) => (s === 1 ? A : B);
  if (o.crest) {
    const E = side(o.crest.side);
    const sg = o.crest.side;
    const tips: Pt[] = [];
    const bases: Pt[] = [];
    for (let i = 1; i < n - 2; i += o.crest.every) {
      const h = o.crest.h * (1 - (0.6 * i) / n);
      const [tx, ty] = T[i];
      // Spines lean back along the body.
      bases.push(E[i]);
      tips.push([E[i][0] - ty * h * sg - tx * h * 0.45, E[i][1] + tx * h * sg - ty * h * 0.45]);
    }
    if (tips.length > 1) {
      const web = (p: Pen) => {
        p.M(bases[0][0], bases[0][1]);
        tips.forEach(([x, y], i) => {
          if (i === 0) p.L(x, y);
          else {
            const b = bases[i];
            const prev = tips[i - 1];
            // The web between two spines sags toward the body.
            p.Q((prev[0] + x) / 2 * 0.5 + b[0] * 0.5, (prev[1] + y) / 2 * 0.5 + b[1] * 0.5, x, y);
          }
        });
        const last = bases[bases.length - 1];
        p.L(last[0], last[1]);
      };
      web(l.fill);
      l.fill.Z();
      web(l.ink);
      tips.forEach(([x, y], i) => l.fine.M(bases[i][0], bases[i][1]).L(x, y));
    }
  }
  l.fill.line([...A, ...B.slice().reverse()], true);
  l.ink.line(A);
  l.ink.line(B);
  if (o.cap) {
    const a = A[n - 1];
    const b = B[n - 1];
    const [tx, ty] = T[n - 1];
    const w = Wd[n - 1];
    l.ink.M(a[0], a[1]).Q(pts[n - 1][0] + tx * w * 2, pts[n - 1][1] + ty * w * 2, b[0], b[1]);
    l.fill.M(a[0], a[1]).Q(pts[n - 1][0] + tx * w * 2, pts[n - 1][1] + ty * w * 2, b[0], b[1]).Z();
  }
  if (o.shade) l.clip.line([...pts, ...side(o.shade).slice().reverse()], true);
  if (o.bands) {
    for (let i = o.bands; i < n - 1; i += o.bands) {
      const [tx, ty] = T[i];
      const w = Wd[i];
      l.etch.M(A[i][0], A[i][1]).Q(pts[i][0] + tx * w * 0.5, pts[i][1] + ty * w * 0.5, B[i][0], B[i][1]);
    }
  }
  if (o.suckers) {
    const E = side(o.suckers);
    const sg = o.suckers;
    for (let i = 2; i < n - 3; i += 2) {
      const [tx, ty] = T[i];
      const w = Wd[i];
      const r = w * 0.28;
      if (r < 0.6) continue;
      // Just inside the edge.
      const x = E[i][0] + ty * r * 1.3 * sg;
      const y = E[i][1] - tx * r * 1.3 * sg;
      l.fine.ell(x, y, r, r);
    }
  }
}

/** Rows of short scalloped waves, the engraved sea around a drawing's waterline. */
function sea(p: Pen, x0: number, x1: number, y: number, rows = 3, step = 10, amp = 3) {
  for (let r = 0; r < rows; r++) {
    const inset = (x1 - x0) * 0.13 * r;
    const yy = y + r * 7;
    let x = x0 + inset + (r % 2) * (step / 2);
    p.M(x, yy);
    for (; x + step <= x1 - inset; x += step) p.Q(x + step / 2, yy - amp, x + step, yy);
  }
}

/** A zigzag of teeth between two points, pointing to one side. */
function teeth(p: Pen, x0: number, y0: number, x1: number, y1: number, n: number, h: number) {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  p.M(x0, y0);
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n;
    const b = (i + 1) / n;
    p.L(x0 + (x1 - x0) * a + (nx / l) * h, y0 + (y1 - y0) * a + (ny / l) * h);
    p.L(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
  }
}

/** A spined, webbed fin on a line of bases, each spine to its tip. */
function spinedFin(l: Layer, bases: readonly Pt[], tips: readonly Pt[]) {
  const web = (p: Pen) => {
    p.M(bases[0][0], bases[0][1]);
    tips.forEach(([x, y], i) => {
      if (i === 0) p.L(x, y);
      else {
        const b = bases[i];
        const q = tips[i - 1];
        p.Q((q[0] + x + b[0] * 2) / 4, (q[1] + y + b[1] * 2) / 4, x, y);
      }
    });
    const last = bases[bases.length - 1];
    p.L(last[0], last[1]);
  };
  web(l.fill);
  l.fill.Z();
  web(l.ink);
  tips.forEach(([x, y], i) => l.fine.M(bases[i][0], bases[i][1]).L(x, y));
}

/** A dragon's or serpent's head facing left, jaws open, its snout at (x, y): horned, or with a frill of spines. */
function monsterHead(f: Fig, x: number, y: number, horns: boolean) {
  const back = f.layer("hatch");
  if (horns) {
    // Two long horns swept back, ringed.
    both(back, (p) => p.M(x + 34, y - 17).C(x + 42, y - 34, x + 60, y - 42, x + 82, y - 42).C(x + 62, y - 36, x + 50, y - 26, x + 44, y - 12).Z());
    both(back, (p) => p.M(x + 42, y - 12).C(x + 52, y - 24, x + 68, y - 28, x + 88, y - 24).C(x + 68, y - 20, x + 58, y - 12, x + 50, y - 4).Z());
    for (let i = 1; i < 5; i++) back.fine.M(x + 36 + i * 7, y - 20 - i * 3.6).L(x + 42 + i * 6, y - 14 - i * 3.8);
  } else {
    spinedFin(
      back,
      [[x + 32, y - 18], [x + 40, y - 16], [x + 47, y - 11], [x + 52, y - 4], [x + 54, y + 4]],
      [[x + 40, y - 38], [x + 54, y - 34], [x + 64, y - 24], [x + 70, y - 12], [x + 70, y + 2]],
    );
  }
  const l = f.layer("hatch");
  both(l, (p) =>
    p
      .M(x + 52, y - 8)
      .C(x + 44, y - 22, x + 28, y - 23, x + 19, y - 16)
      .Q(x + 10, y - 12, x + 2, y - 11)
      .Q(x - 5, y - 10, x - 3, y - 3)
      .L(x + 19, y - 1)
      .L(x + 1, y + 9)
      .Q(x + 1, y + 15, x + 10, y + 15)
      .C(x + 24, y + 15, x + 42, y + 13, x + 54, y + 6)
      .Z(),
  );
  // The throat and jaw in shadow.
  l.clip.M(x + 10, y + 15).C(x + 24, y + 15, x + 42, y + 13, x + 54, y + 6).L(x + 52, y - 1).Q(x + 36, y + 7, x + 20, y + 6).Q(x + 12, y + 8, x + 6, y + 12).Z();
  // The open mouth in solid ink, with teeth top and bottom.
  l.solid.M(x - 1.5, y - 3.2).L(x + 18, y - 1).L(x + 2.5, y + 8).Q(x - 1, y + 2, x - 1.5, y - 3.2).Z();
  teeth(l.fine, x, y - 3, x + 15, y - 1.3, 5, 2.6);
  teeth(l.fine, x + 15, y + 0.8, x + 3.5, y + 7, 4, 2.4);
  // A slanted eye under a heavy brow, a curled nostril, scales on the cheek, and a beard of wisps.
  l.ink.M(x + 21, y - 10).Q(x + 26, y - 14.5, x + 32, y - 11).Q(x + 26, y - 8, x + 21, y - 10);
  l.fine.M(x + 26.5, y - 13.4).L(x + 26.5, y - 8.6);
  l.ink.M(x + 17, y - 15).Q(x + 26, y - 21, x + 37, y - 14);
  l.fine.M(x + 3, y - 8).Q(x + 5, y - 11, x + 8, y - 9);
  for (let i = 0; i < 3; i++) l.etch.M(x + 36 + i * 5, y - 6).Q(x + 39 + i * 5, y - 1, x + 36 + i * 5, y + 5);
  for (let i = 0; i < 3; i++) l.fine.M(x + 12 + i * 6, y + 15).Q(x + 9 + i * 6, y + 20, x + 11 + i * 5, y + 25);
}

// ---- the drawings -------------------------------------------------------------------------------------------------
// Each is drawn in its own units, facing left, and fitted to a circle of radius 1 around its spot when built.

/** A sea serpent rising through the waves in three coils, with a finned crest and open jaws. */
function serpent(f: Fig) {
  const W = 20;
  const back = f.layer();
  sea(back.fine, -96, 100, W - 4, 1, 12, 3);
  const body = f.layer("hatch");
  const tail = curl(bez([74, W + 2], [76, W - 12], [86, W - 22], [96, W - 20]), -1, 6, 1.0);
  tube(body, tail, 11, 1.5, { shade: 1, bands: 3 });
  for (const [cx, a, h, w] of [
    [44, 13, 26, 12],
    [10, 15, 34, 14],
    [-24, 15, 40, 15],
  ] as const) {
    tube(body, arch(cx, W + 2, a, h), w, w, { shade: 1, bands: 2, crest: { side: -1, h: 8, every: 3 } });
  }
  const neck = f.layer("hatch");
  tube(neck, bez([-58, W + 2], [-56, W - 28], [-58, W - 58], [-70, W - 72]), 18, 13, { shade: 1, bands: 2, crest: { side: 1, h: 11, every: 3 } });
  monsterHead(f, -100, W - 74, false);
  const tongue = f.layer();
  tongue.ink.M(-92, W - 70).Q(-104, W - 66, -110, W - 70).M(-110, W - 70).L(-116, W - 74).M(-110, W - 70).L(-116, W - 67);
  const front = f.layer();
  sea(front.ink, -100, 100, W + 4, 3, 11, 3.2);
  // Splashes where each coil leaves the water.
  for (const x of [-40, -8, 26, 56, 70]) front.fine.M(x - 3, W).Q(x, W - 6, x + 3, W - 1);
}

/** A kraken: a ridged mantle with slit-eyed stare, arms curling up out of the sea. */
function kraken(f: Fig) {
  const W = 22;
  const far = f.layer();
  sea(far.fine, -92, 92, W - 6, 1, 12, 3);
  const behind = f.layer("hatch");
  tube(behind, curl(bez([-24, W], [-36, -6], [-72, -14], [-72, -52]), -1, 9, 1.2), 13, 2.5, { shade: 1, suckers: 1, cap: true });
  tube(behind, curl(bez([24, W], [36, -6], [72, -14], [72, -52]), 1, 9, 1.2), 13, 2.5, { shade: -1, suckers: -1, cap: true });
  tube(behind, curl(bez([-12, W], [-20, -30], [-44, -50], [-40, -80]), 1, 7, 1.0), 10, 2, { shade: 1, suckers: 1, cap: true });
  const mantle = f.layer("hatch");
  // A bulbous head narrowing to the eyes at the waterline.
  const outline = (p: Pen) => p.M(-26, W).C(-30, 4, -22, -8, -30, -22).C(-54, -40, -42, -86, 0, -86).C(42, -86, 54, -40, 30, -22).C(22, -8, 30, 4, 26, W);
  outline(mantle.fill);
  mantle.fill.Z();
  outline(mantle.ink);
  mantle.clip.M(0, -86).C(42, -86, 54, -40, 30, -22).C(22, -8, 30, 4, 26, W).L(12, W).C(14, 0, 14, -18, 20, -30).C(30, -48, 24, -78, 0, -86).Z();
  for (const i of [-2, -1, 0, 1, 2]) mantle.etch.M(i * 9, -20).C(i * 18, -40, i * 15, -72, i * 4, -84);
  for (const y of [-34, -46, -58]) mantle.etch.M(-40, y + 6).Q(0, y - 6, 40, y + 6);
  for (const sx of [-1, 1]) {
    mantle.fill.M(sx * 24, -10).Q(sx * 14, -20, sx * 4, -10).Q(sx * 14, -2, sx * 24, -10).Z();
    mantle.ink.M(sx * 24, -10).Q(sx * 14, -20, sx * 4, -10).Q(sx * 14, -2, sx * 24, -10);
    mantle.solid.M(sx * 14.8, -16).Q(sx * 16.2, -10, sx * 14.8, -5).Q(sx * 13.4, -10, sx * 14.8, -16).Z();
    mantle.ink.M(sx * 27, -16).Q(sx * 16, -27, sx * 3, -17);
  }
  const front = f.layer("hatch");
  tube(front, curl(bez([-18, W + 2], [-40, 4], [-70, 12], [-88, -2]), 1, 7, 1.0), 12, 2, { shade: 1, suckers: -1, cap: true });
  tube(front, curl(bez([18, W + 2], [40, 4], [70, 12], [88, -2]), -1, 7, 1.0), 12, 2, { shade: -1, suckers: 1, cap: true });
  tube(front, arch(-46, W + 4, 11, 16), 9, 7, { shade: 1, suckers: 1 });
  tube(front, arch(42, W + 4, 10, 13), 9, 7, { shade: 1, suckers: 1 });
  const water = f.layer();
  sea(water.ink, -98, 98, W + 4, 3, 11, 3.2);
}

/** A whale spouting from its blowhole, engraved with throat grooves, flukes raised. */
function whale(f: Fig) {
  const tail = f.layer("hatch");
  tube(tail, bez([72, -4], [84, -8], [90, -20], [90, -34]), 16, 8, { shade: 1 });
  both(tail, (p) => p.M(90, -32).Q(80, -38, 66, -54).Q(82, -52, 90, -42).Q(98, -54, 114, -56).Q(102, -40, 92, -30).Z());
  tail.fine.M(90, -40).Q(80, -46, 72, -52).M(91, -40).Q(100, -48, 108, -53);
  const body = f.layer("hatch");
  both(body, (p) =>
    p
      .M(-96, 4)
      .C(-94, -24, -66, -40, -30, -40)
      .C(6, -40, 40, -30, 62, -14)
      .Q(72, -8, 80, -10)
      .L(84, -2)
      .Q(70, 4, 60, 10)
      .C(30, 26, -20, 30, -50, 24)
      .C(-72, 20, -92, 16, -96, 4)
      .Z(),
  );
  // Shade along the back's far side and the belly.
  body.clip.M(-96, 4).C(-92, 16, -72, 20, -50, 24).C(-20, 30, 30, 26, 60, 10).Q(70, 4, 84, -2).L(80, -10).Q(40, 4, -20, 14).C(-60, 16, -86, 12, -96, 4).Z();
  // Throat grooves: the whale's engraved ribbing.
  for (let i = 0; i < 9; i++) body.etch.M(-94 + i * 1.5, 8 + i * 2.4).C(-70, 14 + i * 2.6, -40, 20 + i * 2.2, 4 + i * 3, 20 + i * 1.4);
  // Contour lines along the back give it roundness.
  for (let i = 0; i < 3; i++) body.etch.M(-80 + i * 6, -26 + i * 7).C(-50, -38 + i * 8, 10, -34 + i * 8, 62, -12 + i * 4);
  body.ink.M(-96, 4).Q(-76, 10, -54, 6);
  body.ink.ell(-60, -10, 3.2, 2.2);
  body.fine.M(-66, -15).Q(-60, -18, -54, -14);
  const fin = f.layer("hatch");
  both(fin, (p) => p.M(-44, 18).C(-40, 30, -30, 40, -14, 46).C(-22, 34, -26, 24, -28, 20).Z());
  const spout = f.layer();
  spout.ink.M(-54, -40).C(-58, -60, -70, -72, -88, -74);
  spout.ink.M(-50, -40).C(-46, -60, -34, -70, -18, -70);
  spout.fine.M(-53, -40).C(-56, -64, -62, -78, -74, -86);
  spout.fine.M(-51, -40).C(-50, -64, -44, -80, -34, -88);
  spout.fine.M(-52, -40).L(-52, -84);
  for (const [x, y] of [[-92, -70], [-84, -66], [-14, -66], [-22, -62], [-78, -86], [-30, -88], [-56, -90], [-48, -92]] as const) {
    spout.fine.M(x, y).L(x + (x < -52 ? -1.5 : 1.5), y + 4);
  }
  const water = f.layer();
  sea(water.ink, -100, 100, 24, 3, 11, 3.2);
}

/** Olaus Magnus's sea hog: a pig's head and tusk on a scaled fish body, with a spined fin and webbed feet. */
function hog(f: Fig) {
  const tail = f.layer("hatch");
  both(tail, (p) => p.M(64, -6).C(76, -16, 86, -30, 100, -38).Q(94, -16, 88, 0).Q(94, 16, 100, 38).C(86, 30, 76, 16, 64, 6).Z());
  for (const [x, y] of [[98, -34], [94, -18], [92, 0], [94, 18], [98, 34]] as const) tail.fine.M(68, 0).Q((68 + x) / 2, y * 0.4, x, y);
  const fin = f.layer();
  spinedFin(
    fin,
    [[-34, -34], [-22, -37], [-8, -38], [6, -37], [20, -33], [32, -28], [42, -22]],
    [[-36, -56], [-22, -62], [-6, -64], [10, -62], [24, -56], [36, -48], [46, -36]],
  );
  const foot = f.layer("hatch");
  both(foot, (p) => p.M(-34, 18).C(-40, 30, -50, 40, -58, 48).L(-48, 45).L(-44, 52).L(-37, 45).L(-28, 50).C(-26, 38, -22, 28, -18, 20).Z());
  foot.fine.M(-30, 22).L(-48, 45).M(-28, 24).L(-37, 45);
  both(foot, (p) => p.M(24, 18).C(22, 30, 16, 38, 8, 44).L(18, 42).L(22, 48).L(28, 41).L(36, 44).C(36, 34, 36, 26, 38, 16).Z());
  const body = f.layer("scales");
  both(body, (p) => p.M(-50, -26).C(-30, -40, 10, -40, 40, -26).Q(58, -18, 70, -8).L(70, 6).Q(56, 14, 40, 18).C(10, 28, -30, 28, -52, 14).Z());
  const belly = f.layer("hatch");
  belly.clip.M(-52, 14).C(-30, 28, 10, 28, 40, 18).Q(56, 14, 70, 6).L(70, 0).Q(40, 12, 0, 16).C(-30, 16, -46, 8, -52, 4).Z();
  const head = f.layer("hatch");
  both(head, (p) => p.M(-44, -30).C(-58, -38, -70, -30, -76, -20).L(-92, -16).Q(-98, -10, -94, -2).L(-80, 2).C(-74, 10, -62, 18, -46, 18).C(-40, 6, -38, -16, -44, -30).Z());
  head.clip.M(-80, 2).C(-74, 10, -62, 18, -46, 18).C(-42, 10, -41, 2, -42, -4).Q(-60, 4, -80, 2).Z();
  head.ink.ell(-95, -9, 2.6, 6.2);
  head.fine.M(-95.5, -12).L(-95.5, -9).M(-95, -6).L(-95, -3);
  head.ink.M(-94, -2).Q(-86, 5, -76, 2);
  head.ink.ell(-66, -20, 2.8, 2);
  head.fine.M(-71, -24).Q(-66, -27, -61, -23);
  for (let i = 0; i < 3; i++) head.fine.M(-86 + i * 4, -18).Q(-84 + i * 4, -13, -86 + i * 4, -8);
  const ear = f.layer("hatch");
  both(ear, (p) => p.M(-58, -32).Q(-64, -54, -48, -60).Q(-44, -44, -46, -30).Z());
  ear.fine.M(-55, -34).Q(-56, -48, -50, -54);
  const tusk = f.layer();
  both(tusk, (p) => p.M(-82, 2).Q(-90, -10, -86, -26).Q(-84, -10, -76, 1).Z());
  const water = f.layer();
  sea(water.ink, -100, 100, 32, 3, 11, 3.2);
}

/** A winged sea dragon rising from the water, horned, with its tail coiled behind. */
function dragon(f: Fig) {
  const W = 24;
  const wingBack = f.layer("hatch");
  both(wingBack, (p) => p.M(8, -20).L(-2, -66).L(-14, -86).Q(-6, -74, 6, -80).Q(8, -68, 22, -78).Q(20, -60, 30, -52).Q(22, -40, 22, -22).Z());
  wingBack.fine.M(-2, -66).L(6, -80).M(-2, -66).L(22, -78).M(-2, -66).L(30, -52);
  const tail = f.layer("hatch");
  tube(tail, arch(54, W + 2, 13, 20), 13, 11, { shade: 1, bands: 2, crest: { side: -1, h: 7, every: 3 } });
  tube(tail, bez([67, W + 2], [72, W - 12], [82, W - 22], [94, W - 24]), 10, 3, { shade: 1, bands: 3 });
  both(tail, (p) => p.M(92, W - 30).L(108, W - 24).L(92, W - 17).Q(96, W - 24, 92, W - 30).Z());
  const neck = f.layer("hatch");
  tube(neck, bez([4, W + 2], [2, -12], [-20, -40], [-44, -52]), 32, 16, { shade: 1, bands: 2, crest: { side: 1, h: 10, every: 3 } });
  const wing = f.layer("hatch");
  both(wing, (p) =>
    p.M(10, -14).L(40, -58).L(48, -88).Q(52, -70, 72, -76).Q(64, -58, 86, -50).Q(74, -38, 90, -22).Q(72, -22, 62, -6).Q(40, -10, 24, 2).Z(),
  );
  wing.clip.M(40, -58).L(90, -22).Q(72, -22, 62, -6).Q(40, -10, 24, 2).Z();
  wing.ink.M(10, -14).L(40, -58);
  wing.fine.M(40, -58).L(72, -76).M(40, -58).L(86, -50).M(40, -58).L(90, -22).M(40, -58).L(62, -6);
  monsterHead(f, -96, -54, true);
  const water = f.layer();
  sea(water.ink, -100, 100, W + 4, 3, 11, 3.2);
}

/** A great fish with a spined back, open toothed jaws and a forked tail. */
function fish(f: Fig) {
  const fins = f.layer("hatch");
  both(fins, (p) => p.M(66, -6).C(78, -14, 90, -30, 104, -42).Q(96, -18, 90, 0).Q(96, 18, 104, 42).C(90, 30, 78, 14, 66, 6).Z());
  for (const [x, y] of [[102, -38], [96, -20], [92, 0], [96, 20], [102, 38]] as const) fins.fine.M(70, 0).Q((70 + x) / 2, y * 0.4, x, y);
  both(fins, (p) => p.M(10, 28).Q(22, 44, 38, 42).Q(32, 32, 36, 20).Z());
  both(fins, (p) => p.M(-26, 30).Q(-26, 46, -12, 48).Q(-12, 38, -8, 32).Z());
  const dorsal = f.layer();
  spinedFin(
    dorsal,
    [[-40, -37], [-28, -39], [-14, -40], [0, -39], [14, -37], [26, -33], [38, -28]],
    [[-42, -60], [-28, -66], [-12, -68], [4, -66], [18, -60], [30, -52], [44, -40]],
  );
  const body = f.layer("scales");
  both(body, (p) =>
    p.M(-74, 4).L(-98, -6).C(-88, -32, -50, -42, -10, -40).C(30, -38, 56, -20, 70, -6).L(70, 6).C(56, 20, 30, 32, -10, 34).C(-50, 34, -80, 26, -94, 14).Z(),
  );
  body.etch.M(-48, -10).C(-10, -18, 30, -12, 68, 0);
  const belly = f.layer("hatch");
  belly.clip.M(-50, 32).C(-20, 36, 30, 30, 56, 18).L(70, 6).L(70, 0).Q(30, 20, -10, 24).C(-30, 24, -44, 22, -50, 20).Z();
  const head = f.layer("hatch");
  both(head, (p) => p.M(-74, 4).L(-98, -6).C(-92, -24, -72, -36, -50, -38).C(-40, -20, -40, 14, -50, 32).C(-66, 30, -84, 24, -94, 14).Z());
  head.clip.M(-50, 32).C(-66, 30, -84, 24, -94, 14).L(-74, 4).Q(-60, 14, -44, 12).Q(-44, 24, -50, 32).Z();
  head.fine.M(-56, -34).C(-48, -14, -48, 12, -56, 28);
  head.solid.M(-76, 4).L(-96, -4.5).L(-92, 12).Z();
  teeth(head.fine, -95, -4, -78, 3, 5, 2.6);
  teeth(head.fine, -79, 5.5, -92, 11.5, 4, 2.4);
  head.ink.ell(-72, -16, 5, 4.6);
  head.fine.ell(-72, -16, 2.2, 2.2, Math.PI, TAU);
  const pectoral = f.layer("hatch");
  both(pectoral, (p) => p.M(-44, 4).C(-32, 6, -20, 14, -10, 26).C(-24, 26, -36, 18, -44, 12).Z());
  pectoral.fine.M(-42, 7).L(-14, 24).M(-42, 10).L(-22, 25);
  const water = f.layer();
  sea(water.ink, -100, 100, 50, 2, 11, 3.2);
}

/** A sea turtle swimming, seen from above: scuted shell, flippers, head raised. */
function turtle(f: Fig) {
  const limbs = f.layer("hatch");
  both(limbs, (p) => p.M(-24, -22).C(-38, -42, -58, -58, -84, -64).C(-64, -46, -44, -28, -30, -10).Z());
  both(limbs, (p) => p.M(-24, 22).C(-38, 42, -56, 54, -82, 58).C(-62, 42, -44, 26, -30, 10).Z());
  both(limbs, (p) => p.M(28, -20).C(36, -30, 48, -40, 60, -42).C(54, -28, 44, -18, 34, -10).Z());
  both(limbs, (p) => p.M(28, 20).C(36, 30, 48, 40, 60, 42).C(54, 28, 44, 18, 34, 10).Z());
  both(limbs, (p) => p.M(40, -4).L(56, 0).L(40, 4).Z());
  for (const sy of [-1, 1]) {
    for (let i = 0; i < 3; i++) limbs.fine.M(-36 - i * 12, sy * (26 + i * 9)).Q(-40 - i * 12, sy * (20 + i * 10), -44 - i * 12, sy * (24 + i * 10));
  }
  const head = f.layer("hatch");
  both(head, (p) => p.M(-38, -7).Q(-46, -7, -54, -8).C(-62, -12, -76, -12, -82, -3).Q(-84, 0, -82, 3).C(-76, 12, -62, 12, -54, 8).Q(-46, 7, -38, 7).Z());
  head.clip.M(-38, 7).Q(-46, 7, -54, 8).C(-62, 12, -76, 12, -82, 3).L(-44, 2).Z();
  head.ink.M(-73, -8).Q(-69, -10.5, -65, -8).M(-73, 8).Q(-69, 10.5, -65, 8);
  head.fine.M(-83, 0).L(-76, 0).M(-58, -8).Q(-56, 0, -58, 8);
  head.fine.M(-64, -4).L(-60, 0).L(-64, 4);
  const shell = f.layer("hatch");
  both(shell, (p) => p.ell(0, 0, 44, 34));
  shell.clip.ell(0, 0, 44, 34, -0.35, Math.PI * 0.9).Q(-4, 18, 42, -15).Z();
  shell.ink.ell(0, 0, 36, 26);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    shell.fine.M(36 * Math.cos(a), 26 * Math.sin(a)).L(44 * Math.cos(a), 34 * Math.sin(a));
  }
  const hexes: Pt[] = [];
  for (const cx of [-21, -7, 7, 21]) {
    shell.ink.line([[cx - 7, 0], [cx - 4, -10], [cx + 4, -10], [cx + 7, 0], [cx + 4, 10], [cx - 4, 10]], true);
    hexes.push([cx - 4, -10], [cx + 4, -10]);
  }
  for (const [x, y] of hexes) {
    const xx = x * 1.15;
    const ry = 26 * Math.sqrt(Math.max(0, 1 - (xx / 36) ** 2));
    if (Math.abs(x) > 5 && Math.abs(x) < 24) {
      shell.fine.M(x, y).L(xx, -ry);
      shell.fine.M(x, -y).L(xx, ry);
    }
  }
  shell.fine.M(-28, 0).L(-36, 0).M(28, 0).L(36, 0);
  const water = f.layer();
  for (let i = 0; i < 3; i++) water.fine.M(62 + i * 12, -12 - i * 6).Q(72 + i * 14, 0, 62 + i * 12, 12 + i * 6);
  sea(water.ink, -60, 96, 46, 2, 11, 3);
}

/** A galleon under sail, heading left: square sails, a lateen mizzen, rigging, no flags. */
function galleon(f: Fig) {
  const rig = f.layer();
  rig.ink.M(-28, -2).L(-28, -86).M(4, -2).L(4, -102).M(34, -12).L(34, -78).M(-58, -8).L(-94, -30);
  rig.fine.M(-28, -86).L(-92, -30).M(4, -102).L(-28, -86).M(4, -100).L(-26, -60).M(34, -78).L(4, -68);
  rig.fine.M(34, -78).L(58, -22).M(4, -102).L(50, -18);
  for (const [x, top] of [[-28, -58], [4, -62], [34, -48]] as const) {
    rig.fine.M(x, top).L(x - 9, -4).M(x, top).L(x + 9, -4);
    rig.ink.M(x - 5, top).L(x + 5, top);
  }
  const lateen = f.layer("hatch");
  both(lateen, (p) => p.M(18, -38).L(50, -82).Q(56, -52, 48, -26).Q(32, -28, 18, -38).Z());
  lateen.clip.M(50, -82).Q(56, -52, 48, -26).L(40, -30).Q(46, -56, 50, -82).Z();
  lateen.ink.M(14, -32).L(52, -86);
  const sails = f.layer("hatch");
  const square = (x: number, yT: number, yB: number, wT: number, wB: number, b: number) => {
    both(sails, (p) => p.M(x - wT, yT).L(x + wT, yT).Q(x + wB - b * 0.3, (yT + yB) / 2, x + wB, yB).Q(x, yB + b, x - wB, yB).Q(x - wB - b, (yT + yB) / 2, x - wT, yT).Z());
    sails.clip.M(x + wT * 0.25, yT).L(x + wT, yT).Q(x + wB - b * 0.3, (yT + yB) / 2, x + wB, yB).Q(x + wB * 0.6, yB + b * 0.7, x + wB * 0.2, yB + b * 0.8).Q(x + wB * 0.3, (yT + yB) / 2, x + wT * 0.25, yT).Z();
    sails.ink.M(x - wT - 3, yT).L(x + wT + 3, yT);
    sails.fine.M(x - wT * 0.35, yT).Q(x - wB * 0.6 - b * 0.5, (yT + yB) / 2, x - wB * 0.4, yB + b * 0.75);
    sails.fine.M(x + wT * 0.1, yT).Q(x - b * 0.2, (yT + yB) / 2, x + wB * 0.05, yB + b * 0.95);
  };
  square(-28, -56, -18, 16, 19, 6);
  square(-28, -82, -60, 11, 15, 4);
  square(4, -64, -20, 20, 23, 7);
  square(4, -98, -68, 13, 18, 5);
  square(-80, -26, -8, 8, 9, 3);
  const hull = f.layer("hatch");
  both(hull, (p) => p.M(-74, -14).L(-56, -6).Q(-20, -1, 22, -4).L(24, -13).L(44, -15).L(48, -24).L(60, -26).Q(63, -8, 56, 4).Q(48, 17, 28, 18).L(-34, 18).Q(-54, 16, -60, 2).Z());
  hull.clip.M(-60, 4).Q(0, 10, 58, 2).Q(48, 17, 28, 18).L(-34, 18).Q(-54, 16, -60, 4).Z();
  for (let i = 0; i < 5; i++) hull.etch.M(-64, -4 + i * 4.5).Q(0, i * 4.5 + 1, 64, -10 + i * 4.5);
  hull.ink.M(-58, 1).Q(-10, 7, 58, 0).M(-52, 9).Q(0, 13, 54, 7);
  hull.fine.M(24, -13).L(24, -4).M(44, -15).L(46, 2).M(48, -24).L(50, -12);
  for (let x = 50; x <= 56; x += 3) hull.fine.M(x, -21).L(x, -15);
  const water = f.layer();
  water.ink.M(-66, 12).Q(-74, 6, -80, 10).M(-62, 16).Q(-72, 12, -82, 18);
  sea(water.ink, -96, 96, 20, 3, 11, 3);
  for (let i = 0; i < 3; i++) water.fine.M(60 + i * 8, 14 + i * 3).Q(74 + i * 10, 12 + i * 4, 90 + i * 4, 16 + i * 5);
}

function ship(f: Fig) {
  galleon(f);
}

/** Olaus Magnus's great sea serpent wrapped around a ship, its head rearing over the deck. */
function leviathan(f: Fig) {
  const W = 26;
  const back = f.layer("hatch");
  tube(back, arch(-4, W, 58, 96), 15, 15, { shade: 1, bands: 2, crest: { side: -1, h: 9, every: 3 } });
  f.within(0.62, 0, 8, 1, () => galleon(f));
  const front = f.layer("hatch");
  tube(front, arch(2, W + 6, 36, 30), 14, 13, { shade: 1, bands: 2, crest: { side: -1, h: 8, every: 3 } });
  const tail = f.layer("hatch");
  tube(tail, curl(bez([56, W + 4], [64, W - 10], [76, W - 18], [88, W - 16]), -1, 6, 1.0), 12, 1.5, { shade: 1, bands: 3 });
  const neck = f.layer("hatch");
  tube(neck, bez([-66, W + 4], [-70, 0], [-78, -30], [-66, -54]), 18, 13, { shade: -1, bands: 2, crest: { side: -1, h: 10, every: 3 } });
  // The head turns back toward the ship.
  f.within(1, 0, 0, -1, () => monsterHead(f, 30, -58, true));
  const water = f.layer();
  sea(water.ink, -100, 100, W + 8, 3, 11, 3.2);
  for (const x of [-80, -52, -34, 38, 48, 62]) water.fine.M(x - 3, W + 2).Q(x, W - 4, x + 3, W + 1);
}

/** A whirlpool: arms of current spiralling down, seen at a slant. */
function whirlpool(f: Fig) {
  const pool = f.layer(null, true);
  pool.fill.ell(0, 0, 96, 56);
  const arms = 4;
  for (let a = 0; a < arms; a++) {
    const pts: Pt[] = [];
    const n = 110;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const ang = (a / arms) * TAU + u * TAU * 2.1;
      const r = 94 * Math.pow(1 - u, 1.15) + 2;
      pts.push([r * Math.cos(ang), 0.56 * r * Math.sin(ang)]);
    }
    (a % 2 ? pool.fine : pool.ink).line(pts);
  }
  // Wavelets riding round the rim.
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * TAU;
    const x = 100 * Math.cos(ang);
    const y = 60 * Math.sin(ang);
    const tx = -Math.sin(ang) * 8;
    const ty = Math.cos(ang) * 5;
    pool.fine.M(x - tx, y - ty).Q(x + ty * 0.6, y - tx * 0.6 * 0.6, x + tx, y + ty);
  }
}

/** A compass rose: sixteen points, half in solid ink, inside a ring of ticks, with rhumb lines running out. */
function rose(f: Fig) {
  const lines = f.layer();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU - Math.PI / 2;
    const len = i % 4 === 0 ? 100 : i % 2 === 0 ? 90 : 78;
    lines.fine.M(50 * Math.cos(a), 50 * Math.sin(a)).L(len * Math.cos(a), len * Math.sin(a));
  }
  const ring = f.layer();
  both(ring, (p) => p.ell(0, 0, 48, 48));
  ring.ink.ell(0, 0, 42, 42);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const r0 = i % 4 === 0 ? 42 : 45;
    ring.fine.M(r0 * Math.cos(a), r0 * Math.sin(a)).L(48 * Math.cos(a), 48 * Math.sin(a));
  }
  const points = (count: number, offset: number, len: number, w: number) => {
    const l = f.layer();
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const tip: Pt = [len * c, len * s];
      const b = len * 0.16;
      const left: Pt = [b * c + w * s, b * s - w * c];
      const right: Pt = [b * c - w * s, b * s + w * c];
      l.fill.line([tip, left, [0, 0], right], true);
      l.solid.line([tip, [0, 0], right], true);
      l.ink.line([tip, left, [0, 0], right], true);
    }
  };
  points(8, -Math.PI / 2 + Math.PI / 8, 30, 5);
  points(4, -Math.PI / 4, 46, 8);
  points(4, -Math.PI / 2, 70, 10);
  // North gets a longer point with a spear tip.
  const north = f.layer();
  north.ink.M(-7, -72).L(0, -88).L(7, -72).M(0, -70).L(0, -88);
}

const BUILD: Record<SeaKind, (f: Fig) => void> = { serpent, kraken, whale, hog, dragon, fish, turtle, leviathan, ship, whirlpool, rose };

// ---- wave marks -----------------------------------------------------------------------------------------------------

/** Wave marks sit one to a cell of a grid this many degrees wide; each zoom level halves the cell. */
const G0 = 6;
const MAX_LEVEL = 4;
/** A finer level fades in once its cells are this many pixels wide, and is fully drawn at the second. */
const MARK_FROM = 22;
const MARK_FULL = 30;
const MARK_ALPHA = 0.5;

interface Field {
  lon: number;
  lat: number;
  r: number;
  cosR: number;
  v: readonly [number, number, number];
  /** Per level: [lon, lat, depth inside the areas in degrees, x, y, z, shape] for each mark. */
  marks: (Float32Array | undefined)[];
}

let fields: Field[] | null = null;

function vec(lon: number, lat: number): [number, number, number] {
  const l = lon * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

function fieldList(): Field[] {
  fields ??= WAVE_FIELDS.map(([lon, lat, r]) => ({ lon, lat, r, cosR: Math.cos(r * RAD), v: vec(lon, lat), marks: [] }));
  return fields;
}

/** A fixed pseudo-random number in [0, 1) for a cell, so the sea looks the same on every visit. */
function hash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c + 1, 2246822519) ^ Math.imul(d + 7, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The one mark in cell (i, j) at a level. A finer level keeps every coarser mark where it was and adds three more
 * around it, so zooming in fills the sea in without moving what is already there.
 */
function cellMark(L: number, i: number, j: number): [number, number, number] {
  const g = G0 / 2 ** L;
  if (L > 0) {
    const p = cellMark(L - 1, i >> 1, j >> 1);
    if (Math.floor((p[0] + 180) / g) === i && Math.floor((p[1] + 90) / g) === j) return p;
  }
  return [-180 + (i + 0.15 + 0.7 * hash(i, j, L, 0)) * g, -90 + (j + 0.15 + 0.7 * hash(i, j, L, 1)) * g, L];
}

/** The marks a level adds inside one area, built the first time they are needed. */
function marksFor(fi: number, L: number): Float32Array {
  const F = fieldList();
  const f = F[fi];
  const have = f.marks[L];
  if (have) return have;
  const g = G0 / 2 ** L;
  const cols = Math.round(360 / g);
  const cosMax = Math.max(0.15, Math.cos(Math.min(89, Math.abs(f.lat) + f.r) * RAD));
  const dLon = f.r / cosMax;
  const out: number[] = [];
  const j0 = Math.floor((f.lat - f.r + 90) / g);
  const j1 = Math.floor((f.lat + f.r + 90) / g);
  const i0 = Math.floor((f.lon - dLon + 180) / g);
  const i1 = Math.floor((f.lon + dLon + 180) / g);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const ii = ((i % cols) + cols) % cols;
      const p = cellMark(L, ii, j);
      if (p[2] !== L) continue;
      const v = vec(p[0], p[1]);
      // The mark belongs to the first area that holds it; its depth is how far inside the deepest one it lies.
      let first = -1;
      let depth = -1;
      for (let q = 0; q < F.length; q++) {
        const o = F[q];
        const dot = v[0] * o.v[0] + v[1] * o.v[1] + v[2] * o.v[2];
        if (dot <= o.cosR) continue;
        if (first < 0) first = q;
        depth = Math.max(depth, o.r - Math.acos(Math.min(1, dot)) / RAD);
      }
      if (first !== fi) continue;
      // Thinner toward the edge, so no area shows as a circle.
      if (depth < 1.5 * hash(ii, j, L, 2)) continue;
      out.push(p[0], p[1], depth, v[0], v[1], v[2], hash(ii, j, L, 3));
    }
  }
  const arr = new Float32Array(out);
  f.marks[L] = arr;
  return arr;
}

/**
 * Short engraved wave marks over the open sea, fixed to the world so they turn with it. Each stays clear of land
 * and dots by at least a margin on screen: the areas keep 1.5 degrees from every coast and 3 from every outlet's
 * city, and a mark shows only where its depth inside them gives it that margin at the current zoom. All marks of a
 * level go into one path, stroked once.
 */
function drawWaveMarks(ctx: CanvasRenderingContext2D, proj: GeoProjection, mode: ViewMode, center: [number, number], k: number, W: number, H: number) {
  const F = fieldList();
  let top = 0;
  while (top < MAX_LEVEL && (G0 / 2 ** (top + 1)) * k >= MARK_FROM) top++;
  const fadeTop = top === 0 ? 1 : Math.min(1, Math.max(0, ((G0 / 2 ** top) * k - MARK_FROM) / (MARK_FULL - MARK_FROM)));
  const [cx, cy] = proj.translate();
  const cv = vec(center[0], center[1]);
  const globe = mode === "3d";
  const half = Math.min(8, Math.max(5.5, k * 1.3));
  const amp = half * 0.3;
  ctx.lineWidth = 0.8;
  for (let pass = 0; pass < 2; pass++) {
    const newest = pass === 1;
    if (newest && top === 0) break;
    ctx.globalAlpha = MARK_ALPHA * (newest ? fadeTop : 1);
    if (ctx.globalAlpha < 0.02) continue;
    ctx.beginPath();
    for (let fi = 0; fi < F.length; fi++) {
      const f = F[fi];
      // Skip areas off screen or on the far side of the globe.
      if (globe && f.v[0] * cv[0] + f.v[1] * cv[1] + f.v[2] * cv[2] < -Math.sin(f.r * RAD)) continue;
      const c = proj([f.lon, f.lat]);
      if (!c) continue;
      const rx = (f.r * k) / (globe ? 1 : Math.max(0.2, Math.cos(Math.min(85, Math.abs(f.lat) + f.r) * RAD)));
      const ry = f.r * k;
      if (c[0] + rx < -10 || c[0] - rx > W + 10 || c[1] + ry < -10 || c[1] - ry > H + 10) continue;
      const from = newest ? top : 0;
      const to = newest ? top : top === 0 ? 0 : top - 1;
      for (let L = from; L <= to; L++) {
        const m = marksFor(fi, L);
        for (let o = 0; o < m.length; o += 7) {
          let fore = 1;
          if (globe) {
            fore = m[o + 3] * cv[0] + m[o + 4] * cv[1] + m[o + 5] * cv[2];
            if (fore < 0.3) continue;
          }
          const depth = m[o + 2];
          const px = k * fore;
          if ((depth + 1.5) * px < 13 || (depth + 3) * px < 21) continue;
          const p = proj([m[o], m[o + 1]]);
          if (!p) continue;
          const x = p[0];
          const y = p[1];
          if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
          let ux = 0;
          let uy = 0;
          if (globe) {
            const d = Math.hypot(x - cx, y - cy) || 1;
            ux = (x - cx) / d;
            uy = (y - cy) / d;
          }
          // Foreshortened toward the globe's rim: offsets along the radius shrink.
          const sq = 1 - fore;
          const at = (dx: number, dy: number): [number, number] => {
            const r = (dx * ux + dy * uy) * sq;
            return [x + dx - r * ux, y + dy - r * uy];
          };
          const shape = m[o + 6];
          // A smooth ripple rising and falling, never cusped arcs, which read as birds.
          const wave = (x0: number, y0: number, w: number, halves: number, a: number) => {
            const step = (2 * w) / halves;
            let [sx, sy] = at(x0 - w, y0);
            ctx.moveTo(sx, sy);
            for (let q = 0; q < halves; q++) {
              const [qx, qy] = at(x0 - w + step * (q + 0.5), y0 + (q % 2 ? a : -a));
              [sx, sy] = at(x0 - w + step * (q + 1), y0);
              ctx.quadraticCurveTo(qx, qy, sx, sy);
            }
          };
          if (shape < 0.4) wave(0, 0, half, 4, amp);
          else if (shape < 0.75) {
            wave(0, 0, half, 3, amp);
            wave(half * 0.4, half * 0.62, half * 0.6, 2, amp * 0.8);
          } else wave(0, 0, half * 0.7, 2, amp);
        }
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---- Candy Shop and Space ---------------------------------------------------------------------------------------------

function drawSweets(ctx: CanvasRenderingContext2D, proj: GeoProjection, t: Theme, mode: ViewMode, center: [number, number], list: readonly Sweet[]) {
  const [cx, cy] = proj.translate();
  // Half the width of a sweet in pixels: grows with zoom, but stays small next to the land.
  const s = Math.min(28, Math.max(9, proj.scale() * 0.06));
  ctx.save();
  ctx.strokeStyle = t.coast;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  for (const c of list) {
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
    if (c.kind === "wrapped") wrapped(ctx);
    else if (c.kind === "lollipop") lollipop(ctx);
    else swirl(ctx);
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

// The sweets below are drawn in a box about two units wide, centred on their spot, as open strokes.

/** A wrapped sweet: an oval with a stripe, twisted wrapper ends either side. */
function wrapped(ctx: CanvasRenderingContext2D) {
  ctx.ellipse(0, 0, 0.55, 0.34, 0, 0, Math.PI * 2);
  ctx.moveTo(-0.2, -0.3);
  ctx.lineTo(0.05, 0.32);
  ctx.moveTo(0.12, -0.33);
  ctx.lineTo(0.34, 0.24);
  for (const side of [-1, 1]) {
    ctx.moveTo(side * 0.55, 0);
    ctx.lineTo(side * 0.98, -0.34);
    ctx.lineTo(side * 0.9, 0);
    ctx.lineTo(side * 0.98, 0.34);
    ctx.closePath();
  }
}

/** A lollipop: an open spiral on a stick. */
function lollipop(ctx: CanvasRenderingContext2D) {
  const cy = -0.35;
  for (let a = 0; a <= Math.PI * 5; a += 0.2) {
    const r = 0.04 + (a / (Math.PI * 5)) * 0.52;
    const x = Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.moveTo(0, cy + 0.56);
  ctx.lineTo(0, 0.98);
}

/** A peppermint swirl: curved spokes inside a ring, with wrapper ends. */
function swirl(ctx: CanvasRenderingContext2D) {
  ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(Math.cos(a + 0.6) * 0.34, Math.sin(a + 0.6) * 0.34, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
  }
  for (const side of [-1, 1]) {
    ctx.moveTo(side * 0.5, 0);
    ctx.lineTo(side * 0.9, -0.28);
    ctx.lineTo(side * 0.9, 0.28);
    ctx.closePath();
  }
}
