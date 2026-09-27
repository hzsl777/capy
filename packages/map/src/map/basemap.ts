import { feature } from "topojson-client";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

export interface Basemap {
  land: FeatureCollection;
  lakes: FeatureCollection;
  rivers: FeatureCollection<LineString | MultiLineString, { r: number }>;
  ice?: FeatureCollection;
}

export interface Relief {
  peaks: [number, number][];
  dunes: [number, number][];
}

function toBasemap(topo: Topology): Basemap {
  const get = (name: string) =>
    topo.objects[name] ? (feature(topo, topo.objects[name] as GeometryCollection) as FeatureCollection) : undefined;
  return {
    land: get("land")!,
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
