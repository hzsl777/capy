// Machine Music (id machine): after the feel of 1970s and 80s German electronic music stage shows and
// record sleeves, and the constructivist posters they borrowed from. Nothing is copied from any of them: no names,
// figures, sleeve or poster art, lettering or logos. Black, signal red, warm grey and white only.
//
// Map view: the world as a vector display on a black screen: a fine red grid fixed to longitude and latitude with a
// stronger line every thirty degrees, land as ruled scan lines in grey with the grid showing through it like a
// wireframe, and a coast drawn as a neon tube (a soft red glow, a red line, a white-hot core).
//
// Globe view: a red wireframe sphere (its far side showing through) with the same land, standing on a stage: a back
// wall of lit grid panels, one strong red diagonal band across it with a grey stripe beside it, a neon frame, two
// spotlight cones, a perspective grid floor and a lit console at each side. The stage is drawn first and the sphere's
// opaque body over it, so nothing ever lies over a place; the view draws markers last. Its layout follows the
// globe's resting size, not its zoom, so zooming never redraws it.
//
// Nothing on the canvas moves on its own. The machinery that does (the sequencer, the scope, the meters, the chasers)
// is chrome around the map (src/ui/machine.ts, style.css), and its timing lives here so the test can check it.

import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import { hash2, offscreen, pathContext, type SurfaceFrame } from "./surface.ts";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The palette: signal red, a brighter red for light, warm greys and white. Nothing else. */
export const MACHINE = {
  red: "#d71920",
  glow: "#ff3a2f",
  hot: "#ffd9d3",
  grey: "#9a9a94",
  land: "#2a2a28",
  scan: "rgba(150,150,142,0.62)",
  ice: "#8a8a84",
  black: "#050505",
};

// ---- the sequencer's timing (chrome in src/ui/machine.ts) ---------------------------------------------------------

/** Sixteen steps; the lit one walks two steps a second, so the row goes round once every eight seconds. */
export const SEQ_STEPS = 16;
export const SEQ_HZ = 2;
/**
 * Seconds a step's light takes to come up or go down (a linear CSS transition). The step that goes dark fades as the
 * next one comes up, so the row as a whole holds the same light.
 */
export const SEQ_FADE_S = 0.24;
/** The step that stays lit for readers who ask for reduced motion: the row holds still. */
export const SEQ_STILL = 0;
/**
 * The steps the pattern keeps dimly lit, always: a rhythm of our own, four bars of four, that the walking light passes
 * over. It carries nothing and changes nothing; only the one walking step moves.
 */
export const SEQ_PATTERN: readonly number[] = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0];

/** The lit step at `t` seconds on the motion clock. */
export function seqStep(t: number, still = false): number {
  if (still) return SEQ_STILL;
  return ((Math.floor(t * SEQ_HZ) % SEQ_STEPS) + SEQ_STEPS) % SEQ_STEPS;
}

/**
 * How lit each step is at `t` (0 dark, 1 lit), as the page shows it: the step just lit coming up over `SEQ_FADE_S`,
 * the one before it going down over the same time, the rest dark.
 */
export function padLevels(t: number, still = false): number[] {
  const out = new Array<number>(SEQ_STEPS).fill(0);
  const k = seqStep(t, still);
  if (still) {
    out[k] = 1;
    return out;
  }
  const since = (t * SEQ_HZ - Math.floor(t * SEQ_HZ)) / SEQ_HZ;
  const up = clamp(since / SEQ_FADE_S, 0, 1);
  out[k] = up;
  out[(k + SEQ_STEPS - 1) % SEQ_STEPS] = 1 - up;
  return out;
}

/**
 * The chasers along the toolbar and the time bar: a short lit cell that steps along a row of sixteen, in CSS, at the
 * sequencer's pace (one step every half second, the whole row in eight seconds). The cell is a few pixels tall.
 */
export const CHASE_CELLS = SEQ_STEPS;
export const CHASE_PERIOD_S = SEQ_STEPS / SEQ_HZ;

/**
 * The meters' needles and the scope's trace, as CSS animations (style.css): seconds per swing and per pass. All are
 * slow, thin and small, and none changes the light of a large area.
 */
export const METER_SWING_S: readonly number[] = [3.2, 4.1];
export const SCOPE_PASS_S = 5;

// ---- the rack's readouts (chrome in src/ui/machine.ts) -------------------------------------------------------------

/** The reticle's longitude and latitude as the rack's display prints them: `036.8E` and `01.3S`. */
export function lonText(lon: number): string {
  const v = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(v).toFixed(1).padStart(5, "0")}${v < 0 ? "W" : "E"}`;
}
export function latText(lat: number): string {
  return `${Math.abs(lat).toFixed(1).padStart(4, "0")}${lat < 0 ? "S" : "N"}`;
}

/** Zoom's lamps: how many of `count` are lit for the map's detail level (0 up to `count - 1`), at least one. */
export function zoomLamps(level: number, count: number): number {
  return clamp(Math.round(level) + 1, 1, count);
}

// ---- Map view: the black screen ----------------------------------------------------------------------------------

/** Grid steps in degrees: a fine one, finer as the map is zoomed in, and a stronger one every 30 degrees. */
export function gridStep(zoom: number): number {
  return zoom >= 6 ? 1 : zoom >= 2.5 ? 2.5 : 5;
}
const GRIDS = new Map<number, object>();
const gridOf = (step: number) => {
  let g = GRIDS.get(step);
  if (!g) GRIDS.set(step, (g = geoGraticule().step([step, step]).extent([[-180, -90], [180, 90.001]])()));
  return g;
};
const MAJOR = geoGraticule().step([30, 30])();
const WIRE = geoGraticule().step([15, 15])();

/** The world's land, ice, lakes and coasts as paths for this frame. */
function worldPaths(f: SurfaceFrame) {
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  return { path, land: path(f.map.land), coast: path(f.map.coast), lakes: path(f.map.lakes) };
}

/** A neon tube: a wide faint glow and a narrower one added to the light, the coloured tube, and a white-hot core. */
function tube(g: CanvasRenderingContext2D, p: Path2D | null, width: number, color = MACHINE.glow, glow = true) {
  const stroke = () => (p ? g.stroke(p) : g.stroke());
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  if (glow) {
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "rgba(215,25,32,0.14)";
    g.lineWidth = width * 5.5;
    stroke();
    g.strokeStyle = "rgba(255,58,47,0.22)";
    g.lineWidth = width * 2.4;
    stroke();
    g.globalCompositeOperation = "source-over";
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  stroke();
  g.strokeStyle = "rgba(255,233,228,0.8)";
  g.lineWidth = Math.max(0.5, width * 0.36);
  stroke();
  g.restore();
}

let scanTile: { dpr: number; pattern: CanvasPattern } | undefined;
/** Scan lines for the land: a one pixel grey rule every third pixel, the way a plotter or a vector screen fills a shape. */
function scanlines(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern | null {
  if (scanTile?.dpr !== dpr) {
    // Below one device pixel per pixel (the Design picker's small pictures) a rule can't be drawn, so the tile is the
    // rule's average: one pixel at a third of the strength.
    const thin = dpr < 1;
    const [c, g] = offscreen(1, thin ? 1 : 3, thin ? 1 : dpr);
    g.fillStyle = thin ? "rgba(150,150,142,0.21)" : MACHINE.scan;
    g.fillRect(0, 0, 1, 1);
    const pattern = ctx.createPattern(c, "repeat");
    if (!pattern) return null;
    // The tile is drawn at device pixels; the frame is scaled by dpr, so bring it back to one tile pixel per pixel.
    pattern.setTransform(new DOMMatrix().scale(1 / dpr));
    scanTile = { dpr, pattern };
  }
  return scanTile.pattern;
}

/**
 * The land as a vector display fills it: a dark grey body ruled with grey scan lines, the grid showing through it
 * as a wireframe, faint relief chevrons, black lakes, and the coast as a neon tube. Shared by the screen and sphere.
 */
function paintLand(f: SurfaceFrame, globe: boolean) {
  const { ctx, theme: t, proj, w, h } = f;
  const { path, land, coast, lakes } = worldPaths(f);
  ctx.fillStyle = MACHINE.land;
  ctx.fill(land);
  const rules = scanlines(ctx, f.dpr);
  if (rules) {
    ctx.fillStyle = rules;
    ctx.fill(land);
  }
  if (f.map.ice) {
    ctx.fillStyle = t.ice;
    ctx.fill(path(f.map.ice));
  }
  // The wire through the land: the grid again, over it, so the land reads as a surface the lines run across.
  ctx.save();
  ctx.clip(land);
  const wire = geoPath(f.view as never, ctx);
  ctx.beginPath();
  wire((globe ? WIRE : gridOf(gridStep(f.zoom) * 2)) as never);
  ctx.strokeStyle = "rgba(255,58,47,0.3)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  if (f.relief) {
    // Mountains as small open chevrons in a light grey, like marks engraved on a panel: never a dot.
    const s = clamp(1.8 * Math.sqrt(f.zoom), 1.8, 4.5);
    const c: [number, number] = [f.lon, f.lat];
    const relief = new Path2D();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && !facing(c, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      relief.moveTo(p[0] - s, p[1] + s * 0.55);
      relief.lineTo(p[0], p[1] - s * 0.55);
      relief.lineTo(p[0] + s, p[1] + s * 0.55);
    }
    ctx.lineWidth = 0.9;
    ctx.lineJoin = "miter";
    ctx.strokeStyle = t.relief;
    ctx.stroke(relief);
  }
  ctx.restore();
  ctx.fillStyle = t.lake;
  ctx.fill(lakes);
  if (f.zoom >= 2) {
    ctx.strokeStyle = t.river;
    ctx.lineWidth = 0.8;
    ctx.stroke(path(f.map.rivers));
  }
  tube(ctx, coast, t.coastWidth + 0.5);
  ctx.save();
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth * 0.7;
  ctx.stroke(lakes);
  ctx.restore();
}

function facing([lon0, lat0]: [number, number], lon: number, lat: number): boolean {
  const d = Math.PI / 180;
  return Math.sin(lat * d) * Math.sin(lat0 * d) + Math.cos(lat * d) * Math.cos(lat0 * d) * Math.cos((lon - lon0) * d) > 0.05;
}

function drawScreen(f: SurfaceFrame) {
  const { ctx, w, h, theme: t } = f;
  ctx.fillStyle = MACHINE.black;
  ctx.fillRect(0, 0, w, h);
  const path = geoPath(f.view as never, ctx);
  // The world's sheet, a shade off black, so its edge reads on the screen.
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.fillStyle = t.ocean;
  ctx.fill();
  // The fine grid, then the stronger one every thirty degrees, both under the land.
  ctx.beginPath();
  path(gridOf(gridStep(f.zoom)) as never);
  ctx.strokeStyle = t.graticule;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.beginPath();
  path(MAJOR as never);
  ctx.strokeStyle = "rgba(255,58,47,0.55)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // The equator and the prime meridian, a little stronger and in grey: the axes of the screen.
  ctx.beginPath();
  path({ type: "LineString", coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] } as never);
  path({ type: "LineString", coordinates: [[0, -90], [0, -45], [0, 0], [0, 45], [0, 90]] } as never);
  ctx.strokeStyle = "rgba(190,190,182,0.38)";
  ctx.lineWidth = 1;
  ctx.stroke();
  paintLand(f, false);
  // The sheet's edge as a thin red tube, over the land.
  ctx.beginPath();
  path({ type: "Sphere" });
  tube(ctx, null, 1.2, MACHINE.red);
}

// ---- Globe view: the wireframe sphere on its stage ---------------------------------------------------------------

/** A spotlight: where it hangs above the frame and where its cone meets the stage, as shares of the globe's radius. */
export interface Cone {
  /** The lamp's x and the cone's centre on the stage, from the globe's centre in radii. */
  top: number;
  foot: number;
  /** Half the cone's width at the lamp and at the stage, in radii. */
  w0: number;
  w1: number;
}

/** Two cones from upper left and upper right, crossing behind the sphere and landing on the stage beneath it. */
export const CONES: readonly Cone[] = [
  { top: -1.5, foot: 0.35, w0: 0.08, w1: 0.95 },
  { top: 1.5, foot: -0.35, w0: 0.08, w1: 0.95 },
];

/** The stage's front edge below the globe's centre, in radii: the sphere stands just on the floor. */
export const STAGE_AT = 1.04;

/** The diagonal: one band across the whole stage, rising to the right at this angle, behind the sphere. */
export const BAND_DEG = 27;
export interface Band {
  /** A point on the band's centre line and its direction (rising right) and normal, as unit vectors in screen space. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  /** Half the red band's thickness, in pixels, and the grey stripe's offset and half thickness beside it. */
  half: number;
  stripeAt: number;
  stripeHalf: number;
}
export function bandOf(cx: number, cy: number, R: number): Band {
  const a = (BAND_DEG * Math.PI) / 180;
  return { x: cx + R * 0.2, y: cy + R * 0.3, dx: Math.cos(a), dy: -Math.sin(a), nx: Math.sin(a), ny: Math.cos(a), half: R * 0.2, stripeAt: R * 0.36, stripeHalf: R * 0.035 };
}

/** A console on the stage: its front face and the parallelogram of its top, in pixels. */
export interface Console {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * The two lit consoles that stand on the floor at the sides of the globe, left and right, when the frame has room for
 * them beside the sphere and floor below it. Always outside the sphere at its resting size.
 */
export function consoleBoxes(w: number, h: number, cx: number, cy: number, R: number): Console[] {
  const floor = cy + R * STAGE_AT;
  const bw = R * 0.78;
  const bh = Math.min(R * 0.2, h - floor - 8);
  if (bh < 14) return [];
  const out: Console[] = [];
  for (const side of [-1, 1]) {
    const x = cx + side * R * 1.62 - bw / 2;
    if (x < 6 || x + bw > w - 6) continue;
    out.push({ x, y: floor + 6, w: bw, h: bh });
  }
  return out;
}

export class MachineCache {
  /** The stage, its wall, band, light and floor: one per frame size and resting globe size. */
  stage?: { key: string; canvas: HTMLCanvasElement };
}

/** The back wall: rows of square panels, a few of them lit in red or grey, a few showing a little matrix of lamps. */
function wall(g: CanvasRenderingContext2D, w: number, floor: number, cx: number, cy: number, R: number) {
  const p = clamp(R * 0.3, 30, 96);
  const x0 = cx - p / 2 - Math.ceil((cx - p / 2) / p) * p;
  const cols = Math.ceil((w - x0) / p);
  const rows = Math.ceil(floor / p);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * p + 1.5, y = j * p + 1.5, s = p - 3;
      const n = hash2(i * 7 + 3, j * 13 + 1);
      g.fillStyle = "#0e0e0d";
      g.fillRect(x, y, s, s);
      if (n < 0.2) {
        g.fillStyle = `rgba(215,25,32,${(0.1 + (n / 0.2) * 0.24).toFixed(3)})`;
        g.fillRect(x, y, s, s);
      } else if (n < 0.3) {
        g.fillStyle = `rgba(214,214,204,${(0.04 + ((n - 0.2) / 0.1) * 0.06).toFixed(3)})`;
        g.fillRect(x, y, s, s);
      }
      g.strokeStyle = "rgba(154,154,148,0.16)";
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      // A panel with a matrix of lamps: four by four, each lit or dark by a fixed pattern.
      if (hash2(i + 91, j * 5 + 2) < 0.16 && s > 28) {
        const m = s * 0.6, c = m / 4, mx = x + (s - m) / 2, my = y + (s - m) / 2;
        for (let b = 0; b < 16; b++) {
          const on = hash2(i * 16 + b, j * 3 + 17);
          if (on < 0.45) continue;
          g.fillStyle = on > 0.85 ? "rgba(244,244,238,0.85)" : "rgba(255,58,47,0.8)";
          g.fillRect(mx + (b % 4) * c + 0.5, my + Math.floor(b / 4) * c + 0.5, c - 1.5, c - 1.5);
        }
      }
    }
  }
  // Darker toward the edges, so the wall is lit from the middle.
  const fall = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.max(w * 0.62, R * 2.4));
  fall.addColorStop(0, "rgba(5,5,5,0)");
  fall.addColorStop(1, "rgba(5,5,5,0.82)");
  g.fillStyle = fall;
  g.fillRect(0, 0, w, floor);
}

/** The diagonal: a red band, a black gap, a grey stripe and a white hairline, all rising to the right. */
function diagonal(g: CanvasRenderingContext2D, b: Band, w: number, h: number) {
  const L = Math.hypot(w, h);
  const strip = (off: number, half: number, fill: string) => {
    const ox = b.x + b.nx * off, oy = b.y + b.ny * off;
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(ox - b.dx * L - b.nx * half, oy - b.dy * L - b.ny * half);
    g.lineTo(ox + b.dx * L - b.nx * half, oy + b.dy * L - b.ny * half);
    g.lineTo(ox + b.dx * L + b.nx * half, oy + b.dy * L + b.ny * half);
    g.lineTo(ox - b.dx * L + b.nx * half, oy - b.dy * L + b.ny * half);
    g.closePath();
    g.fill();
  };
  strip(0, b.half, MACHINE.red);
  // The band's edge toward the light: a brighter red rule along it.
  strip(-b.half + 2, 2, "rgba(255,90,76,0.8)");
  strip(b.stripeAt, b.stripeHalf, "rgba(154,154,148,0.9)");
  strip(b.stripeAt + b.stripeHalf * 3.2, 1, "rgba(244,244,238,0.85)");
}

/** A console's face: dark, with a row of lit keys along it, a slanted top ruled with faders, and a small lit screen. */
function console3(g: CanvasRenderingContext2D, c: Console, seed: number) {
  const top = Math.min(c.h * 0.45, 12);
  // The top: a parallelogram, a lighter grey, ruled.
  g.fillStyle = "#3a3a37";
  g.beginPath();
  g.moveTo(c.x + top, c.y - top);
  g.lineTo(c.x + c.w, c.y - top);
  g.lineTo(c.x + c.w - top, c.y);
  g.lineTo(c.x, c.y);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(10,10,10,0.7)";
  g.lineWidth = 1;
  for (let k = 1; k < 8; k++) {
    const x = c.x + (c.w * k) / 8;
    g.beginPath();
    g.moveTo(x + top * 0.7, c.y - top * 0.7);
    g.lineTo(x + top * 0.3, c.y - top * 0.3);
    g.stroke();
  }
  // The face and its keys.
  g.fillStyle = "#171716";
  g.fillRect(c.x, c.y, c.w - top, c.h);
  g.strokeStyle = "rgba(154,154,148,0.5)";
  g.strokeRect(c.x + 0.5, c.y + 0.5, c.w - top - 1, c.h - 1);
  const keys = 12, kw = (c.w - top - 10) / keys;
  for (let k = 0; k < keys; k++) {
    const n = hash2(k + seed * 17, seed + 5);
    g.fillStyle = n > 0.78 ? "#f4f4ee" : n > 0.4 ? "#ff3a2f" : "#4a4a46";
    g.fillRect(c.x + 5 + k * kw + 1, c.y + c.h * 0.3, Math.max(2, kw - 2.5), c.h * 0.4);
  }
  // A small lit screen on the top's back edge: a dark pane ruled in red.
  const sw = c.w * 0.3, sh = Math.min(c.h * 1.1, 26);
  const sx = c.x + c.w * 0.4, sy = c.y - top - sh - 2;
  g.fillStyle = "#050505";
  g.fillRect(sx, sy, sw, sh);
  g.strokeStyle = "rgba(255,58,47,0.45)";
  for (let k = 3; k < sh; k += 3) {
    g.beginPath();
    g.moveTo(sx, sy + k + 0.5);
    g.lineTo(sx + sw, sy + k + 0.5);
    g.stroke();
  }
  g.strokeStyle = MACHINE.red;
  g.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
}

/** The floor: a grid in perspective running away to the horizon at the wall's foot, brighter near the front. */
function floorGrid(g: CanvasRenderingContext2D, w: number, h: number, cx: number, floor: number, R: number) {
  const deep = h - floor;
  if (deep < 4) return;
  const deck = g.createLinearGradient(0, floor, 0, h);
  deck.addColorStop(0, "#161615");
  deck.addColorStop(1, "#060606");
  g.fillStyle = deck;
  g.fillRect(0, floor, w, deep);
  g.save();
  g.beginPath();
  g.rect(0, floor, w, deep);
  g.clip();
  // Lines running across, closer together toward the horizon; lines running away, fanning from a point behind the wall.
  g.lineWidth = 1;
  for (let k = 1; k <= 14; k++) {
    const y = floor + deep * Math.pow(k / 14, 1.7);
    g.strokeStyle = `rgba(215,25,32,${(0.12 + 0.4 * (k / 14)).toFixed(3)})`;
    g.beginPath();
    g.moveTo(0, Math.round(y) + 0.5);
    g.lineTo(w, Math.round(y) + 0.5);
    g.stroke();
  }
  const vy = floor - R * 1.1;
  for (let k = -14; k <= 14; k++) {
    const x = cx + k * R * 0.34;
    g.strokeStyle = `rgba(215,25,32,${(0.5 - Math.abs(k) * 0.02).toFixed(3)})`;
    g.beginPath();
    g.moveTo(cx + (x - cx) * 0.18, vy + (floor - vy) * 0.18);
    g.lineTo(cx + (x - cx) * (1 + (h - floor) / (floor - vy)) , h);
    g.stroke();
  }
  g.restore();
}

/** The stage behind the sphere: wall, diagonal, neon frame, spotlight cones and their pools, floor and consoles. */
function stageLayer(f: SurfaceFrame, cx: number, cy: number, R: number): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const [c, g] = offscreen(w, h, dpr);
  g.fillStyle = MACHINE.black;
  g.fillRect(0, 0, w, h);
  const floor = cy + R * STAGE_AT;
  wall(g, w, Math.min(floor, h), cx, cy, R);
  diagonal(g, bandOf(cx, cy, R), w, h);
  // A neon frame round the stage's middle, the width of the sphere and a half, with a short tube running out of it
  // along the diagonal.
  g.beginPath();
  g.rect(cx - R * 1.5, cy - R * 1.22, R * 3, R * 2.44);
  tube(g, null, 1.8);
  // The cones: light falling from above the frame, brightest near the lamp, fading toward the stage.
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const k of CONES) {
    const xt = cx + k.top * R, xf = cx + k.foot * R;
    const top = -R * 0.2;
    const beam = g.createLinearGradient(xt, top, xf, floor);
    beam.addColorStop(0, "rgba(235,235,226,0.2)");
    beam.addColorStop(0.55, "rgba(235,235,226,0.07)");
    beam.addColorStop(1, "rgba(235,235,226,0.03)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(xt - k.w0 * R, top);
    g.lineTo(xt + k.w0 * R, top);
    g.lineTo(xf + k.w1 * R, floor);
    g.lineTo(xf - k.w1 * R, floor);
    g.closePath();
    g.fill();
  }
  g.restore();
  floorGrid(g, w, h, cx, floor, R);
  // Where the cones land, a soft pool on the floor.
  if (floor < h) {
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const k of CONES) {
      g.save();
      g.translate(cx + k.foot * R, floor + (h - floor) * 0.18);
      g.scale(1, 0.18);
      const pool = g.createRadialGradient(0, 0, 0, 0, 0, k.w1 * R * 1.1);
      pool.addColorStop(0, "rgba(235,235,226,0.2)");
      pool.addColorStop(1, "rgba(235,235,226,0)");
      g.fillStyle = pool;
      g.fillRect(-k.w1 * R * 1.2, -k.w1 * R * 1.2, k.w1 * R * 2.4, k.w1 * R * 2.4);
      g.restore();
    }
    g.restore();
    // The stage's front edge: a thin warm grey rule, and a red tube under it, the width of the frame.
    g.fillStyle = "rgba(154,154,148,0.6)";
    g.fillRect(0, Math.round(floor), w, 1);
    g.beginPath();
    g.moveTo(0, Math.round(floor) + 4);
    g.lineTo(w, Math.round(floor) + 4);
    tube(g, null, 1.6);
  }
  consoleBoxes(w, h, cx, cy, R).forEach((b, i) => console3(g, b, i + 1));
  return c;
}

function drawSphere(f: SurfaceFrame, cache: MachineCache) {
  const { ctx, w, h, proj, theme: t } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  // The stage is laid out for the globe at rest, so a zoom in or out never redraws it: the sphere just grows over it.
  const R0 = R / f.zoom;
  const key = `${w}|${h}|${f.dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R0)}`;
  if (cache.stage?.key !== key) cache.stage = { key, canvas: stageLayer(f, cx, cy, R0) };
  ctx.drawImage(cache.stage.canvas, 0, 0, w, h);

  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, TAU);
  // A faint red glow round the sphere, then its dark glass, opaque so the stage never shows through it.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
  halo.addColorStop(0, "rgba(215,25,32,0.34)");
  halo.addColorStop(1, "rgba(215,25,32,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.12, 0, TAU);
  ctx.fill();
  const body = ctx.createRadialGradient(cx, cy - R * 0.45, R * 0.1, cx, cy, R);
  body.addColorStop(0, "#161615");
  body.addColorStop(1, t.ocean);
  ctx.fillStyle = body;
  ctx.fill(sphere);

  ctx.save();
  ctx.clip(sphere);
  // The far side's wire shows through faintly; the near side is drawn over it at full strength.
  const back = geoOrthographic().rotate(proj.rotate()).scale(R).translate([cx, cy]).clipAngle(179.5).precision(0.8);
  ctx.beginPath();
  geoPath(back, ctx)(WIRE as never);
  ctx.strokeStyle = "rgba(215,25,32,0.2)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  const path = geoPath(f.view as never, ctx);
  ctx.beginPath();
  path(WIRE as never);
  ctx.strokeStyle = "rgba(255,58,47,0.62)";
  ctx.lineWidth = 1;
  ctx.stroke();
  paintLand(f, true);
  // The spotlights from above: a little light on the sphere's top, falling off toward its foot and its limb.
  const top = ctx.createRadialGradient(cx, cy - R * 0.9, R * 0.1, cx, cy - R * 0.5, R * 1.3);
  top.addColorStop(0, "rgba(255,255,248,0.1)");
  top.addColorStop(1, "rgba(255,255,248,0)");
  ctx.fillStyle = top;
  ctx.fill(sphere);
  const limb = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
  limb.addColorStop(0, "rgba(5,5,5,0)");
  limb.addColorStop(1, "rgba(5,5,5,0.5)");
  ctx.fillStyle = limb;
  ctx.fill(sphere);
  ctx.restore();

  // The rim: a red tube, with a thin grey line just inside it.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  tube(ctx, null, 1.8, MACHINE.red);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, R - 4), 0, TAU);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(154,154,148,0.5)";
  ctx.stroke();
}

export function drawMachine(f: SurfaceFrame, cache: MachineCache) {
  if (f.mode === "3d") drawSphere(f, cache);
  else drawScreen(f);
}
