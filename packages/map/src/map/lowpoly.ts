// Polygon Kingdom's terrain (decision 63): a grid of triangles with heights and baked light, seen through the tilted
// camera or on the globe, standing on cliff walls along the coast, fading into haze at the draw distance. It was part
// of the map view and lives here so its code reaches a visitor only with that design (src/designs/bit64.ts registers
// it). It draws into the view's frame and keeps the terrain meshes on the view, which clears them when places change.
import type { GeoProjection } from "d3-geo";
import type { Theme } from "../themes.ts";
import { buildTerrain, heightAt, type Terrain } from "./terrain.ts";
import { clamp, DEG, type MapView } from "./view.ts";

export { heightAt };

/** Grid spacing for Polygon Kingdom's terrain by zoom: coarse at the whole world, finer as you zoom in. */
const TERRAIN_STEPS: [number, number][] = [
  [1.8, 3],
  [4, 1.5],
  [Infinity, 0.75],
];

const unitOf = (lon: number, lat: number): [number, number, number] => {
  const l = lon / DEG, p = lat / DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

/** Mix a packed 0xRRGGBB colour toward a CSS hex colour by t, as a CSS string. */
function fogged(rgb: number, fog: [number, number, number], t: number): string {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  return `rgb(${Math.round(r + (fog[0] - r) * t)},${Math.round(g + (fog[1] - g) * t)},${Math.round(b + (fog[2] - b) * t)})`;
}

const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

class LowPoly {
  constructor(private v: MapView) {}

  private n64Tex?: HTMLCanvasElement;

  /**
   * A low-resolution texture the way early 3D consoles showed them: a 32 by 32 tile of grey noise enlarged eight
   * times with smoothing, so the texels are big and blurry. Tied to the world's position, so it moves with the land
   * and sea instead of sliding under them. `scale` enlarges it further.
   */
  worldTexture(proj: GeoProjection, scale = 1): CanvasPattern {
    if (!this.n64Tex) {
      const small = document.createElement("canvas");
      small.width = small.height = 96;
      const g = small.getContext("2d")!;
      const img = g.createImageData(32, 32);
      let seed = 21;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 32 * 32; i++) {
        const v = 128 + Math.round((rnd() - 0.5) * 90);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) g.putImageData(img, x * 32, y * 32);
      const big = document.createElement("canvas");
      big.width = big.height = 768;
      const bg = big.getContext("2d")!;
      bg.imageSmoothingEnabled = true;
      bg.imageSmoothingQuality = "low";
      bg.drawImage(small, 0, 0, 768, 768);
      const tile = document.createElement("canvas");
      tile.width = tile.height = 256;
      tile.getContext("2d")!.drawImage(big, -256, -256);
      this.n64Tex = tile;
    }
    const p = this.v.ctx.createPattern(this.n64Tex, "repeat")!;
    const anchor = proj([0, 0]) ?? [0, 0];
    const a = this.v.cam ? this.v.tp(anchor[0], anchor[1], 0, this.v.cam) : anchor;
    const size = 256 * scale;
    p.setTransform(new DOMMatrix().translate(((a[0] % size) + size) % size, ((a[1] % size) + size) % size).scale(scale));
    return p;
  }

  private work = new WeakMap<Terrain, { X: Float32Array; Y: Float32Array; S: Float32Array; stamp: Int32Array }>();
  private frameNo = 0;
  private fogStrings = new Map<number, string>();

  /**
   * Terrain the way early 3D games built their overworlds (decision 63): a grid of triangles with heights and
   * baked light, seen through the tilted camera or on the globe, standing on cliff walls along the coast, fading
   * into haze at the draw distance.
   */
  drawLowPoly(proj: GeoProjection, t: Theme) {
    const { ctx, w, h: H } = this.v;
    const lp = t.lowPoly!;
    const base = this.v.low ?? this.v.high;
    if (!base) return;
    const rasters = this.v.rastersFor(base);
    if (!this.v.meshFor || this.v.meshFor.base !== base || this.v.meshFor.relief !== this.v.relief) {
      this.v.meshFor = { base, relief: this.v.relief };
      this.v.meshes.clear();
    }
    const step = TERRAIN_STEPS.find(([z]) => this.v.zoom < z)![1];
    let m = this.v.meshes.get(step);
    if (!m) {
      m = buildTerrain({ ...lp, isLand: rasters.isLand, isIce: rasters.isIce, peaks: this.v.relief?.peaks ?? [], step, anchors: [...this.v.anchors.values()] });
      this.v.meshes.set(step, m);
    }
    this.v.terrainNow = m;
    const cam = this.v.cam;
    const globe = this.v.mode === "3d";
    const R = proj.scale();
    const [gcx, gcy] = proj.translate();
    const lift = this.v.liftPx;
    const fog = hexRgb(t.fog ?? "#ffffff");

    // Only triangles that can be on screen: the facing half of the globe, or a window around the flat map's centre
    // that reaches further north, toward the horizon, under the tilted camera.
    const T = m.rgb.length;
    const order: number[] = [];
    if (globe) {
      const [ux, uy, uz] = unitOf(this.v.lon, this.v.lat);
      for (let i = 0; i < T; i++) if (m.cx[i]! * ux + m.cy[i]! * uy + m.cz[i]! * uz > 0.06) order.push(i);
    } else {
      const degPerPx = DEG / R;
      const halfW = (w / 2) * degPerPx * (cam ? 1.9 : 1.1) + m.step * 2;
      const halfH = (H / 2) * degPerPx;
      const north = this.v.lat + halfH * (cam ? 3.5 : 1.2) + m.step * 2;
      const south = this.v.lat - halfH * 1.3 - m.step * 2;
      for (let i = 0; i < T; i++) {
        const dl = ((((m.clon[i]! - this.v.lon) % 360) + 540) % 360) - 180;
        if (Math.abs(dl) > halfW || m.clat[i]! > north || m.clat[i]! < south) continue;
        order.push(i);
      }
    }

    let wk = this.work.get(m);
    if (!wk) {
      const n = m.lon.length;
      wk = { X: new Float32Array(n), Y: new Float32Array(n), S: new Float32Array(n), stamp: new Int32Array(n) };
      this.work.set(m, wk);
    }
    const { X, Y, S, stamp } = wk;
    const frame = ++this.frameNo;
    // Each corner is projected once, on the ground; heights are added per triangle, since a plateau's corner and
    // the mountain beside it stand at different heights.
    const vert = (i: number) => {
      if (stamp[i] === frame) return;
      stamp[i] = frame;
      const p = proj([m.lon[i]!, m.lat[i]!])!;
      if (cam) {
        const q = this.v.tp(p[0], p[1], 0, cam);
        X[i] = q[0];
        Y[i] = q[1];
        S[i] = q[2];
      } else {
        X[i] = p[0];
        Y[i] = p[1];
        S[i] = globe ? Math.hypot(p[0] - gcx, p[1] - gcy) / R : 1;
      }
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    /** A corner raised `hu` units, as SVG path coordinates. */
    const up = (i: number, hu: number): string => {
      const hp = hu * lift;
      if (cam) return `${r1(X[i]!)} ${r1(Y[i]! - hp * S[i]!)}`;
      if (globe) {
        const k = 1 + hp / R;
        return `${r1(gcx + (X[i]! - gcx) * k)} ${r1(gcy + (Y[i]! - gcy) * k)}`;
      }
      return `${r1(X[i]!)} ${r1(Y[i]! - hp)}`;
    };
    const heightOf = (t: number, v: number) => {
      const f = m.triH[t]!;
      return Number.isNaN(f) ? m.h[v]! : f;
    };
    // How far into the haze a point is: toward the draw distance on the tilted map, toward the rim on the globe.
    const haze = (i: number) => (cam ? (0.92 - S[i]!) / 0.3 : globe ? (S[i]! - 0.72) / 0.4 : 0);
    const colorOf = (rgb: number, i: number) => {
      const level = Math.round(Math.max(0, Math.min(1, haze(i))) * 8);
      const key = rgb * 16 + level;
      let col = this.fogStrings.get(key);
      if (!col) {
        col = fogged(rgb, fog, level / 8);
        this.fogStrings.set(key, col);
      }
      return col;
    };

    const tris = m.tris;
    const drawn: number[] = [];
    const shown = new Uint8Array(T);
    for (const i of order) {
      const a = tris[3 * i]!, b = tris[3 * i + 1]!, c = tris[3 * i + 2]!;
      vert(a);
      vert(b);
      vert(c);
      // Past the draw distance, the ground is gone into the haze.
      if (cam && Math.min(S[a]!, S[b]!, S[c]!) < 0.5) continue;
      const minX = Math.min(X[a]!, X[b]!, X[c]!), maxX = Math.max(X[a]!, X[b]!, X[c]!);
      if (!globe && maxX - minX > w / 3) continue;
      if (maxX < -40 || minX > w + 40) continue;
      const minY = Math.min(Y[a]!, Y[b]!, Y[c]!);
      if (minY > H + 60 || Math.max(Y[a]!, Y[b]!, Y[c]!) < -120) continue;
      drawn.push(i);
      shown[i] = 1;
    }

    // Shallows and cliffs along the coast, under the land. A cliff starts at its triangle's height.
    const depth = clamp(R * 0.018, 3, 14);
    const shallowText: string[] = [];
    const wallText: string[] = [];
    const coast = m.coast;
    for (let k = 0; k < coast.length; k += 2) {
      const a = coast[k]!, b = coast[k + 1]!;
      const tri = m.coastTri[k / 2]!;
      if (!shown[tri]) continue;
      const da = depth * (cam ? S[a]! : 1), db = depth * (cam ? S[b]! : 1);
      const ga = `${r1(X[a]!)} ${r1(Y[a]! + da)}`, gb = `${r1(X[b]!)} ${r1(Y[b]! + db)}`;
      shallowText.push(`M${ga}L${gb}`);
      wallText.push(`M${up(a, heightOf(tri, a))}L${up(b, heightOf(tri, b))}L${gb}L${ga}Z`);
    }
    const shallows = new Path2D(shallowText.join(""));
    const coastWalls = new Path2D(wallText.join(""));
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = depth * 1.6;
    ctx.strokeStyle = lp.shallows;
    ctx.globalAlpha = 0.85;
    ctx.stroke(shallows);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lp.cliff[0];
    ctx.fill(coastWalls);
    ctx.restore();

    // Bands from far to near: a row of the grid on the tilted map (north is far), a ring of distance on the globe
    // (the rim is far). In each band the tops go first, then the step walls that hang from them. Paths are built
    // as SVG path text and handed to the canvas once per colour: thousands of separate moveTo and lineTo calls
    // cost more than the drawing itself.
    type Band = { tops: Map<string, string[]>; walls: Map<string, string[]> };
    const bands = new Map<number, Band>();
    const bandOf = (i: number) => (globe ? Math.round(S[tris[3 * i]!]! * 24) : Math.round(m.clat[i]! / m.step));
    const bandFor = (key: number) => {
      let b = bands.get(key);
      if (!b) bands.set(key, (b = { tops: new Map(), walls: new Map() }));
      return b;
    };
    const push = (map: Map<string, string[]>, col: string, text: string) => {
      const list = map.get(col);
      if (list) list.push(text);
      else map.set(col, [text]);
    };
    const landText: string[] = [];
    for (const i of drawn) {
      const a = tris[3 * i]!, b = tris[3 * i + 1]!, c = tris[3 * i + 2]!;
      const text = `M${up(a, heightOf(i, a))}L${up(b, heightOf(i, b))}L${up(c, heightOf(i, c))}Z`;
      push(bandFor(bandOf(i)).tops, colorOf(m.rgb[i]!, a), text);
      landText.push(text);
    }
    const cliffRgb = hexRgb(lp.cliff[0]);
    const cliffAt = (k: number) => ((Math.round(cliffRgb[0] * k) << 16) | (Math.round(cliffRgb[1] * k) << 8) | Math.round(cliffRgb[2] * k)) >>> 0;
    const wallText2: string[] = [];
    const st = m.steps;
    for (let k = 0; k < st.a.length; k++) {
      const north = st.north[k]!;
      if (!shown[north]) continue;
      const a = st.a[k]!, b = st.b[k]!;
      // Walls facing the viewer are lit; walls running toward the horizon fall into shadow.
      const dx = X[b]! - X[a]!, dy = Y[b]! - Y[a]!;
      const steep = Math.abs(dy) / (Math.hypot(dx, dy) || 1);
      const text = `M${up(a, st.hiA[k]!)}L${up(b, st.hiB[k]!)}L${up(b, st.loB[k]!)}L${up(a, st.loA[k]!)}Z`;
      push(bandFor(bandOf(north)).walls, colorOf(cliffAt(1 - 0.35 * steep), a), text);
      wallText2.push(text);
    }
    const land = new Path2D(landText.join(""));
    ctx.fillStyle = `rgb(${lp.grass.map((v) => Math.round(v * 0.85)).join(",")})`;
    ctx.fill(land);
    ctx.lineWidth = 0.8;
    const drawMap = (map: Map<string, string[]>) => {
      for (const [col, list] of map) {
        const path = new Path2D(list.join(""));
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.fill(path);
        ctx.stroke(path);
      }
    };
    for (const key of [...bands.keys()].sort((p, q) => q - p)) {
      const band = bands.get(key)!;
      drawMap(band.tops);
      drawMap(band.walls);
    }
    // Blurry low-resolution textures, tied to the world: grass on the tops, rock on the walls.
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = this.worldTexture(proj, 0.35);
    ctx.fill(land);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = this.worldTexture(proj, 0.5);
    ctx.fill(coastWalls);
    ctx.fill(new Path2D(wallText2.join("")));
    ctx.restore();

    // Round trees on trunks stand on the grass, never in a cell that holds a place.
    const size = clamp(2.6 + this.v.zoom * 0.5, 3, 7);
    const trunks: string[] = [], crowns: string[] = [], lights: string[] = [];
    const placed: [number, number, number][] = [];
    for (let j = 0; j < m.treeTri.length; j++) {
      if (!shown[m.treeTri[j]!]) continue;
      const lo = m.trees[3 * j]!, la = m.trees[3 * j + 1]!, th = m.trees[3 * j + 2]! * lift;
      const p = proj([lo, la]);
      if (!p) continue;
      let x: number, y: number, sc: number;
      if (cam) {
        const q = this.v.tp(p[0], p[1], th, cam);
        [x, y, sc] = q;
        if (sc < 0.55) continue;
      } else if (globe) {
        const k = 1 + th / R;
        x = gcx + (p[0] - gcx) * k;
        y = gcy + (p[1] - gcy) * k;
        sc = 1;
      } else {
        x = p[0];
        y = p[1] - th;
        sc = 1;
      }
      placed.push([x, y, size * sc]);
    }
    placed.sort((p, q) => p[1] - q[1]);
    for (const [x, y, z] of placed) {
      const rx = z, ry = z * 1.15, cy = y - z * 1.9;
      trunks.push(`M${r1(x - z * 0.22)} ${r1(y)}h${r1(z * 0.44)}v${r1(-z * 1.1)}h${r1(-z * 0.44)}Z`);
      crowns.push(`M${r1(x - rx)} ${r1(cy)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0Z`);
      const lx = x - rx * 0.3, ly = cy - ry * 0.35, lr = rx * 0.45;
      lights.push(`M${r1(lx - lr)} ${r1(ly)}a${r1(lr)} ${r1(lr * 0.8)} 0 1 0 ${r1(2 * lr)} 0a${r1(lr)} ${r1(lr * 0.8)} 0 1 0 ${r1(-2 * lr)} 0Z`);
    }
    if (placed.length) {
      ctx.save();
      ctx.fillStyle = "#6b3f1a";
      ctx.fill(new Path2D(trunks.join("")));
      const crown = new Path2D(crowns.join(""));
      ctx.fillStyle = "#2f9a2a";
      ctx.fill(crown);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#1c6a1a";
      ctx.stroke(crown);
      ctx.fillStyle = "#6fd24a";
      ctx.fill(new Path2D(lights.join("")));
      ctx.restore();
    }
  }
}

const kits = new WeakMap<MapView, LowPoly>();
const of = (v: MapView) => {
  let k = kits.get(v);
  if (!k) kits.set(v, (k = new LowPoly(v)));
  return k;
};

/** Polygon Kingdom's water texture, tied to the world's position (see `worldTexture`). */
export const worldTexture = (v: MapView, proj: GeoProjection, scale = 1) => of(v).worldTexture(proj, scale);

/** The terrain, drawn over the clipped globe or map. */
export const drawLowPoly = (v: MapView, proj: GeoProjection, t: Theme) => of(v).drawLowPoly(proj, t);
