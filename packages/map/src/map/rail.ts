// Sleeper Car (decision 74): the world seen from a long-distance train's window at dusk. In Map view the tilted
// camera looks out across farmland, sea and mountains to a horizon under a dusk sky with low hills; the land is a
// patchwork of small fields cut from a fixed grid of longitude and latitude, the sea catches the light in short
// glints fixed to the world, mountains are small painted peaks from the relief layer. In the foreground an
// embankment with the next track and telegraph poles slides past faster than the land when the map moves, a
// parallax drawn below the map, never over it. In Globe view the globe hangs in the dusk sky over the same
// embankment. No text, no routes: nothing links one place to another.

import { geoPath } from "d3-geo";
import { hash2, offscreen, pathContext, r1, seeded, type SurfaceCam, type SurfaceFrame } from "./surface.ts";

const DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FIELD_TONES = ["#a4a45e", "#c2b06a", "#7f9352", "#b59a5a"];
// Sand country, from the relief layer's dunes: plots of pale sand instead of crops.
const SAND_TONE = "#e2c68c";
const STEPS = [8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625];

export class RailCache {
  back?: { key: string; canvas: HTMLCanvasElement };
  /** One-degree cells near the relief layer's dunes, where no fields are drawn. */
  sand?: { from: readonly [number, number][]; cells: Uint8Array };
}

/** Whether a point is in sand country: within two degrees of a dune in the relief layer. Built once. */
function sandy(f: SurfaceFrame, cache: RailCache): (lon: number, lat: number) => boolean {
  const dunes = f.relief?.dunes ?? [];
  if (cache.sand?.from !== dunes) {
    const cells = new Uint8Array(360 * 180);
    for (const [lon, lat] of dunes) {
      const i0 = Math.floor(lon + 180), j0 = Math.floor(90 - lat);
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const j = j0 + dj;
          if (j < 0 || j >= 180) continue;
          cells[j * 360 + (((i0 + di) % 360) + 360) % 360] = 1;
        }
    }
    cache.sand = { from: dunes, cells };
  }
  const cells = cache.sand.cells;
  return (lon, lat) => {
    const i = Math.floor(lon + 180) % 360, j = Math.min(179, Math.max(0, Math.floor(90 - lat)));
    return cells[j * 360 + i] === 1;
  };
}

/** Flat-map offset below the frame's centre that the camera shows at screen offset `yo`. */
const vAtScreen = (c: SurfaceCam, yo: number) => (yo * c.d) / (c.d * c.cos + yo * c.sin);
/** Flat-map offset below the frame's centre where the camera's scale is `s`. */
const vAtScale = (c: SurfaceCam, s: number) => (c.d * (1 - 1 / s)) / c.sin;
/** Screen y of a flat-map offset `v`. */
const yAt = (c: SurfaceCam, v: number) => c.cy + (v * c.cos * c.d) / (c.d - v * c.sin);

/** How tall the foreground embankment is. */
export const bankHeight = (h: number, globe: boolean) => clamp(h * (globe ? 0.085 : 0.11), 34, globe ? 70 : 92);

export function drawRail(f: SurfaceFrame, cache: RailCache) {
  if (f.cam) drawView(f, f.cam, cache);
  else drawGlobe(f, cache);
  drawBank(f);
}

/** The dusk sky with a few stars, a low sun's glow and two ranges of hills along the horizon. */
function sky(g: CanvasRenderingContext2D, f: SurfaceFrame, w: number, yH: number) {
  const [zenith, middle, horizon] = f.theme.sky ?? ["#1b2550", "#6b5a8e", "#f2a86b"];
  const s = g.createLinearGradient(0, 0, 0, yH);
  s.addColorStop(0, zenith);
  s.addColorStop(0.6, middle);
  s.addColorStop(1, horizon);
  g.fillStyle = s;
  g.fillRect(0, 0, w, yH);
  const rnd = seeded(41);
  g.fillStyle = "#fff6e6";
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = rnd() * yH * 0.45;
    g.globalAlpha = (0.2 + rnd() * 0.6) * (1 - y / (yH * 0.45));
    g.fillRect(x, y, rnd() < 0.2 ? 1.6 : 1, rnd() < 0.2 ? 1.6 : 1);
  }
  g.globalAlpha = 1;
  const sun = g.createRadialGradient(w * 0.72, yH, 0, w * 0.72, yH, Math.max(w, yH) * 0.45);
  sun.addColorStop(0, "rgba(255,214,150,0.75)");
  sun.addColorStop(0.3, "rgba(255,170,120,0.25)");
  sun.addColorStop(1, "rgba(255,170,120,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, yH);
}

/**
 * A range of rolling hills: a silhouette whose ridge wanders between `ridge - rise` and `ridge`, filled down to
 * `base`. Beyond the drawn land, so it never covers a place.
 */
function hills(g: CanvasRenderingContext2D, w: number, ridge: number, rise: number, base: number, seed: number, color: string) {
  const rnd = seeded(seed);
  const waves = Array.from({ length: 4 }, () => ({ k: 0.003 + rnd() * 0.011, p: rnd() * 6, a: 0.3 + rnd() * 0.7 }));
  const total = waves.reduce((s, wv) => s + wv.a, 0);
  g.beginPath();
  g.moveTo(0, base);
  for (let x = 0; x <= w + 8; x += 8) {
    let y = 0;
    for (const wv of waves) y += Math.sin(x * wv.k + wv.p) * wv.a;
    g.lineTo(x, ridge - rise * (0.5 + (0.5 * y) / total));
  }
  g.lineTo(w, base);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function viewBack(f: SurfaceFrame, yH: number, yLand: number): HTMLCanvasElement {
  const { w, h, dpr, theme: t } = f;
  const [c, g] = offscreen(w, h, dpr);
  sky(g, f, w, yH);
  // Two ranges between the horizon and the far edge of the drawn land: the far one paler, the near one darker.
  const band = Math.max(8, yLand - yH);
  const base = yLand + 6;
  // The sky's horizon colour carries on under the horizon line, behind the hills.
  g.fillStyle = (t.sky ?? ["", "", "#f2a86b"])[2];
  g.fillRect(0, yH - 1, w, base - yH + 1);
  hills(g, w, yH + band * 0.25, clamp(band * 0.9, 16, 70), base, 5, "#8a7596");
  hills(g, w, yH + band * 0.6, clamp(band * 0.6, 12, 50), base, 9, "#6f5c7a");
  // Haze over their feet, so the far land fades into them.
  const haze = g.createLinearGradient(0, yH + band * 0.3, 0, base);
  haze.addColorStop(0, "rgba(230,180,143,0)");
  haze.addColorStop(1, t.fog ?? "#e6b48f");
  g.fillStyle = haze;
  g.fillRect(0, yH, w, base - yH);
  return c;
}

function pickStep(pxDeg: number, minPx: number): number {
  for (let i = STEPS.length - 1; i >= 0; i--) if (STEPS[i]! * pxDeg >= minPx) return STEPS[i]!;
  return STEPS[0]!;
}

function drawView(f: SurfaceFrame, c: SurfaceCam, cache: RailCache) {
  const { ctx, w, h, theme: t, proj } = f;
  const yH = c.cy - (c.d * c.cos) / c.sin;
  const vNear = vAtScreen(c, h / 2 + 12);
  const vLand = vAtScale(c, c.far);
  const yLand = yAt(c, vLand);
  const key = `view:${w}:${h}:${f.dpr}:${Math.round(yH)}:${Math.round(yLand)}`;
  if (cache.back?.key !== key) cache.back = { key, canvas: viewBack(f, yH, yLand) };
  ctx.drawImage(cache.back.canvas, 0, 0, w, h);

  // The sea, lighter toward the far haze.
  const sea = ctx.createLinearGradient(0, yLand, 0, h);
  sea.addColorStop(0, "#8a8aa0");
  sea.addColorStop(0.18, "#4c6488");
  sea.addColorStop(1, t.ocean);
  ctx.fillStyle = sea;
  ctx.fillRect(0, yLand, w, h - yLand);

  const pxDeg = proj.scale() / DEG;
  const reach = w / 2 / c.far + 40;
  // Degrees of longitude and latitude at a point on the flat map, which is plate carree around the centre.
  const lonAt = (x: number) => f.lon + (x - c.cx) / pxDeg;
  const latAt = (y: number) => f.lat - (y - c.cy) / pxDeg;
  const xAt = (lon: number) => c.cx + (lon - f.lon) * pxDeg;
  const yOf = (lat: number) => c.cy - (lat - f.lat) * pxDeg;

  // Glints on the water: short level strokes on a lattice fixed to the world, where the sea is.
  {
    const step = pickStep(pxDeg, 30);
    const out: string[] = [];
    const lat0 = Math.floor(latAt(c.cy + vNear) / step) * step;
    const lat1 = latAt(c.cy + vLand);
    const lon0 = Math.floor(lonAt(c.cx - reach) / step) * step;
    const lon1 = lonAt(c.cx + reach);
    for (let lat = lat0; lat <= lat1; lat += step)
      for (let lon = lon0; lon <= lon1; lon += step) {
        const jx = (hash2(Math.round(lon / step), Math.round(lat / step)) - 0.5) * step;
        const jy = (hash2(Math.round(lat / step) + 7, Math.round(lon / step)) - 0.5) * step;
        const lo = lon + jx, la = lat + jy;
        if (f.isLand(((lo + 540) % 360) - 180, la)) continue;
        const [x, y, s] = f.tp(xAt(lo), yOf(la), 0);
        if (s < c.far || x < -20 || x > w + 20 || y > h) continue;
        const len = 5 * s + 2;
        out.push(`M${r1(x - len)} ${r1(y)}h${r1(len * 2)}`);
      }
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = t.waterline;
    ctx.stroke(new Path2D(out.join("")));
    ctx.restore();
  }

  // Land, cut at the draw distance before it is tilted, since the camera's formula folds back past the horizon.
  const ext = proj.clipExtent();
  proj.clipExtent([
    [c.cx - reach, c.cy + vLand],
    [c.cx + reach, c.cy + vNear + 40],
  ]);
  const land = new Path2D();
  geoPath(f.view as never, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(f.view as never, pathContext(coast))(f.map.coast);
  let ice: Path2D | null = null;
  if (f.map.ice) {
    ice = new Path2D();
    geoPath(f.view as never, pathContext(ice))(f.map.ice);
  }
  proj.clipExtent(ext);

  const ground = ctx.createLinearGradient(0, yLand, 0, h);
  ground.addColorStop(0, "#b39a86");
  ground.addColorStop(0.25, "#9c9a66");
  ground.addColorStop(1, t.land);
  ctx.fillStyle = ground;
  ctx.fill(land);

  // Fields: small plots on a grid of longitude and latitude, in a few crop colours chosen by a fixed hash. Only
  // the nearer half, where they read; farther off they would be too small to see.
  {
    const step = pickStep(pxDeg, 13);
    const vMid = vAtScale(c, 0.55);
    const half = w / 2 / 0.55 + 40;
    const at = (lon: number, lat: number) => {
      const q = f.tp(xAt(lon), yOf(lat), 0);
      return [q[0], q[1]] as [number, number];
    };
    drawFields(f, cache, land, step, [lonAt(c.cx - half), lonAt(c.cx + half)], [latAt(c.cy + vNear + 40), latAt(c.cy + vMid)], at);
  }

  if (ice) {
    ctx.fillStyle = t.ice;
    ctx.fill(ice);
  }
  drawPeaks(f, c, vLand, vNear, pxDeg);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(59,52,36,0.75)";
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  ctx.restore();

  // Haze: the far land and sea fade into the dusk.
  const yFade = yAt(c, vAtScale(c, c.far * 2.1));
  const haze = ctx.createLinearGradient(0, yLand, 0, yFade);
  haze.addColorStop(0, t.fog ?? "#e6b48f");
  haze.addColorStop(1, "rgba(230,180,143,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, yLand - 1, w, yFade - yLand + 1);
}

/**
 * Fields: small plots on a grid of longitude and latitude between the given bounds, in a few crop colours chosen
 * by a fixed hash, pale sand in dune country, none on ice or far north and south. `at` takes a corner to the
 * screen, or returns null where it can't be seen. The plots are cut from the grid alone, never by any region.
 */
function drawFields(
  f: SurfaceFrame,
  cache: RailCache,
  land: Path2D,
  step: number,
  [lonA, lonB]: [number, number],
  [latA, latB]: [number, number],
  at: (lon: number, lat: number) => [number, number] | null,
) {
  const { ctx, w, h } = f;
  const lists: string[][] = [...FIELD_TONES, SAND_TONE].map(() => []);
  const m = step * 0.1;
  const sand = sandy(f, cache);
  const lat0 = Math.floor(Math.min(latA, latB) / step) * step;
  const lat1 = Math.max(latA, latB);
  const lon0 = Math.floor(lonA / step) * step;
  for (let lat = lat0; lat <= lat1 + step; lat += step) {
    if (Math.abs(lat) > 58) continue;
    for (let lon = lon0; lon <= lonB; lon += step) {
      const lo = ((lon + step / 2 + 540) % 360) - 180, la = lat + step / 2;
      if (!f.isLand(lo, la) || f.isIce(lo, la)) continue;
      const hv = hash2(Math.round(lon / step), Math.round(lat / step));
      if (hv < 0.18) continue;
      const a = at(lon + m, lat + m);
      const b = at(lon + step - m, lat + m);
      const cc = at(lon + step - m, lat + step - m);
      const d = at(lon + m, lat + step - m);
      if (!a || !b || !cc || !d) continue;
      if (Math.max(a[0], b[0], cc[0]) < -10 || Math.min(a[0], b[0], cc[0]) > w + 10 || Math.min(a[1], cc[1]) > h + 10 || Math.max(a[1], cc[1]) < -10) continue;
      lists[sand(lo, la) ? FIELD_TONES.length : Math.floor(hv * 97) % FIELD_TONES.length]!.push(`M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}L${r1(cc[0])} ${r1(cc[1])}L${r1(d[0])} ${r1(d[1])}Z`);
    }
  }
  ctx.save();
  ctx.clip(land);
  ctx.globalAlpha = 0.34;
  lists.forEach((list, i) => {
    if (!list.length) return;
    ctx.fillStyle = i < FIELD_TONES.length ? FIELD_TONES[i]! : SAND_TONE;
    ctx.fill(new Path2D(list.join("")));
  });
  ctx.restore();
}

/** Small painted peaks where the relief layer has mountains: a lit face, a shaded face and a snow cap. */
function drawPeaks(f: SurfaceFrame, c: SurfaceCam, vFar: number, vNear: number, pxDeg: number) {
  const peaks = f.relief?.peaks;
  if (!peaks) return;
  const { ctx, w, proj } = f;
  const a = clamp(0.55 * pxDeg, 2.6, 6);
  const lit: string[] = [], shade: string[] = [], snow: string[] = [];
  const list: [number, number, number][] = [];
  for (const [lon, lat] of peaks) {
    const p = proj([lon, lat]);
    if (!p) continue;
    const v = p[1] - c.cy;
    if (v < vFar || v > vNear) continue;
    const s = c.d / (c.d - v * c.sin);
    if (Math.abs(p[0] - c.cx) * s > w / 2 + a * 4) continue;
    list.push([p[0], p[1], v]);
  }
  list.sort((p, q) => p[2] - q[2]);
  for (const [x, y] of list) {
    const L = f.tp(x - a, y, 0), R = f.tp(x + a, y, 0), A = f.tp(x - a * 0.1, y, a * 1.6), M = f.tp(x + a * 0.15, y, 0);
    lit.push(`M${r1(L[0])} ${r1(L[1])}L${r1(A[0])} ${r1(A[1])}L${r1(M[0])} ${r1(M[1])}Z`);
    shade.push(`M${r1(M[0])} ${r1(M[1])}L${r1(A[0])} ${r1(A[1])}L${r1(R[0])} ${r1(R[1])}Z`);
    const k = 0.32;
    snow.push(
      `M${r1(A[0] + (L[0] - A[0]) * k)} ${r1(A[1] + (L[1] - A[1]) * k)}L${r1(A[0])} ${r1(A[1])}L${r1(A[0] + (R[0] - A[0]) * k)} ${r1(A[1] + (R[1] - A[1]) * k)}Z`,
    );
  }
  ctx.fillStyle = "#9a8a7c";
  ctx.fill(new Path2D(lit.join("")));
  ctx.fillStyle = f.theme.relief;
  ctx.fill(new Path2D(shade.join("")));
  ctx.fillStyle = "rgba(244,236,230,0.85)";
  ctx.fill(new Path2D(snow.join("")));
}

function globeBack(f: SurfaceFrame): HTMLCanvasElement {
  const { w, h, dpr } = f;
  const [c, g] = offscreen(w, h, dpr);
  const base = h - bankHeight(h, true);
  sky(g, f, w, base);
  hills(g, w, base, clamp(h * 0.09, 16, 60), base + 4, 5, "#7c6a8a");
  hills(g, w, base + 2, clamp(h * 0.05, 10, 40), base + 4, 9, "#5c4d6a");
  return c;
}

function drawGlobe(f: SurfaceFrame, cache: RailCache) {
  const { ctx, w, h, proj, theme: t } = f;
  const key = `globe:${w}:${h}:${f.dpr}`;
  if (cache.back?.key !== key) cache.back = { key, canvas: globeBack(f) };
  ctx.drawImage(cache.back.canvas, 0, 0, w, h);
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, Math.PI * 2);
  // A warm glow around the globe from the low sun.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
  halo.addColorStop(0, "rgba(255,200,150,0.4)");
  halo.addColorStop(1, "rgba(255,200,150,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
  const sea = ctx.createRadialGradient(cx + R * 0.35, cy + R * 0.3, R * 0.1, cx, cy, R);
  sea.addColorStop(0, "#3f6590");
  sea.addColorStop(1, t.ocean);
  ctx.fillStyle = sea;
  ctx.fill(sphere);
  ctx.save();
  ctx.clip(sphere);
  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.fillStyle = t.land;
  ctx.fill(land);
  // The same fields as in Map view, on the side of the globe that faces us.
  const r = Math.PI / 180;
  const [ux, uy, uz] = [Math.cos(f.lat * r) * Math.cos(f.lon * r), Math.cos(f.lat * r) * Math.sin(f.lon * r), Math.sin(f.lat * r)];
  const facing = (lon: number, lat: number) => Math.cos(lat * r) * Math.cos(lon * r) * ux + Math.cos(lat * r) * Math.sin(lon * r) * uy + Math.sin(lat * r) * uz > 0.08;
  drawFields(f, cache, land, pickStep(R / DEG, 11), [f.lon - 90, f.lon + 90], [Math.max(-60, f.lat - 90), Math.min(60, f.lat + 90)], (lon, lat) =>
    facing(lon, lat) ? (proj([lon, lat]) as [number, number] | null) : null,
  );
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = t.ice;
    ctx.fill(ice);
  }
  // Small peaks where the relief layer has mountains, standing upright on the screen.
  if (f.relief?.peaks) {
    const s = clamp(R * 0.009, 2, 5);
    const lit: string[] = [], shade: string[] = [];
    for (const [lon, lat] of f.relief.peaks) {
      if (!facing(lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p || p[0] < -8 || p[1] < -8 || p[0] > w + 8 || p[1] > h + 8) continue;
      lit.push(`M${r1(p[0] - s)} ${r1(p[1] + s * 0.5)}L${r1(p[0])} ${r1(p[1] - s * 1.1)}L${r1(p[0] + s * 0.1)} ${r1(p[1] + s * 0.5)}Z`);
      shade.push(`M${r1(p[0] + s * 0.1)} ${r1(p[1] + s * 0.5)}L${r1(p[0])} ${r1(p[1] - s * 1.1)}L${r1(p[0] + s)} ${r1(p[1] + s * 0.5)}Z`);
    }
    ctx.fillStyle = "#9a8a7c";
    ctx.fill(new Path2D(lit.join("")));
    ctx.fillStyle = t.relief;
    ctx.fill(new Path2D(shade.join("")));
  }
  ctx.strokeStyle = "rgba(59,52,36,0.7)";
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  // Lit by the setting sun from the lower right; night falls across the upper left.
  const light = ctx.createLinearGradient(cx + R * 0.8, cy + R * 0.6, cx - R * 0.9, cy - R * 0.8);
  light.addColorStop(0, "rgba(255,190,130,0.28)");
  light.addColorStop(0.45, "rgba(255,190,130,0)");
  light.addColorStop(1, "rgba(16,20,48,0.5)");
  ctx.fillStyle = light;
  ctx.fill(sphere);
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,220,180,0.6)";
  ctx.stroke(sphere);
}

/**
 * The embankment beside the line, below the map: grass, the next track's rails and ties, and telegraph poles with
 * their wires. It slides with the map's longitude, faster than the land, so it passes like the near side of the
 * view. It never moves by itself.
 */
function drawBank(f: SurfaceFrame) {
  const { ctx, w, h, proj } = f;
  const globe = f.mode === "3d";
  const bh = bankHeight(h, globe);
  const top = h - bh;
  const pxDeg = proj.scale() / DEG;
  const travel = f.lon * pxDeg * (globe ? 1.4 : 2.6);
  ctx.save();
  // Grass along the top of the embankment, as a ragged silhouette.
  const bank = ctx.createLinearGradient(0, top, 0, h);
  bank.addColorStop(0, "#3d3a24");
  bank.addColorStop(1, "#1f1c14");
  ctx.fillStyle = bank;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const tuft = 7;
  const shift = ((travel % tuft) + tuft) % tuft;
  for (let x = -shift - tuft; x <= w + tuft; x += tuft) {
    const n = hash2(Math.round((x + travel) / tuft), 3);
    ctx.lineTo(x, top + 4 - n * 7);
    ctx.lineTo(x + tuft / 2, top + 6);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  // The next track: ties passing, and two rails catching the light.
  const ty = top + bh * 0.62;
  const tie = 18;
  const toff = ((travel * 1.3) % tie + tie) % tie;
  const ties: string[] = [];
  for (let x = -toff; x < w + tie; x += tie) ties.push(`M${r1(x)} ${r1(ty - 3)}h${r1(tie * 0.45)}v${r1(bh * 0.2)}h${r1(-tie * 0.45)}Z`);
  ctx.fillStyle = "#2c2419";
  ctx.fill(new Path2D(ties.join("")));
  ctx.fillStyle = "rgba(230,200,160,0.55)";
  ctx.fillRect(0, ty - 1, w, 1.4);
  ctx.fillRect(0, ty + bh * 0.14, w, 1.4);
  // Telegraph poles, and wires sagging between them along the top of the embankment.
  const gap = clamp(w * 0.34, 180, 420);
  const poff = ((travel % gap) + gap) % gap;
  const poleTop = top - 2;
  const tops: number[] = [];
  for (let x = -poff - gap; x < w + gap; x += gap) tops.push(x);
  ctx.strokeStyle = "rgba(24,18,12,0.85)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 0; i + 1 < tops.length; i++) {
    const a = tops[i]!, b = tops[i + 1]!;
    for (const [dy, dx] of [
      [4, -9],
      [4, 9],
    ] as const) {
      ctx.moveTo(a + dx, poleTop + dy);
      ctx.quadraticCurveTo((a + b) / 2 + dx, poleTop + dy + bh * 0.3, b + dx, poleTop + dy);
    }
  }
  ctx.stroke();
  ctx.fillStyle = "#1d160f";
  for (const x of tops) {
    ctx.fillRect(x - 2, poleTop, 4, h - poleTop);
    ctx.fillRect(x - 13, poleTop + 2.5, 26, 3);
    ctx.fillStyle = "#cfd6d2";
    for (const dx of [-9, -3, 3, 9]) ctx.fillRect(x + dx - 1, poleTop, 2, 2.5);
    ctx.fillStyle = "#1d160f";
  }
  ctx.restore();
}
