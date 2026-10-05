// The detailed basemap for the closest zooms: Natural Earth's 10m land, lakes, rivers and ice in 10 degree cells
// (public/basemap/10m/, built by scripts/build-basemap.ts). The 50m basemap is off by several kilometres at a coast and
// leaves out small islands, so a town on a shore or on an island can land in the sea. Once a pixel is a few
// kilometres, the view asks for the cells it shows and draws those instead of 50m. This file loads and keeps the cells
// and puts the ones in view together into one `Basemap`, which every design draws as it would the 50m one.

import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { coastOf, isCut, type Basemap } from "./basemap.ts";
import { CELL, COLS, ROWS, cellId, cellKey, cellOf, cellOfKey, isGridCut, splitLayers, type Cell, type Piece } from "./cells.ts";

/** Cells away from the view that are loaded, so a drag meets them already here. */
const MAX_RING = 3;
/** The most cells kept (more when the view itself needs more); the ones least recently in view go first. */
const MAX_KEPT = 72;
const MAX_LOADING = 6;
/** Lake numbers of the 50m basemap's cells, kept clear of the 10m ones. */
const FIFTY_LAKES = 100000;

const cut = (a: Position, b: Position) => isCut(a, b) || isGridCut(a, b);

const polygons = (f: Feature): Position[][][] => {
  const g = f.geometry as Polygon | MultiPolygon | null;
  return !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
};

/** A cell's file read back into the shape the build cut it from. */
export function decodePiece(topo: Topology): Piece {
  const get = (name: string) =>
    topo.objects[name] ? (feature(topo, topo.objects[name] as GeometryCollection) as FeatureCollection).features : [];
  return {
    land: get("land").flatMap(polygons),
    ice: get("ice").flatMap(polygons),
    lakes: get("lakes").map((f) => ({ id: Number(f.id), rings: polygons(f) })),
    rivers: get("rivers").map((f) => ({ r: Number(f.properties?.r ?? 9), lines: (f.geometry as MultiLineString).coordinates })),
  };
}

const coasts = new WeakMap<Piece, Position[][]>();

/** A cell's coastline: its land's rings, less the edges the cell's border cuts. */
function coastOfPiece(p: Piece): Position[][] {
  let c = coasts.get(p);
  if (!c) {
    const land: FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: p.land } }] };
    c = coastOf(land, cut).coordinates;
    coasts.set(p, c);
  }
  return c;
}

const near = (a: Position, b: Position) => Math.abs(a[0]! - b[0]!) < 1e-6 && Math.abs(a[1]! - b[1]!) < 1e-6;
const endKey = (p: Position) => `${Math.round(p[0]! * 1e6)},${Math.round(p[1]! * 1e6)}`;

/**
 * Lines that meet end to end, as at a cell's border, made one line, so a stroke runs on across the border with its
 * joins and not as two lines with butt ends. Rings and lines with free ends are kept as they are.
 */
export function joinLines(lines: Position[][]): Position[][] {
  const ends = new Map<string, number[]>();
  const add = (p: Position, i: number) => {
    const k = endKey(p);
    const l = ends.get(k);
    if (l) l.push(i);
    else ends.set(k, [i]);
  };
  lines.forEach((l, i) => {
    if (l.length < 2 || near(l[0]!, l[l.length - 1]!)) return;
    add(l[0]!, i);
    add(l[l.length - 1]!, i);
  });
  const used = new Uint8Array(lines.length);
  const take = (p: Position): number => {
    for (const i of ends.get(endKey(p)) ?? []) if (!used[i]) return i;
    return -1;
  };
  const out: Position[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let line = lines[i]!;
    if (line.length < 2 || near(line[0]!, line[line.length - 1]!)) {
      out.push(line);
      continue;
    }
    line = line.slice();
    // Grow at the end, then at the start.
    for (let side = 0; side < 2; side++) {
      for (;;) {
        const j = take(line[line.length - 1]!);
        if (j < 0) break;
        used[j] = 1;
        const next = lines[j]!;
        const forward = near(next[0]!, line[line.length - 1]!);
        const seq = forward ? next : next.slice().reverse();
        for (let k = 1; k < seq.length; k++) line.push(seq[k]!);
      }
      line.reverse();
    }
    out.push(line);
  }
  return out;
}

// ---- thinning to the screen --------------------------------------------------------------------------------
// The 10m outlines have a point every few hundred metres. Seen from a few kilometres a pixel, most of them are a
// fraction of a pixel apart, and the canvas pays for every segment of a long stroke (a coast is stroked many times in
// some designs). So the pieces in view are thinned to about half a pixel, once per octave of zoom, and kept. Points on a
// cell's border always stay, so the cells still meet exactly and the cut edges are still found.

const COS = Math.PI / 180;
const onBorder = (v: number) => Math.abs(v / CELL - Math.round(v / CELL)) * CELL < 1e-6;

function thinLine(pts: Position[], tol: number, ring: boolean): Position[] {
  if (pts.length <= 8) return pts;
  const t2 = tol * tol;
  const out: Position[] = [pts[0]!];
  let last = pts[0]!;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const p = pts[i]!;
    const dx = (p[0]! - last[0]!) * Math.cos(p[1]! * COS);
    const dy = p[1]! - last[1]!;
    if (dx * dx + dy * dy >= t2 || onBorder(p[0]!) || onBorder(p[1]!)) {
      out.push(p);
      last = p;
    }
  }
  out.push(pts[end]!);
  // A ring left with under four points is a speck smaller than a pixel: it keeps its own shape, which is small.
  return ring && out.length < 4 ? pts : out;
}

/** Longest side of a ring's box, in degrees (longitude a little foreshortened: good enough for a size test). */
function extent(r: Position[]): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of r) {
    if (p[0]! < x0) x0 = p[0]!;
    if (p[0]! > x1) x1 = p[0]!;
    if (p[1]! < y0) y0 = p[1]!;
    if (p[1]! > y1) y1 = p[1]!;
  }
  return Math.max((x1 - x0) * Math.cos(((y0 + y1) / 2) * COS), y1 - y0);
}

/** A ring this many tolerances across or less is dropped. */
const SPECK = 1.5;

/** The last thinning of each piece. Only one is kept, so a piece never holds a copy for every zoom it has been seen at. */
const thinned = new WeakMap<Piece, { tol: number; piece: Piece }>();

/** A piece with every outline thinned to `tol` degrees; the same piece for the same `tol`. */
export function thinPiece(p: Piece, tol: number): Piece {
  const had = thinned.get(p);
  if (had?.tol === tol) return had.piece;
  const rings = (list: Position[][][]) =>
    list.flatMap((poly) => {
      // An island or lake smaller than a pixel and a half is left out: it would only be a speck of stroke.
      if (extent(poly[0]!) < tol * SPECK) return [];
      return [poly.filter((r, i) => i === 0 || extent(r) >= tol * SPECK).map((r) => thinLine(r, tol, true))];
    });
  const piece: Piece = {
    land: rings(p.land),
    ice: rings(p.ice),
    lakes: p.lakes.map((l) => ({ id: l.id, rings: rings(l.rings) })),
    rivers: p.rivers.map((r) => ({ r: r.r, lines: r.lines.map((l) => thinLine(l, tol, false)) })),
  };
  thinned.set(p, { tol, piece });
  return piece;
}

/** The thinning for a map drawn at `scale` pixels per radian: half a pixel, in the power of two of degrees below it. */
export const tolFor = (scale: number) => 2 ** Math.floor(Math.log2((1 * 180) / (Math.PI * scale)));

/** The pieces of cells put together as one basemap. */
export function compose(pieces: Piece[]): Basemap {
  const feat = <G extends MultiPolygon | MultiLineString, P>(geometry: G, properties: P): Feature<G, P> => ({ type: "Feature", properties, geometry });
  const land: FeatureCollection = { type: "FeatureCollection", features: [] };
  const ice: FeatureCollection = { type: "FeatureCollection", features: [] };
  const lakes: FeatureCollection = { type: "FeatureCollection", features: [] };
  const rivers: Basemap["rivers"] = { type: "FeatureCollection", features: [] };
  const seen = new Set<number>();
  const lines: Position[][] = [];
  for (const p of pieces) {
    if (p.land.length) land.features.push(feat({ type: "MultiPolygon", coordinates: p.land }, {}));
    if (p.ice.length) ice.features.push(feat({ type: "MultiPolygon", coordinates: p.ice }, {}));
    for (const l of p.lakes) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      lakes.features.push(feat({ type: "MultiPolygon", coordinates: l.rings }, {}));
    }
    for (const r of p.rivers) rivers.features.push(feat({ type: "MultiLineString", coordinates: r.lines }, { r: r.r }) as Feature<LineString | MultiLineString, { r: number }>);
    for (const l of coastOfPiece(p)) lines.push(l);
  }
  return { land, coast: { type: "MultiLineString", coordinates: joinLines(lines) }, lakes, rivers, ice };
}

/**
 * The cells whose picture reaches the screen (grown by `margin` pixels): a cell's corners, the middles of its sides and
 * its centre go through `project`, and the cell counts when their box meets the frame. A cell wider than the frame
 * still meets it, and a point turned away (null) is left out.
 */
export function cellsInView(
  project: (p: [number, number]) => [number, number] | null,
  frame: { x0: number; y0: number; x1: number; y1: number },
  seed?: [number, number] | null,
): Cell[] {
  const meets = (col: number, row: number) => {
    const s = -90 + row * CELL;
    const w = -180 + col * CELL;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 9; i++) {
      const q = project([w + (i % 3) * (CELL / 2), s + Math.floor(i / 3) * (CELL / 2)]);
      if (!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    // A cell the antimeridian of a rotated flat map runs through has corners at both ends of the picture, and a box
    // from one to the other: no cell is thousands of pixels wide where the cells are asked for.
    if (x1 - x0 > 4000) return false;
    return !(x1 < frame.x0 || x0 > frame.x1 || y1 < frame.y0 || y0 > frame.y1);
  };
  const out: Cell[] = [];
  if (!seed) {
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (meets(col, row)) out.push({ col, row });
    return out;
  }
  // From the cell under the frame's middle outwards while cells still meet the frame: a few cells, not all 648.
  const seen = new Set<number>();
  const todo: Cell[] = [cellOf(seed[0], seed[1])];
  seen.add(cellId(todo[0]!));
  while (todo.length) {
    const c = todo.shift()!;
    if (!meets(c.col, c.row)) continue;
    out.push(c);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const row = c.row + dy;
        if (row < 0 || row >= ROWS) continue;
        const n = { col: (((c.col + dx) % COLS) + COLS) % COLS, row };
        const id = cellId(n);
        if (seen.has(id)) continue;
        seen.add(id);
        todo.push(n);
      }
  }
  // A seed outside the frame (the middle on a cell that just misses) finds nothing; scan everything then.
  return out.length ? out : cellsInView(project, frame);
}

/** The cells within `r` cells of any in the list (east and west wrap round), the list's own first. */
export function grown(cells: Cell[], r: number): Cell[] {
  const seen = new Set(cells.map(cellId));
  const out = cells.slice();
  for (let d = 1; d <= r; d++) {
    for (const c of cells)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const row = c.row + dy;
          if (row < 0 || row >= ROWS) continue;
          const n = { col: (((c.col + dx) % COLS) + COLS) % COLS, row };
          const id = cellId(n);
          if (!seen.has(id)) {
            seen.add(id);
            out.push(n);
          }
        }
  }
  return out;
}

export const ringFor = (pxPerCell: number) => Math.max(1, Math.min(MAX_RING, Math.ceil(320 / Math.max(1, pxPerCell))));

interface Kept {
  piece: Piece;
  used: number;
}

/** Loads the detailed cells and hands out the basemap for the cells in view. */
export class Detail {
  private index?: Set<number>;
  private indexLoading = false;
  private indexFailed = -Infinity;
  private kept = new Map<number, Kept>();
  private loading = new Set<number>();
  private failed = new Set<number>();
  private queue: number[] = [];
  private fifty?: Map<number, Piece>;
  private ready = false;
  private last?: { sig: string; map: Basemap };
  private tick = 0;

  constructor(
    private base: string,
    private changed: () => void,
  ) {}

  /** How many cells are held, for the tests and the speed checks. */
  get size() {
    return this.kept.size;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  private loadIndex() {
    // After a failure, not again for half a minute, so a missing file is not asked for every frame.
    if (this.indexLoading || performance.now() - this.indexFailed < 30000) return;
    this.indexLoading = true;
    this.fetchJson<{ tiles: string[] }>(`${this.base}basemap/10m/index.json`)
      .then((j) => {
        this.index = new Set(j.tiles.map(cellOfKey).filter((c): c is Cell => !!c).map(cellId));
        this.changed();
      })
      .catch(() => {
        // Without the index the 50m basemap simply stays.
        this.indexLoading = false;
        this.indexFailed = performance.now();
      });
  }

  private pump() {
    while (this.loading.size < MAX_LOADING && this.queue.length) {
      const id = this.queue.shift()!;
      if (this.kept.has(id) || this.loading.has(id) || this.failed.has(id)) continue;
      this.loading.add(id);
      const cell = { col: id % COLS, row: Math.floor(id / COLS) };
      this.fetchJson<Topology>(`${this.base}basemap/10m/${cellKey(cell)}.json`)
        .then((t) => {
          const piece = decodePiece(t);
          // The coast is found as the cell arrives, so putting cells together while the map moves costs only the joining.
          coastOfPiece(piece);
          this.kept.set(id, { piece, used: this.tick });
        })
        .catch(() => this.failed.add(id))
        .finally(() => {
          this.loading.delete(id);
          this.pump();
          this.changed();
        });
    }
  }

  /** Lets go of every cell, as when the view zooms back out. */
  clear() {
    this.queue = [];
    this.kept.clear();
    this.ready = false;
    this.last = undefined;
  }

  /**
   * Asks for the cells in view and the ring round them. With `show` it returns the basemap for the cells in view once
   * they have all arrived (and from then on, with a 50m piece in the place of any cell that has not): until then
   * null, and the 50m basemap stays on screen, so the coast never changes under the reader a piece at a time.
   */
  update(high: Basemap, cells: Cell[], ring: Cell[], show: boolean, tol = 0): Basemap | null {
    if (!this.index) {
      this.loadIndex();
      return null;
    }
    this.tick++;
    const index = this.index;
    this.queue = ring.map(cellId).filter((id) => index.has(id) && !this.kept.has(id) && !this.failed.has(id));
    // The view's own cells first, nearest the middle of the list.
    for (const c of cells) {
      const k = this.kept.get(cellId(c));
      if (k) k.used = this.tick;
    }
    for (const c of ring) {
      const k = this.kept.get(cellId(c));
      if (k) k.used = this.tick;
    }
    this.pump();
    const cap = Math.max(MAX_KEPT, ring.length + 8);
    if (this.kept.size > cap) {
      const order = [...this.kept.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [id] of order) {
        if (this.kept.size <= cap) break;
        this.kept.delete(id);
      }
    }
    if (!show) return null;
    const wanted = cells.map(cellId).filter((id) => index.has(id));
    const missing = wanted.some((id) => !this.kept.has(id));
    if (!this.ready) {
      if (missing) return null;
      this.ready = true;
    }
    const sig = `${tol}:${wanted.map((id) => (this.kept.has(id) ? id : -id - 1)).join(",")}`;
    if (this.last?.sig === sig) return this.last.map;
    const pieces: Piece[] = [];
    for (const id of wanted) {
      const k = this.kept.get(id);
      if (k) pieces.push(k.piece);
      else {
        this.fifty ??= splitLayers(
          { land: high.land, ice: high.ice ?? { type: "FeatureCollection", features: [] }, lakes: high.lakes, rivers: high.rivers } as never,
          FIFTY_LAKES,
        );
        const f = this.fifty.get(id);
        if (f) pieces.push(f);
      }
    }
    const map = compose(tol ? pieces.map((p) => thinPiece(p, tol)) : pieces);
    this.last = { sig, map };
    return map;
  }
}
