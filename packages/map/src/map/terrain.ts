// Terrain for the Polygon Kingdom design: the land as a grid of triangles with a height at every corner, the way
// early 3D games built their overworlds. Colours are lit once when the mesh is built, like the vertex colours those
// games baked in, so a frame only projects and fills. Pure: the land test is passed in, so it can be tested.

export type RGB = [number, number, number];

export interface TerrainInput {
  /** Whether a point is land (the view reads it from a small raster of the basemap). */
  isLand: (lon: number, lat: number) => boolean;
  isIce: (lon: number, lat: number) => boolean;
  /** Mountain points from the relief layer. */
  peaks: readonly [number, number][];
  /** Grid spacing in degrees. */
  step: number;
  /**
   * Places that must stand on land whatever the grid spacing: every place on the map. A coarse grid would
   * otherwise drop small islands while keeping their neighbours.
   */
  anchors: readonly [number, number][];
  grass: RGB;
  rock: RGB;
  snow: RGB;
  /** Snow in shadow, a cool lavender. */
  snowShade: RGB;
}

export interface Terrain {
  step: number;
  cols: number;
  rows: number;
  lon: Float32Array;
  lat: Float32Array;
  /** Height at each corner: 0 on the shore, rolling hills inland, spikes where the relief layer has mountains. */
  h: Float32Array;
  /** Land triangles as corner index triples, north row first, so drawing in order goes far to near. */
  tris: Uint32Array;
  /** Each triangle's lit colour, packed 0xRRGGBB. */
  rgb: Uint32Array;
  /** Each triangle's centre as a unit vector, for quick culling on the globe. */
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  /** Each triangle's centre longitude and latitude, for quick culling on the flat map. */
  clon: Float32Array;
  clat: Float32Array;
  /** Coast edges (corner index pairs): where a land triangle meets the sea, and the cliff walls hang. */
  coast: Uint32Array;
  /** The land triangle each coast edge belongs to. */
  coastTri: Uint32Array;
  /**
   * A grass triangle's flat height (it sits on a plateau), or NaN for a rock or snow triangle, which slopes
   * between its corners' heights.
   */
  triH: Float32Array;
  /**
   * Steps between neighbouring triangles that meet at different heights (a plateau's edge, or where grass meets a
   * mountain): corner pairs, the height on each side at each corner, and the triangle further north.
   */
  steps: { a: Uint32Array; b: Uint32Array; hiA: Float32Array; loA: Float32Array; hiB: Float32Array; loB: Float32Array; north: Uint32Array };
  /** Trees on the grass: longitude, latitude and ground height, three numbers each, and the triangle they stand on. */
  trees: Float32Array;
  treeTri: Uint32Array;
  /** Flat height of each grid cell's plateau, or NaN where the cell is mountain or sea. */
  cellH: Float32Array;
}

/** Plateau levels: the grass steps up in flat tiers, as early 3D games built their fields. */
const LEVELS = 3;
const levelHeight = (l: number) => 0.3 + l * 0.7;

const NORTH = 88;

/** Fixed pseudo-random value in [0, 1) for two integers, so the hills are the same on every load. */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise on a lattice `cell` degrees apart: rolling hills rather than per-corner jitter. */
function hills(lon: number, lat: number, cell: number): number {
  const x = (lon + 180) / cell;
  const y = (lat + 90) / cell;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const unit = (lon: number, lat: number): [number, number, number] => {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

export function buildTerrain(o: TerrainInput): Terrain {
  const { step } = o;
  const cols = Math.round(360 / step);
  const rows = Math.round((2 * NORTH) / step);
  const at = (c: number, r: number) => r * (cols + 1) + c;
  const n = (cols + 1) * (rows + 1);
  const lon = new Float32Array(n);
  const lat = new Float32Array(n);
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      lon[at(c, r)] = -180 + c * step;
      lat[at(c, r)] = NORTH - r * step;
    }

  // Cells that hold a place are land in both their triangles.
  const anchored = new Set<number>();
  for (const [alon, alat] of o.anchors) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((alon + 180) / step)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((NORTH - alat) / step)));
    anchored.add(r * cols + c);
  }

  // Two triangles per cell, the diagonal alternating so the surface doesn't read as a regular grid. A triangle is
  // land when its centre is, when two of its corners are, or when its cell holds a place.
  const tris: number[] = [];
  const ice: number[] = [];
  const shore = new Uint8Array(n);
  const landV = new Uint8Array(n);
  for (let i = 0; i < n; i++) landV[i] = o.isLand(lon[i]!, lat[i]!) ? 1 : 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v00 = at(c, r), v10 = at(c + 1, r), v01 = at(c, r + 1), v11 = at(c + 1, r + 1);
      const pair = (c + r) % 2 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]];
      const pinned = anchored.has(r * cols + c);
      for (const [a, b, d] of pair as [number, number, number][]) {
        const cl = (lon[a]! + lon[b]! + lon[d]!) / 3;
        const ct = (lat[a]! + lat[b]! + lat[d]!) / 3;
        const land = pinned || o.isLand(cl, ct) || landV[a]! + landV[b]! + landV[d]! >= 2;
        if (!land) {
          shore[a] = shore[b] = shore[d] = 1;
          continue;
        }
        tris.push(a, b, d);
        ice.push(o.isIce(cl, ct) ? 1 : 0);
      }
    }

  // Coast edges: used by one land triangle only. The two copies of the 180th meridian count as one edge.
  const wrapped = (i: number) => (i % (cols + 1) === cols ? i - cols : i);
  const edges = new Map<number, number>();
  for (let k = 0; k < tris.length; k += 3)
    for (const [a, b] of [[tris[k]!, tris[k + 1]!], [tris[k + 1]!, tris[k + 2]!], [tris[k + 2]!, tris[k]!]] as const) {
      const wa = wrapped(a), wb = wrapped(b);
      const key = wa < wb ? wa * n + wb : wb * n + wa;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const coast: number[] = [];
  for (let k = 0; k < tris.length; k += 3)
    for (const [a, b] of [[tris[k]!, tris[k + 1]!], [tris[k + 1]!, tris[k + 2]!], [tris[k + 2]!, tris[k]!]] as const) {
      const wa = wrapped(a), wb = wrapped(b);
      if (edges.get(wa < wb ? wa * n + wb : wb * n + wa) === 1) coast.push(a, b);
    }

  // Mountains: relief peaks within about three degrees, counted on a one-degree grid so every grid spacing gets the
  // same heights. Capped, so a dense range is a row of peaks, not a wall.
  const density = new Float32Array(360 * 180);
  for (const [plon, plat] of o.peaks) {
    const c0 = Math.floor(plon + 180), r0 = Math.floor(90 - plat);
    for (let dr = -3; dr <= 3; dr++)
      for (let dc = -3; dc <= 3; dc++) {
        const c = (c0 + dc + 360) % 360, r = r0 + dr;
        if (r < 0 || r >= 180) continue;
        density[r * 360 + c]! += 1 / (1 + dr * dr + dc * dc);
      }
  }
  const level = (lo: number, la: number) => Math.min(LEVELS - 1, Math.floor(hills(lo, la, 7) * LEVELS * 1.05));
  const h = new Float32Array(n);
  const spikeV = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (shore[i] || !landV[i]) continue;
    const dc = Math.min(359, Math.max(0, Math.floor(lon[i]! + 180)));
    const dr = Math.min(179, Math.max(0, Math.floor(90 - lat[i]!)));
    const dens = density[dr * 360 + dc]!;
    const spike = dens > 0.3 ? Math.min(3, 0.9 * Math.pow(dens, 0.6)) * (0.6 + 0.8 * hash(Math.round(lon[i]! * 3), Math.round(lat[i]! * 3))) : 0;
    spikeV[i] = spike;
    h[i] = levelHeight(level(lon[i]!, lat[i]!)) + spike;
  }

  // Light from the north-west and above, as a morning sun over the map.
  const L: [number, number, number] = [-0.45, 0.55, 0.7];
  const LL = Math.hypot(...L);
  const HK = 1.4;
  const vlight = new Float32Array(n);
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const i = at(c, r);
      const dx = (h[at(Math.min(cols, c + 1), r)]! - h[at(Math.max(0, c - 1), r)]!) * HK;
      const dy = (h[at(c, Math.max(0, r - 1))]! - h[at(c, Math.min(rows, r + 1))]!) * HK;
      const len = Math.hypot(dx, dy, 2);
      const d = (-dx * L[0] - dy * L[1] + 2 * L[2]) / (len * LL);
      vlight[i] = 0.7 + 0.35 * d;
    }

  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c: RGB, k: number) => {
    const q = (x: number) => Math.max(0, Math.min(255, Math.round((x * k) / 4) * 4));
    return (q(c[0]) << 16) | (q(c[1]) << 8) | q(c[2]);
  };
  const T = tris.length / 3;
  const rgb = new Uint32Array(T);
  const triH = new Float32Array(T);
  const cx = new Float32Array(T), cy = new Float32Array(T), cz = new Float32Array(T);
  const clon = new Float32Array(T), clat = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const a = tris[3 * t]!, b = tris[3 * t + 1]!, d = tris[3 * t + 2]!;
    const top = Math.max(h[a]!, h[b]!, h[d]!);
    const mountain = Math.max(spikeV[a]!, spikeV[b]!, spikeV[d]!) > 0.55;
    const cl0 = (lon[a]! + lon[b]! + lon[d]!) / 3, ct0 = (lat[a]! + lat[b]! + lat[d]!) / 3;
    // Grass sits flat on its plateau; rock and snow slope between their corners, so mountains rise from the tiers.
    triH[t] = mountain || ice[t] ? NaN : levelHeight(level(cl0, ct0));
    // Grass takes the smooth average of its corners' light. Rock takes its own face's light, so peaks show facets.
    const smooth = (vlight[a]! + vlight[b]! + vlight[d]!) / 3;
    let color: RGB;
    let k = smooth;
    if (!Number.isNaN(triH[t])) {
      // A plateau is lit evenly; each tier up is a touch brighter, as the tops of those fields caught the sun.
      color = o.grass;
      k = 0.94 + 0.05 * level(cl0, ct0);
    } else if (ice[t] || top > 3.3) {
      color = mix(o.snowShade, o.snow, Math.max(0, Math.min(1, (smooth - 0.6) / 0.45)));
      k = 1;
    } else if (top > 1.35) {
      const ux = (lon[b]! - lon[a]!) / step, uy = (lat[b]! - lat[a]!) / step, uz = (h[b]! - h[a]!) * HK;
      const vx = (lon[d]! - lon[a]!) / step, vy = (lat[d]! - lat[a]!) / step, vz = (h[d]! - h[a]!) * HK;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
      const f = (nx * L[0] + ny * L[1] + nz * L[2]) / ((Math.hypot(nx, ny, nz) || 1) * LL);
      color = o.rock;
      k = 0.55 + 0.6 * f;
    } else color = o.grass;
    rgb[t] = pack(color, k);
    const cl = (lon[a]! + lon[b]! + lon[d]!) / 3, ct = (lat[a]! + lat[b]! + lat[d]!) / 3;
    const u = unit(cl, ct);
    cx[t] = u[0];
    cy[t] = u[1];
    cz[t] = u[2];
    clon[t] = cl;
    clat[t] = ct;
  }
  // Where two triangles share an edge but not a height, a step wall closes the gap: plateau edges, and where grass
  // meets a mountain's foot.
  const heightOf = (t: number, v: number) => (Number.isNaN(triH[t]!) ? h[v]! : triH[t]!);
  const owner = new Map<number, number>();
  const sA: number[] = [], sB: number[] = [], hiA: number[] = [], loA: number[] = [], hiB: number[] = [], loB: number[] = [], north: number[] = [];
  for (let t = 0; t < T; t++)
    for (const [a, b] of [[tris[3 * t]!, tris[3 * t + 1]!], [tris[3 * t + 1]!, tris[3 * t + 2]!], [tris[3 * t + 2]!, tris[3 * t]!]] as const) {
      const key = a < b ? a * n + b : b * n + a;
      const other = owner.get(key);
      if (other === undefined) {
        owner.set(key, t);
        continue;
      }
      const ha1 = heightOf(t, a), ha2 = heightOf(other, a), hb1 = heightOf(t, b), hb2 = heightOf(other, b);
      if (Math.abs(ha1 - ha2) < 0.05 && Math.abs(hb1 - hb2) < 0.05) continue;
      sA.push(a);
      sB.push(b);
      hiA.push(Math.max(ha1, ha2));
      loA.push(Math.min(ha1, ha2));
      hiB.push(Math.max(hb1, hb2));
      loB.push(Math.min(hb1, hb2));
      north.push(clat[t]! >= clat[other]! ? t : other);
    }

  // Coast edges know their triangle, so the cliff starts at the plateau's height.
  const coastTri: number[] = [];
  for (let k = 0; k < coast.length; k += 2) {
    const a = coast[k]!, b = coast[k + 1]!;
    const key = a < b ? a * n + b : b * n + a;
    coastTri.push(owner.get(key) ?? 0);
  }

  // Trees on some grass, never in a cell that holds a place, so a tree can never sit where a marker stands.
  const trees: number[] = [];
  const treeTri: number[] = [];
  const cellH = new Float32Array(rows * cols).fill(NaN);
  for (let t = 0; t < T; t++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((clon[t]! + 180) / step)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((NORTH - clat[t]!) / step)));
    if (!Number.isNaN(triH[t]!) && Number.isNaN(cellH[r * cols + c]!)) cellH[r * cols + c] = triH[t]!;
    if (Number.isNaN(triH[t]!) || ice[t] || anchored.has(r * cols + c)) continue;
    if (hash(Math.round(clon[t]! * 7), Math.round(clat[t]! * 7)) < 0.09) {
      trees.push(clon[t]!, clat[t]!, triH[t]!);
      treeTri.push(t);
    }
  }

  return {
    step, cols, rows, lon, lat, h, tris: Uint32Array.from(tris), rgb, cx, cy, cz, clon, clat,
    coast: Uint32Array.from(coast), coastTri: Uint32Array.from(coastTri), triH,
    steps: { a: Uint32Array.from(sA), b: Uint32Array.from(sB), hiA: Float32Array.from(hiA), loA: Float32Array.from(loA), hiB: Float32Array.from(hiB), loB: Float32Array.from(loB), north: Uint32Array.from(north) },
    trees: Float32Array.from(trees), treeTri: Uint32Array.from(treeTri), cellH,
  };
}

/** The terrain height under a point: its plateau, or on a mountain, interpolated between the corners around it. */
export function heightAt(t: Terrain, lon: number, lat: number): number {
  const x = (lon + 180) / t.step;
  const y = (NORTH - lat) / t.step;
  const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x)));
  const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y)));
  const flat = t.cellH[r * t.cols + c]!;
  if (!Number.isNaN(flat)) return flat;
  const fx = Math.min(1, Math.max(0, x - c)), fy = Math.min(1, Math.max(0, y - r));
  const at = (cc: number, rr: number) => t.h[rr * (t.cols + 1) + cc]!;
  const top = at(c, r) * (1 - fx) + at(c + 1, r) * fx;
  const bottom = at(c, r + 1) * (1 - fx) + at(c + 1, r + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
