// Toy Train Set (decision 76): a model railway on a tabletop. In Map view the camera looks down at the board at a
// steep angle with little perspective, like an isometric picture: land is green felt on a plaster base with a sand
// beach, painted plaster mountains and little model trees stand on it, and the sea is a painted board. Toy trains
// run slowly round oval tracks laid at fixed spots in open sea (never across land or near a place, tested). The
// board's wooden edge and the playroom floor show beyond the world's edges. In Globe view the world is a globe on a
// wooden stand on the table, with a train running round the stand below it. For readers who ask for reduced motion
// the trains stand still. No text, no borders, nothing cut or coloured by any political unit.

import { clamp, cellKey, landPaths, once, pxPerDeg, RAD, speckle, standAt, StillLayer, stillLayer, streaks, vAtScale, vAtScreen, wideCoast, type SeaSpot } from "./handmade.ts";
import { hash2, type SurfaceFrame } from "./surface.ts";

/**
 * Where the tracks are laid: spots with open sea all round (test/handmade.test.ts). Each oval reaches 80 percent
 * of the radius east and west and 50 percent north and south, so track, train and its shadow stay on the water.
 */
export const TRACKS: readonly SeaSpot[] = [
  { kind: "oval", lon: -42, lat: 24, r: 11 },
  { kind: "oval", lon: -152, lat: 40, r: 11 },
  { kind: "oval", lon: 82, lat: -16, r: 11 },
  { kind: "oval", lon: -138, lat: -38, r: 11 },
  { kind: "oval", lon: -2, lat: -56, r: 11 },
  { kind: "oval", lon: 122, lat: -54, r: 11 },
];
const OVAL_A = 0.8;
const OVAL_B = 0.5;
/** Seconds for a train to go once round its oval. */
const LAP = 70;

export class TrainsetCache {
  still = new StillLayer();
  globe = new StillLayer();
  back: { key?: string; canvas?: HTMLCanvasElement } = {};
  floor: { key?: string; canvas?: HTMLCanvasElement } = {};
  near?: { size: number; cells: Set<number> };
  sand?: { relief: object; cells: Set<number> };
}

/** A flat plane seen by some camera: a point on it, raised `lift` pixels, on screen, with the camera's scale. */
interface Plane {
  at(x: number, y: number, lift: number): [number, number, number];
}

// ---- trains --------------------------------------------------------------------------------------------------

interface Car {
  /** Centre along the oval, in radians, and half its length. */
  t: number;
  half: number;
  height: number;
  body: string;
  side: string;
  roof: string;
  kind: "boiler" | "cab" | "coach" | "chimney";
}

/** An engine and three coaches, front first, as offsets behind the front along the oval (radians of a unit oval). */
function trainCars(front: number): Car[] {
  const cars: Car[] = [];
  const add = (len: number, gap: number, c: Omit<Car, "t" | "half">) => {
    const at = front - len / 2;
    cars.push({ ...c, t: at, half: len / 2 });
    front = at - len / 2 - gap;
  };
  add(0.18, 0, { height: 0.75, body: "#1d1d22", side: "#0f0f12", roof: "#34343c", kind: "boiler" });
  add(0.12, 0.015, { height: 1.2, body: "#c3262c", side: "#8c1a1f", roof: "#e0473f", kind: "cab" });
  const coaches: [string, string, string][] = [
    ["#2d5fb3", "#1d3f7a", "#e9e2cf"],
    ["#2f8a4a", "#1f5f33", "#e9e2cf"],
    ["#f2b632", "#b98415", "#e9e2cf"],
  ];
  for (const [body, side, roof] of coaches) add(0.24, 0.035, { height: 1.05, body, side, roof, kind: "coach" });
  return cars;
}

/**
 * One box of a train standing on a plane: its footprint along the oval between two points, a width and a height.
 * Draws its shadow, the sides that face the viewer and its top.
 */
function box(g: CanvasRenderingContext2D, plane: Plane, a: [number, number], b: [number, number], width: number, height: number, car: Car) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * width, ny = (dx / len) * width;
  const foot: [number, number][] = [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
  const ground = foot.map(([x, y]) => plane.at(x, y, 0));
  const top = foot.map(([x, y]) => plane.at(x, y, height));
  // Shadow on the board, down and to the right.
  const sh = foot.map(([x, y]) => plane.at(x + height * 0.5, y + height * 0.35, 0));
  g.beginPath();
  sh.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = "rgba(10,40,70,0.28)";
  g.fill();
  // Which way round the footprint runs on screen, so a side's outward direction is known.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = ground[i]!, q = ground[(i + 1) % 4]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sign = area > 0 ? 1 : -1;
  g.lineJoin = "round";
  g.lineWidth = 0.8;
  g.strokeStyle = "rgba(20,14,10,0.7)";
  for (let i = 0; i < 4; i++) {
    const p = ground[i]!, q = ground[(i + 1) % 4]!;
    // Outward normal of this edge on screen; it faces the viewer when it points down the screen.
    const oy = sign * (q[0] - p[0]);
    if (oy <= 0) continue;
    const tp = top[i]!, tq = top[(i + 1) % 4]!;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(q[0], q[1]);
    g.lineTo(tq[0], tq[1]);
    g.lineTo(tp[0], tp[1]);
    g.closePath();
    g.fillStyle = car.side;
    g.fill();
    g.stroke();
    if (car.kind === "coach" || car.kind === "cab") {
      // A row of windows along the side, and a dark band where the wheels are.
      const lerp = (u: number, v: number): [number, number] => [
        p[0] + (q[0] - p[0]) * u + (tp[0] - p[0]) * v,
        p[1] + (q[1] - p[1]) * u + (tp[1] - p[1]) * v,
      ];
      const n = car.kind === "coach" ? 4 : 1;
      g.fillStyle = "#fff4cf";
      for (let k = 0; k < n; k++) {
        const u0 = (k + 0.22) / n, u1 = (k + 0.78) / n;
        const c = [lerp(u0, 0.5), lerp(u1, 0.5), lerp(u1, 0.85), lerp(u0, 0.85)];
        g.beginPath();
        c.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
      }
      const w = [lerp(0.04, 0), lerp(0.96, 0), lerp(0.96, 0.22), lerp(0.04, 0.22)];
      g.fillStyle = "#231c18";
      g.beginPath();
      w.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
  }
  g.beginPath();
  top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = car.kind === "coach" ? car.roof : car.body;
  g.fill();
  g.stroke();
  if (car.kind === "boiler") {
    // The boiler's red band and the front's buffer beam.
    const mid = (i: number, j: number, u: number): [number, number] => [top[i]![0] + (top[j]![0] - top[i]![0]) * u, top[i]![1] + (top[j]![1] - top[i]![1]) * u];
    const band = [mid(0, 1, 0.55), mid(0, 1, 0.68), mid(3, 2, 0.68), mid(3, 2, 0.55)];
    g.fillStyle = "#c3262c";
    g.beginPath();
    band.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  }
}

/** A point on a unit oval's plane coordinates, for the flat map (through the projection) or the table. */
type OvalAt = (t: number) => [number, number] | null;

function drawTrain(g: CanvasRenderingContext2D, plane: Plane, oval: OvalAt, front: number, scale: number, only?: (y: number) => boolean) {
  const cars = trainCars(front);
  const boxes: { a: [number, number]; b: [number, number]; car: Car; y: number; w: number; h: number }[] = [];
  for (const car of cars) {
    const a = oval(car.t - car.half), b = oval(car.t + car.half);
    if (!a || !b) continue;
    const y = plane.at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)[1];
    if (only && !only(y)) continue;
    boxes.push({ a, b, car, y, w: scale * 0.55, h: scale * car.height });
    if (car.kind === "boiler") {
      // The chimney stands on the boiler's front.
      const c = oval(car.t + car.half * 0.55), d = oval(car.t + car.half * 0.95);
      if (c && d) boxes.push({ a: c, b: d, car: { ...car, kind: "chimney", body: "#2a2a30", side: "#141418", roof: "#2a2a30" }, y: y + 0.01, w: scale * 0.22, h: scale * 1.55 });
    }
  }
  boxes.sort((p, q) => p.y - q.y);
  for (const bx of boxes) box(g, plane, bx.a, bx.b, bx.w, bx.h, bx.car);
}

/** The track: a bed of ballast, sleepers across it and two rails, as paths on a plane. */
function drawTrack(g: CanvasRenderingContext2D, plane: Plane, oval: OvalAt, scale: number) {
  const n = 120;
  const pts: ([number, number] | null)[] = [];
  for (let i = 0; i < n; i++) pts.push(oval((i / n) * Math.PI * 2));
  const bed = new Path2D(), rails = new Path2D(), sleepers = new Path2D();
  const gauge = scale * 0.42, sw = scale * 0.7;
  const offsetLine = (off: number, into: Path2D) => {
    let open = false;
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n], q = pts[(i + 1) % n], o = pts[(i + n - 1) % n];
      if (!p || !q || !o) {
        open = false;
        continue;
      }
      const dx = q[0] - o[0], dy = q[1] - o[1];
      const len = Math.hypot(dx, dy) || 1;
      const s = plane.at(p[0] + (-dy / len) * off, p[1] + (dx / len) * off, 0);
      if (open) into.lineTo(s[0], s[1]);
      else into.moveTo(s[0], s[1]);
      open = true;
    }
  };
  offsetLine(0, bed);
  offsetLine(gauge, rails);
  offsetLine(-gauge, rails);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], o = pts[(i + n - 1) % n];
    if (!p || !q || !o) continue;
    const dx = q[0] - o[0], dy = q[1] - o[1];
    const len = Math.hypot(dx, dy) || 1;
    const a = plane.at(p[0] + (-dy / len) * sw, p[1] + (dx / len) * sw, 0);
    const b = plane.at(p[0] - (-dy / len) * sw, p[1] - (dx / len) * sw, 0);
    sleepers.moveTo(a[0], a[1]);
    sleepers.lineTo(b[0], b[1]);
  }
  const px = plane.at(pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, 0)[2];
  g.save();
  g.lineJoin = "round";
  g.lineCap = "butt";
  g.lineWidth = scale * 2.1 * px;
  g.strokeStyle = "rgba(10,40,70,0.25)";
  g.stroke(bed);
  g.lineWidth = scale * 1.8 * px;
  g.strokeStyle = "#a89478";
  g.stroke(bed);
  g.lineWidth = Math.max(1, scale * 0.28 * px);
  g.strokeStyle = "#6b4a2e";
  g.stroke(sleepers);
  g.lineWidth = Math.max(0.8, scale * 0.14 * px);
  g.strokeStyle = "#d8dde2";
  g.stroke(rails);
  g.restore();
}

// ---- the board -----------------------------------------------------------------------------------------------

/** Planks of a playroom floor, seen beyond the board's edges. */
function floor(f: SurfaceFrame, cache: TrainsetCache): HTMLCanvasElement {
  const { w, h, dpr } = f;
  return once(cache.floor, `${w}:${h}:${dpr}`, w, h, dpr, (g) => {
    g.fillStyle = "#8a5a34";
    g.fillRect(0, 0, w, h);
    const plank = 34;
    for (let y = 0, i = 0; y < h; y += plank, i++) {
      g.fillStyle = i % 2 ? "rgba(255,220,170,0.07)" : "rgba(40,20,5,0.08)";
      g.fillRect(0, y, w, plank);
      g.fillStyle = "rgba(40,20,5,0.45)";
      g.fillRect(0, y, w, 1.5);
      const off = (i * 173) % 260;
      for (let x = off; x < w; x += 260) g.fillRect(x, y, 1.5, plank);
    }
    g.fillStyle = streaks(g, dpr, "rgba(40,20,5,0.3)", 90, [30, 90], [0.6, 1.6], 41, 200, 0.01);
    g.fillRect(0, 0, w, h);
  });
}

/** Which one-degree cells hold a place or touch one, so no tree stands near a place. */
function nearPlaces(f: SurfaceFrame, cache: TrainsetCache): Set<number> {
  const size = f.anchors?.size ?? 0;
  if (cache.near && cache.near.size === size) return cache.near.cells;
  const cells = new Set<number>();
  for (const [lon, lat] of f.anchors?.values() ?? []) {
    const i0 = Math.floor(lon), j0 = Math.floor(lat);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) cells.add(cellKey(((i0 + di + 540) % 360) - 180, j0 + dj));
  }
  cache.near = { size, cells };
  return cells;
}

/** Which one-degree cells are model sand (the relief layer's dunes), so no tree grows in a desert. */
function sandCells(f: SurfaceFrame, cache: TrainsetCache): Set<number> {
  if (!f.relief) return new Set();
  if (cache.sand?.relief === f.relief) return cache.sand.cells;
  const cells = new Set<number>();
  for (const [lon, lat] of f.relief.dunes) {
    const i0 = Math.floor(lon), j0 = Math.floor(lat);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) cells.add(cellKey(((i0 + di + 540) % 360) - 180, j0 + dj));
  }
  cache.sand = { relief: f.relief, cells };
  return cells;
}

interface Standing {
  x: number;
  y: number;
  z: number;
  k: number;
  kind: "pine" | "round" | "hill";
  v: number;
}

/** Plaster mountains where the relief layer has peaks, and model trees on a grid tied to the world. */
function standingThings(f: SurfaceFrame, cache: TrainsetCache): Standing[] {
  const out: Standing[] = [];
  const pxDeg = pxPerDeg(f.proj);
  const screenK = clamp(Math.min(f.w, f.h) / 720, 0.6, 1);
  const z = clamp(0.8 + f.zoom * 0.22, 1, 2.8) * screenK;
  const onScreen = (x: number, y: number, m: number) => x > -m && x < f.w + m && y > -m && y < f.h + m * 2;
  const far = f.cam ? f.cam.far * 1.05 : 0;
  // Mountains, thinned to one per patch of screen.
  const taken = new Set<number>();
  const cell = 34 * z;
  for (const [lon, lat] of f.relief?.peaks ?? []) {
    const at = standAt(f, lon, lat);
    if (!at || at.s < far || !onScreen(at.x, at.y, 40)) continue;
    const key = Math.floor(at.x / cell) * 4096 + Math.floor(at.y / (cell * 0.6));
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ x: at.x, y: at.y, z: z * at.s, k: at.k, kind: "hill", v: hash2(Math.round(lon * 10), Math.round(lat * 10)) });
  }
  // Trees on a grid of longitude and latitude that halves as you zoom in, so zooming in adds trees without
  // moving the ones already there. Never on ice, never within a degree of a place.
  const near = nearPlaces(f, cache);
  const sand = sandCells(f, cache);
  const steps = [4, 2, 1, 0.5, 0.25];
  const step = steps.find((s) => s * pxDeg <= 34) ?? 0.25;
  const [lon0, lat0] = [f.lon, f.lat];
  let latMin = lat0 - 60, latMax = lat0 + 60, halfLon = 180;
  if (f.cam) {
    latMax = lat0 - vAtScale(f, f.cam.far) / pxDeg + step;
    latMin = lat0 - vAtScreen(f, f.h / 2 + 30) / pxDeg - step;
    halfLon = Math.min(180, f.w / 2 / f.cam.far / pxDeg + step);
  } else if (f.mode === "3d") {
    const reach = 80;
    latMin = Math.max(-90, lat0 - reach);
    latMax = Math.min(90, lat0 + reach);
  }
  latMin = Math.max(latMin, -84);
  latMax = Math.min(latMax, 84);
  let count = 0;
  for (let j = Math.floor(latMin / step); j * step <= latMax && count < 1600; j++) {
    for (let i = Math.floor((lon0 - halfLon) / step); i * step <= lon0 + halfLon; i++) {
      const h1 = hash2(i * 7 + 3, j * 13 + 1);
      if (h1 > 0.5) continue;
      const lon = (i + 0.15 + 0.7 * hash2(i, j + 91)) * step;
      const lat = (j + 0.15 + 0.7 * hash2(i + 57, j)) * step;
      const wl = ((((lon + 180) % 360) + 360) % 360) - 180;
      if (!f.isLand(wl, lat) || f.isIce(wl, lat)) continue;
      if (near.has(cellKey(Math.floor(wl), Math.floor(lat))) || sand.has(cellKey(Math.floor(wl), Math.floor(lat)))) continue;
      const at = standAt(f, wl, lat);
      if (!at || at.s < far || !onScreen(at.x, at.y, 20)) continue;
      out.push({ x: at.x, y: at.y, z: z * 3 * at.s, k: at.k, kind: Math.abs(lat) > 45 || h1 < 0.18 ? "pine" : "round", v: h1 });
      count++;
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

function drawStanding(g: CanvasRenderingContext2D, list: Standing[]) {
  g.lineJoin = "round";
  for (const t of list) {
    const { x, y, z } = t;
    const k = Math.max(0.35, t.k);
    if (t.kind === "hill") {
      const bw = (9 + t.v * 5) * z, hh = (16 + t.v * 12) * z * k;
      g.fillStyle = "rgba(10,40,20,0.25)";
      g.beginPath();
      g.ellipse(x + bw * 0.35, y + 1, bw * 1.1, bw * 0.35, 0, 0, Math.PI * 2);
      g.fill();
      const body = new Path2D(`M${x - bw} ${y}C${x - bw * 0.62} ${y - hh * 0.55} ${x - bw * 0.3} ${y - hh} ${x} ${y - hh}C${x + bw * 0.3} ${y - hh} ${x + bw * 0.62} ${y - hh * 0.55} ${x + bw} ${y}Q${x} ${y + bw * 0.25} ${x - bw} ${y}Z`);
      g.fillStyle = "#9a826a";
      g.fill(body);
      g.save();
      g.clip(body);
      g.fillStyle = "#6f5a47";
      g.fillRect(x + bw * 0.05, y - hh - 2, bw * 1.2, hh + bw);
      // Painted snow on the top, running down in drips.
      g.fillStyle = "#fbfbf7";
      g.beginPath();
      g.moveTo(x - bw, y - hh * 0.6);
      g.quadraticCurveTo(x - bw * 0.45, y - hh * 0.5, x - bw * 0.3, y - hh * 0.62);
      g.quadraticCurveTo(x - bw * 0.15, y - hh * 0.45, x, y - hh * 0.6);
      g.quadraticCurveTo(x + bw * 0.2, y - hh * 0.48, x + bw * 0.35, y - hh * 0.64);
      g.quadraticCurveTo(x + bw * 0.55, y - hh * 0.55, x + bw, y - hh * 0.62);
      g.lineTo(x + bw, y - hh - 4);
      g.lineTo(x - bw, y - hh - 4);
      g.closePath();
      if (t.v > 0.25) g.fill();
      g.restore();
      g.lineWidth = 0.9;
      g.strokeStyle = "#3e2e20";
      g.stroke(body);
      continue;
    }
    // Trunk.
    g.fillStyle = "#6b4426";
    g.fillRect(x - 0.13 * z, y - 0.55 * z * k * 2, 0.26 * z, 0.55 * z * k * 2);
    g.fillStyle = "rgba(10,40,20,0.3)";
    g.beginPath();
    g.ellipse(x + 0.5 * z, y + 0.1 * z, 0.9 * z, 0.3 * z, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 0.7;
    g.strokeStyle = "#1f3f1c";
    if (t.kind === "pine") {
      const layer = (w: number, y0: number, y1: number, col: string) => {
        g.beginPath();
        g.moveTo(x - w * z, y - y0 * z * k);
        g.lineTo(x, y - y1 * z * k);
        g.lineTo(x + w * z, y - y0 * z * k);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.stroke();
      };
      layer(1.05, 0.9, 3.2, "#2e6a36");
      layer(0.8, 2.0, 4.0, "#3a7d42");
    } else {
      g.beginPath();
      g.ellipse(x, y - 2.3 * z * k, 1.05 * z, 1.15 * z * Math.max(0.6, k), 0, 0, Math.PI * 2);
      g.fillStyle = t.v < 0.3 ? "#5aa23f" : "#4c9437";
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(x - 0.35 * z, y - 2.6 * z * k, 0.45 * z, 0.4 * z, 0, 0, Math.PI * 2);
      g.fillStyle = "#8ccb5e";
      g.fill();
    }
  }
}

/** The felt world: painted sea, a sand beach, green felt on a plaster base, sand and snow, mountains and trees. */
function drawWorld(f: SurfaceFrame, g: CanvasRenderingContext2D, cache: TrainsetCache, clip: Path2D | null) {
  const { land, coast, ice } = landPaths(f, f.map);
  g.save();
  if (clip) g.clip(clip);
  // Brush marks in the painted sea, and a glossy band where it meets the beach.
  g.fillStyle = streaks(g, f.dpr, "rgba(255,255,255,0.16)", 46, [14, 44], [1.5, 3.5], 53, 180);
  g.fillRect(0, 0, f.w, f.h);
  g.fillStyle = streaks(g, f.dpr, "rgba(20,60,110,0.14)", 40, [12, 40], [1.5, 3], 59, 170);
  g.fillRect(0, 0, f.w, f.h);
  g.lineJoin = "round";
  g.lineCap = "round";
  const soft = wideCoast(f, coast);
  g.lineWidth = 20;
  g.strokeStyle = "rgba(140,205,235,0.55)";
  g.stroke(soft);
  g.lineWidth = 9;
  g.strokeStyle = "rgba(220,244,252,0.7)";
  g.stroke(soft);
  const T = f.cam ? 3 + 5 * f.cam.sin : 4;
  g.lineWidth = 6;
  g.strokeStyle = "#e6d3a0";
  g.save();
  g.translate(0, T);
  g.stroke(coast);
  g.restore();
  // The plaster base's edge, then the felt on top.
  g.save();
  g.translate(0, T);
  g.fillStyle = "#b39472";
  g.fill(land);
  g.restore();
  g.fillStyle = f.theme.land;
  g.fill(land);
  g.save();
  g.clip(land);
  g.fillStyle = speckle(g, f.dpr, "rgba(160,215,110,0.55)", 700, [0.6, 2.2], 61, 110);
  g.fillRect(0, 0, f.w, f.h);
  g.fillStyle = speckle(g, f.dpr, "rgba(30,80,25,0.45)", 500, [0.6, 2], 67, 100);
  g.fillRect(0, 0, f.w, f.h);
  g.fillStyle = speckle(g, f.dpr, "rgba(240,220,120,0.6)", 90, [0.8, 1.6], 71, 90);
  g.fillRect(0, 0, f.w, f.h);
  // Model sand where the relief layer has dunes, and white felt on the ice.
  const dunes = f.relief?.dunes;
  if (dunes) {
    const pxDeg = pxPerDeg(f.proj);
    const sand = new Path2D();
    for (const [lon, lat] of dunes) {
      const at = standAt(f, lon, lat);
      if (!at) continue;
      const rr = clamp(1.4 * pxDeg * at.s, 2, 70);
      if (at.x < -rr || at.x > f.w + rr || at.y < -rr || at.y > f.h + rr) continue;
      sand.moveTo(at.x + rr, at.y);
      sand.ellipse(at.x, at.y, rr, rr * (f.cam ? Math.max(0.4, f.cam.cos) : 1), 0, 0, Math.PI * 2);
    }
    g.fillStyle = "#e3c883";
    g.fill(sand);
    g.fillStyle = speckle(g, f.dpr, "rgba(150,110,50,0.4)", 300, [0.6, 1.4], 73, 90);
    g.fill(sand);
  }
  if (ice) {
    g.fillStyle = f.theme.ice;
    g.fill(ice);
    g.fillStyle = speckle(g, f.dpr, "rgba(150,170,190,0.4)", 300, [0.6, 1.6], 79, 90);
    g.fill(ice);
  }
  g.restore();
  g.lineWidth = 0.9;
  g.strokeStyle = "rgba(40,60,25,0.6)";
  g.stroke(land);
  g.restore();
  drawStanding(g, standingThings(f, cache));
}

// ---- Map view ------------------------------------------------------------------------------------------------

function flatPlane(f: SurfaceFrame): Plane {
  return { at: (x, y, lift) => f.tp(x, y, lift) };
}

function flatOval(f: SurfaceFrame, spot: SeaSpot): OvalAt {
  return (t) => {
    const lat = spot.lat + OVAL_B * spot.r * Math.sin(t);
    const lon = spot.lon + (OVAL_A * spot.r * Math.cos(t)) / Math.cos(lat * RAD);
    const p = f.proj([lon, lat]);
    return p ? [p[0], p[1]] : null;
  };
}

/** The tracks in view, with their size on screen. */
function tracksInView(f: SurfaceFrame): { spot: SeaSpot; scale: number }[] {
  const pxDeg = pxPerDeg(f.proj);
  const out: { spot: SeaSpot; scale: number }[] = [];
  for (const spot of TRACKS) {
    const at = standAt(f, spot.lon, spot.lat);
    if (!at) continue;
    if (f.cam && at.s < f.cam.far * 1.15) continue;
    const reach = spot.r * pxDeg * at.s;
    if (at.x < -reach || at.x > f.w + reach || at.y < -reach || at.y > f.h + reach) continue;
    out.push({ spot, scale: 0.07 * spot.r * pxDeg });
  }
  return out;
}

function drawBoard(f: SurfaceFrame, g: CanvasRenderingContext2D, cache: TrainsetCache) {
  const { w, h } = f;
  g.drawImage(floor(f, cache), 0, 0, w, h);
  const cam = f.cam!;
  // The board: the world between the poles, with a wooden edge and the table's front face below its near edge.
  const yN = f.proj([f.lon, 90])![1];
  const yS = f.proj([f.lon, -90])![1];
  const top = Math.max(yN, cam.cy + vAtScale(f, cam.far));
  const reach = w / 2 / cam.far + 60;
  const corner = (x: number, y: number) => f.tp(x, y, 0);
  const board = new Path2D();
  const quad = (y0: number, y1: number, into: Path2D, lift0 = 0, lift1 = 0) => {
    const a = f.tp(cam.cx - reach, y0, lift0), b = f.tp(cam.cx + reach, y0, lift0), c = f.tp(cam.cx + reach, y1, lift1), d = f.tp(cam.cx - reach, y1, lift1);
    into.moveTo(a[0], a[1]);
    into.lineTo(b[0], b[1]);
    into.lineTo(c[0], c[1]);
    into.lineTo(d[0], d[1]);
    into.closePath();
  };
  quad(top, yS, board);
  const rim = 14;
  // The table's near face, below the board's front edge.
  const face = new Path2D();
  const s0 = corner(cam.cx, yS + rim)[2];
  const [fa, fb] = [f.tp(cam.cx - reach, yS + rim, 0), f.tp(cam.cx + reach, yS + rim, 0)];
  face.moveTo(fa[0], fa[1]);
  face.lineTo(fb[0], fb[1]);
  face.lineTo(fb[0], fb[1] + 26 * s0);
  face.lineTo(fa[0], fa[1] + 26 * s0);
  face.closePath();
  const faceInk = g.createLinearGradient(0, fa[1], 0, fa[1] + 26 * s0);
  faceInk.addColorStop(0, "#7a4a24");
  faceInk.addColorStop(1, "#5a3418");
  g.fillStyle = faceInk;
  g.fill(face);
  g.fillStyle = "rgba(30,15,5,0.35)";
  g.fillRect(0, fa[1] + 26 * s0, w, 10 * s0);
  const wood = new Path2D();
  if (yN >= top - 1) quad(yN - rim, yN, wood);
  quad(yS, yS + rim, wood);
  g.fillStyle = "#c08f5c";
  g.fill(wood);
  g.save();
  g.clip(wood);
  g.fillStyle = streaks(g, f.dpr, "rgba(90,50,20,0.35)", 70, [20, 70], [0.6, 1.4], 83, 160, 0.02);
  g.fillRect(0, 0, w, h);
  g.restore();
  g.fillStyle = f.theme.ocean;
  g.fill(board);
  g.save();
  g.clip(board);
  // The sea is painted a little deeper away from the light, toward the far side of the board.
  const depth = g.createLinearGradient(0, 0, 0, h);
  depth.addColorStop(0, "rgba(20,60,110,0.22)");
  depth.addColorStop(1, "rgba(255,255,255,0.08)");
  g.fillStyle = depth;
  g.fillRect(0, 0, w, h);
  g.restore();
  drawWorld(f, g, cache, board);
  const plane = flatPlane(f);
  for (const { spot, scale } of tracksInView(f)) drawTrack(g, plane, flatOval(f, spot), scale);
}

// ---- Globe view: a globe on a stand on the table, a train running round the stand -------------------------

function tableFrame(f: SurfaceFrame) {
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  const base = cy + R * 1.12;
  return { R, cx, cy, base, rx: R * 1.08, rz: R * 0.9, squash: 0.28 };
}

function drawTable(f: SurfaceFrame, cache: TrainsetCache) {
  const { w, h, dpr } = f;
  const t = tableFrame(f);
  const key = `${w}:${h}:${dpr}:${Math.round(t.cx)}:${Math.round(t.cy)}:${Math.round(t.R)}`;
  return once(cache.back, key, w, h, dpr, (g) => {
    // A wall above, the tabletop below, meeting behind the globe.
    const horizon = t.cy + t.R * 0.35;
    const wall = g.createLinearGradient(0, 0, 0, horizon);
    wall.addColorStop(0, "#e9dcc0");
    wall.addColorStop(1, "#f4ead3");
    g.fillStyle = wall;
    g.fillRect(0, 0, w, horizon);
    for (let x = 0; x < w; x += 44) {
      g.fillStyle = "rgba(170,60,50,0.1)";
      g.fillRect(x, 0, 14, horizon);
    }
    const top = g.createLinearGradient(0, horizon, 0, h);
    top.addColorStop(0, "#a06a3a");
    top.addColorStop(1, "#c8925a");
    g.fillStyle = top;
    g.fillRect(0, horizon, w, h - horizon);
    g.fillStyle = streaks(g, dpr, "rgba(70,35,10,0.3)", 90, [30, 100], [0.6, 1.8], 89, 220, 0.01);
    g.fillRect(0, horizon, w, h - horizon);
    g.fillStyle = "rgba(60,30,10,0.4)";
    g.fillRect(0, horizon - 1, w, 3);
    // The stand's round wooden foot and its shadow.
    g.fillStyle = "rgba(40,20,5,0.35)";
    g.beginPath();
    g.ellipse(t.cx + t.R * 0.1, t.base + t.R * 0.04, t.R * 0.62, t.R * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    const foot = g.createLinearGradient(t.cx - t.R * 0.5, 0, t.cx + t.R * 0.5, 0);
    foot.addColorStop(0, "#8a5530");
    foot.addColorStop(0.4, "#c28a52");
    foot.addColorStop(1, "#6f4222");
    g.fillStyle = foot;
    g.beginPath();
    g.ellipse(t.cx, t.base, t.R * 0.5, t.R * 0.13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(t.cx - t.R * 0.5, t.base - t.R * 0.07, t.R, t.R * 0.07);
    g.beginPath();
    g.ellipse(t.cx, t.base - t.R * 0.07, t.R * 0.5, t.R * 0.13, 0, 0, Math.PI * 2);
    g.fillStyle = "#d39a60";
    g.fill();
    // The post, and the brass half ring that holds the globe at its poles, tipped like a desk globe's axis.
    g.fillStyle = "#7a4a26";
    g.fillRect(t.cx - t.R * 0.05, t.cy + t.R * 0.9, t.R * 0.1, t.base - t.cy - t.R * 0.95);
    g.save();
    g.translate(t.cx, t.cy);
    g.rotate(0.41);
    const brass = g.createLinearGradient(-t.R, 0, t.R, 0);
    brass.addColorStop(0, "#fbe7a1");
    brass.addColorStop(0.5, "#c9a03e");
    brass.addColorStop(1, "#7a5a18");
    g.strokeStyle = brass;
    g.lineWidth = Math.max(4, t.R * 0.045);
    g.beginPath();
    g.arc(0, 0, t.R * 1.07, Math.PI * 0.5, Math.PI * 1.5);
    g.stroke();
    g.restore();
  });
}

function tablePlane(f: SurfaceFrame): Plane {
  const t = tableFrame(f);
  return { at: (x, y, lift) => [t.cx + x, t.base + y * t.squash - lift, 1] };
}

function tableOval(f: SurfaceFrame): OvalAt {
  const t = tableFrame(f);
  return (a) => [t.rx * Math.cos(a), t.rz * Math.sin(a)];
}

function drawTableGlobe(f: SurfaceFrame, cache: TrainsetCache): boolean {
  const g = f.ctx;
  const t = tableFrame(f);
  g.drawImage(drawTable(f, cache), 0, 0, f.w, f.h);
  const plane = tablePlane(f);
  const oval = tableOval(f);
  const scale = t.R * 0.06;
  const trackVisible = t.base - t.rz * t.squash < f.h + 20;
  if (trackVisible) drawTrack(g, plane, oval, scale);
  const front = trainFront(f, 1);
  // The far half of the train passes behind the stand and the globe; the near half in front of them.
  const behind = (y: number) => y < t.base;
  if (trackVisible) drawTrain(g, plane, oval, front, scale, behind);
  stillLayer(f, cache.globe, `${f.anchors?.size ?? 0}`, (gg) => {
    const ball = new Path2D();
    ball.arc(t.cx, t.cy, t.R, 0, Math.PI * 2);
    gg.fillStyle = f.theme.ocean;
    gg.fill(ball);
    gg.save();
    gg.clip(ball);
    drawWorld(f, gg, cache, ball);
    const lit = gg.createRadialGradient(t.cx - t.R * 0.4, t.cy - t.R * 0.45, t.R * 0.1, t.cx, t.cy, t.R * 1.02);
    lit.addColorStop(0, "rgba(255,255,255,0.2)");
    lit.addColorStop(0.55, "rgba(255,255,255,0)");
    lit.addColorStop(1, "rgba(10,30,60,0.35)");
    gg.fillStyle = lit;
    gg.fill(ball);
    gg.restore();
    gg.lineWidth = 1.5;
    gg.strokeStyle = "#3a2a1c";
    gg.stroke(ball);
  });
  if (trackVisible) drawTrain(g, plane, oval, front, scale, (y) => !behind(y));
  return trackVisible;
}

/** Where the front of a train is on its oval now, in radians; each track starts its train somewhere else. */
function trainFront(f: SurfaceFrame, seed: number): number {
  const secs = (f.time ?? 0) / 1000;
  return seed * 2.1 + (secs / LAP) * Math.PI * 2;
}

export function drawTrainset(f: SurfaceFrame, cache: TrainsetCache): number | void {
  if (f.mode === "3d" || !f.cam) {
    const moving = drawTableGlobe(f, cache);
    return moving && !f.still ? 66 : undefined;
  }
  stillLayer(f, cache.still, `${f.anchors?.size ?? 0}`, (g) => drawBoard(f, g, cache));
  const plane = flatPlane(f);
  const tracks = tracksInView(f);
  for (const { spot, scale } of tracks) drawTrain(f.ctx, plane, flatOval(f, spot), trainFront(f, TRACKS.indexOf(spot)), scale);
  return tracks.length && !f.still ? 66 : undefined;
}
