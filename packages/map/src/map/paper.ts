// Notebook (id paper): a ruled school notebook page with the world drawn on it by hand in ballpoint pen.
// The page itself (pale blue rules, the red margin, the punched holes) is the stylesheet's, behind a transparent canvas;
// the canvas draws only what the pen did: land left white so it hides the rules, its coasts in blue ink with a faint
// second line beside them, small caret mountains, thin rivers, and the edge of the sheet or the globe. The sea is the
// page, so the ruling runs through it.
//
// Every frame is the whole picture. The pen's wobble is tied to the point on the world (not to the screen), so a line
// keeps its shape while the map is dragged, and nothing is drawn plainly while it moves and fully when it stops: that
// switch is what made the old design stutter. Nothing here moves on its own, and markers, arcs and tuning are the
// view's as in every design.

import { geoDistance, geoPath, type GeoProjection, type GeoStream } from "d3-geo";
import { pathContext, type SurfaceFrame } from "./surface.ts";

/** The notebook's colours. style.css repeats them as --nb-* custom properties, and a test checks it does. */
export const PAPER = "#fcfcf8";
export const RULE = "#bdd5ef";
export const MARGIN = "#ec8b9c";
/** Blue ballpoint, for the pen's lines and writing. */
export const INK = "#1d3a96";
/** A black pen, for the markers. */
export const BLACK = "#1f2230";
/** Pencil-grey blue for small print. */
export const GRAPHITE = "#4a5276";
export const HIGHLIGHT = "#fff1a0";
/** A thin wash of blue ink for lakes and ice. */
export const WASH = "#e1ebf8";
/** The red pen: fresh reports. */
export const RED = "#d1344a";
/** The desk the sheet lies on, on wide screens. */
export const DESK = "#52698a";

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A page flip: the page swings on its binding, edge-on at the middle, where the new page takes its place and swings
 * back. It never goes past 88 degrees, so the page never shows its back, and it changes no colour and no opacity,
 * so there is nothing to flash (WCAG 2.3.1). None for reduced motion.
 */
export const FLIP_MS = 240;
export const FLIP_MAX = 88;

/** The page's angle in degrees at t from 0 to 1 of a turn: out to -FLIP_MAX at the middle, back from +FLIP_MAX. */
export function flipAngle(t: number): number {
  const x = clamp(t, 0, 1);
  const ease = (u: number) => u * u * (3 - 2 * u);
  return x < 0.5 ? -FLIP_MAX * ease(x * 2) : FLIP_MAX * (1 - ease(x * 2 - 1));
}

/**
 * The keyframes of a turn: forward the page swings on its left edge, back on its right (the caller sets the origin).
 * Only the transform changes, never a colour or the opacity.
 */
export function flipFrames(forward: boolean, steps = 16): { transform: string; offset: number }[] {
  const frames: { transform: string; offset: number }[] = [];
  for (let i = 0; i <= steps; i++) frames.push({ transform: `perspective(1400px) rotateY(${((forward ? 1 : -1) * flipAngle(i / steps)).toFixed(2)}deg)`, offset: i / steps });
  return frames;
}

/** sRGB to relative luminance (WCAG), for the flash checks. */
export function luminance(color: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`not a hex colour: ${color}`);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => lin(parseInt(x, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** How far the pen strays from the true line, at most, in pixels at the usual scale of the whole map. */
export const WOBBLE_PX = 1.1;
/** The map scale WOBBLE_PX is for: the whole world about 900 pixels wide. */
const USUAL_SCALE = 143;
/** The drift's swing: one in sixteen pixels at the usual scale, as a frequency in radians per degree of the world. */
const RATE = (2 * Math.PI * USUAL_SCALE * RAD) / 16;

/** A fixed value in [-0.5, 0.5) for a point and a stream k. */
function hash(x: number, y: number, k: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/**
 * The pen's stray from the line at a point of the world, in units of the wobble (at most about 1.2 either way): a slow
 * drift, and for lines only a little shake from point to point. It depends on the place on the world alone, never on
 * where the map was dragged to or how far it is zoomed, so a line keeps its shape in motion; zooming only scales it.
 *
 * The drift alone is smooth enough (its slope stays under one) that it moves a small island or lake as a whole and can
 * never turn it inside out, which the projection would read as "everything but this lake". So shapes that are filled
 * take the drift only, and only lines, which have no inside, take the shake as well.
 */
export function penNudge(lon: number, lat: number, shake = false): [number, number] {
  const drift = (a: number) => Math.sin(lon * RATE + lat * RATE * 0.63 + a) * 0.55 + Math.sin(lon * RATE * 0.41 - lat * RATE * 1.1 + a * 2.1) * 0.45;
  const k = shake ? 0.6 : 1;
  return [drift(0.7) * k + (shake ? hash(lon, lat, 1) * 0.8 : 0), drift(3.9) * k + (shake ? hash(lat, lon, 5) * 0.8 : 0)];
}

/**
 * The wobble in pixels at a map scale: the usual one, less on a small map. A swing is a fixed stretch of the world, so on
 * a small map it is narrower in pixels, and its amplitude shrinks with it to keep its slope (the amplitude over the
 * swing's length) where it is at the usual scale, below the point where a shape could fold over.
 */
export function wobbleAt(scale: number): number {
  return WOBBLE_PX * clamp(scale / USUAL_SCALE, 0.2, 1);
}

/**
 * The projection with every point of a drawing nudged as the pen would, for geoPath to draw through. What each point
 * of a shape is nudged by is worked out the first time that shape is drawn and kept (a drawing's points always come in
 * the same order), so a frame costs a multiply and an add per point and no sines.
 */
class Pen {
  private a: Float32Array | null = null;
  private fresh: number[] | null = null;
  private i = 0;
  /** Degrees of the world in one unit of the nudge, at this scale. */
  private readonly k: number;
  readonly view: { stream(out: GeoStream): GeoStream };

  constructor(
    inner: { stream(out: GeoStream): GeoStream },
    scale: number,
    private readonly shake: boolean,
    private readonly kept: WeakMap<object, Float32Array>,
  ) {
    this.k = wobbleAt(scale) / (scale * RAD);
    this.view = {
      stream: (out: GeoStream) => {
        const s = inner.stream(out);
        return {
          point: (x: number, y: number) => {
            let ux: number;
            let uy: number;
            const a = this.a;
            if (a) {
              ux = a[this.i]!;
              uy = a[this.i + 1]!;
              this.i += 2;
            } else {
              [ux, uy] = penNudge(x, y, this.shake);
              this.fresh!.push(ux, uy);
            }
            s.point(x + ux * this.k, y + uy * this.k);
          },
          lineStart: () => s.lineStart(),
          lineEnd: () => s.lineEnd(),
          polygonStart: () => s.polygonStart(),
          polygonEnd: () => s.polygonEnd(),
          sphere: () => s.sphere?.(),
        };
      },
    };
  }

  /** Draws `root` through the pen. */
  draw(root: object, path: (o: never) => void) {
    this.i = 0;
    this.a = this.kept.get(root) ?? null;
    this.fresh = this.a ? null : [];
    path(root as never);
    if (this.fresh) this.kept.set(root, Float32Array.from(this.fresh));
  }
}

const keptSmooth = new WeakMap<object, Float32Array>();
const keptShaky = new WeakMap<object, Float32Array>();

/** A circle drawn by hand: its radius wanders a little round the turn, and the pen overshoots where it meets itself. */
export function handCircle(cx: number, cy: number, R: number, wobble = WOBBLE_PX): Path2D {
  const p = new Path2D();
  const n = 120;
  const a0 = 0.35;
  const extra = 8;
  for (let i = 0; i <= n + extra; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    // The overshoot drifts outward, so the end of the line passes the start without joining it.
    const over = i > n ? ((i - n) / extra) * 1.6 : 0;
    const r = R + wobble * (0.55 * Math.sin(a * 3 + 1.1) + 0.3 * Math.sin(a * 7 + 2.3) + 0.15 * Math.sin(a * 13 + 0.4)) + over;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i) p.lineTo(x, y);
    else p.moveTo(x, y);
  }
  return p;
}

const SPHERE = { type: "Sphere" } as const;

/** What is drawn through the pen for one view, kept while the view holds still so a redraw for a marker costs fills only. */
interface Strokes {
  key: string;
  land: Path2D;
  coast: Path2D;
  lakes: Path2D;
  ice: Path2D | null;
  rivers: Path2D;
  edge: Path2D;
  peaks: Path2D;
}

export class PaperCache {
  strokes?: Strokes;
  maps = new WeakMap<object, number>();
  mapId = 0;
  reliefs = new WeakMap<object, number>();
}

const idOf = (m: WeakMap<object, number>, o: object, next: () => number): number => {
  let id = m.get(o);
  if (id === undefined) m.set(o, (id = next()));
  return id;
};

/** A caret mountain, a tick of the pen either side of a point. */
function caret(p: Path2D, x: number, y: number, s: number) {
  p.moveTo(x - s, y + s * 0.55);
  p.lineTo(x, y - s * 0.7);
  p.lineTo(x + s * 0.85, y + s * 0.55);
  p.moveTo(x - s * 0.1, y - s * 0.1);
  p.lineTo(x + s * 0.28, y + s * 0.5);
}

function build(f: SurfaceFrame, key: string): Strokes {
  const scale = f.proj.scale();
  const smooth = new Pen(f.view, scale, false, keptSmooth);
  const shaky = new Pen(f.view, scale, true, keptShaky);
  const through = (pen: Pen, draw: (path: (o: never) => void) => void): Path2D => {
    const p = new Path2D();
    draw(geoPath(pen.view as GeoProjection, pathContext(p)) as (o: never) => void);
    return p;
  };
  const land = through(smooth, (path) => smooth.draw(f.map.land, path));
  const coast = through(shaky, (path) => shaky.draw(f.map.coast, path));
  const lakes = through(smooth, (path) => smooth.draw(f.map.lakes, path));
  const ice = f.map.ice ? through(smooth, (path) => smooth.draw(f.map.ice!, path)) : null;
  // Rivers: only the larger ones until the map is zoomed in, as in every design.
  const maxRank = f.zoom < 1.8 ? 4 : f.zoom < 3.5 ? 5 : 9;
  const rivers = through(shaky, (path) => {
    for (const r of f.map.rivers.features) if ((r.properties?.r ?? 9) <= maxRank) shaky.draw(r, path);
  });
  // The edge: a ball is a circle drawn by hand; the flat map's oval is the projection's own clean outline.
  let edge: Path2D;
  if (f.mode === "3d") {
    const [cx, cy] = f.proj.translate();
    edge = handCircle(cx, cy, f.proj.scale(), wobbleAt(scale));
  } else {
    edge = new Path2D();
    geoPath(f.view as GeoProjection, pathContext(edge))(SPHERE);
  }
  // Mountains: the same small caret at every peak, a little bigger as the map is zoomed in.
  const peaks = new Path2D();
  if (f.relief) {
    const s = Math.min(5, 2.2 + f.zoom * 0.45);
    const globe = f.mode === "3d";
    // Only some of the peaks, the same ones for the same scale, fewer on a small map, so a range reads as a few strokes of
    // the pen and not as a shading. Which are kept goes by the peak's place in the list, never by where it is on screen.
    const keep = clamp((scale / 260) ** 2, 0.06, 0.7);
    let n = 0;
    for (const [lon, lat] of f.relief.peaks) {
      if ((n++ * 0.6180339887) % 1 > keep) continue;
      if (globe && geoDistance([lon, lat], [f.lon, f.lat]) > Math.PI / 2 - 0.05) continue;
      const p = f.proj([lon, lat]);
      if (!p) continue;
      if (p[0] < -8 || p[1] < -8 || p[0] > f.w + 8 || p[1] > f.h + 8) continue;
      caret(peaks, p[0], p[1], s);
    }
  }
  return { key, land, coast, lakes, ice, rivers, edge, peaks };
}

/**
 * Draws the map as a pen drawing on ruled paper, the whole picture in every frame. The sea is left clear (the page's
 * rules show through it); the land is filled with the page's white to hide the rules; everything else is pen.
 */
export function drawPaper(f: SurfaceFrame, c: PaperCache): void {
  const g = f.ctx;
  const globe = f.mode === "3d";
  const key = `${f.mode}|${f.lon}|${f.lat}|${f.zoom}|${f.w}|${f.h}|${f.dpr}|${idOf(c.maps, f.map, () => ++c.mapId)}|${f.relief ? idOf(c.reliefs, f.relief, () => ++c.mapId) : 0}`;
  if (c.strokes?.key !== key) c.strokes = build(f, key);
  const s = c.strokes!;

  g.lineCap = "round";
  g.lineJoin = "round";

  // The sheet or sphere, lightly washed so the world reads as a drawn thing lying on the page, rules showing through.
  g.fillStyle = "rgba(252,252,248,0.42)";
  g.fill(s.edge);

  // A second, fainter line a little way beside every coast, down and to the right: what a pen does going back over a
  // shape. The land is laid over its inner half, so it shows only on the sea's side.
  g.save();
  g.translate(2.2, 2.0);
  g.strokeStyle = "rgba(29,58,150,0.38)";
  g.lineWidth = 1;
  g.stroke(s.coast);
  g.restore();

  g.fillStyle = PAPER;
  g.fill(s.land);

  if (s.ice) {
    g.fillStyle = WASH;
    g.fill(s.ice);
  }

  g.fillStyle = WASH;
  g.fill(s.lakes);
  g.strokeStyle = INK;
  g.lineWidth = 0.8;
  g.stroke(s.lakes);

  g.strokeStyle = "rgba(29,58,150,0.55)";
  g.lineWidth = 0.7;
  g.stroke(s.rivers);

  g.strokeStyle = "rgba(29,58,150,0.8)";
  g.lineWidth = 1;
  g.stroke(s.peaks);

  // The coast: blue ballpoint, pressed a little harder than the lines beside it.
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.stroke(s.coast);

  // The edge of the sheet, or of the ball, in a firmer line; the globe gets a second pen line inside its lower right.
  g.strokeStyle = INK;
  g.lineWidth = globe ? 1.8 : 1.4;
  g.stroke(s.edge);
  if (globe) {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    g.beginPath();
    g.arc(cx, cy, R - 4.5, 0.15 * Math.PI, 0.78 * Math.PI);
    g.strokeStyle = "rgba(29,58,150,0.55)";
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R - 8.5, 0.28 * Math.PI, 0.62 * Math.PI);
    g.stroke();
  }
}
