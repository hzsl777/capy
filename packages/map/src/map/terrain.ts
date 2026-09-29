// Terrain for the Polygon Kingdom design: the land as a grid of triangles with a height at every corner, the way
// early 3D games built their overworlds. Built once per basemap from a small raster of the land, never per frame.
import { geoEquirectangular, geoPath } from "d3-geo";
import type { Basemap, Relief } from "./basemap.ts";

export interface Terrain {
  lon: Float32Array;
  lat: Float32Array;
  /** Height at each corner: 0 on the shore, low hills inland, spikes where the relief data has mountains. */
  h: Float32Array;
  /** Land triangles as corner index triples. */
  tris: Uint32Array;
  /** 1 where a triangle lies on ice. */
  ice: Uint8Array;
  /** Coast edges (corner index pairs): where a land triangle meets the sea, and the cliff walls hang. */
  coast: Uint32Array;
}

/** Fixed pseudo-random value in [0, 1) for a grid corner, so the hills are the same on every load. */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Which half-degree cells a layer covers, read back from drawing it once on a small plate carrée canvas. */
function raster(fc: Basemap["land"] | undefined): (lon: number, lat: number) => boolean {
  const W = 720;
  const H = 360;
  if (!fc) return () => false;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2);
  g.beginPath();
  geoPath(proj, g)(fc);
  g.fillStyle = "#fff";
  g.fill();
  const px = g.getImageData(0, 0, W, H).data;
  return (lon, lat) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    return px[(y * W + x) * 4 + 3]! > 127;
  };
}

export function buildTerrain(base: Basemap, relief: Relief | undefined, step: number): Terrain {
  const isLand = raster(base.land);
  const isIce = raster(base.ice);
  const cols = Math.round(360 / step);
  const rows = Math.round(176 / step);
  const at = (c: number, r: number) => r * (cols + 1) + c;
  const n = (cols + 1) * (rows + 1);
  const lon = new Float32Array(n);
  const lat = new Float32Array(n);
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      lon[at(c, r)] = -180 + c * step;
      lat[at(c, r)] = 88 - r * step;
    }

  // Two triangles per cell, the diagonal alternating so the surface doesn't read as a regular grid.
  const tris: number[] = [];
  const ice: number[] = [];
  const shore = new Uint8Array(n);
  const edges = new Map<number, number>();
  const edge = (a: number, b: number) => {
    const k = a < b ? a * n + b : b * n + a;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v00 = at(c, r), v10 = at(c + 1, r), v01 = at(c, r + 1), v11 = at(c + 1, r + 1);
      const pair = (c + r) % 2 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]];
      for (const [a, b, d] of pair as [number, number, number][]) {
        const cl = (lon[a]! + lon[b]! + lon[d]!) / 3;
        const ct = (lat[a]! + lat[b]! + lat[d]!) / 3;
        if (!isLand(cl, ct)) {
          shore[a] = shore[b] = shore[d] = 1;
          continue;
        }
        tris.push(a, b, d);
        ice.push(isIce(cl, ct) ? 1 : 0);
        edge(a, b);
        edge(b, d);
        edge(d, a);
      }
    }
  const coast: number[] = [];
  for (const [k, count] of edges) if (count === 1) coast.push(Math.floor(k / n), k % n);

  // Mountains: how many relief peaks lie near each corner, turned into a spiky height.
  const peaks = new Float32Array(n);
  for (const [plon, plat] of relief?.peaks ?? []) {
    const c0 = Math.round((plon + 180) / step);
    const r0 = Math.round((88 - plat) / step);
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || c > cols || r < 0 || r > rows) continue;
        peaks[at(c, r)]! += 1 / (1 + dr * dr + dc * dc);
      }
  }
  const h = new Float32Array(n);
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const i = at(c, r);
      if (shore[i]) continue;
      const hills = 0.2 + 0.45 * hash(c, r);
      const m = peaks[i]! > 0 ? Math.min(5, 1.1 * Math.pow(peaks[i]!, 0.75)) * (0.55 + 0.9 * hash(r + 7, c + 3)) : 0;
      h[i] = hills + m;
    }
  return { lon, lat, h, tris: Uint32Array.from(tris), ice: Uint8Array.from(ice), coast: Uint32Array.from(coast) };
}
