// Machine Music (id machine, experimental): after the feel of 1970s and 80s German electronic music stage shows and
// record sleeves, and the constructivist posters they borrowed from. Nothing is copied from any of them: no names,
// figures, sleeve or poster art, lettering or logos. Black stage, signal red, warm grey and white only.
//
// Map view: the world on a black screen ruled by a fine red grid fixed to longitude and latitude, grey land with
// faint relief in lighter greys, and a thin red coast that glows a little. Globe view: a red wireframe sphere of
// meridians and parallels, its far side showing through faintly, with the same grey land, standing on a dark stage
// under two spotlight cones that fall from above behind it. The cones and the stage are drawn first, so the sphere
// covers them and nothing ever lies over a place; the view draws markers last.
//
// Nothing on the canvas moves on its own. The machinery that does (the sequencer, the scope, the meters) is chrome
// under the map (src/ui/extras.ts), and its timing lives here so the test can check it never flashes.

import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import { offscreen, pathContext, type SurfaceFrame } from "./surface.ts";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The palette: signal red, a brighter red for light, warm greys and white. Nothing else. */
export const MACHINE = {
  red: "#d71920",
  glow: "#ff3a2f",
  grey: "#9a9a94",
  land: "#4b4b47",
  landLit: "#5d5d58",
  ice: "#8a8a84",
  black: "#050505",
};

// ---- the sequencer's timing (chrome in src/ui/extras.ts) ----------------------------------------------------------

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
 * The meters' needles and the scope's trace, as CSS animations (style.css): seconds per swing and per pass. All are
 * slow, thin and small, and none changes the light of a large area.
 */
export const METER_SWING_S: readonly number[] = [3.2, 4.1];
export const SCOPE_PASS_S = 5;

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

/**
 * Grey land lit a little from above, faint relief as soft lighter patches (never an outline or a dot), ice in a
 * paler grey, black lakes, and the red coast with a soft glow. Shared by the screen and the sphere.
 */
function paintLand(f: SurfaceFrame, globe: boolean, y0: number, y1: number) {
  const { ctx, theme: t, proj, w, h } = f;
  const { path, land, coast, lakes } = worldPaths(f);
  const lit = ctx.createLinearGradient(0, y0, 0, y1);
  lit.addColorStop(0, MACHINE.landLit);
  lit.addColorStop(1, MACHINE.land);
  ctx.fillStyle = lit;
  ctx.fill(land);
  if (f.map.ice) {
    ctx.fillStyle = t.ice;
    ctx.fill(path(f.map.ice));
  }
  if (f.relief) {
    // Mountains as small open chevrons in a lighter grey, like marks engraved on a panel: never a dot.
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
    ctx.save();
    ctx.clip(land);
    ctx.lineWidth = 0.9;
    ctx.lineJoin = "miter";
    ctx.strokeStyle = t.relief;
    ctx.stroke(relief);
    ctx.restore();
  }
  ctx.fillStyle = t.lake;
  ctx.fill(lakes);
  if (f.zoom >= 2) {
    ctx.strokeStyle = t.river;
    ctx.lineWidth = 0.8;
    ctx.stroke(path(f.map.rivers));
  }
  // The coast: a soft red glow into the sea and onto the land, then the line itself.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(215,25,32,0.16)";
  ctx.lineWidth = 6;
  ctx.stroke(coast);
  ctx.strokeStyle = "rgba(255,58,47,0.22)";
  ctx.lineWidth = 2.6;
  ctx.stroke(coast);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
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
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(154,154,148,0.45)";
  ctx.stroke();
  // The fine grid, then the stronger one every thirty degrees, both under the land.
  ctx.beginPath();
  path(gridOf(gridStep(f.zoom)) as never);
  ctx.strokeStyle = t.graticule;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.beginPath();
  path(MAJOR as never);
  ctx.strokeStyle = "rgba(215,25,32,0.5)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  const [[, y0], [, y1]] = path.bounds({ type: "Sphere" });
  paintLand(f, false, y0, y1);
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

/** The stage's front edge below the globe, in radii from its centre. */
export const STAGE_AT = 1.16;

export class MachineCache {
  /** The stage, its light and the spotlight cones behind the sphere: one per frame size and globe size. */
  stage?: { key: string; canvas: HTMLCanvasElement };
}

/** The stage behind the sphere: the dark floor and its front edge, the cones of light and the pools they make. */
function stageLayer(f: SurfaceFrame, cx: number, cy: number, R: number): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const [c, g] = offscreen(w, h, dpr);
  g.fillStyle = MACHINE.black;
  g.fillRect(0, 0, w, h);
  const floor = cy + R * STAGE_AT;
  // The floor: a little lighter than the back wall, falling into dark toward the front.
  if (floor < h) {
    const deck = g.createLinearGradient(0, floor, 0, h);
    deck.addColorStop(0, "#151514");
    deck.addColorStop(1, "#070707");
    g.fillStyle = deck;
    g.fillRect(0, floor, w, h - floor);
  }
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
    // Where it lands, a soft pool on the stage.
    if (floor < h + R * 0.2) {
      g.save();
      g.translate(xf, floor);
      g.scale(1, 0.16);
      const pool = g.createRadialGradient(0, 0, 0, 0, 0, k.w1 * R * 1.1);
      pool.addColorStop(0, "rgba(235,235,226,0.16)");
      pool.addColorStop(1, "rgba(235,235,226,0)");
      g.fillStyle = pool;
      g.fillRect(-k.w1 * R * 1.2, -k.w1 * R * 1.2, k.w1 * R * 2.4, k.w1 * R * 2.4);
      g.restore();
    }
  }
  g.restore();
  // The stage's front edge: a thin warm grey rule, and a red line under it, the width of the frame.
  if (floor < h) {
    g.fillStyle = "rgba(154,154,148,0.55)";
    g.fillRect(0, Math.round(floor), w, 1);
    g.fillStyle = "rgba(215,25,32,0.7)";
    g.fillRect(0, Math.round(floor) + 3, w, 2);
  }
  return c;
}

function drawSphere(f: SurfaceFrame, cache: MachineCache) {
  const { ctx, w, h, proj, theme: t } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  const key = `${w}|${h}|${f.dpr}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}`;
  if (cache.stage?.key !== key) cache.stage = { key, canvas: stageLayer(f, cx, cy, R) };
  ctx.drawImage(cache.stage.canvas, 0, 0, w, h);

  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, TAU);
  // A faint red glow round the sphere, then its dark glass.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
  halo.addColorStop(0, "rgba(215,25,32,0.32)");
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
  paintLand(f, true, cy - R, cy + R);
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

  // The rim: a red line, with a thin grey one just inside it.
  ctx.lineWidth = 2;
  ctx.strokeStyle = MACHINE.red;
  ctx.stroke(sphere);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, R - 3), 0, TAU);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(154,154,148,0.5)";
  ctx.stroke();
}

export function drawMachine(f: SurfaceFrame, cache: MachineCache) {
  if (f.mode === "3d") drawSphere(f, cache);
  else drawScreen(f);
}
