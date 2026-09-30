// Pop-up Book (decision 76): a children's pop-up book. The continents are thick paper cut-outs standing up off the
// page, two cards thick with their cut edges showing and a shadow on the page under them; the shallows are rings
// of lighter paper around every coast; mountains are little folded paper peaks that stand up; and paper clouds,
// suns and folded paper boats stand on sticks at fixed spots in open sea. In Map view the page is seen from a low
// angle that lays flatter as you zoom out and stands up as you zoom in, with the book's upright back page beyond
// the far edge. In Globe view the world is a paper ball popping out of the page on two folded hinges. The gutter
// between the pages runs down the middle as a soft fold. No text, no borders, nothing cut by any political unit.

import { geoPath } from "d3-geo";
import { clamp, landPaths, once, pxPerDeg, speckle, standAt, vAtScale, wideCoast, yAtV, type SeaSpot } from "./handmade.ts";
import { hash2, type SurfaceFrame } from "./surface.ts";

/**
 * Paper clouds, suns and boats on sticks, at spots with open sea all round (test/handmade.test.ts). Each stands
 * about as tall as a third of its radius of open water, so even seen from the low camera it covers only sea.
 */
export const POPUP_SPOTS: readonly SeaSpot[] = [
  { kind: "sun", lon: -42, lat: 24, r: 11 },
  { kind: "cloud", lon: -152, lat: 40, r: 11 },
  { kind: "cloud", lon: -24, lat: -34, r: 11, flip: true },
  { kind: "boat", lon: -22, lat: -2, r: 6 },
  { kind: "cloud", lon: 86, lat: -42, r: 11 },
  { kind: "boat", lon: 52, lat: -36, r: 8, flip: true },
  { kind: "sun", lon: -138, lat: -38, r: 11 },
  { kind: "cloud", lon: -120, lat: -14, r: 11, flip: true },
  { kind: "boat", lon: 160, lat: 40, r: 7.5 },
  { kind: "cloud", lon: 82, lat: -16, r: 11 },
  { kind: "cloud", lon: -2, lat: -56, r: 11, flip: true },
  { kind: "boat", lon: -168, lat: 6, r: 8 },
  { kind: "cloud", lon: 122, lat: -54, r: 11 },
  { kind: "sun", lon: -112, lat: -58, r: 11 },
];

export class PopupCache {
  back: { key?: string; canvas?: HTMLCanvasElement } = {};
}

/** Paper colours, as [card, its cut edge]. */
const GREEN_LOW: [string, string] = ["#4f9d47", "#2f6a36"];
const GREEN_TOP: [string, string] = ["#8ccd5c", "#4c8a3a"];
const SAND: [string, string] = ["#f3d27a", "#c99a3c"];
const ICE: [string, string] = ["#f7fbff", "#b9cfe0"];
const SEA_RINGS = ["#a9dcf3", "#c6eaf9"];
const INK = "#27405a";

// ---- the pictures on sticks, in local units: a unit wide either side of the stick, the foot at 0, up is -y ----

const circle = (p: Path2D, x: number, y: number, r: number) => {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, Math.PI * 2);
};

function cloudShape(): Path2D {
  const p = new Path2D();
  circle(p, -0.55, -1.02, 0.36);
  circle(p, -0.08, -1.24, 0.46);
  circle(p, 0.46, -1.08, 0.38);
  circle(p, 0.84, -0.9, 0.24);
  circle(p, -0.92, -0.88, 0.24);
  p.rect(-0.92, -1.02, 1.76, 0.36);
  return p;
}

function sunRays(): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = a + 0.16, c = a - 0.16;
    p.moveTo(0.46 * Math.cos(c), -1.2 + 0.46 * Math.sin(c));
    p.lineTo(0.8 * Math.cos(a), -1.2 + 0.8 * Math.sin(a));
    p.lineTo(0.46 * Math.cos(b), -1.2 + 0.46 * Math.sin(b));
    p.closePath();
  }
  return p;
}

/** The pieces as paths in local units, made on first use (tests import this file without a canvas). */
let pieces: ReturnType<typeof makePieces> | null = null;
const makePieces = () => {
  const stick = new Path2D();
  stick.rect(-0.05, -0.8, 0.1, 0.8);
  const tab = new Path2D("M-0.22 0L0.22 0L0.13 -0.1L-0.13 -0.1Z");
  const sun = new Path2D();
  circle(sun, 0, -1.2, 0.44);
  const sunIn = new Path2D();
  circle(sunIn, 0, -1.2, 0.3);
  const hull = new Path2D("M-0.98 -0.44L0.98 -0.44L0.64 0L-0.64 0Z");
  const sail = new Path2D("M-0.5 -0.44L0 -1.2L0.5 -0.44Z");
  const fold = new Path2D("M0 -1.2L0 -0.44M-0.64 0L-0.32 -0.44M0.64 0L0.32 -0.44");
  return { stick, tab, cloud: cloudShape(), rays: sunRays(), sun, sunIn, hull, sail, fold };
};

const P = () => (pieces ??= makePieces());

/** One paper piece, standing, in local units. `u` is the pixel size of a unit, for line widths. */
function drawPiece(g: CanvasRenderingContext2D, kind: string, u: number) {
  const lw = clamp(1.6 / u, 0.01, 0.2);
  g.lineJoin = "round";
  g.lineWidth = lw;
  g.strokeStyle = INK;
  if (kind === "boat") {
    // A folded paper boat, floating: no stick.
    g.fillStyle = "#f2b53a";
    g.fill(P().hull);
    g.stroke(P().hull);
    g.fillStyle = "#ffd766";
    g.fill(P().sail);
    g.stroke(P().sail);
    g.lineWidth = lw * 0.7;
    g.strokeStyle = "rgba(39,64,90,0.55)";
    g.stroke(P().fold);
    return;
  }
  g.fillStyle = "#d7a266";
  g.fill(P().stick);
  g.stroke(P().stick);
  g.fillStyle = "#efe2c4";
  g.fill(P().tab);
  g.stroke(P().tab);
  if (kind === "sun") {
    g.fillStyle = "#ff9f1c";
    g.fill(P().rays);
    g.stroke(P().rays);
    g.fillStyle = "#ffcf3a";
    g.fill(P().sun);
    g.stroke(P().sun);
    g.fillStyle = "#ffe483";
    g.fill(P().sunIn);
    return;
  }
  // A cloud of two layers of paper: a blue one peeking out behind a white one.
  g.save();
  g.translate(0.09, 0.07);
  g.lineWidth = lw * 2.4;
  g.stroke(P().cloud);
  g.fillStyle = "#b7def3";
  g.fill(P().cloud);
  g.restore();
  g.lineWidth = lw * 2.4;
  g.stroke(P().cloud);
  g.fillStyle = "#ffffff";
  g.fill(P().cloud);
}

/**
 * Every piece on a stick, far ones first, with its shadow on the page. A piece is as wide as 90 percent of the open
 * water around its spot and never stands taller than that water reaches behind it on screen, so it covers sea only.
 */
function drawSticks(f: SurfaceFrame, g: CanvasRenderingContext2D, cosT: number) {
  const pxDeg = pxPerDeg(f.proj);
  const list: { x: number; y: number; u: number; k: number; kind: string; flip: number }[] = [];
  for (const sp of POPUP_SPOTS) {
    const at = standAt(f, sp.lon, sp.lat);
    if (!at) continue;
    if (f.cam && at.s < f.cam.far) continue;
    const u = Math.min(160, 0.45 * sp.r * pxDeg) * at.s;
    if (u < 3 || at.x < -u * 2 || at.x > f.w + u * 2 || at.y < -u * 3 || at.y > f.h + u * 3) continue;
    // A piece 2 units tall covers ground up to 2 u k / cos(tilt) behind its foot: keep that inside the water.
    const k = f.cam ? Math.max(0.35, Math.min(at.k, 1.05 * cosT)) : at.k;
    list.push({ x: at.x, y: at.y, u, k, kind: sp.kind, flip: sp.flip ? -1 : 1 });
  }
  list.sort((a, b) => a.y - b.y);
  for (const p of list) {
    g.save();
    // The card's shadow falls on the page toward the lower right, longer the more the piece stands up.
    g.save();
    g.transform(p.u * p.flip, 0, -0.5 * p.u * p.k, -0.28 * p.u * p.k, p.x, p.y);
    g.scale(1, -1);
    g.fillStyle = "rgba(24,70,110,0.2)";
    if (p.kind === "boat") g.fill(P().hull);
    else {
      g.fill(P().stick);
      g.fill(p.kind === "sun" ? P().sun : P().cloud);
    }
    g.restore();
    g.translate(p.x, p.y);
    g.scale(p.u * p.flip, p.u * p.k);
    drawPiece(g, p.kind, p.u);
    g.restore();
  }
}

/** Little folded paper peaks where the relief layer has mountains: two panels, the shaded one on the right. */
function drawPeaks(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const peaks = f.relief?.peaks;
  if (!peaks) return;
  const z = clamp(0.8 + f.zoom * 0.2, 1, 2.6) * clamp(Math.min(f.w, f.h) / 720, 0.6, 1);
  const cell = 30 * z;
  const taken = new Set<number>();
  const list: { x: number; y: number; bw: number; hh: number; dep: number; snow: boolean }[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const [lon, lat] = peaks[i]!;
    const at = standAt(f, lon, lat);
    if (!at) continue;
    if (f.cam && at.s < f.cam.far * 1.1) continue;
    if (at.x < -20 || at.x > f.w + 20 || at.y < -30 || at.y > f.h + 30) continue;
    const key = Math.floor(at.x / cell) * 4096 + Math.floor(at.y / (cell * 0.55));
    if (taken.has(key)) continue;
    taken.add(key);
    const v = hash2(Math.round(lon * 10), Math.round(lat * 10));
    const k = Math.max(0.3, at.k);
    list.push({ x: at.x, y: at.y, bw: (6 + v * 3) * z * at.s, hh: (13 + v * 8) * z * at.s * k, dep: f.cam ? f.cam.cos : 0.5, snow: v > 0.4 || Math.abs(lat) > 40 });
  }
  list.sort((a, b) => a.y - b.y);
  g.lineJoin = "round";
  g.lineWidth = 0.9;
  g.strokeStyle = "#4a2f1c";
  for (const p of list) {
    const tx = p.x, ty = p.y - p.hh;
    const lx = p.x - p.bw, rx = p.x + p.bw, ly = p.y, ry = p.y;
    // The fold comes toward the viewer a little, so the two panels read as a folded card.
    const fx = p.x - p.bw * 0.12, fy = p.y + p.bw * 0.45 * p.dep;
    g.fillStyle = "rgba(24,70,110,0.22)";
    g.beginPath();
    g.moveTo(rx, ry);
    g.lineTo(rx + p.hh * 0.45, ry + p.hh * 0.18 * p.dep);
    g.lineTo(fx, fy);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(tx, ty);
    g.lineTo(fx, fy);
    g.closePath();
    g.fillStyle = "#c29262";
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(tx, ty);
    g.lineTo(rx, ry);
    g.closePath();
    g.fillStyle = "#8f6242";
    g.fill();
    g.stroke();
    if (p.snow) {
      const c = 0.38;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx + (lx - tx) * c, ty + (ly - ty) * c);
      g.lineTo(tx + (lx - tx) * c * 0.55 + (fx - tx) * c * 0.5, ty + (ly - ty) * c * 0.8);
      g.lineTo(tx + (fx - tx) * c, ty + (fy - ty) * c);
      g.lineTo(tx + (rx - tx) * c * 0.6 + (fx - tx) * c * 0.4, ty + (ry - ty) * c * 0.75);
      g.lineTo(tx + (rx - tx) * c, ty + (ry - ty) * c);
      g.closePath();
      g.fillStyle = "#ffffff";
      g.fill();
      g.stroke();
    }
  }
}

/** A layer of card: its cut edge a few pixels down, then its face, both grown by `grow` pixels all round. */
function card(g: CanvasRenderingContext2D, path: Path2D, colors: [string, string], dy: number, edge: number, grow: number) {
  g.save();
  g.lineJoin = "round";
  g.translate(0, dy + edge);
  g.fillStyle = colors[1];
  g.strokeStyle = colors[1];
  g.lineWidth = grow * 2;
  g.fill(path);
  if (grow) g.stroke(path);
  g.translate(0, -edge);
  g.fillStyle = colors[0];
  g.strokeStyle = colors[0];
  g.fill(path);
  if (grow) g.stroke(path);
  g.restore();
}

/** The land as paper: a shadow on the page, a lower darker card, the top card, sand and ice on it, cut edges lit. */
function drawLand(f: SurfaceFrame, g: CanvasRenderingContext2D, land: Path2D, coast: Path2D, ice: Path2D | null, thick: number) {
  // Rings of lighter paper around every coast: the shallows, cut and layered. Wide and soft, so the light coast
  // is enough for them.
  const soft = wideCoast(f, coast);
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  const ring = clamp(10 + f.zoom * 3, 12, 30);
  g.lineWidth = ring * 2 + 2.4;
  g.strokeStyle = "#6fbde2";
  g.stroke(soft);
  g.lineWidth = ring * 2;
  g.strokeStyle = SEA_RINGS[0]!;
  g.stroke(soft);
  g.lineWidth = ring + 2.4;
  g.strokeStyle = "#86cbe9";
  g.stroke(soft);
  g.lineWidth = ring;
  g.strokeStyle = SEA_RINGS[1]!;
  g.stroke(soft);
  g.restore();

  // The shadow on the page, down and to the right.
  g.save();
  g.translate(thick * 0.9 + 2, thick * 1.3 + 2);
  g.fillStyle = "rgba(24,70,110,0.28)";
  g.fill(land);
  g.restore();

  card(g, land, GREEN_LOW, thick * 0.5, thick * 0.5, 3.2);
  card(g, land, GREEN_TOP, 0, thick * 0.5, 0);

  g.save();
  g.clip(land);
  // Deserts as sand-coloured paper laid on the green, from the relief layer's dunes.
  const dunes = f.relief?.dunes;
  if (dunes) {
    const pxDeg = pxPerDeg(f.proj);
    const sand = new Path2D();
    for (const [lon, lat] of dunes) {
      const at = standAt(f, lon, lat);
      if (!at || (f.cam && at.s < f.cam.far)) continue;
      const rr = clamp(1.3 * pxDeg * at.s, 2, 60);
      if (at.x < -rr || at.x > f.w + rr || at.y < -rr || at.y > f.h + rr) continue;
      const squash = f.cam ? f.cam.cos : 1;
      sand.moveTo(at.x + rr, at.y);
      sand.ellipse(at.x, at.y, rr, rr * Math.max(0.3, squash), 0, 0, Math.PI * 2);
    }
    card(g, sand, SAND, -thick * 0.25, thick * 0.25, 0);
  }
  if (ice) card(g, ice, ICE, -thick * 0.3, thick * 0.3, 0);
  // Paper fibres over the card.
  g.fillStyle = speckle(g, f.dpr, "rgba(255,255,255,0.55)", 260, [0.5, 1.6], 17);
  g.fillRect(0, 0, f.w, f.h);
  g.restore();

  // The cut edge catches the light.
  g.save();
  g.lineJoin = "round";
  g.lineWidth = 1.1;
  g.strokeStyle = "rgba(255,255,240,0.75)";
  g.stroke(land);
  g.restore();
}

/** The page: sea paper with fibres, and on the tilted map the book's back page standing up beyond the far edge. */
function pageBack(f: SurfaceFrame, cache: PopupCache, yFar: number): HTMLCanvasElement {
  const { w, h, dpr, theme: t } = f;
  return once(cache.back, `page:${w}:${h}:${dpr}:${Math.round(yFar)}:${f.mode}`, w, h, dpr, (g) => {
    g.fillStyle = t.ocean;
    g.fillRect(0, 0, w, h);
    g.fillStyle = speckle(g, dpr, "rgba(255,255,255,0.5)", 240, [0.5, 1.8], 23);
    g.fillRect(0, 0, w, h);
    // A soft darkening toward the page's edges, like a printed page in lamplight.
    const v = g.createRadialGradient(w / 2, h * 0.6, Math.min(w, h) * 0.35, w / 2, h * 0.6, Math.max(w, h) * 0.8);
    v.addColorStop(0, "rgba(20,60,90,0)");
    v.addColorStop(1, "rgba(20,60,90,0.16)");
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    if (f.mode === "3d") {
      g.fillStyle = "#fbf2dc";
      g.fillRect(0, 0, w, h);
      g.fillStyle = speckle(g, dpr, "rgba(160,120,60,0.35)", 200, [0.5, 1.6], 29);
      g.fillRect(0, 0, w, h);
      paperBall(f, g);
      return;
    }
    if (yFar <= 0) return;
    // The upright back page: a paper sky with a sun and layered clouds, and the fold where the two pages meet.
    const sky = g.createLinearGradient(0, 0, 0, yFar);
    sky.addColorStop(0, "#bfe6fb");
    sky.addColorStop(1, "#e4f5fd");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, yFar);
    g.fillStyle = speckle(g, dpr, "rgba(255,255,255,0.6)", 240, [0.5, 1.8], 31);
    g.fillRect(0, 0, w, yFar);
    const u = clamp(yFar * 0.28, 12, 70);
    const put = (kind: string, x: number, y: number, s: number, flip = 1) => {
      g.save();
      g.translate(x, y);
      g.scale(u * s * flip, u * s);
      drawPiece(g, kind, u * s);
      g.restore();
    };
    g.save();
    g.beginPath();
    g.rect(0, 0, w, yFar);
    g.clip();
    // Rolling paper hills along the bottom of the back page, two layers.
    for (const [col, edge, base, amp, per] of [
      ["#9ed27a", "#5f9a48", 0.72, 0.16, 0.9],
      ["#7cc05c", "#4c8a3a", 0.86, 0.12, 0.6],
    ] as const) {
      g.beginPath();
      g.moveTo(0, yFar);
      for (let x = 0; x <= w + 20; x += 20) g.lineTo(x, yFar * (base - amp * Math.sin((x / w) * Math.PI * 2 * per + base * 9)));
      g.lineTo(w, yFar);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = edge;
      g.stroke();
    }
    put("sun", w * 0.82, yFar * 0.95, 1.2);
    put("cloud", w * 0.18, yFar * 0.78, 1);
    put("cloud", w * 0.52, yFar * 0.62, 0.8, -1);
    g.restore();
    // The fold between the pages: a shadow on the flat page, a lit edge on the upright one.
    const fold = g.createLinearGradient(0, yFar - 6, 0, yFar + 22);
    fold.addColorStop(0, "rgba(255,255,255,0)");
    fold.addColorStop(0.2, "rgba(255,255,255,0.7)");
    fold.addColorStop(0.24, "rgba(40,70,100,0.5)");
    fold.addColorStop(1, "rgba(40,70,100,0)");
    g.fillStyle = fold;
    g.fillRect(0, yFar - 6, w, 28);
  });
}

/** The paper ball's shadow and the two folded hinges that hold it up off the page. Drawn under the ball. */
function paperBall(f: SurfaceFrame, g: CanvasRenderingContext2D) {
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const sh = g.createRadialGradient(cx + R * 0.12, cy + R * 0.98, R * 0.1, cx + R * 0.12, cy + R * 0.98, R * 1.05);
  sh.addColorStop(0, "rgba(90,60,20,0.35)");
  sh.addColorStop(1, "rgba(90,60,20,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.ellipse(cx + R * 0.12, cy + R * 0.98, R * 1.05, R * 0.24, 0, 0, Math.PI * 2);
  g.fill();
  for (const side of [-1, 1]) {
    // A V-fold of card from the page to the ball's side: two panels, one in shade.
    const x0 = cx + side * R * 0.98, y0 = cy + R * 0.12;
    const x1 = cx + side * R * 1.32, y1 = cy + R * 0.95;
    const x2 = cx + side * R * 0.7, y2 = cy + R * 0.97;
    g.lineJoin = "round";
    g.lineWidth = 1.2;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo((x1 + x2) / 2, (y1 + y2) / 2 - R * 0.05);
    g.closePath();
    g.fillStyle = "#f0dfb8";
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo((x1 + x2) / 2, (y1 + y2) / 2 - R * 0.05);
    g.lineTo(x2, y2);
    g.closePath();
    g.fillStyle = "#d8c08e";
    g.fill();
    g.stroke();
  }
}

/** The gutter between the book's pages: a soft fold down the middle of the spread. */
function gutter(f: SurfaceFrame, g: CanvasRenderingContext2D, top: number) {
  const x = f.w / 2;
  const wide = clamp(f.w * 0.05, 26, 70);
  const gr = g.createLinearGradient(x - wide, 0, x + wide, 0);
  gr.addColorStop(0, "rgba(30,60,90,0)");
  gr.addColorStop(0.42, "rgba(30,60,90,0.13)");
  gr.addColorStop(0.5, "rgba(30,60,90,0.26)");
  gr.addColorStop(0.53, "rgba(255,255,255,0.18)");
  gr.addColorStop(0.62, "rgba(30,60,90,0.08)");
  gr.addColorStop(1, "rgba(30,60,90,0)");
  g.fillStyle = gr;
  g.fillRect(x - wide, top, wide * 2, f.h - top);
}

export function drawPopup(f: SurfaceFrame, cache: PopupCache): number | void {
  const g = f.ctx;
  const cam = f.cam;
  const sinT = cam ? cam.sin : 1;
  const cosT = cam ? cam.cos : 0;
  const yFar = cam ? yAtV(f, vAtScale(f, cam.far)) : 0;
  g.drawImage(pageBack(f, cache, yFar), 0, 0, f.w, f.h);
  const { land, coast, ice } = landPaths(f, f.map);

  if (f.mode === "3d") {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    gutter(f, g, 0);
    const ball = new Path2D();
    ball.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = f.theme.ocean;
    g.fill(ball);
    g.save();
    g.clip(ball);
    g.fillStyle = speckle(g, f.dpr, "rgba(255,255,255,0.5)", 240, [0.5, 1.8], 23);
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    // Paper strips: the ball is made of gores, joined along every 30th meridian.
    g.beginPath();
    geoPath(f.proj, g)({ type: "MultiLineString", coordinates: Array.from({ length: 12 }, (_, i) => Array.from({ length: 19 }, (_, j) => [i * 30 - 180, j * 10 - 90])) });
    g.lineWidth = 1;
    g.strokeStyle = "rgba(40,90,130,0.18)";
    g.stroke();
    drawLand(f, g, land, coast, ice, 5);
    // The ball is lit from the upper left.
    const lit = g.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.1, cx, cy, R * 1.02);
    lit.addColorStop(0, "rgba(255,255,255,0.18)");
    lit.addColorStop(0.55, "rgba(255,255,255,0)");
    lit.addColorStop(1, "rgba(20,50,90,0.3)");
    g.fillStyle = lit;
    g.fill(ball);
    g.restore();
    drawPeaks(f, g);
    drawSticks(f, g, cosT);
    g.lineWidth = 2;
    g.strokeStyle = INK;
    g.stroke(ball);
    return;
  }

  // Paper stands up as the camera tilts: a few pixels thick when the page lies flat, more as it stands.
  drawLand(f, g, land, coast, ice, 3 + 7 * sinT);
  drawPeaks(f, g);
  drawSticks(f, g, cosT);
  gutter(f, g, Math.max(0, yFar));
  if (cam && yFar > 0) {
    // The flat page's far edge, where the land stops before the fold.
    const fade = g.createLinearGradient(0, yFar, 0, yFar + 26);
    fade.addColorStop(0, f.theme.ocean);
    fade.addColorStop(1, "rgba(143,208,238,0)");
    g.fillStyle = fade;
    g.fillRect(0, yFar, f.w, 26);
  }
}


