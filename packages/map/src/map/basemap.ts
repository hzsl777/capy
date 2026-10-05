import { feature } from "topojson-client";
import type { FeatureCollection, LineString, MultiLineString, Position } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

export interface Basemap {
  land: FeatureCollection;
  /** Land outlines for stroking: the land's rings without the cuts the data makes at 180 degrees and at the pole. */
  coast: MultiLineString;
  lakes: FeatureCollection;
  rivers: FeatureCollection<LineString | MultiLineString, { r: number }>;
  ice?: FeatureCollection;
}

export interface Relief {
  peaks: [number, number][];
  dunes: [number, number][];
}

/** An edge the data adds to close a polygon, not a real coast: along the 180th meridian, or along the pole. */
export function isCut(a: Position, b: Position): boolean {
  return (Math.abs(a[0]!) > 179.99 && Math.abs(b[0]!) > 179.99) || (a[1]! < -89.99 && b[1]! < -89.99);
}

/** Every ring of the land split wherever it runs along a cut, so a stroke draws coastline only. `cut` says which edges are cuts. */
export function coastOf(land: FeatureCollection, cut: (a: Position, b: Position) => boolean = isCut): MultiLineString {
  const lines: Position[][] = [];
  const rings = land.features.flatMap((f) => {
    const g = f.geometry;
    if (g?.type === "Polygon") return g.coordinates;
    if (g?.type === "MultiPolygon") return g.coordinates.flat();
    return [];
  });
  for (const ring of rings) {
    let line: Position[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      if (i > 0 && cut(ring[i - 1]!, p)) {
        if (line.length > 1) lines.push(line);
        line = [];
      }
      line.push(p);
    }
    if (line.length > 1) lines.push(line);
  }
  return { type: "MultiLineString", coordinates: lines };
}

function toBasemap(topo: Topology): Basemap {
  const get = (name: string) =>
    topo.objects[name] ? (feature(topo, topo.objects[name] as GeometryCollection) as FeatureCollection) : undefined;
  const land = get("land")!;
  return {
    land,
    coast: coastOf(land),
    lakes: get("lakes")!,
    rivers: get("rivers") as Basemap["rivers"],
    ice: get("ice"),
  };
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadLow(base: string): Promise<Basemap> {
  return toBasemap(await json<Topology>(`${base}basemap/world-110m.json`));
}

export async function loadHigh(base: string): Promise<{ map: Basemap; relief: Relief }> {
  const [topo, relief] = await Promise.all([
    json<Topology>(`${base}basemap/world-50m.json`),
    json<Relief>(`${base}basemap/relief.json`),
  ]);
  return { map: toBasemap(topo), relief };
}
