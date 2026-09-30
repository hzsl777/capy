import type { GeoProjection, GeoStream } from "d3-geo";

/**
 * Decision 71: three designs that see the world through their own camera, with light that moves.
 *
 * - Nightclub: the globe is a mirror ball of square facets under sweeping spotlights; the map is a light-up dance
 *   floor seen from a tilted camera, with lasers fanning up from the horizon.
 * - Poolside: the map lies on a swimming pool's floor under rippling light; the globe floats on the water at night.
 * - Snow Globe: the globe stands in a glass snow globe on a wooden base; the map is seen through curved glass.
 *
 * This file holds the parts that need no MapView state: geometry, textures and the snow. MapView (view.ts) draws the
 * map itself once into an off-screen canvas and repaints only these extras while the light moves.
 *
 * Safety: nothing here flashes. Every light moves or changes colour over seconds, never faster than once a second
 * anywhere, and brightness never jumps over a large area (WCAG 2.3.1).
 */

export type RGB = [number, number, number];
const DEG = 180 / Math.PI;

export const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A fixed pseudo-random number in [0, 1) for a grid cell, the same on every frame. */
export function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const hexRGB = (hex: string): RGB => {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB, alpha = 1) =>
  alpha >= 1 ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
const smooth = (t: number) => t * t * (3 - 2 * t);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A screen-space camera applied after the map projection: each point goes through `f`. */
export type Warp = (x: number, y: number) => [number, number, number];

/**
 * A projection whose output passes through a warp, for streams (coasts, arcs) and for single points alike, so a
 * lens bends the land and places the dots the same way.
 */
export function warped(proj: GeoProjection, f: Warp): GeoProjection {
  const p = ((c: [number, number]) => {
    const q = proj(c);
    if (!q) return null;
    const r = f(q[0], q[1]);
    return [r[0], r[1]];
  }) as unknown as GeoProjection & { stream(out: GeoStream): GeoStream };
  p.stream = (out: GeoStream) =>
    proj.stream({
      point: (x, y) => {
        const q = f(x, y);
        out.point(q[0], q[1]);
      },
      lineStart: () => out.lineStart(),
      lineEnd: () => out.lineEnd(),
      polygonStart: () => out.polygonStart(),
      polygonEnd: () => out.polygonEnd(),
      sphere: () => out.sphere?.(),
    });
  p.scale = (() => proj.scale()) as GeoProjection["scale"];
  p.translate = (() => proj.translate()) as GeoProjection["translate"];
  return p;
}

// ---- Snow Globe's lens -------------------------------------------------------------------------------------

/**
 * Curved glass over the flat map: an oval window as wide as the frame, with frost in the corners outside it.
 * Inside, the picture is enlarged `1 + a` times at the centre and squeezed toward the rim, like a fisheye.
 */
export interface Lens {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  a: number;
}
export const lensOf = (w: number, h: number): Lens => ({ cx: w / 2, cy: h / 2, rx: w * 0.5, ry: h * 0.55, a: 0.75 });

/** Flat map point to the point seen through the glass. Grows steadily with distance, so nothing folds over. */
export function lensPoint(L: Lens, x: number, y: number): [number, number, number] {
  const dx = x - L.cx, dy = y - L.cy;
  const r = Math.hypot(dx / L.rx, dy / L.ry);
  const g = (1 + L.a) / (1 + L.a * r);
  return [L.cx + dx * g, L.cy + dy * g, g];
}

/** The inverse: the flat map point behind a point on the glass. */
export function lensInverse(L: Lens, x: number, y: number): [number, number] {
  const dx = x - L.cx, dy = y - L.cy;
  const rp = Math.min(Math.hypot(dx / L.rx, dy / L.ry), (1 + L.a) / L.a - 1e-3);
  // Seen radius r' = r (1 + a) / (1 + a r), so r = r' / (1 + a - a r'), and the flat offset is the seen one times r / r'.
  const k = 1 / (1 + L.a - L.a * rp);
  return [L.cx + dx * k, L.cy + dy * k];
}

// ---- Nightclub's mirror ball ---------------------------------------------------------------------------------

export interface Ball {
  /** SVG path text per fill colour: every facet visible, shaded by the room's key light. */
  fills: Map<string, string[]>;
  /** The lit left and top edge of every facet, as path text: the bevel that makes each one read as a mirror. */
  edges: string;
  /** Per visible facet: its four corners on screen, its normal toward the viewer, and a fixed sparkle 0 to 1. */
  quads: Float32Array;
  normals: Float32Array;
  sparkle: Float32Array;
  count: number;
}

const unit = (lon: number, lat: number): [number, number, number] => {
  const l = lon / DEG, p = lat / DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

/**
 * The globe as a mirror ball: rows of square facets fixed to the world (a facet is land when its centre is, or when
 * it holds a place), each a flat mirror shaded by a fixed key light with a fixed per-facet sparkle.
 */
export function buildBall(o: {
  proj: GeoProjection;
  lon: number;
  lat: number;
  w: number;
  h: number;
  step: number;
  isLand: (lon: number, lat: number) => boolean;
  /** Every place ever shown: the facet holding one is always land, so no island with news turns to sea. */
  anchors: [number, number][];
  land: [RGB, RGB];
  sea: [RGB, RGB];
}): Ball {
  const { proj, step } = o;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const view = unit(o.lon, o.lat);
  const rowsOf = (j: number) => {
    const n = Math.max(4, Math.round((360 * Math.cos((-90 + (j + 0.5) * step) / DEG)) / step));
    return { n, dl: 360 / n, off: (j % 2) * (360 / n) * 0.5 };
  };
  const anchored = new Set<string>();
  for (const [lon, lat] of o.anchors) {
    const j = Math.min(Math.round(180 / step) - 1, Math.max(0, Math.floor((lat + 90) / step)));
    const { n, dl, off } = rowsOf(j);
    anchored.add(`${j},${(((Math.floor((lon + 180 - off) / dl)) % n) + n) % n}`);
  }
  // The part of the sphere that can be on screen: the facing half, narrowed to the frame when zoomed in.
  const reach = Math.hypot(o.w, o.h) / 2 / R;
  const cosReach = reach >= 1 ? 0.02 : Math.max(0.02, Math.cos(Math.asin(reach)) - 0.02);
  const fills = new Map<string, string[]>();
  const edges: string[] = [];
  const quads: number[] = [];
  const normals: number[] = [];
  const sparkle: number[] = [];
  const L = [-0.42, -0.55, 0.72];
  const Ln = Math.hypot(L[0], L[1], L[2]);
  const rows = Math.round(180 / step);
  const shrink = 0.83;
  for (let j = 0; j < rows; j++) {
    const la0 = -90 + j * step, la1 = la0 + step, lam = (la0 + la1) / 2;
    const { n, dl, off } = rowsOf(j);
    for (let k = 0; k < n; k++) {
      const lo0 = -180 + off + k * dl, lo1 = lo0 + dl, lom = lo0 + dl / 2;
      const u = unit(lom, lam);
      const c = u[0] * view[0] + u[1] * view[1] + u[2] * view[2];
      if (c < cosReach) continue;
      const pts = [proj([lo0, la0]), proj([lo1, la0]), proj([lo1, la1]), proj([lo0, la1])];
      const m = proj([lom, lam]);
      if (!m || pts.some((p) => !p)) continue;
      const [mx, my] = m;
      if (mx < -60 || my < -60 || mx > o.w + 60 || my > o.h + 60) continue;
      const q = pts.map((p) => [mx + (p![0] - mx) * shrink, my + (p![1] - my) * shrink]);
      const lonW = ((((lom + 180) % 360) + 360) % 360) - 180;
      const land = o.isLand(lonW, lam) || anchored.has(`${j},${k}`);
      const nx = (mx - cx) / R, ny = (my - cy) / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const diffuse = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / Ln);
      const s = hash2(j * 7919 + 13, k * 104729 + 7);
      // Each mirror catches a different part of the room, so neighbours differ a little.
      const b = Math.max(0, Math.min(1, 0.2 + 0.62 * diffuse + 0.22 * (s - 0.5) + 0.12 * nz));
      const level = Math.round(b * 10);
      const [lo, hi] = land ? o.land : o.sea;
      const col = css(mix(lo, hi, level / 10));
      const text = `M${r1(q[0][0])} ${r1(q[0][1])}L${r1(q[1][0])} ${r1(q[1][1])}L${r1(q[2][0])} ${r1(q[2][1])}L${r1(q[3][0])} ${r1(q[3][1])}Z`;
      const list = fills.get(col);
      if (list) list.push(text);
      else fills.set(col, [text]);
      for (const p of q) quads.push(p[0], p[1]);
      edges.push(`M${r1(q[0][0])} ${r1(q[0][1])}L${r1(q[3][0])} ${r1(q[3][1])}L${r1(q[2][0])} ${r1(q[2][1])}`);
      normals.push(nx, ny, nz);
      sparkle.push(s);
    }
  }
  return { fills, edges: edges.join(""), quads: new Float32Array(quads), normals: new Float32Array(normals), sparkle: new Float32Array(sparkle), count: sparkle.length };
}

/**
 * Where the moving lights catch the ball: soft spots of facets that drift across it. Each facet brightens and
 * fades over about a second as a spot passes, never faster. Returns path text per light and brightness step.
 */
export function ballGlints(ball: Ball, t: number, lights: readonly RGB[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const spots = lights.map((_, i) => {
    const a = t * (0.1 + i * 0.025) + i * 2.1;
    const b = t * (0.07 + i * 0.015) + i * 1.3;
    const sx = Math.sin(a) * 0.72, sy = Math.sin(b) * 0.5 - 0.1;
    return [sx, sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy))];
  });
  const { quads: Q, normals: N, sparkle: S } = ball;
  for (let i = 0; i < ball.count; i++) {
    const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2];
    for (let l = 0; l < spots.length; l++) {
      const sp = spots[l];
      const d = nx * sp[0] + ny * sp[1] + nz * sp[2];
      if (d < 0.965) continue;
      const k = smooth(Math.min(1, (d - 0.965) / 0.03)) * (0.35 + 0.65 * S[i]);
      const level = Math.round(k * 4);
      if (!level) continue;
      const key = `${l}:${level}`;
      const o = 8 * i;
      const text = `M${r1(Q[o])} ${r1(Q[o + 1])}L${r1(Q[o + 2])} ${r1(Q[o + 3])}L${r1(Q[o + 4])} ${r1(Q[o + 5])}L${r1(Q[o + 6])} ${r1(Q[o + 7])}Z`;
      const list = out.get(key);
      if (list) list.push(text);
      else out.set(key, [text]);
    }
  }
  return out;
}

// ---- Nightclub's dance floor ---------------------------------------------------------------------------------

/** Neon colours the floor's land tiles move through. No yellow or amber: that colour means a fresh report. */
export const FLOOR_COLORS: readonly RGB[] = ["#ff2bd6", "#a347ff", "#3f6dff", "#12d8ff", "#1dffa8", "#ff4f86"].map(hexRGB);
export const FLOOR_CLASSES = FLOOR_COLORS.length;
export const FLOOR_LEVELS = 4;

export interface Floor {
  /** Sea tiles, path text per colour, drawn once into the still picture. */
  sea: Map<string, string[]>;
  /** Land tiles by colour class and haze level: the tile, and its lit centre. Recoloured every frame. */
  land: { outer: Path2D; inner: Path2D; cls: number; level: number }[];
}

/**
 * The flat map as a floor of square tiles under a tilted camera: a tile is land when most of it is, or when it
 * holds a place. Tiles past the draw distance are left to the haze.
 */
export function buildFloor(o: {
  proj: GeoProjection;
  tp: (x: number, y: number) => [number, number, number];
  lon: number;
  lat: number;
  w: number;
  h: number;
  step: number;
  cutoff: number;
  isLand: (lon: number, lat: number) => boolean;
  /** Every place ever shown: the tile holding one is always land. */
  anchors: [number, number][];
  sea: [RGB, RGB];
  fog: RGB;
}): Floor {
  const { proj, step, w, h } = o;
  const anchored = new Set(o.anchors.map(([lon, lat]) => `${Math.floor((lon + 180) / step)},${Math.floor((lat + 90) / step)}`));
  const R = proj.scale();
  const degPerPx = DEG / R;
  const halfW = (w / 2) * degPerPx * 2.2 + step * 2;
  const halfH = (h / 2) * degPerPx;
  const north = Math.min(90, o.lat + halfH * 4 + step * 2);
  const south = Math.max(-90, o.lat - halfH * 1.4 - step * 2);
  const sea = new Map<string, string[]>();
  const landText = new Map<number, { outer: string[]; inner: string[] }>();
  const iy0 = Math.floor((south + 90) / step), iy1 = Math.ceil((north + 90) / step);
  const cols = Math.round(360 / step);
  const ixc = Math.floor((o.lon + 180) / step);
  const span = Math.ceil(halfW / step);
  const add = (map: Map<string, string[]>, key: string, text: string) => {
    const l = map.get(key);
    if (l) l.push(text);
    else map.set(key, [text]);
  };
  for (let iy = iy0; iy < iy1; iy++) {
    const la0 = -90 + iy * step, la1 = la0 + step;
    if (la0 < -90 || la1 > 90) continue;
    for (let d = -span; d <= span; d++) {
      const ix = (((ixc + d) % cols) + cols) % cols;
      const lo0 = -180 + ix * step, lo1 = lo0 + step;
      const corners = [proj([lo0, la0]), proj([lo1, la0]), proj([lo1, la1]), proj([lo0, la1])];
      if (corners.some((p) => !p)) continue;
      const q = corners.map((p) => o.tp(p![0], p![1]));
      const minS = Math.min(q[0][2], q[1][2], q[2][2], q[3][2]);
      if (minS < o.cutoff) continue;
      const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      if (maxX - minX > w / 3 || maxX < -40 || minX > w + 40) continue;
      if (Math.min(...ys) > h + 40 || Math.max(...ys) < -40) continue;
      const mx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4, my = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
      const quad = (k: number) => `M${q.map((p) => `${r1(mx + (p[0] - mx) * k)} ${r1(my + (p[1] - my) * k)}`).join("L")}Z`;
      const sc = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
      const haze = Math.max(0, Math.min(1, (0.98 - sc) / (0.98 - o.cutoff)));
      const level = Math.min(FLOOR_LEVELS - 1, Math.floor(haze * FLOOR_LEVELS));
      const lm = lo0 + step / 2, am = la0 + step / 2, e = step * 0.3;
      let votes = 0;
      for (const [a, b] of [[lm, am], [lm - e, am - e], [lm + e, am - e], [lm + e, am + e], [lm - e, am + e]]) if (o.isLand(a, b)) votes++;
      const land = votes >= 2 || anchored.has(`${ix},${iy}`);
      if (land) {
        const cls = Math.floor(hash2(ix, iy) * FLOOR_CLASSES);
        const k = cls * FLOOR_LEVELS + level;
        let t = landText.get(k);
        if (!t) landText.set(k, (t = { outer: [], inner: [] }));
        t.outer.push(quad(0.9));
        t.inner.push(quad(0.45));
      } else {
        // A dark glossy checkerboard, fading into the haze with distance.
        const base = (ix + iy) % 2 ? o.sea[0] : o.sea[1];
        add(sea, css(mix(base, o.fog, haze * 0.85)), quad(0.9));
      }
    }
  }
  const land: Floor["land"] = [];
  for (const [k, t] of landText) land.push({ outer: new Path2D(t.outer.join("")), inner: new Path2D(t.inner.join("")), cls: Math.floor(k / FLOOR_LEVELS), level: k % FLOOR_LEVELS });
  return { sea, land };
}

/** A land tile's colour at time t: each class moves to the next colour over four seconds, gently eased. */
export function floorColor(cls: number, t: number): RGB {
  const u = t / 4 + cls * 1.7;
  const i = Math.floor(u);
  const n = FLOOR_COLORS.length;
  const a = FLOOR_COLORS[(((i + cls) % n) + n) % n], b = FLOOR_COLORS[(((i + cls + 1) % n) + n) % n];
  return mix(a, b, smooth(u - i));
}

// ---- Poolside's caustics -------------------------------------------------------------------------------------

/**
 * Light rippling on a pool floor: a loop of textures, each the bright seams between drifting cells (where a wavy
 * water surface focuses light). They tile without a seam and cycle over a few seconds.
 */
export function causticFrames(frames = 12, size = 160, seed = 5): HTMLCanvasElement[] {
  const rnd = rng(seed);
  const n = 18;
  const pts = Array.from({ length: n }, () => ({ x: rnd() * size, y: rnd() * size, r: 5 + rnd() * 9, ph: rnd() * Math.PI * 2, sp: rnd() < 0.5 ? 1 : -1 }));
  const out: HTMLCanvasElement[] = [];
  const k = (Math.PI * 2) / size;
  for (let f = 0; f < frames; f++) {
    const a = (f / frames) * Math.PI * 2;
    const P = pts.map((p) => [p.x + Math.cos(a * p.sp + p.ph) * p.r, p.y + Math.sin(a * p.sp + p.ph) * p.r]);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Bend the space the cells live in, with whole waves across the tile so it still wraps, so the seams
        // curve like light through moving water instead of running straight.
        const wx = x + 6 * Math.sin(k * 2 * y + a) + 3 * Math.sin(k * 3 * (x + y) - a);
        const wy = y + 6 * Math.sin(k * 2 * x - a) + 3 * Math.sin(k * 3 * (x - y) + a);
        let d1 = 1e9, d2 = 1e9;
        for (const [px, py] of P) {
          let dx = (((wx - px) % size) + size) % size, dy = (((wy - py) % size) + size) % size;
          if (dx > size / 2) dx = size - dx;
          if (dy > size / 2) dy = size - dy;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        const v = Math.pow(Math.max(0, 1 - edge / 5), 2.6);
        const i = (y * size + x) * 4;
        img.data[i] = 225;
        img.data[i + 1] = 252;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(v * 235);
      }
    }
    g.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}

// ---- Snow ------------------------------------------------------------------------------------------------------

/** Where snow comes to rest: a low mound in the dome, a drift along the bottom of the window. */
export function snowFloor(shape: "dome" | "box", x: number): number {
  if (shape === "dome") return 0.8 + 0.05 * x * x;
  return 0.88 - 0.03 * Math.sin(x * 3.1) - 0.02 * Math.sin(x * 7.3 + 1);
}

/**
 * Flakes that fall slowly and settle. Coordinates are in units of the space's half height, centred: inside a
 * circle of radius 1 (the snow globe's dome) or a box `aspect` wide (the window around the lensed map). A flake
 * that reaches the floor rests there until the next stir.
 */
export class Snow {
  readonly n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  size: Float32Array;
  rest: Uint8Array;
  private rnd: () => number;
  constructor(
    n: number,
    readonly shape: "dome" | "box",
    public aspect = 1,
  ) {
    this.n = n;
    this.rnd = rng(17);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.size = new Float32Array(n);
    this.rest = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.size[i] = 0.6 + this.rnd() * this.rnd() * 1.6;
      this.place(i);
    }
  }

  floor(x: number): number {
    return snowFloor(this.shape, x);
  }

  private inside(x: number, y: number): boolean {
    return this.shape === "dome" ? x * x + y * y < 0.94 : Math.abs(x) < this.aspect && Math.abs(y) < 1;
  }

  /** Scatter a flake through the air, drifting gently. */
  private place(i: number) {
    do {
      this.x[i] = (this.rnd() * 2 - 1) * (this.shape === "dome" ? 1 : this.aspect);
      this.y[i] = this.rnd() * 1.7 - 1;
    } while (!this.inside(this.x[i], this.y[i]) || this.y[i] > this.floor(this.x[i]));
    this.vx[i] = (this.rnd() - 0.5) * 0.08;
    this.vy[i] = this.rnd() * 0.05;
    this.rest[i] = 0;
  }

  /** Everything settled, for readers who ask for reduced motion: most on the floor, a few still in the air. */
  settle() {
    for (let i = 0; i < this.n; i++) {
      if (i % 4 === 0) continue;
      const x = this.shape === "dome" ? Math.max(-0.52, Math.min(0.52, this.x[i])) : this.x[i];
      this.x[i] = x;
      this.y[i] = this.floor(x) - 0.012 * this.rnd();
      this.rest[i] = 1;
    }
  }

  /** A drag of `amount` (0 to 1) along (dx, dy): flakes lift off the floor and swirl the way the drag went. */
  stir(amount: number, dx: number, dy: number) {
    const a = Math.min(1, amount);
    for (let i = 0; i < this.n; i++) {
      if (this.rest[i]) {
        if (this.rnd() > a * 0.9) continue;
        this.rest[i] = 0;
        this.vy[i] = -(0.3 + this.rnd() * 0.9) * a;
        this.vx[i] = (this.rnd() - 0.5) * 0.8 * a;
      } else {
        this.vx[i] += ((this.rnd() - 0.5) * 0.6 + dx * 0.4) * a;
        this.vy[i] += ((this.rnd() - 0.6) * 0.6 + dy * 0.4) * a;
      }
    }
  }

  /** Advance by dt seconds. Returns how many flakes are still moving. */
  step(dt: number, t: number): number {
    const drag = Math.exp(-1.7 * dt);
    let moving = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.rest[i]) continue;
      moving++;
      // Slow fall with a lazy sideways sway, so settling takes about fifteen seconds.
      this.vy[i] = this.vy[i] * drag + 0.21 * dt;
      this.vx[i] = this.vx[i] * drag + Math.sin(t * 0.9 + i * 1.7) * 0.05 * dt;
      let x = this.x[i] + this.vx[i] * dt;
      let y = this.y[i] + this.vy[i] * dt;
      if (this.shape === "dome") {
        // The glass keeps a flake's height and pushes it sideways only, so it slides down the curve to the floor.
        if (x * x + y * y > 0.9216) {
          if (Math.abs(y) < 0.96) x = Math.sign(x) * Math.sqrt(0.9216 - y * y);
          else {
            y = Math.sign(y) * 0.96;
            x = 0;
            this.vy[i] = 0;
          }
          this.vx[i] *= -0.3;
        }
      } else {
        if (Math.abs(x) > this.aspect) {
          x = Math.sign(x) * this.aspect;
          this.vx[i] *= -0.3;
        }
        if (y < -1) {
          y = -1;
          this.vy[i] = Math.abs(this.vy[i]) * 0.3;
        }
      }
      const f = this.floor(x);
      if (y >= f) {
        y = f - this.rnd() * 0.012;
        this.rest[i] = 1;
      }
      this.x[i] = x;
      this.y[i] = y;
    }
    return moving;
  }
}

// ---- Backgrounds ---------------------------------------------------------------------------------------------

/** A dark club room behind the mirror ball: a haze of violet light low down, and the dark above. */
export function drawClubRoom(g: CanvasRenderingContext2D, w: number, h: number, floorY: number | null) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#05020a");
  bg.addColorStop(0.55, "#0d0518");
  bg.addColorStop(1, "#1a0830");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const cy = floorY ?? h * 0.5;
  const haze = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.7);
  haze.addColorStop(0, floorY === null ? "rgba(120,40,190,0.35)" : "rgba(170,60,255,0.45)");
  haze.addColorStop(0.5, "rgba(80,20,140,0.14)");
  haze.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = haze;
  g.fillRect(0, 0, w, h);
}

/** Soft cones of coloured light sweeping slowly behind the ball, from below the frame. */
export function drawSpotlights(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cones = [
    { x: 0.12, base: 0.5, sp: 0.21, ph: 0, col: 0 },
    { x: 0.5, base: 0, sp: 0.15, ph: 2, col: 2 },
    { x: 0.88, base: -0.5, sp: 0.18, ph: 4, col: 4 },
  ];
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const c of cones) {
    const ang = c.base + Math.sin(t * c.sp + c.ph) * 0.38;
    const ox = c.x * w, oy = h + 30;
    const len = h * 1.5;
    const spread = 0.13;
    const ax = Math.sin(ang), ay = -Math.cos(ang);
    const col = floorColor(c.col, t * 0.5);
    const grad = g.createLinearGradient(ox, oy, ox + ax * len, oy + ay * len);
    grad.addColorStop(0, css(col, 0.3));
    grad.addColorStop(0.6, css(col, 0.08));
    grad.addColorStop(1, css(col, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ox + Math.sin(ang - spread) * len, oy - Math.cos(ang - spread) * len);
    g.lineTo(ox + Math.sin(ang + spread) * len, oy - Math.cos(ang + spread) * len);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Specks of light the ball throws across the room, circling slowly. Kept off the ball itself. */
export function drawSpecks(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, w: number, h: number, t: number) {
  const rnd = rng(29);
  const cols = ["rgba(255,255,255,0.8)", "rgba(255,120,230,0.75)", "rgba(110,230,255,0.75)", "rgba(190,150,255,0.7)"];
  const paths = cols.map(() => new Path2D());
  const turn = t * 0.07;
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2 + turn;
    const rr = R * (1.12 + rnd() * 2.6);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.8;
    const s = 1.2 + rnd() * 2.4;
    const c = Math.floor(rnd() * cols.length);
    if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    // Stretched along the way they travel, like reflections sweeping a wall.
    const tx = -Math.sin(a), ty = Math.cos(a) * 0.8;
    paths[c].ellipse(x, y, s * 2.2, s * 0.8, Math.atan2(ty, tx), 0, Math.PI * 2);
    paths[c].closePath();
  }
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.arc(cx, cy, R + 3, 0, Math.PI * 2, true);
  g.clip("evenodd");
  paths.forEach((p, i) => {
    g.fillStyle = cols[i];
    g.fill(p);
  });
  g.restore();
}

/** Laser beams fanning up from the dance floor's horizon into the haze, sweeping slowly. Never over the floor. */
export function drawLasers(g: CanvasRenderingContext2D, w: number, horizon: number, t: number) {
  const cols = ["#3dff8a", "#4df3ff", "#ff4ddb"];
  g.save();
  g.beginPath();
  g.rect(0, 0, w, horizon);
  g.clip();
  g.globalCompositeOperation = "lighter";
  const glow = g.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, w * 0.35);
  glow.addColorStop(0, "rgba(200,90,255,0.35)");
  glow.addColorStop(1, "rgba(200,90,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, horizon);
  const emitters = [
    { x: 0.5, n: 7, spread: 1.25, sp: 0.23 },
    { x: 0.12, n: 3, spread: 0.5, sp: 0.31 },
    { x: 0.88, n: 3, spread: 0.5, sp: 0.27 },
  ];
  emitters.forEach((e, ei) => {
    const ox = e.x * w;
    const lean = ei === 0 ? 0 : ei === 1 ? 0.55 : -0.55;
    for (let i = 0; i < e.n; i++) {
      const f = e.n === 1 ? 0 : i / (e.n - 1) - 0.5;
      const ang = lean + f * 2 * e.spread * (0.85 + 0.15 * Math.sin(t * 0.4 + ei)) + Math.sin(t * e.sp + ei * 2) * 0.22;
      const len = w * 1.2;
      const ex = ox + Math.sin(ang) * len, ey = horizon - Math.cos(ang) * len;
      const col = cols[(i + ei) % cols.length];
      g.strokeStyle = col;
      g.globalAlpha = 0.12;
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(ox, horizon);
      g.lineTo(ex, ey);
      g.stroke();
      g.globalAlpha = 0.75;
      g.lineWidth = 1.3;
      g.stroke();
    }
  });
  g.restore();
}

/**
 * The pool at night behind the floating globe: a purple sky over dark hills with a few lit windows, palms, the
 * pool's far edge, teal water lit from below, and a string of lights. Nothing here is on the globe.
 */
export function drawPoolNight(g: CanvasRenderingContext2D, w: number, h: number, globeTop: number) {
  const hz = Math.max(h * 0.24, Math.min(h * 0.4, globeTop + h * 0.16));
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, "#1c0c3a");
  sky.addColorStop(0.6, "#4b1f6e");
  sky.addColorStop(1, "#c2508f");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hz);
  const rnd = rng(41);
  g.fillStyle = "rgba(255,240,220,0.7)";
  for (let i = 0; i < 40; i++) g.fillRect(rnd() * w, rnd() * hz * 0.5, 1, 1);
  // Two ranges of hills, the nearer darker, with a few warm windows in a long low house.
  const hill = (base: number, amp: number, freq: number, ph: number, col: string) => {
    g.beginPath();
    g.moveTo(0, hz);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base - amp * (0.55 + 0.45 * Math.sin(x * freq + ph)) - amp * 0.3 * Math.sin(x * freq * 2.7 + ph * 2));
    g.lineTo(w, hz);
    g.closePath();
    g.fillStyle = col;
    g.fill();
  };
  hill(hz, hz * 0.32, 0.006, 1.2, "#3a1a5c");
  hill(hz, hz * 0.2, 0.011, 4, "#24103f");
  const house = (x: number, y: number, s: number) => {
    g.fillStyle = "#1a0b2e";
    g.fillRect(x - s * 1.6, y - s * 0.5, s * 3.2, s * 0.5);
    g.fillRect(x - s * 1.9, y - s * 0.62, s * 3.8, s * 0.14);
    g.fillStyle = "#ffcf6e";
    for (let i = 0; i < 5; i++) g.fillRect(x - s * 1.4 + i * s * 0.6, y - s * 0.42, s * 0.42, s * 0.3);
  };
  house(w * 0.2, hz - hz * 0.2, Math.max(8, hz * 0.07));
  house(w * 0.83, hz - hz * 0.13, Math.max(6, hz * 0.05));
  // The pool's far edge.
  g.fillStyle = "#e9d6c4";
  g.fillRect(0, hz, w, Math.max(4, h * 0.012));
  g.fillStyle = "rgba(40,10,60,0.5)";
  g.fillRect(0, hz + Math.max(4, h * 0.012), w, 2);
  const water = g.createLinearGradient(0, hz, 0, h);
  water.addColorStop(0, "#0b3d5c");
  water.addColorStop(0.5, "#0f6f86");
  water.addColorStop(1, "#18a6b4");
  g.fillStyle = water;
  g.fillRect(0, hz + Math.max(4, h * 0.012) + 2, w, h);
  const lamp = g.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7);
  lamp.addColorStop(0, "rgba(120,255,240,0.45)");
  lamp.addColorStop(1, "rgba(120,255,240,0)");
  g.fillStyle = lamp;
  g.fillRect(0, hz, w, h - hz);
  // Tile lines on the floor, seen at an angle through the water.
  g.strokeStyle = "rgba(200,255,255,0.08)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = -12; i <= 12; i++) {
    g.moveTo(w / 2 + i * w * 0.05, hz + 6);
    g.lineTo(w / 2 + i * w * 0.16, h);
  }
  for (let k = 1; k < 9; k++) {
    const y = hz + (h - hz) * Math.pow(k / 9, 1.6);
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  // Palms at the sides.
  const palm = (x: number, base: number, s: number, lean: number) => {
    g.strokeStyle = "#140726";
    g.fillStyle = "#140726";
    g.lineCap = "round";
    g.lineWidth = s * 0.07;
    const topX = x + lean * s, topY = base - s * 1.5;
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(x + lean * s * 0.2, base - s * 0.8, topX, topY);
    g.stroke();
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.5;
      const ex = topX + Math.cos(a) * s * 0.7, ey = topY + Math.sin(a) * s * 0.45 + s * 0.25;
      g.beginPath();
      g.moveTo(topX, topY);
      g.quadraticCurveTo(topX + Math.cos(a) * s * 0.45, topY + Math.sin(a) * s * 0.5 - s * 0.12, ex, ey);
      g.quadraticCurveTo(topX + Math.cos(a) * s * 0.4, topY + Math.sin(a) * s * 0.35, topX, topY);
      g.fill();
    }
  };
  const ps = Math.min(w, h) * 0.3;
  palm(w * 0.06, hz + 4, ps, 0.25);
  palm(w * 0.13, hz + 4, ps * 0.7, -0.15);
  palm(w * 0.95, hz + 4, ps * 0.9, -0.3);
  // A string of lights sagging across the top.
  const bulbs = Math.max(6, Math.round(w / 70));
  const y0 = h * 0.03, sag = Math.min(h * 0.09, Math.max(12, globeTop - y0 - 14));
  const at = (u: number): [number, number] => [-10 + u * (w + 20), y0 + sag * 4 * u * (1 - u)];
  g.strokeStyle = "#0e0520";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const [x, y] = at(i / 40);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  for (let i = 0; i < bulbs; i++) {
    const [x, y] = at((i + 0.5) / bulbs);
    const glow = g.createRadialGradient(x, y + 6, 0, x, y + 6, 22);
    glow.addColorStop(0, "rgba(255,214,120,0.55)");
    glow.addColorStop(1, "rgba(255,214,120,0)");
    g.fillStyle = glow;
    g.fillRect(x - 22, y - 16, 44, 44);
    g.fillStyle = "#ffe6a8";
    g.beginPath();
    g.ellipse(x, y + 6, 3.2, 4.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0e0520";
    g.fillRect(x - 1.5, y, 3, 3);
  }
}

/** Reflections of the string lights on the water, wobbling slowly; and rings spreading from the floating globe. */
export function drawPoolRipples(g: CanvasRenderingContext2D, w: number, h: number, cx: number, wy: number, R: number, t: number) {
  g.save();
  g.globalCompositeOperation = "lighter";
  const bulbs = Math.max(6, Math.round(w / 70));
  g.fillStyle = "rgba(255,210,120,0.22)";
  for (let i = 0; i < bulbs; i++) {
    const x = -10 + ((i + 0.5) / bulbs) * (w + 20);
    for (let k = 0; k < 6; k++) {
      const y = h * 0.55 + k * h * 0.07;
      if (y > h) break;
      const wob = Math.sin(t * 1.3 + i * 1.9 + k * 1.1) * (3 + k);
      g.fillRect(x + wob - 4 - k, y, 8 + k * 2, 1.5 + k * 0.3);
    }
  }
  g.restore();
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.arc(cx, wy - R * 0.45, R + 1, 0, Math.PI * 2, true);
  g.clip("evenodd");
  g.lineWidth = 1.5;
  for (let k = 0; k < 4; k++) {
    const f = ((t / 5 + k / 4) % 1 + 1) % 1;
    const s = 1.02 + f * 0.9;
    g.strokeStyle = `rgba(210,255,255,${(0.4 * (1 - f)).toFixed(3)})`;
    g.beginPath();
    g.ellipse(cx, wy, R * 0.92 * s, R * 0.2 * s, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}
