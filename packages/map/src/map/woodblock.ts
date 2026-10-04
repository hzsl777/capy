// Woodblock (id woodblock): after the feel of Japanese colour woodblock prints of the 1800s, a style
// centuries old and in the public domain. Nothing is copied from any print: the waves, the clouds and the seal are
// our own drawings in that manner, and there are no figures, no people and no lettering.
//
// Flat areas of colour, each printed from its own block, with bokashi (a soft gradient within one colour area) and
// a black keyblock line. Map view: the sea in flat Prussian blue tones, stepped paler toward every coast and
// darkening toward the sheet's top and bottom edges; land in soft green with ochre deserts and an ochre shore; a
// black keyblock coast; stylised curling wave crests with claw-like foam tips at fixed, tested open-sea spots, sized
// to the open water around them so they never reach land or a place. Globe view: the same on a ball with a soft
// bokashi rim, over flat bands of cloud laid in the room beside it, drawn first so the ball always covers them and
// kept clear of it (test/woodblock.test.ts). A faint woodgrain lies over the whole sheet. Nothing moves.

import { geoDistance, geoPath, type GeoProjection } from "d3-geo";
import { pathContext, seeded, type SurfaceFrame } from "./surface.ts";

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The palette: washi paper, sumi black, Prussian blues, muted vermilion, soft green and ochre. */
export const WB = {
  washi: "#f1e6cf",
  sumi: "#1d1b18",
  /** The sea's tones, deepest first: each a flat colour from its own block. */
  deep: "#173a5e",
  sea: "#1f4f7d",
  mid: "#3c6f9c",
  pale: "#7fa3c0",
  mist: "#b9cdd8",
  vermilion: "#c4472d",
  green: "#97a873",
  greenDeep: "#6d8656",
  ochre: "#d4a659",
  ochrePale: "#e3c287",
  ice: "#efece2",
};

// ---- the wave crests at sea --------------------------------------------------------------------------------------

/** A fixed spot in open sea with the radius, in degrees, of open water all round it (tested). */
export interface WaveSpot {
  kind: "crest" | "rollers";
  lon: number;
  lat: number;
  r: number;
  flip?: boolean;
}

/**
 * Wave crests at spots whose whole circle of radius `r` is open sea, at least 3 degrees from every place
 * (test/woodblock.test.ts). Each is drawn no wider than its open water, so it never reaches land at any zoom.
 */
export const WAVES: readonly WaveSpot[] = [
  { kind: "crest", lon: -152, lat: -52, r: 20 },
  { kind: "rollers", lon: -16, lat: -52, r: 20, flip: true },
  { kind: "crest", lon: 64, lat: -44, r: 20, flip: true },
  { kind: "crest", lon: -104, lat: -28, r: 20, flip: true },
  { kind: "rollers", lon: -140, lat: 4, r: 20 },
  { kind: "crest", lon: 168, lat: 32, r: 20 },
  { kind: "rollers", lon: 120, lat: -52, r: 14 },
  { kind: "crest", lon: 84, lat: -12, r: 14 },
  { kind: "crest", lon: -44, lat: 24, r: 14, flip: true },
  { kind: "rollers", lon: -148, lat: 40, r: 14, flip: true },
];

/**
 * How far a drawing reaches from its spot, in its own units: every point of a crest lies within this of (0, 0), so
 * a wave drawn at `u` pixels a unit stays inside a circle of `WAVE_REACH * u` pixels.
 */
export const WAVE_REACH = 1.2;
/** The share of the open water's radius a wave may use; with WAVE_REACH, its farthest point stays well inside. */
export const WAVE_FILL = 0.7;

/** The largest a wave grows on screen, in pixels a unit, so a close view shows a crest, not a wall of foam. */
const WAVE_MAX_U = 110;

/** Pixels a unit for a wave whose open water spans `pxR` pixels: inside it at every zoom. */
export function waveUnit(r: number, pxDeg: number): number {
  return Math.min(WAVE_MAX_U, (WAVE_FILL * r * pxDeg) / WAVE_REACH);
}

type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

const bez = (c: Cubic, t: number): Pt => {
  const m = 1 - t;
  const a = m * m * m, b = 3 * m * m * t, d = 3 * m * t * t, e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
};
const f3 = (v: number) => Math.round(v * 1000) / 1000;
const P = (p: Pt) => `${f3(p[0])} ${f3(p[1])}`;
const poly = (pts: Pt[]) => pts.map((p, i) => (i ? "L" : "M") + P(p)).join("") + "Z";

/** Points along a run of cubics, each with the unit normal on its outer side (left of the way the run goes). */
function sample(run: Cubic[], per = 20): { p: Pt; n: Pt }[] {
  const pts: Pt[] = [];
  run.forEach((c, i) => {
    for (let k = i ? 1 : 0; k <= per; k++) pts.push(bez(c, k / per));
  });
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // y runs down the screen, so the left of (dx, dy) is (dy, -dx).
    return { p, n: [dy / l, -dx / l] as Pt };
  });
}

/** One breaking wave in local units, about two wide, its foot on y = 0.42: the water, the hollow, the foam, the lines. */
export interface CrestParts {
  body: string;
  curl: string;
  foam: string;
  lines: string;
}

/**
 * A crest at an offset and scale in local units. The water rises from its foot at the left into a high crest that
 * runs forward over its own face and curls down into a hook, leaving a hollow under it. Along the crest lies a band
 * of foam whose front edge breaks into claws: small hooked tongues that reach forward and curl back like fingers,
 * which is what makes the foam read as the prints' and not as a fringe of spikes. Flat lines of a paler blue follow
 * the swell up the wave's back. Built as path text so a test can bound it.
 */
export function crest(ox = 0, oy = 0, s = 1): CrestParts {
  const T = (p: Pt): Pt => [ox + p[0] * s, oy + p[1] * s];
  const C = (a: Pt, b: Pt, c: Pt, d: Pt): Cubic => [T(a), T(b), T(c), T(d)];
  // The outline, going round: up the back, over the crest, down the lip to its tip, back up under it into the
  // hollow, down the hollow's wall and the face to the foot at the right.
  const back = C([-1, 0.42], [-0.55, 0.4], [-0.32, 0.06], [-0.08, -0.36]);
  const top = C([-0.08, -0.36], [0.1, -0.66], [0.5, -0.74], [0.74, -0.52]);
  const lip = C([0.74, -0.52], [0.9, -0.38], [0.92, -0.16], [0.8, -0.04]);
  const under = C([0.8, -0.04], [0.74, -0.2], [0.62, -0.31], [0.5, -0.26]);
  const wall = C([0.5, -0.26], [0.36, -0.2], [0.33, 0.06], [0.46, 0.22]);
  const face = C([0.46, 0.22], [0.56, 0.36], [0.76, 0.42], [0.98, 0.42]);
  const outline = sample([back, top, lip, under, wall, face]).map((q) => q.p);
  const body = poly(outline);
  // The hollow under the lip: a paler tone, as light shows through the curling water.
  const hollow = sample([under, wall], 14).map((q) => q.p);
  const curl = poly([...hollow, bez(C([0.46, 0.22], [0.62, 0.14], [0.76, 0.06], [0.8, -0.04]), 0.5), T([0.8, -0.04])]);
  // The foam: a band along the crest from high on the back to the lip's tip, thin at both ends.
  const crestRun = sample([C([-0.2, -0.16], [-0.14, -0.26], [-0.11, -0.31], [-0.08, -0.36]), top, lip], 16);
  const thick = 0.075 * s;
  const outer: Pt[] = [], inner: Pt[] = [];
  crestRun.forEach((q, i) => {
    const u = i / (crestRun.length - 1);
    const k = thick * Math.min(1, u * 4, (1 - u) * 3 + 0.25);
    outer.push([q.p[0] + q.n[0] * 0.012 * s, q.p[1] + q.n[1] * 0.012 * s]);
    inner.push([q.p[0] - q.n[0] * k, q.p[1] - q.n[1] * k]);
  });
  let foam = poly([...outer, ...inner.reverse()]);
  // Claws along the front of the crest: each rises off the edge, leans forward and hooks back.
  const n = 11;
  for (let i = 0; i < n; i++) {
    const at = Math.round(crestRun.length * (0.28 + (0.68 * i) / n));
    const q = crestRun[Math.min(crestRun.length - 2, at)]!;
    const q2 = crestRun[Math.min(crestRun.length - 1, at + 1)]!;
    const [nx, ny] = q.n;
    // Forward along the edge.
    const fx = -ny, fy = nx;
    const len = s * (0.16 + 0.05 * Math.sin(i * 2.1 + 0.5)) * (i === n - 1 ? 0.8 : 1);
    const lean = 0.85;
    const dx = nx * Math.cos(lean) + fx * Math.sin(lean), dy = ny * Math.cos(lean) + fy * Math.sin(lean);
    const base0 = q.p, base1 = q2.p;
    const tip: Pt = [base0[0] + dx * len, base0[1] + dy * len];
    // The hook turns the tip back toward the edge, ahead of where it rose.
    const hook: Pt = [tip[0] + fx * len * 0.22 - dx * len * 0.36, tip[1] + fy * len * 0.22 - dy * len * 0.36];
    foam +=
      `M${P(base0)}` +
      `Q${P([base0[0] + nx * len * 0.75 - fx * len * 0.2, base0[1] + ny * len * 0.75 - fy * len * 0.2])} ${P(tip)}` +
      `Q${P([tip[0] + fx * len * 0.3, tip[1] + fy * len * 0.3])} ${P(hook)}` +
      `Q${P([hook[0] - fx * len * 0.12 - nx * len * 0.1, hook[1] - fy * len * 0.12 - ny * len * 0.1])} ${P([base1[0] + nx * len * 0.3, base1[1] + ny * len * 0.3])}` +
      `L${P(base1)}Z`;
  }
  // Swell lines up the back, inside the water: the back's curve stepped inward.
  let lines = "";
  const backRun = sample([back, top], 14);
  for (const [k, a, b] of [[0.12, 0.3, 0.66], [0.23, 0.3, 0.56], [0.34, 0.32, 0.46]] as const) {
    const i0 = Math.round(backRun.length * a), i1 = Math.round(backRun.length * b);
    const run = backRun.slice(i0, i1).map((q): Pt => [q.p[0] - q.n[0] * k * s, q.p[1] - q.n[1] * k * s]);
    lines += run.map((p, i) => (i ? "L" : "M") + P(p)).join("");
  }
  return { body, curl, foam, lines };
}

/** The shapes of each kind, as path text in local units: a single crest, or two smaller crests rolling in. */
export function waveParts(kind: WaveSpot["kind"]): CrestParts {
  if (kind === "crest") return crest();
  const a = crest(-0.46, 0.14, 0.54);
  const b = crest(0.4, -0.02, 0.62);
  return { body: a.body + b.body, curl: a.curl + b.curl, foam: a.foam + b.foam, lines: a.lines + b.lines };
}

/** Every point a path's text names, for a test to bound a drawing. */
export function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}

/** The waves as Path2D, made on first use (tests import this file without a canvas). */
let wavePaths: Record<WaveSpot["kind"], { body: Path2D; curl: Path2D; foam: Path2D; lines: Path2D }> | null = null;
const makeWaves = () => {
  const of = (k: WaveSpot["kind"]) => {
    const p = waveParts(k);
    return { body: new Path2D(p.body), curl: new Path2D(p.curl), foam: new Path2D(p.foam), lines: new Path2D(p.lines) };
  };
  return { crest: of("crest"), rollers: of("rollers") };
};

/** Whether a point is on the globe's near side, by the cosine of its angle from the view's centre. */
function facingCos(f: SurfaceFrame, lon: number, lat: number): number {
  const a = lat * RAD, b = f.lat * RAD;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * RAD);
}

/** The wave crests in view, in flat blocks of colour with a black keyline; on the globe, shrunk toward the rim. */
function drawWaves(f: SurfaceFrame) {
  const { ctx, proj } = f;
  const pxDeg = proj.scale() * RAD;
  const paths = (wavePaths ??= makeWaves());
  for (const s of WAVES) {
    let k = 1;
    if (f.mode === "3d") {
      // Foreshortened toward the rim, and left out near it, so no wave is squeezed against the limb.
      const c = facingCos(f, s.lon, s.lat);
      if (c < 0.4) continue;
      k = c;
    }
    const p = proj([s.lon, s.lat]);
    if (!p) continue;
    const u = waveUnit(s.r, pxDeg) * k;
    const reach = u * WAVE_REACH;
    if (u < 9 || p[0] < -reach || p[0] > f.w + reach || p[1] < -reach || p[1] > f.h + reach) continue;
    const w = paths[s.kind];
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.scale(s.flip ? -u : u, u);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.fillStyle = WB.deep;
    ctx.fill(w.body);
    ctx.fillStyle = WB.mid;
    ctx.fill(w.curl);
    ctx.save();
    ctx.clip(w.body);
    ctx.strokeStyle = WB.pale;
    ctx.lineWidth = 1.6 / u;
    ctx.stroke(w.lines);
    ctx.restore();
    ctx.strokeStyle = WB.sumi;
    ctx.lineWidth = 1.2 / u;
    ctx.stroke(w.body);
    ctx.fillStyle = "#f6efdf";
    ctx.fill(w.foam);
    ctx.lineWidth = 0.9 / u;
    ctx.stroke(w.foam);
    ctx.restore();
  }
}

// ---- the clouds behind the globe ---------------------------------------------------------------------------------

/** A flat band of cloud in the room beside the globe: its left end, top, length and height, in CSS pixels. */
export interface CloudBand {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The corner the Key button takes at the frame's upper left, and the zoom buttons' at its lower right. */
export const KEY_BOX = { w: 120, h: 70 };
export const ZOOM_BOX = { w: 76, h: 120 };

/**
 * Rows the bands may take, as shares of the frame's height, each reaching in from one side toward the globe. A
 * band takes the room its row has beside the ball and is left out where there is too little.
 */
const ROWS: readonly { fy: number; side: -1 | 1; len: number }[] = [
  { fy: 0.2, side: -1, len: 0.8 },
  { fy: 0.3, side: 1, len: 0.95 },
  { fy: 0.62, side: -1, len: 0.95 },
  { fy: 0.76, side: 1, len: 0.75 },
  { fy: 0.86, side: -1, len: 0.6 },
];

/**
 * The bands of cloud for a frame with the globe at (cx, cy) of radius R: never within `gap` of the ball, the Key's
 * corner or the zoom buttons' corner, so nothing lies over the globe or a place even before the ball is drawn over
 * them. The same frame always gets the same bands.
 */
export function cloudBands(w: number, h: number, cx: number, cy: number, R: number): CloudBand[] {
  const out: CloudBand[] = [];
  const gap = Math.max(14, R * 0.08);
  const bh = clamp(R * 0.17, 20, 46);
  const Rg = R + gap;
  for (const row of ROWS) {
    const y = h * row.fy - bh / 2;
    // The nearest the band's rows come to the ball's centre, and so how wide the ball is there.
    const dy = Math.max(0, Math.max(cy - (y + bh), y - cy));
    const half = dy >= Rg ? -Infinity : Math.sqrt(Rg * Rg - dy * dy);
    let x0: number, x1: number;
    if (row.side < 0) {
      x0 = -bh;
      x1 = half === -Infinity ? w * 0.42 : cx - half;
    } else {
      x0 = half === -Infinity ? w * 0.58 : cx + half;
      x1 = w + bh;
    }
    const room = x1 - x0;
    const len = room * row.len;
    if (len < 70) continue;
    const band = row.side < 0 ? { x: x1 - len, y, w: len, h: bh } : { x: x0, y, w: len, h: bh };
    // Out of the buttons' corners: shorten the band toward the ball, or leave it out.
    if (band.y < KEY_BOX.h && band.x < KEY_BOX.w) {
      const cut = KEY_BOX.w - band.x;
      band.x += cut;
      band.w -= cut;
    }
    if (band.y + band.h > h - ZOOM_BOX.h && band.x + band.w > w - ZOOM_BOX.w) band.w = w - ZOOM_BOX.w - band.x;
    if (band.w < 70 || band.y < 4 || band.y + band.h > h - 4) continue;
    out.push(band);
  }
  return out;
}

/** A rounded strip: flat top and foot, round ends. */
function strip(p: Path2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  p.lineTo(x + r, y + h);
  p.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  p.closePath();
}

/**
 * A band of mist in the prints' manner, our own drawing: a long flat strip with round ends and a shorter tier laid
 * on its top, both inside the band's box.
 */
function cloudPath(b: CloudBand, k: number): Path2D {
  const p = new Path2D();
  const low = b.h * 0.6;
  strip(p, b.x, b.y + b.h - low, b.w, low);
  // The tier sits toward one end or the other, by turns, so the bands don't line up like bricks.
  const tw = b.w * (k % 2 ? 0.5 : 0.4);
  const tx = k % 2 ? b.x + b.w * 0.12 : b.x + b.w * 0.86 - tw;
  strip(p, tx, b.y, tw, b.h * 0.64);
  return p;
}

function drawClouds(f: SurfaceFrame, cx: number, cy: number, R: number) {
  const { ctx } = f;
  cloudBands(f.w, f.h, cx, cy, R).forEach((b, k) => {
    const p = cloudPath(b, k);
    // The keyline first and the fill over its inner half, so the two tiers read as one shape in one outline.
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = WB.sumi;
    ctx.stroke(p);
    // Flat paper white with a bokashi of pale vermilion along the foot.
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, "#fbf6ea");
    g.addColorStop(0.55, "#f5eddb");
    g.addColorStop(1, "#efcfb8");
    ctx.fillStyle = g;
    ctx.fill(p);
  });
}

// ---- the woodgrain over the whole sheet --------------------------------------------------------------------------

const grains = new WeakMap<CanvasRenderingContext2D, { dpr: number; p: CanvasPattern }>();

/**
 * Faint woodgrain: long wavy lines across a tile that repeats seamlessly, bending round a knot or two, and a few
 * pale flecks where the block printed light. Fixed to the screen like the paper's own grain.
 */
function grain(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern {
  const had = grains.get(ctx);
  if (had && had.dpr === dpr) return had.p;
  const W = 480, H = 240;
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const rnd = seeded(4127);
  const knots = [
    { x: 150, y: 70, a: 22 },
    { x: 360, y: 170, a: 16 },
  ];
  g.lineCap = "round";
  for (let i = 0; i < 46; i++) {
    const y0 = (i / 46) * H + rnd() * 3;
    const amp = 1 + rnd() * 2.2;
    const ph = rnd() * TAU;
    const cyc = 1 + Math.floor(rnd() * 3);
    g.beginPath();
    for (const off of [-H, 0, H]) {
      for (let x = 0; x <= W; x += 6) {
        let y = y0 + off + amp * Math.sin((x / W) * TAU * cyc + ph);
        for (const k of knots) {
          // Lines swell round a knot as the grain does round a branch.
          const dx = x - k.x, dy = y - k.y;
          const d2 = dx * dx + dy * dy;
          y += (dy >= 0 ? 1 : -1) * k.a * Math.exp(-d2 / (2 * k.a * k.a * 2.2));
        }
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.strokeStyle = `rgba(70,48,24,${(0.04 + rnd() * 0.06).toFixed(3)})`;
    g.lineWidth = 0.6 + rnd() * 0.9;
    g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,250,236,${(0.12 + rnd() * 0.2).toFixed(3)})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 9, 0.6 + rnd() * 0.8);
  }
  const p = ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / dpr));
  grains.set(ctx, { dpr, p });
  return p;
}

function drawGrain(f: SurfaceFrame, clip?: Path2D) {
  const { ctx } = f;
  ctx.save();
  if (clip) ctx.clip(clip);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = grain(ctx, f.dpr);
  ctx.fillRect(0, 0, f.w, f.h);
  ctx.restore();
}

// ---- land and sea ------------------------------------------------------------------------------------------------

/** The land's blocks: green, ochre deserts and shore, pale ice, small peaks, lakes, rivers and the keyblock coast. */
function paintWorld(f: SurfaceFrame, globe: boolean) {
  const { ctx, w, h } = f;
  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  const land = path(f.map.land);
  const coast = path(f.map.coast);
  const lakes = path(f.map.lakes);
  // The coast from the light basemap for the wide flat bands of shallow water, where detail adds nothing.
  const wide = f.map === f.low ? coast : path(f.low.coast);
  // Bands widen as the map comes closer and narrow on a small screen, as the markers do.
  const zk = clamp(Math.sqrt(f.zoom), 1, 2.4) * clamp(Math.min(w, h) / 720, 0.6, 1);

  // Shallows: flat tones stepped paler toward the shore, each a band printed from its own block.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = WB.mid;
  ctx.lineWidth = 15 * zk;
  ctx.stroke(wide);
  ctx.strokeStyle = WB.pale;
  ctx.lineWidth = 7.5 * zk;
  ctx.stroke(wide);
  ctx.strokeStyle = WB.mist;
  ctx.lineWidth = 3 * zk;
  ctx.stroke(wide);
  ctx.restore();

  drawWaves(f);

  // The land: soft green.
  ctx.fillStyle = WB.green;
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  // Deserts in flat ochre, from the relief layer's dunes; the shore in a band of ochre inside the coast.
  if (f.relief?.dunes.length) {
    const pxDeg = f.proj.scale() * RAD;
    const rr = clamp(1.25 * pxDeg, 2, 70);
    const sand = new Path2D();
    const c: [number, number] = [f.lon, f.lat];
    for (const [lon, lat] of f.relief.dunes) {
      if (globe && geoDistance(c, [lon, lat]) > Math.PI / 2 - 0.02) continue;
      const p = f.proj([lon, lat]);
      if (!p || p[0] < -rr || p[1] < -rr || p[0] > w + rr || p[1] > h + rr) continue;
      sand.moveTo(p[0] + rr, p[1]);
      sand.arc(p[0], p[1], rr, 0, TAU);
    }
    ctx.fillStyle = WB.ochre;
    ctx.fill(sand);
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = WB.ochrePale;
  ctx.lineWidth = 5 * zk;
  ctx.stroke(wide);
  if (f.map.ice) {
    ctx.fillStyle = WB.ice;
    ctx.fill(path(f.map.ice));
  }
  // Peaks: small flat hills in deeper green with a pale top, the prints' mountains in miniature. Never round, so
  // none reads as a place.
  if (f.relief) {
    const s = clamp(2.2 * Math.sqrt(f.zoom), 2.2, 6) * clamp(Math.min(w, h) / 720, 0.7, 1);
    const c: [number, number] = [f.lon, f.lat];
    const hills = new Path2D();
    const tops = new Path2D();
    for (const [lon, lat] of f.relief.peaks) {
      if (globe && geoDistance(c, [lon, lat]) > Math.PI / 2 - 0.05) continue;
      // No green hills on the ice sheets.
      if (f.isIce(lon, lat)) continue;
      const p = f.proj([lon, lat]);
      if (!p || p[0] < -10 || p[1] < -10 || p[0] > w + 10 || p[1] > h + 10) continue;
      const [x, y] = p;
      hills.moveTo(x - s * 1.25, y + s * 0.6);
      hills.quadraticCurveTo(x - s * 0.35, y - s * 0.1, x, y - s * 0.75);
      hills.quadraticCurveTo(x + s * 0.35, y - s * 0.1, x + s * 1.25, y + s * 0.6);
      hills.closePath();
      tops.moveTo(x - s * 0.32, y - s * 0.32);
      tops.lineTo(x, y - s * 0.75);
      tops.lineTo(x + s * 0.32, y - s * 0.32);
      tops.closePath();
    }
    ctx.fillStyle = WB.greenDeep;
    ctx.fill(hills);
    ctx.fillStyle = "rgba(241,230,207,0.75)";
    ctx.fill(tops);
  }
  ctx.restore();

  // Lakes in the sea's middle tone, rivers in pale blue once zoomed in.
  ctx.fillStyle = WB.mid;
  ctx.fill(lakes);
  if (f.zoom >= 2) {
    ctx.strokeStyle = WB.mid;
    ctx.lineWidth = 0.9;
    ctx.stroke(path(f.map.rivers));
  }
  // The keyblock: a black coast line, a little heavier as the map comes closer.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = WB.sumi;
  ctx.lineWidth = 1.15 * clamp(Math.sqrt(f.zoom), 1, 1.8);
  ctx.stroke(coast);
  ctx.lineWidth = 0.8;
  ctx.stroke(lakes);
  ctx.restore();
}

// ---- Map view: the print ------------------------------------------------------------------------------------------

function drawSheet(f: SurfaceFrame) {
  const { ctx } = f;
  const path = geoPath(f.view as never);
  const sheet = new Path2D();
  geoPath(f.view as never, pathContext(sheet))({ type: "Sphere" } as never);
  const [[x0, y0], [x1, y1]] = path.bounds({ type: "Sphere" } as never);
  // The sea: flat Prussian blue, with bokashi darkening it toward the sheet's top and bottom edges.
  const sea = ctx.createLinearGradient(0, y0, 0, y1);
  sea.addColorStop(0, WB.deep);
  sea.addColorStop(0.16, WB.sea);
  sea.addColorStop(0.84, WB.sea);
  sea.addColorStop(1, WB.deep);
  ctx.fillStyle = sea;
  ctx.fill(sheet);
  ctx.save();
  ctx.clip(sheet);
  paintWorld(f, false);
  drawGrain(f);
  ctx.restore();
  // The print's border: a black rule round the sheet with a thin one outside it.
  ctx.save();
  ctx.strokeStyle = WB.sumi;
  ctx.lineWidth = 1.6;
  ctx.stroke(sheet);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10);
  ctx.restore();
}

// ---- Globe view: the ball among the clouds -----------------------------------------------------------------------

function drawBall(f: SurfaceFrame) {
  const { ctx, proj } = f;
  const [cx, cy] = (proj as GeoProjection).translate();
  const R = proj.scale();
  // Behind the ball: a soft bokashi of pale indigo round it, and the bands of cloud in the room beside it.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.22);
  halo.addColorStop(0, "rgba(127,163,192,0.55)");
  halo.addColorStop(1, "rgba(127,163,192,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.22, 0, TAU);
  ctx.fill();
  drawClouds(f, cx, cy, R);

  const ball = new Path2D();
  ball.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = WB.sea;
  ctx.fill(ball);
  ctx.save();
  ctx.clip(ball);
  paintWorld(f, true);
  // The rim: bokashi deepening the whole ball toward its limb, sea and land alike, as a printer wipes the block.
  const rim = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  rim.addColorStop(0, "rgba(23,58,94,0)");
  rim.addColorStop(0.75, "rgba(23,58,94,0.12)");
  rim.addColorStop(1, "rgba(16,40,66,0.62)");
  ctx.fillStyle = rim;
  ctx.fill(ball);
  ctx.restore();
  drawGrain(f);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = WB.sumi;
  ctx.stroke(ball);
}

export function drawWoodblock(f: SurfaceFrame) {
  if (f.mode === "3d") drawBall(f);
  else drawSheet(f);
}
