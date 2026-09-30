// Night Drive (decision 70): the world as a 1980s night drive. In Map view the tilted camera looks low across a
// black sea ruled by a glowing grid to a horizon under a striped setting sun; land is a dark plate in a cyan wire
// mesh with a glowing coast and wire mountains from the relief layer. In Globe view a wireframe planet hangs over
// the same sunset, its far side showing through faintly. No text, no borders: grid lines follow longitude and
// latitude only.

import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import { offscreen, pathContext, r1, seeded, type SurfaceCam, type SurfaceFrame } from "./surface.ts";

const DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GRID_STEPS = [30, 15, 10, 5, 2.5, 1.25, 0.625, 0.3125];
const BACK_GRID = geoGraticule().step([15, 15])();
const LAND_GRID = geoGraticule().step([5, 5])();

/** What a frame can reuse: the sky, sun and floor behind the picture, drawn once per frame size. */
export class NeonCache {
  back?: { key: string; canvas: HTMLCanvasElement };
}

/** Flat-map offset below the frame's centre that the camera shows at screen offset `yo`. */
const vAtScreen = (c: SurfaceCam, yo: number) => (yo * c.d) / (c.d * c.cos + yo * c.sin);
/** Flat-map offset below the frame's centre where the camera's scale is `s`. */
const vAtScale = (c: SurfaceCam, s: number) => (c.d * (1 - 1 / s)) / c.sin;
/** Screen y of a flat-map offset `v`. */
const yAt = (c: SurfaceCam, v: number) => c.cy + (v * c.cos * c.d) / (c.d - v * c.sin);

export function drawNeon(f: SurfaceFrame, cache: NeonCache) {
  if (f.cam) drawDrive(f, f.cam, cache);
  else drawPlanet(f, cache);
}

/** A striped setting sun: yellow at the top into hot pink, the lower half cut by bands that widen downward. */
function sun(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const halo = g.createRadialGradient(x, y, r * 0.8, x, y, r * 1.9);
  halo.addColorStop(0, "rgba(255,90,160,0.45)");
  halo.addColorStop(1, "rgba(255,90,160,0)");
  g.fillStyle = halo;
  g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  const [c, sg] = offscreen(r * 2 + 4, r * 2 + 4, 2);
  const body = sg.createLinearGradient(0, 0, 0, r * 2);
  body.addColorStop(0, "#fff36b");
  body.addColorStop(0.45, "#ffa23d");
  body.addColorStop(1, "#ff2f8f");
  sg.beginPath();
  sg.arc(r + 2, r + 2, r, 0, Math.PI * 2);
  sg.fillStyle = body;
  sg.fill();
  sg.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const yy = r + 2 + r * (-0.12 + t * 1.1);
    sg.fillRect(0, yy, r * 2 + 4, 1.2 + t * r * 0.075);
  }
  g.drawImage(c, x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);
}

/** Faint fixed stars in the upper sky. */
function stars(g: CanvasRenderingContext2D, w: number, top: number) {
  const rnd = seeded(29);
  g.fillStyle = "#ffe9ff";
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w, y = rnd() * top, a = 0.25 + rnd() * 0.6;
    g.globalAlpha = a * (1 - y / top);
    g.fillRect(x, y, rnd() < 0.15 ? 2 : 1, 1);
  }
  g.globalAlpha = 1;
}

/** Sky, sun and the glow on the ground under the horizon, for the tilted map. */
function driveBack(f: SurfaceFrame, yH: number): HTMLCanvasElement {
  const { w, h, dpr, theme: t } = f;
  const [c, g] = offscreen(w, h, dpr);
  const [zenith, middle, horizon] = t.sky ?? ["#0d0221", "#4a1068", "#ff7a3d"];
  const sky = g.createLinearGradient(0, 0, 0, yH);
  sky.addColorStop(0, zenith);
  sky.addColorStop(0.55, middle);
  sky.addColorStop(0.85, "#c02a78");
  sky.addColorStop(1, horizon);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, yH);
  stars(g, w, yH * 0.6);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, yH);
  g.clip();
  const r = Math.min(w * 0.16, yH * 0.64);
  sun(g, w / 2, yH - r * 0.42, r);
  g.restore();
  const ground = g.createLinearGradient(0, yH, 0, h);
  ground.addColorStop(0, t.fog ?? "#ff4f9a");
  ground.addColorStop(0.035, "#3a0a3e");
  ground.addColorStop(0.2, t.ocean);
  ground.addColorStop(1, t.ocean);
  g.fillStyle = ground;
  g.fillRect(0, yH, w, h - yH);
  // The horizon itself: one bright line.
  g.fillStyle = "rgba(255,190,220,0.9)";
  g.fillRect(0, yH - 0.5, w, 1.2);
  return c;
}

/**
 * Lines of a grid on the flat plane, anchored to longitude and latitude so it moves with the world: meridians that
 * run to the vanishing point and parallels that crowd toward the horizon, between flat offsets `vFar` and `vNear`.
 */
function gridPath(f: SurfaceFrame, c: SurfaceCam, stepDeg: number, vFar: number, vNear: number, sMin: number, diagonals: boolean): Path2D {
  const pxDeg = f.proj.scale() / DEG;
  const sp = stepDeg * pxDeg;
  const lonFrac = (((f.lon % stepDeg) + stepDeg) % stepDeg) * pxDeg;
  const latFrac = (((f.lat % stepDeg) + stepDeg) % stepDeg) * pxDeg;
  const out: string[] = [];
  const reach = f.w / 2 / sMin + sp;
  const yFar = c.cy + vFar, yNear = c.cy + vNear;
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const a = f.tp(x0, y0, 0), b = f.tp(x1, y1, 0);
    out.push(`M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`);
  };
  for (let x = c.cx - lonFrac - Math.ceil(reach / sp) * sp; x < c.cx + reach; x += sp) seg(x, yFar, x, yNear);
  // Parallels: y = cy + (lat - line) * pxDeg, so the first line at or north of vFar.
  const first = c.cy + latFrac - Math.floor((latFrac - vFar) / sp) * sp;
  for (let y = first; y <= yNear; y += sp) {
    if (y < yFar) continue;
    const s = c.d / (c.d - (y - c.cy) * c.sin);
    const half = (f.w / 2 + 20) / s;
    seg(c.cx - half, y, c.cx + half, y);
  }
  if (diagonals) {
    // One diagonal per square, so the mesh reads as triangles, like a wireframe model.
    for (let x = c.cx - lonFrac - Math.ceil(reach / sp) * sp; x < c.cx + reach; x += sp) {
      const span = yNear - yFar;
      seg(x, yFar, x + span, yNear);
    }
  }
  return new Path2D(out.join(""));
}

function drawDrive(f: SurfaceFrame, c: SurfaceCam, cache: NeonCache) {
  const { ctx, w, h, theme: t, proj } = f;
  const yH = c.cy - (c.d * c.cos) / c.sin;
  const key = `drive:${w}:${h}:${f.dpr}:${Math.round(yH)}`;
  if (cache.back?.key !== key) cache.back = { key, canvas: driveBack(f, yH) };
  ctx.drawImage(cache.back.canvas, 0, 0, w, h);

  const pxDeg = proj.scale() / DEG;
  const vNear = vAtScreen(c, h / 2 + 12);
  const vHorizon = vAtScale(c, 0.07);
  const vLand = vAtScale(c, c.far);
  const yLand = yAt(c, vLand);

  // The ruled sea: a glowing magenta grid fading into the horizon.
  const step = pickStep(pxDeg, 34);
  const sea = gridPath(f, c, step, vHorizon, vNear, 0.14, false);
  const fade = (alpha: number) => {
    const g = ctx.createLinearGradient(0, yH, 0, h);
    g.addColorStop(0, "rgba(255,79,216,0)");
    g.addColorStop(0.03, `rgba(255,79,216,${alpha * 0.45})`);
    g.addColorStop(0.3, `rgba(255,79,216,${alpha})`);
    g.addColorStop(1, `rgba(255,120,230,${alpha})`);
    return g;
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = fade(0.22);
  ctx.stroke(sea);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = fade(0.95);
  ctx.stroke(sea);
  ctx.restore();

  // Land, cut at the draw distance before it is tilted, since the camera's formula folds back past the horizon.
  const ext = proj.clipExtent();
  const reach = w / 2 / c.far + 40;
  proj.clipExtent([
    [c.cx - reach, c.cy + vLand],
    [c.cx + reach, c.cy + vNear + 40],
  ]);
  const land = new Path2D();
  geoPath(f.view as never, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(f.view as never, pathContext(coast))(f.map.coast);
  proj.clipExtent(ext);

  ctx.fillStyle = t.land;
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  const mesh = gridPath(f, c, step / 2, vLand, vNear, c.far, true);
  const meshInk = ctx.createLinearGradient(0, yLand, 0, h);
  meshInk.addColorStop(0, "rgba(111,246,255,0.08)");
  meshInk.addColorStop(0.4, t.textureInk);
  meshInk.addColorStop(1, t.textureInk);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = meshInk;
  ctx.stroke(mesh);
  ctx.restore();

  drawMountains(f, c, vLand, vNear, pxDeg);

  // The coast glows: a wide faint stroke, a narrower one, and a bright core.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = t.coast;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 7;
  ctx.stroke(coast);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3.2;
  ctx.stroke(coast);
  ctx.globalAlpha = 1;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  ctx.restore();

  // The last stretch of land before the draw distance fades into the dark, then the glow at the horizon.
  const yFade = yAt(c, vAtScale(c, c.far * 1.9));
  const haze = ctx.createLinearGradient(0, yLand, 0, yFade);
  haze.addColorStop(0, "rgba(20,3,34,1)");
  haze.addColorStop(1, "rgba(20,3,34,0)");
  ctx.save();
  ctx.clip(land);
  ctx.fillStyle = haze;
  ctx.fillRect(0, yLand - 2, w, yFade - yLand + 2);
  ctx.restore();
  const glow = ctx.createLinearGradient(0, yH, 0, yH + (yLand - yH) * 1.2);
  glow.addColorStop(0, "rgba(255,110,170,0.55)");
  glow.addColorStop(1, "rgba(255,110,170,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, yH, w, (yLand - yH) * 1.2);
}

function pickStep(pxDeg: number, minPx: number): number {
  for (let i = GRID_STEPS.length - 1; i >= 0; i--) if (GRID_STEPS[i]! * pxDeg >= minPx) return GRID_STEPS[i]!;
  return GRID_STEPS[0]!;
}

/** Low wire mountains where the relief layer has peaks: a two-faced pyramid each, drawn in bands far to near. */
function drawMountains(f: SurfaceFrame, c: SurfaceCam, vFar: number, vNear: number, pxDeg: number) {
  const peaks = f.relief?.peaks;
  if (!peaks) return;
  const { ctx, w, proj, theme: t } = f;
  const a = clamp(1.05 * pxDeg, 4, 7);
  const bands = new Map<number, string[]>();
  for (const [lon, lat] of peaks) {
    const p = proj([lon, lat]);
    if (!p) continue;
    const v = p[1] - c.cy;
    if (v < vFar || v > vNear) continue;
    const s = c.d / (c.d - v * c.sin);
    if (Math.abs(p[0] - c.cx) * s > w / 2 + a * 4) continue;
    const L = f.tp(p[0] - a, p[1], 0), R = f.tp(p[0] + a, p[1], 0);
    const F = f.tp(p[0] + a * 0.2, p[1] + a * 0.55, 0), A = f.tp(p[0], p[1], a * 1.7);
    const band = Math.round(v / (a * 2));
    const text =
      `M${r1(L[0])} ${r1(L[1])}L${r1(A[0])} ${r1(A[1])}L${r1(R[0])} ${r1(R[1])}L${r1(F[0])} ${r1(F[1])}Z` +
      `M${r1(A[0])} ${r1(A[1])}L${r1(F[0])} ${r1(F[1])}`;
    const list = bands.get(band);
    if (list) list.push(text);
    else bands.set(band, [text]);
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  // Far ranges are dimmer, so the horizon stays calm.
  const ink = ctx.createLinearGradient(0, yAt(c, vFar), 0, c.cy);
  ink.addColorStop(0, "rgba(159,251,255,0.25)");
  ink.addColorStop(1, t.relief);
  for (const k of [...bands.keys()].sort((x, y) => x - y)) {
    const path = new Path2D(bands.get(k)!.join(""));
    ctx.fillStyle = t.land;
    ctx.fill(path);
    ctx.strokeStyle = ink;
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Sky, sun and a ruled floor behind the globe. */
function planetBack(f: SurfaceFrame, cx: number, cy: number, R: number): HTMLCanvasElement {
  const { w, h, dpr, theme: t } = f;
  const [c, g] = offscreen(w, h, dpr);
  const yH = Math.min(h, cy + R * 0.55);
  const [zenith, middle, horizon] = t.sky ?? ["#0d0221", "#4a1068", "#ff7a3d"];
  const sky = g.createLinearGradient(0, 0, 0, yH);
  sky.addColorStop(0, zenith);
  sky.addColorStop(0.6, middle);
  sky.addColorStop(0.88, "#c02a78");
  sky.addColorStop(1, horizon);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, yH);
  stars(g, w, yH * 0.7);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, yH);
  g.clip();
  sun(g, cx, yH - R * 0.1, R * 1.32);
  g.restore();
  const ground = g.createLinearGradient(0, yH, 0, h);
  ground.addColorStop(0, t.fog ?? "#ff4f9a");
  ground.addColorStop(0.06, "#3a0a3e");
  ground.addColorStop(0.35, t.ocean);
  g.fillStyle = ground;
  g.fillRect(0, yH, w, h - yH);
  // A floor ruled in perspective: lines to the vanishing point and crossings that crowd toward the horizon.
  g.save();
  g.beginPath();
  const vx = w / 2;
  for (let i = -24; i <= 24; i++) {
    g.moveTo(vx + i * 6, yH);
    g.lineTo(vx + i * w * 0.09, h + 40);
  }
  for (let i = 1; i < 14; i++) {
    const y = yH + (h - yH) * Math.pow(i / 13, 2.2);
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  const ink = g.createLinearGradient(0, yH, 0, h);
  ink.addColorStop(0, "rgba(255,79,216,0)");
  ink.addColorStop(0.4, "rgba(255,79,216,0.7)");
  ink.addColorStop(1, "rgba(255,79,216,0.9)");
  g.strokeStyle = ink;
  g.lineWidth = 1.2;
  g.stroke();
  g.restore();
  g.fillStyle = "rgba(255,190,220,0.9)";
  g.fillRect(0, yH - 0.5, w, 1.2);
  return c;
}

function drawPlanet(f: SurfaceFrame, cache: NeonCache) {
  const { ctx, w, h, theme: t, proj } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  // The sun and the floor scale with the planet, so zooming reads as the camera moving in on the whole scene.
  const key = `planet:${w}:${h}:${f.dpr}:${Math.round(R)}`;
  if (cache.back?.key !== key) cache.back = { key, canvas: planetBack(f, cx, cy, R) };
  ctx.drawImage(cache.back.canvas, 0, 0, w, h);

  const path = geoPath(proj, ctx);
  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, Math.PI * 2);

  // A glow around the planet, then the planet itself, dark.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.14);
  halo.addColorStop(0, "rgba(255,79,216,0.55)");
  halo.addColorStop(0.35, "rgba(160,60,255,0.2)");
  halo.addColorStop(1, "rgba(160,60,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
  const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  body.addColorStop(0, "#1a0838");
  body.addColorStop(1, t.ocean);
  ctx.fillStyle = body;
  ctx.fill(sphere);

  ctx.save();
  ctx.clip(sphere);
  // The far side shows through the wire, faintly.
  const back = geoOrthographic()
    .rotate(proj.rotate())
    .scale(R)
    .translate([cx, cy])
    .clipAngle(179.5)
    .precision(0.8);
  const backPath = geoPath(back, ctx);
  // The far half is drawn whole and the front drawn over it at full strength, which looks the same as cutting it.
  ctx.beginPath();
  backPath(BACK_GRID);
  ctx.strokeStyle = "rgba(255,79,216,0.16)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  backPath(f.low.coast as never);
  ctx.strokeStyle = "rgba(111,246,255,0.16)";
  ctx.stroke();

  ctx.beginPath();
  path(BACK_GRID);
  ctx.strokeStyle = "rgba(255,79,216,0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.fillStyle = t.land;
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  ctx.beginPath();
  path(LAND_GRID);
  ctx.strokeStyle = t.textureInk;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.coast;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 7;
  ctx.stroke(coast);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3.2;
  ctx.stroke(coast);
  ctx.globalAlpha = 1;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  // Toward the limb the planet darkens, so it reads as a sphere.
  const limb = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
  limb.addColorStop(0, "rgba(7,1,15,0)");
  limb.addColorStop(1, "rgba(7,1,15,0.55)");
  ctx.fillStyle = limb;
  ctx.fill(sphere);
  ctx.restore();

  // The rim: magenta outside, a thin cyan line inside.
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "#ff4fd8";
  ctx.stroke(sphere);
  ctx.beginPath();
  ctx.arc(cx, cy, R - 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "rgba(111,246,255,0.7)";
  ctx.stroke();
  ctx.restore();
}

