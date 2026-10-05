// The detailed basemap's grid (decision 78's idea, for the coast): the world is cut into 10 degree cells, each a file
// of Natural Earth's 10m layers under public/basemap/10m/. This file holds what the build script and the site share:
// the cells' names, and the planar clipping that cuts polygons and lines to a cell. Pure functions, no DOM.

import type { Position } from "geojson";

/** Width and height of a cell in degrees. A tile's quantization grid is a whole number of steps across, so tiles line up. */
export const CELL = 10;
export const COLS = 360 / CELL;
export const ROWS = 180 / CELL;

export interface Cell {
  /** 0 at 180 degrees west, counting east. */
  col: number;
  /** 0 at the South Pole, counting north. */
  row: number;
}

export const cellId = (c: Cell) => c.row * COLS + c.col;
export const cellWest = (col: number) => -180 + col * CELL;
export const cellSouth = (row: number) => -90 + row * CELL;

/** A cell's file name the way core names a local-story tile: the south-west corner, "30N_10E". */
export function cellKey(c: Cell): string {
  const s = cellSouth(c.row);
  const w = cellWest(c.col);
  return `${Math.abs(s)}${s >= 0 ? "N" : "S"}_${Math.abs(w)}${w >= 0 ? "E" : "W"}`;
}

export function cellOfKey(key: string): Cell | null {
  const m = /^(\d+)([NS])_(\d+)([EW])$/.exec(key);
  if (!m) return null;
  const s = Number(m[1]) * (m[2] === "S" ? -1 : 1);
  const w = Number(m[3]) * (m[4] === "W" ? -1 : 1);
  const row = (s + 90) / CELL;
  const col = (w + 180) / CELL;
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < ROWS && col >= 0 && col < COLS ? { col, row } : null;
}

export const cellOf = (lon: number, lat: number): Cell => ({
  col: Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / CELL))),
  row: Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / CELL))),
});

const onGrid = (v: number) => Math.abs(v / CELL - Math.round(v / CELL)) * CELL < 1e-6;

/**
 * An edge lying along a cell's border: the clip adds it to close a polygon, so it is not a coast. Both ends on the
 * same meridian or the same parallel of the grid.
 */
export function isGridCut(a: Position, b: Position): boolean {
  return (Math.abs(a[0]! - b[0]!) < 1e-6 && onGrid(a[0]!)) || (Math.abs(a[1]! - b[1]!) < 1e-6 && onGrid(a[1]!));
}

// ---- clipping ---------------------------------------------------------------------------------------------

type Ring = Position[];

/** Twice the signed area in square degrees. */
export function area2(ring: Ring): number {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++) a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  return a;
}

/**
 * The edges a clip adds along a parallel are great-circle arcs to d3, which bow off the parallel by up to several
 * kilometres over ten degrees. Short steps keep every such edge on it, so the two sides of a border agree.
 */
const STEP = 0.5;
function densify(ring: Ring): Ring {
  const out: Ring = [ring[0]!];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    if (a[1] === b[1] && Math.abs(a[1]!) < 90 && onGrid(a[1]!) && Math.abs(b[0]! - a[0]!) > STEP) {
      const m = Math.ceil(Math.abs(b[0]! - a[0]!) / STEP);
      for (let k = 1; k < m; k++) out.push([a[0]! + ((b[0]! - a[0]!) * k) / m, a[1]!]);
    }
    out.push(b);
  }
  return out;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The part of the segment a to b inside the rectangle, as parameters along it, or null. */
function segmentIn(a: Position, b: Position, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  for (const [p, q] of [[-dx, a[0]! - r.x0], [dx, r.x1 - a[0]!], [-dy, a[1]! - r.y0], [dy, r.y1 - a[1]!]] as const) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** A point on the segment, exactly on the rectangle's border when the parameter cut it there. */
function pointAt(a: Position, b: Position, t: number, r: Rect): Position {
  if (t === 0) return a;
  if (t === 1) return b;
  const x = a[0]! + (b[0]! - a[0]!) * t;
  const y = a[1]! + (b[1]! - a[1]!) * t;
  const snap = (v: number, lo: number, hi: number) => (Math.abs(v - lo) < 1e-9 ? lo : Math.abs(v - hi) < 1e-9 ? hi : v);
  return [snap(x, r.x0, r.x1), snap(y, r.y0, r.y1)];
}

const inside = (p: Position, r: Rect) => p[0]! >= r.x0 && p[0]! <= r.x1 && p[1]! >= r.y0 && p[1]! <= r.y1;

function pointInRing(ring: Ring, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) c = !c;
  }
  return c;
}

/**
 * A polygon (exterior ring first, then holes; wound the way Natural Earth winds them, the land on the right of the
 * way round) cut to a rectangle, as polygons with no overlapping edges. Where the polygon leaves the rectangle and
 * comes back, the cut pieces of its rings are joined by walking the rectangle's border clockwise from where one
 * leaves to the first where another enters, so the result is made of simple rings. (Closing each ring on its own, as
 * Sutherland-Hodgman does, lays back-and-forth edges along the border, and d3's own clipping of such rings fills the
 * whole screen at some zooms.)
 */
export function clipPolygon(rings: Position[][], r: Rect): Position[][][] {
  const W = r.x1 - r.x0;
  const H = r.y1 - r.y0;
  const P = 2 * (W + H);
  // Distance clockwise (y up) along the border from the top left corner.
  const along = (p: Position): number => {
    if (p[1] === r.y1) return p[0]! - r.x0;
    if (p[0] === r.x1) return W + (r.y1 - p[1]!);
    if (p[1] === r.y0) return W + H + (r.x1 - p[0]!);
    return 2 * W + H + (p[1]! - r.y0);
  };
  const whole: Ring[] = [];
  const pieces: Position[][] = [];
  for (const ring of rings) {
    const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
    const n = pts.length;
    if (n < 3) continue;
    let start = -1;
    for (let i = 0; i < n && start < 0; i++) if (!inside(pts[i]!, r)) start = i;
    if (start < 0) {
      whole.push([...pts, pts[0]!]);
      continue;
    }
    // From an outside point, so that no piece runs across the start.
    let cur: Position[] | null = null;
    for (let k = 0; k < n; k++) {
      const a = pts[(start + k) % n]!;
      const b = pts[(start + k + 1) % n]!;
      const seg = segmentIn(a, b, r);
      // A segment that only touches the border has nothing inside.
      if (!seg || seg[1] - seg[0] < 1e-12) {
        cur = null;
        continue;
      }
      const [t0, t1] = seg;
      if (t0 > 0 || !cur) {
        cur = [pointAt(a, b, t0, r)];
        pieces.push(cur);
      }
      cur.push(pointAt(a, b, t1, r));
      if (t1 < 1) cur = null;
    }
  }
  const out: Ring[] = [];
  if (!pieces.length) {
    // No ring crosses the rectangle: it is all inside the polygon, or all outside it.
    // Tested at a corner: a ring wholly inside the rectangle (an island, a lake) can hold its middle but never a corner.
    const covered = rings.filter((ring) => pointInRing(ring, r.x0, r.y0)).length % 2 === 1;
    if (covered) out.push([[r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0], [r.x0, r.y0], [r.x0, r.y1]]);
  } else {
    const used = new Uint8Array(pieces.length);
    const corners: [number, Position][] = [[0, [r.x0, r.y1]], [W, [r.x1, r.y1]], [W + H, [r.x1, r.y0]], [2 * W + H, [r.x0, r.y0]]];
    const corners2 = [...corners, ...corners.map(([t, p]) => [t + P, p] as [number, Position])];
    for (let s = 0; s < pieces.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const ring: Position[] = pieces[s]!.slice();
      for (let guard = 0; guard <= pieces.length; guard++) {
        const tEnd = along(ring[ring.length - 1]!);
        // The next entry clockwise from where the ring leaves; its own start when nothing is nearer.
        let best = -1;
        let bestD = Infinity;
        for (let j = 0; j < pieces.length; j++) {
          if (used[j] && j !== s) continue;
          let d = along(pieces[j]![0]!) - tEnd;
          if (d < -1e-12) d += P;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
        if (best < 0) break;
        const tNext = tEnd + bestD;
        for (const c of corners2) if (c[0] > tEnd + 1e-12 && c[0] < tNext - 1e-12) ring.push(c[1]);
        if (best === s) break;
        used[best] = 1;
        for (const p of pieces[best]!) ring.push(p);
      }
      ring.push(ring[0]!);
      out.push(ring);
    }
  }
  // Clockwise rings (negative area) are land; counterclockwise ones are holes, each kept with the smallest ring holding it.
  const outers = out.filter((ring) => area2(ring) < 0).map((ring) => ({ ring, holes: [] as Ring[], size: Math.abs(area2(ring)) }));
  for (const ring of whole) if (area2(ring) < 0) outers.push({ ring, holes: [], size: Math.abs(area2(ring)) });
  const holes: Ring[] = [...out.filter((ring) => area2(ring) >= 0), ...whole.filter((ring) => area2(ring) >= 0)];
  for (const h of holes) {
    let owner: (typeof outers)[number] | undefined;
    for (const o of outers) if (pointInRing(o.ring, h[0]![0]!, h[0]![1]!) && (!owner || o.size < owner.size)) owner = o;
    owner?.holes.push(h);
  }
  return outers.map((o) => [densify(o.ring), ...o.holes.map(densify)]);
}

/** A polygon cut into the cells it covers, by columns and then rows, so a big polygon is not walked once per cell. */
function splitPolygon(rings: Position[][], into: Map<number, Position[][][]>) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of rings[0]!) {
    if (p[0]! < x0) x0 = p[0]!;
    if (p[0]! > x1) x1 = p[0]!;
    if (p[1]! < y0) y0 = p[1]!;
    if (p[1]! > y1) y1 = p[1]!;
  }
  const a = cellOf(x0, y0);
  const b = cellOf(x1, y1);
  for (let col = a.col; col <= b.col; col++) {
    const w = cellWest(col);
    const strips = a.col === b.col ? [rings] : clipPolygon(rings, { x0: w, y0: -90, x1: w + CELL, y1: 90 });
    for (const strip of strips)
      for (let row = a.row; row <= b.row; row++) {
        const s = cellSouth(row);
        const cells = clipPolygon(strip, { x0: w, y0: s, x1: w + CELL, y1: s + CELL });
        if (!cells.length) continue;
        const id = cellId({ col, row });
        const list = into.get(id);
        if (list) list.push(...cells);
        else into.set(id, cells);
      }
  }
}

/** A line cut to lo <= axis <= hi: the pieces inside, with the cut ends exactly on the border. */
function clipLineAxis(line: Position[], axis: 0 | 1, lo: number, hi: number): Position[][] {
  const other = axis === 0 ? 1 : 0;
  const out: Position[][] = [];
  let cur: Position[] = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const d = b[axis]! - a[axis]!;
    let t0 = 0;
    let t1 = 1;
    if (d === 0) {
      if (a[axis]! < lo || a[axis]! > hi) {
        flush();
        continue;
      }
    } else {
      const tl = (lo - a[axis]!) / d;
      const th = (hi - a[axis]!) / d;
      t0 = Math.max(0, Math.min(tl, th));
      t1 = Math.min(1, Math.max(tl, th));
      if (t0 > t1) {
        flush();
        continue;
      }
    }
    const at = (t: number, edge: number): Position => {
      if (t === 0) return a;
      if (t === 1) return b;
      const p: Position = [0, 0];
      p[axis] = edge;
      p[other] = a[other]! + (b[other]! - a[other]!) * t;
      return p;
    };
    const edgeAt = (t: number) => (d > 0 ? (t === t0 ? lo : hi) : t === t0 ? hi : lo);
    const p0 = at(t0, edgeAt(t0));
    const p1 = at(t1, t1 === t0 ? edgeAt(t0) : d > 0 ? hi : lo);
    const last = cur[cur.length - 1];
    if (last && last[0] === p0[0] && last[1] === p0[1]) cur.push(p1);
    else {
      flush();
      cur = [p0, p1];
    }
    if (t1 < 1) flush();
  }
  flush();
  return out;
}

function splitLine(line: Position[], into: Map<number, Position[][]>) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of line) {
    if (p[0]! < x0) x0 = p[0]!;
    if (p[0]! > x1) x1 = p[0]!;
    if (p[1]! < y0) y0 = p[1]!;
    if (p[1]! > y1) y1 = p[1]!;
  }
  const a = cellOf(x0, y0);
  const b = cellOf(x1, y1);
  for (let col = a.col; col <= b.col; col++) {
    const strips = clipLineAxis(line, 0, cellWest(col), cellWest(col) + CELL);
    for (const strip of strips)
      for (let row = a.row; row <= b.row; row++)
        for (const piece of clipLineAxis(strip, 1, cellSouth(row), cellSouth(row) + CELL)) {
          const id = cellId({ col, row });
          const list = into.get(id);
          if (list) list.push(piece);
          else into.set(id, [piece]);
        }
  }
}

// ---- pieces -----------------------------------------------------------------------------------------------

export interface LakePiece {
  /** Names the lake across cells: the same lake in two cells is drawn once. */
  id: number;
  rings: Position[][][];
}

/** What one cell holds of every layer. */
export interface Piece {
  land: Position[][][];
  ice: Position[][][];
  lakes: LakePiece[];
  rivers: { r: number; lines: Position[][] }[];
}

export interface Layers {
  land: { type: string; features: { geometry: { type: string; coordinates: unknown } | null; properties?: { r?: number } | null }[] };
  ice?: Layers["land"];
  lakes: Layers["land"];
  rivers: Layers["land"];
}

const polygonsOf = (g: { type: string; coordinates: unknown } | null): Position[][][] =>
  !g ? [] : g.type === "Polygon" ? [g.coordinates as Position[][]] : g.type === "MultiPolygon" ? (g.coordinates as Position[][][]) : [];

const linesOf = (g: { type: string; coordinates: unknown } | null): Position[][] =>
  !g ? [] : g.type === "LineString" ? [g.coordinates as Position[]] : g.type === "MultiLineString" ? (g.coordinates as Position[][]) : [];

/**
 * Cuts every layer into cells. Land, ice and rivers are clipped to the cell; a lake goes whole into every cell it
 * touches, so its outline is never cut (it is stroked, and a cut edge would show as a line across the water).
 * `lakeBase` keeps one source's lake numbers from meeting another's.
 */
export function splitLayers(layers: Layers, lakeBase = 0): Map<number, Piece> {
  const out = new Map<number, Piece>();
  const piece = (id: number): Piece => {
    let p = out.get(id);
    if (!p) out.set(id, (p = { land: [], ice: [], lakes: [], rivers: [] }));
    return p;
  };
  const polys = (fc: Layers["land"] | undefined, key: "land" | "ice") => {
    if (!fc) return;
    const into = new Map<number, Position[][][]>();
    for (const f of fc.features) for (const poly of polygonsOf(f.geometry)) splitPolygon(poly, into);
    for (const [id, list] of into) piece(id)[key].push(...list);
  };
  polys(layers.land, "land");
  polys(layers.ice, "ice");
  layers.lakes.features.forEach((f, i) => {
    const rings = polygonsOf(f.geometry);
    const ids = new Set<number>();
    for (const poly of rings)
      for (const id of splitRingCells(poly[0]!)) ids.add(id);
    for (const id of ids) piece(id).lakes.push({ id: lakeBase + i, rings });
  });
  const byRank = new Map<number, Map<number, Position[][]>>();
  for (const f of layers.rivers.features) {
    const r = Number(f.properties?.r ?? 9);
    let into = byRank.get(r);
    if (!into) byRank.set(r, (into = new Map()));
    for (const line of linesOf(f.geometry)) splitLine(line, into);
  }
  for (const [r, into] of byRank) for (const [id, lines] of into) piece(id).rivers.push({ r, lines });
  return out;
}

/** The cells a ring's bounding box covers (a lake is listed in all of them, a little generously). */
function splitRingCells(ring: Position[]): number[] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) {
    if (p[0]! < x0) x0 = p[0]!;
    if (p[0]! > x1) x1 = p[0]!;
    if (p[1]! < y0) y0 = p[1]!;
    if (p[1]! > y1) y1 = p[1]!;
  }
  const a = cellOf(x0, y0);
  const b = cellOf(x1, y1);
  const ids: number[] = [];
  for (let col = a.col; col <= b.col; col++) for (let row = a.row; row <= b.row; row++) ids.push(cellId({ col, row }));
  return ids;
}
