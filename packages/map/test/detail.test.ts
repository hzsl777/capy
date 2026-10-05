import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FeatureCollection, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { coastOf } from "../src/map/basemap.ts";
import { geoArea, geoEquirectangular } from "d3-geo";
import { CELL, area2, cellKey, cellOf, cellOfKey, clipPolygon, isGridCut, splitLayers, type Piece } from "../src/map/cells.ts";
import { Detail, cellsInView, compose, decodePiece, grown, joinLines, thinPiece, tolFor } from "../src/map/detail.ts";
import type { Basemap } from "../src/map/basemap.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = <T>(p: string): T => JSON.parse(readFileSync(here(p), "utf8")) as T;

const index = read<{ deg: number; q: number; tiles: string[] }>("../public/basemap/10m/index.json");
const pieces = new Map<string, Piece>();
for (const key of index.tiles) pieces.set(key, decodePiece(read<Topology>(`../public/basemap/10m/${key}.json`)));

const topo50 = read<Topology>("../public/basemap/world-50m.json");
const land50 = feature(topo50, topo50.objects.land as GeometryCollection) as FeatureCollection;

// ---- the cities --------------------------------------------------------------------------------------------

const inRing = (r: Position[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) c = !c;
  }
  return c;
};
const inPolygons = (polys: Position[][][], x: number, y: number) =>
  polys.some((p) => inRing(p[0]!, x, y) && !p.slice(1).some((h) => inRing(h, x, y)));

/** Kilometres from a point to the nearest edge of the lines, which a cell's border does not count as. */
function kmToCoast(lines: Position[][], x: number, y: number): number {
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const l of lines)
    for (let i = 0; i + 1 < l.length; i++) {
      const a = l[i]!;
      const b = l[i + 1]!;
      if (Math.abs(a[0]! - x) > 1 && Math.abs(b[0]! - x) > 1) continue;
      if (Math.abs(a[1]! - y) > 1 && Math.abs(b[1]! - y) > 1) continue;
      const ax = (a[0]! - x) * kx, ay = (a[1]! - y) * ky, bx = (b[0]! - x) * kx, by = (b[1]! - y) * ky;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  return best;
}

function polygonsOf(fc: FeatureCollection): Position[][][] {
  return fc.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : []));
}
const polys50 = polygonsOf(land50);
const coast50 = coastOf(land50).coordinates;

function detailAt(lon: number, lat: number) {
  const c = cellOf(lon, lat);
  const nearby: Piece[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const p = pieces.get(cellKey({ col: (c.col + dx + 36) % 36, row: Math.min(17, Math.max(0, c.row + dy)) }));
      if (p) nearby.push(p);
    }
  const own = pieces.get(cellKey(c));
  return { own, nearby };
}

const places = read<[string, string, number, number][]>("../../pipeline/data/places.json").map((r) => ({ lat: r[2], lon: r[3] }));
const outlets = [...readFileSync(here("../../../config/sources.yaml"), "utf8").matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => ({ lat: Number(m[1]), lon: Number(m[2]) }));

/** Points not on land, and those more than a kilometre from the coast as well. */
function seaCount(list: { lat: number; lon: number }[], detail: boolean) {
  let sea = 0;
  let far = 0;
  for (const c of list) {
    let on: boolean;
    let lines: Position[][];
    if (detail) {
      const { own, nearby } = detailAt(c.lon, c.lat);
      on = !!own && inPolygons(own.land, c.lon, c.lat);
      if (on) continue;
      lines = nearby.flatMap((p) => compose([p]).coast.coordinates);
    } else {
      on = inPolygons(polys50, c.lon, c.lat);
      if (on) continue;
      lines = coast50;
    }
    sea++;
    if (kmToCoast(lines, c.lon, c.lat) > 1) far++;
  }
  return { sea, far };
}

describe("the 10m detail cells", () => {
  it("name cells the way the local-story tiles are named", () => {
    expect(cellKey({ col: 19, row: 12 })).toBe("30N_10E");
    expect(cellOfKey("30N_10E")).toEqual({ col: 19, row: 12 });
    expect(cellKey({ col: 0, row: 0 })).toBe("90S_180W");
    expect(cellOfKey("40N_80W")).toEqual({ col: 10, row: 13 });
    expect(cellOfKey("45N_80W")).toBeNull();
    expect(cellOf(10.72, 34.75)).toEqual({ col: 19, row: 12 });
    expect(index.tiles).toContain("30N_10E");
  });

  it("hold land only inside their own cell, and every cell with land is listed", () => {
    for (const [key, p] of pieces) {
      const c = cellOfKey(key)!;
      const w = -180 + c.col * CELL;
      const s = -90 + c.row * CELL;
      const rings = [...p.land.flat(), ...p.ice.flat()];
      expect(rings.length).toBeGreaterThan(0);
      let out = 0;
      for (const r of rings)
        for (const [x, y] of r) if (x! < w - 1e-6 || x! > w + CELL + 1e-6 || y! < s - 1e-6 || y! > s + CELL + 1e-6) out++;
      expect(out).toBe(0);
    }
    expect(index.tiles.length).toBeGreaterThan(300);
  });

  it("cut a polygon at a border without stroking the cut, and join its coast across it", () => {
    // A square island across the 10 degree meridian, with a hole.
    const ring: Position[] = [[5, 1], [5, 9], [15, 9], [15, 1], [5, 1]];
    const hole: Position[] = [[8, 3], [12, 3], [12, 5], [8, 3]];
    const cut = splitLayers({
      land: { type: "FeatureCollection", features: [{ geometry: { type: "Polygon", coordinates: [ring, hole] }, properties: {} }] },
      lakes: { type: "FeatureCollection", features: [] },
      rivers: { type: "FeatureCollection", features: [{ geometry: { type: "LineString", coordinates: [[2, 5], [18, 5]] }, properties: { r: 3 } }] },
    });
    const a = cut.get(9 * 36 + 18)!;
    const b = cut.get(9 * 36 + 19)!;
    expect(a.land.length).toBe(1);
    expect(b.land.length).toBe(1);
    expect(a.rivers[0]!.lines[0]![a.rivers[0]!.lines[0]!.length - 1]).toEqual([10, 5]);
    expect(b.rivers[0]!.lines[0]![0]).toEqual([10, 5]);
    // Every edge along x = 10 is a cut and not a coast, so each side's coast starts and ends at the border.
    const coastA = coastOf({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: a.land } }] }, (p, q) => isGridCut(p, q));
    for (const l of coastA.coordinates) for (let i = 0; i + 1 < l.length; i++) expect(isGridCut(l[i]!, l[i + 1]!)).toBe(false);
    const whole = compose([a, b]);
    const open = whole.coast.coordinates.filter((l) => l[0]![0] !== l[l.length - 1]![0] || l[0]![1] !== l[l.length - 1]![1]);
    // The two halves of the outer ring are one closed line again, and the hole (across the border) is one too.
    expect(open.length).toBe(0);
    expect(whole.coast.coordinates.length).toBe(2);
  });

  it("cut a polygon that leaves a cell and comes back into separate simple rings, with no edge laid twice", () => {
    // A U shape (clockwise, land on the right): its arms stand in the cell, its base is below it.
    const u: Position[] = [[2, -5], [2, 8], [4, 8], [4, 1], [6, 1], [6, 8], [8, 8], [8, -5], [2, -5]];
    const cell = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const out = clipPolygon([u], cell);
    // Two arms are two rings, never one ring joined by a corridor along the border.
    expect(out.length).toBe(1);
    const areaOf = (polys: Position[][][]) => polys.reduce((a, p) => a + Math.abs(area2(p[0]!)) / 2, 0);
    // The U inside 0..10 by 0..10: two arms of 2 by 8, and a 2 by 1 span between them.
    expect(areaOf(out)).toBeCloseTo(2 * 8 * 2 + 2 * 1, 9);
    const top = clipPolygon([[[1, -5], [1, 15], [9, 15], [9, -5], [1, -5]], [[3, 2], [7, 2], [7, 8], [3, 8], [3, 2]]], cell);
    // A rectangle with a hole wholly inside it keeps the hole.
    expect(top.length).toBe(1);
    expect(top[0]!.length).toBe(2);
    // A hole that reaches the border opens into the ring, so no ring is a hole.
    const open = clipPolygon([[[-5, -5], [-5, 15], [15, 15], [15, -5], [-5, -5]], [[-2, 4], [3, 4], [3, 6], [-2, 6], [-2, 4]]] as Position[][], cell);
    expect(open.length).toBe(1);
    expect(open[0]!.length).toBe(1);
    expect(areaOf(open)).toBeCloseTo(100 - 3 * 2, 9);
    // A polygon that covers the cell, or none of it.
    expect(areaOf(clipPolygon([[[-5, -5], [-5, 15], [15, 15], [15, -5], [-5, -5]]], cell))).toBeCloseTo(100, 9);
    expect(clipPolygon([[[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]]], cell)).toEqual([]);
  });

  it("make polygons d3 reads the right way round, none inside out", () => {
    let bad = 0;
    for (const p of pieces.values()) for (const poly of p.land) if (geoArea({ type: "Polygon", coordinates: poly }) > 0.1) bad++;
    expect(bad).toBe(0);
  });

  it("thin a piece to the screen, keeping border points and dropping specks", () => {
    const line: Position[] = [];
    for (let i = 0; i <= 200; i++) line.push([10 + i * 0.001, 30 + Math.sin(i / 20) * 0.01]);
    const ring: Position[] = [[10, 30], [10, 31], [11, 31], [11, 30], [10, 30]];
    const speck: Position[] = [[12, 30], [12, 30.001], [12.001, 30.001], [12.001, 30], [12, 30]];
    const piece: Piece = { land: [[ring], [speck]], ice: [], lakes: [], rivers: [{ r: 3, lines: [line] }] };
    const thin = thinPiece(piece, 0.02);
    expect(thin.land.length).toBe(1);
    expect(thin.rivers[0]!.lines[0]!.length).toBeLessThan(40);
    expect(thin.rivers[0]!.lines[0]![0]).toEqual(line[0]);
    expect(thin.rivers[0]!.lines[0]!.at(-1)).toEqual(line.at(-1));
    expect(thinPiece(piece, 0.02)).toBe(thin);
    expect(tolFor(2000)).toBeLessThan(tolFor(1000));
  });

  it("find the cells a view shows, and no others", () => {
    const proj = geoEquirectangular().rotate([-10.7, 0]).center([0, 34.75]).scale(4000).translate([500, 430]);
    const frame = { x0: 0, y0: 0, x1: 1000, y1: 860 };
    const flood = cellsInView((p) => proj(p), frame, [10.7, 34.75]);
    const scan = cellsInView((p) => proj(p), frame);
    expect(flood.map((c) => cellKey(c)).sort()).toEqual(scan.map((c) => cellKey(c)).sort());
    expect(flood.map((c) => cellKey(c))).toContain("30N_10E");
    expect(flood.length).toBeLessThan(20);
    // A frame inside one cell still finds it.
    const small = cellsInView((p) => proj(p), { x0: 490, y0: 420, x1: 510, y1: 440 }, [10.7, 34.75]);
    expect(small.map((c) => cellKey(c))).toEqual(["30N_10E"]);
  });

  it("hand out the basemap only once every cell in view is here, and keep it while the view holds still", async () => {
    const fetched: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url));
      const name = String(url).split("/10m/")[1]!;
      return { ok: true, json: async () => JSON.parse(readFileSync(here(`../public/basemap/10m/${name}`), "utf8")) };
    }) as never;
    try {
      let changes = 0;
      const detail = new Detail("/", () => changes++);
      const empty = { type: "FeatureCollection", features: [] } as never;
      const high = { land: empty, coast: { type: "MultiLineString", coordinates: [] }, lakes: empty, rivers: empty } as Basemap;
      const cells = [cellOf(10.7, 34.75), cellOf(10.7, 38.1)];
      const ring = grown(cells, 1);
      // Nothing yet: the index is asked for, and the 50m basemap stays.
      expect(detail.update(high, cells, ring, true)).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      expect(detail.update(high, cells, ring, true)).toBeNull();
      for (let i = 0; i < 50 && !detail.update(high, cells, ring, true); i++) await new Promise((r) => setTimeout(r, 10));
      const map = detail.update(high, cells, ring, true, 0.004)!;
      expect(map).toBeTruthy();
      expect(map.land.features.length).toBeGreaterThan(0);
      expect(detail.update(high, cells, ring, true, 0.004)).toBe(map);
      expect(fetched.some((u) => u.endsWith("index.json"))).toBe(true);
      expect(fetched.filter((u) => !u.endsWith("index.json")).length).toBeGreaterThan(1);
      // Asked only for cells that hold land.
      for (const u of fetched) expect(cellOfKey(u.split("/10m/")[1]!.replace(".json", "")) !== null || u.endsWith("index.json")).toBe(true);
      detail.clear();
      expect(detail.size).toBe(0);
      expect(changes).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("join lines that meet end to end", () => {
    const joined = joinLines([[[0, 0], [1, 1]], [[2, 2], [1, 1]], [[2, 2], [3, 0]], [[7, 7], [8, 8]]]);
    expect(joined.length).toBe(2);
    expect(joined.map((l) => l.length).sort()).toEqual([2, 4]);
  });

  it("grow a list of cells round the world's edge", () => {
    const g = grown([{ col: 0, row: 5 }], 1);
    expect(g.length).toBe(9);
    expect(g.some((c) => c.col === 35)).toBe(true);
    expect(grown([{ col: 3, row: 0 }], 1).length).toBe(6);
  });

  it("put the listed cities and the outlets' cities on land far more often than 50m does", () => {
    const rows: Record<string, unknown> = {};
    for (const [label, list] of [["cities", places], ["outlets", outlets]] as const) {
      const before = seaCount(list, false);
      const after = seaCount(list, true);
      rows[label] = { total: list.length, "50m in the sea": before.sea, "50m over 1 km out": before.far, "10m in the sea": after.sea, "10m over 1 km out": after.far };
      console.log(label, JSON.stringify(rows[label]));
      // Measured: 495 listed cities and 119 outlet cities in the sea on 50m, 46 and 28 on 10m; 376 and 99 more than a
      // kilometre from the coast on 50m, 10 and 8 on 10m. The room left is for rebuilding with other settings.
      expect(after.sea, `${label} in the sea`).toBeLessThan(before.sea * (label === "cities" ? 0.15 : 0.3));
      expect(after.far, `${label} over 1 km out`).toBeLessThan(before.far * (label === "cities" ? 0.05 : 0.12));
    }
  });

  it("put the places the brief names on land", () => {
    const named: [string, number, number][] = [
      ["Palermo", 38.127, 13.348], ["Sfax", 34.75, 10.72], ["Valletta", 35.9, 14.515], ["Nabeul", 36.46, 10.73], ["Zarzis", 33.51, 11.1], ["Singapore", 1.29, 103.85], ["Hong Kong", 22.3, 114.17], ["Beirut", 33.89, 35.5],
    ];
    const lost = named.filter(([, lat, lon]) => {
      const { own, nearby } = detailAt(lon, lat);
      if (own && inPolygons(own.land, lon, lat)) return false;
      return kmToCoast(nearby.flatMap((p) => compose([p]).coast.coordinates), lon, lat) > 1;
    });
    expect(lost.map((l) => l[0])).toEqual([]);
  });

  it("keep the sample day's places off the sea too", () => {
    const sample = samplePlaces().map((p) => ({ lat: p.lat, lon: p.lon }));
    expect(seaCount(sample, true).far).toBeLessThanOrEqual(seaCount(sample, false).far);
  });
});
